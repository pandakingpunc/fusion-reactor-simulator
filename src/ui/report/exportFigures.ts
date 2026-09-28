/**
 * Rapor ekranından yayın kalitesinde figür dışa aktarımı (SVG / PDF, tarayıcıda üretilir).
 * Bu modül tıklamada dinamik içe aktarılır (grafik kütüphanesi ana pakete girmez).
 *
 * Fonts: the STIX Two TTF files are fetched lazily, only when exporting, from Vite asset URLs
 * (bundled as separate hashed files, never inlined). The three text faces are loaded first; STIX Two
 * Math (≈1.5 MB) only when a label needs a symbol the text faces lack. Loaded fonts are cached for
 * the session.
 */
import { DiagSpec, HistoryFrame, MagneticConfig, ReactorConfig, SimEvent } from '../../physics/types';
import { DEFAULT_PROFILE_SETTINGS } from '../../physics/profiles/defaults';
import { Figure } from '../../plot/figure';
import { FontKey, FontProvider, FontSet, loadFontSet } from '../../plot/fonts';
import { toPDF } from '../../plot/pdf';
import { toSVG } from '../../plot/svg';
import { canonicalJSON, sha256Hex } from '../../plot/sha256';
import { figTimeTraces } from '../../plot/figures/timetrace';
import { figProfiles } from '../../plot/figures/profiles';
import { figDiagGroups, figEqSnapshot } from '../../plot/figures/generic';
import { version } from '../../../package.json';

export type FigureKind = 'traces' | 'profiles' | 'cross';

export interface FigureShot { name: string; cfg: ReactorConfig; frames: HistoryFrame[]; events: SimEvent[]; diagSpecs: DiagSpec[]; timeUnit: string }

function lastWith<K extends 'prof' | 'eq'>(frames: HistoryFrame[], k: K): HistoryFrame | null {
  for (let i = frames.length - 1; i >= 0; i--) if (frames[i][k]) return frames[i];
  return null;
}

export function buildFigure(shot: FigureShot, kind: FigureKind): Figure {
  const { frames, events, diagSpecs, timeUnit, name } = shot;
  const is15 = frames.some((f) => f.prof);
  if (kind === 'profiles') {
    const f = lastWith(frames, 'prof')!;
    const pw = (shot.cfg as MagneticConfig).profiles?.pedestalWidth ?? DEFAULT_PROFILE_SETTINGS.pedestalWidth;
    return figProfiles({ frame: f, pedestalWidth: pw, label: `${name}, t = ${f.t.toFixed(1)} s` });
  }
  if (kind === 'cross') {
    const fe = lastWith(frames, 'eq')!, fp = lastWith(frames, 'prof');
    return figEqSnapshot(fe.eq!, fp?.prof ? { rho: fp.prof.rho, Te: fp.prof.Te } : null, `${name}, t = ${fe.t.toFixed(1)} s`);
  }
  if (is15) return figTimeTraces(frames.filter((f) => f.prof), events, name);
  const pref = ['Performance', 'Power', 'Temperature', 'Density', 'MHD', 'Confinement', 'Radiation', 'Energy'];
  const groups = [...new Set(diagSpecs.map((s) => s.group))];
  const pick = [...pref.filter((g) => groups.includes(g)), ...groups.filter((g) => !pref.includes(g))].slice(0, 4);
  return figDiagGroups(frames, diagSpecs, pick, timeUnit, name, events);
}

/** Vite rewrites each `new URL('<literal>', import.meta.url)` into the URL of the emitted asset. */
function fontUrl(key: FontKey): URL {
  switch (key) {
    case 'roman': return new URL('../../../assets/fonts/stix-two/STIXTwoText-Regular.ttf', import.meta.url);
    case 'italic': return new URL('../../../assets/fonts/stix-two/STIXTwoText-Italic.ttf', import.meta.url);
    case 'bold': return new URL('../../../assets/fonts/stix-two/STIXTwoText-Bold.ttf', import.meta.url);
    case 'math': return new URL('../../../assets/fonts/stix-two/STIXTwoMath-Regular.ttf', import.meta.url);
  }
}

const fontCache = new Map<FontKey, Promise<Uint8Array>>();
const fetchFont: FontProvider = (_file, key) => {
  let p = fontCache.get(key);
  if (!p) {
    p = fetch(fontUrl(key)).then(async (r) => {
      if (!r.ok) throw new Error(`font ${key}: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    });
    p.catch(() => fontCache.delete(key)); // retry on the next export
    fontCache.set(key, p);
  }
  return p;
};

function save(fileName: string, data: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

/** Builds, lays out (STIX Two metrics) and downloads a figure; resolves when the download has been started. */
export async function exportFigure(shot: FigureShot, kind: FigureKind, format: 'svg' | 'pdf'): Promise<void> {
  const fig = buildFigure(shot, kind);
  let fonts: FontSet = await loadFontSet(fetchFont, ['roman', 'italic', 'bold']);
  let dl = fig.render(fonts);
  if (fonts.missingFace) { fonts = await loadFontSet(fetchFont); dl = fig.render(fonts); }
  // metadata: software version and configuration hash only (reproducible; no dates, no git SHA)
  const meta = { title: fig.title, version, configHash: sha256Hex(canonicalJSON({ id: `ui:${kind}`, config: shot.cfg })) };
  const base = `${shot.name.replace(/[^\w\-]+/g, '_').slice(0, 50) || 'shot'}_${kind}`;
  if (format === 'svg') save(`${base}.svg`, toSVG(dl, meta), 'image/svg+xml');
  else save(`${base}.pdf`, new Uint8Array(toPDF(dl, meta)) as Uint8Array<ArrayBuffer>, 'application/pdf');
}
