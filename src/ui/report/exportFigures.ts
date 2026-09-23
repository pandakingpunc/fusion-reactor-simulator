/**
 * Rapor ekranından yayın kalitesinde figür dışa aktarımı (SVG / PDF, tarayıcıda üretilir).
 * Bu modül tıklamada dinamik içe aktarılır (grafik kütüphanesi ana pakete girmez).
 */
import { DiagSpec, HistoryFrame, MagneticConfig, ReactorConfig, SimEvent } from '../../physics/types';
import { DEFAULT_PROFILE_SETTINGS } from '../../physics/profiles/defaults';
import { Figure } from '../../plot/figure';
import { figTimeTraces } from '../../plot/figures/timetrace';
import { figProfiles } from '../../plot/figures/profiles';
import { figDiagGroups, figEqSnapshot } from '../../plot/figures/generic';

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

function save(fileName: string, data: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

export function exportFigure(shot: FigureShot, kind: FigureKind, format: 'svg' | 'pdf'): void {
  const fig = buildFigure(shot, kind);
  const base = `${shot.name.replace(/[^\w\-]+/g, '_').slice(0, 50) || 'shot'}_${kind}`;
  if (format === 'svg') save(`${base}.svg`, fig.toSVG(), 'image/svg+xml');
  else save(`${base}.pdf`, new Uint8Array(fig.toPDF()) as Uint8Array<ArrayBuffer>, 'application/pdf');
}
