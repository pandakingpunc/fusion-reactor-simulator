/// <reference types="node" />
/**
 * Browser figure export (src/ui/report/exportFigures.ts) with fetch and the download link stubbed:
 * fonts are fetched lazily from the asset URLs, STIX Two Math only when a label needs it, and the
 * downloaded PDF embeds the fonts and carries version + configuration hash.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ITER } from '../physics/presets';
import { DiagSpec, HistoryFrame } from '../physics/types';
import { buildFigure, exportFigure, FigureShot, MAX_EXPORT_FRAMES, RHOT_QUANTITIES } from '../ui/report/exportFigures';
import { DIAG_SPECS, syntheticEvents, syntheticFrames } from './figures/testdata/synthetic';

const fetched: string[] = [];
let saved: { name: string; blob: Blob }[] = [];
let removed = 0;
let revoked: string[] = [];

beforeEach(() => {
  fetched.length = 0; saved = []; removed = 0; revoked = [];
  // save() removes its link and revokes the object URL 100 ms after the click. On a real timer that callback fired
  // after the test (and, in the last test of the file, after the environment was torn down), when the document stub
  // was gone: "ReferenceError: document is not defined" as an unhandled error that failed `npm run coverage`.
  // Only setTimeout is faked, and afterEach runs the pending cleanup while the stubs are still in place.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('fetch', async (u: URL) => { fetched.push(u.pathname.split('/').pop()!); return new Response(readFileSync(fileURLToPath(u))); });
  const a = { href: '', download: '', click: () => { saved.push({ name: a.download, blob: blobs.get(a.href)! }); } };
  const blobs = new Map<string, Blob>();
  vi.stubGlobal('document', { createElement: () => a, body: { appendChild: () => {}, removeChild: () => { removed++; } } });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { const k = `blob:${blobs.size}`; blobs.set(k, b as Blob); return k; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => { revoked.push(u); });
});
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function shot(label: string): FigureShot {
  const diagSpecs: DiagSpec[] = [{ key: 'a', label, unit: 'MW', group: 'Power' }, { key: 'b', label: 'β_N', unit: '', group: 'MHD' }];
  const frames: HistoryFrame[] = Array.from({ length: 50 }, (_, i) => ({ t: i, y: [], internal: {}, d: { a: Math.sin(i / 5), b: 2 + Math.cos(i / 7) } }));
  return { name: 'Şebeke ğ test', cfg: ITER, frames, events: [], diagSpecs, timeUnit: 's' };
}

describe('browser figure export', () => {
  it('fetches only the text faces when no math symbol is needed; the PDF embeds them', async () => {
    await exportFigure(shot('P_alpha ρ τ'), 'traces', 'pdf');
    expect(fetched.sort()).toEqual(['STIXTwoText-Bold.ttf', 'STIXTwoText-Italic.ttf', 'STIXTwoText-Regular.ttf']);
    expect(saved.length).toBe(1);
    expect(saved[0].name).toBe('_ebeke_test_traces.pdf');
    const pdf = new TextDecoder('latin1').decode(new Uint8Array(await saved[0].blob.arrayBuffer()));
    expect(pdf).toMatch(/\/FontFile2 \d+ 0 R/);
    expect(pdf).toMatch(/\/FRSConfigSHA256 \([0-9a-f]{64}\)/);
    expect(pdf).toMatch(/\/FRSVersion \(\d+\.\d+\.\d+\)/);
  });

  it('adds STIX Two Math for a label with ≈ (and caches the text faces)', async () => {
    await exportFigure(shot('P ≈ ∝ ∞'), 'traces', 'svg');
    expect(fetched).toEqual(['STIXTwoMath-Regular.ttf']); // text faces already cached by the previous export
    const svg = await saved[0].blob.text();
    expect(svg).toContain('≈');
    expect(svg).toMatch(/config-sha256="[0-9a-f]{64}"/);
  });

  it('removes the download link and revokes the object URL 100 ms after the click, not before', async () => {
    await exportFigure(shot('P_alpha ρ τ'), 'traces', 'svg');
    expect(saved.length).toBe(1);
    expect(removed).toBe(0);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(99);
    expect(removed).toBe(0);
    vi.advanceTimersByTime(1);
    expect(removed).toBe(1);
    expect(revoked).toEqual(['blob:0']);
  });
});

/** a 1.5D shot (frames with profiles) of n frames, and a 0D shot of the same length */
const shot15 = (n = 40): FigureShot => ({ name: 'Synthetic 1.5D', cfg: ITER, frames: syntheticFrames(n), events: syntheticEvents(), diagSpecs: DIAG_SPECS, timeUnit: 's' });
const shot0D = (n: number): FigureShot => ({
  name: 'Synthetic 0D', cfg: ITER, events: syntheticEvents(n), diagSpecs: DIAG_SPECS, timeUnit: 's',
  frames: Array.from({ length: n }, (_, i) => ({
    t: i * 0.01, y: [], internal: {},
    d: { Q: 5 + Math.sin(i / 300), Pfus: 400 + 30 * Math.sin(i / 90), P_alpha: 80, P_aux: 50, P_rad: 20 + (i % 500 === 0 ? 40 : 0), Te0: 20, Ti0: 18, nbar: 0.8 },
  })),
});
const lineLengths = (fig: ReturnType<typeof buildFigure>) => fig.axes.flatMap((ax) => ax.artists.filter((a) => a.k === 'line').map((a) => (a as { x: ArrayLike<number> }).x.length));

describe('radius-time map export', () => {
  it('exports the chosen profile as an SVG with a raster and the key in the file name and configuration hash', async () => {
    await exportFigure(shot15(), 'rhot', 'svg', { rhoTKey: 'ne' });
    await exportFigure(shot15(), 'rhot', 'svg');
    expect(saved.map((f) => f.name)).toEqual(['Synthetic_1_5D_rhot_ne.svg', 'Synthetic_1_5D_rhot_Te.svg']);
    const [ne, te] = await Promise.all(saved.map((f) => f.blob.text()));
    expect(ne).toContain('<image ');
    expect(ne.match(/config-sha256="([0-9a-f]{64})"/)![1]).not.toBe(te.match(/config-sha256="([0-9a-f]{64})"/)![1]);
  });

  it('every listed quantity builds from a 1.5D shot; a 0D shot (no profiles) and an unknown key are refused clearly', () => {
    for (const key of Object.keys(RHOT_QUANTITIES)) expect(() => buildFigure(shot15(), 'rhot', { rhoTKey: key }), key).not.toThrow();
    expect(() => buildFigure(shot0D(50), 'rhot')).toThrow(/radius-time map: the shot has no 1.5D profile 'Te'/);
    expect(() => buildFigure(shot15(), 'rhot', { rhoTKey: 'no_such_profile' })).toThrow(/profile 'no_such_profile'/);
  });
});

describe('long histories are thinned before they are plotted', () => {
  it('a 0D history up to the limit is drawn as it is; a longer one is min/max decimated (events and extremes kept)', () => {
    const exact = lineLengths(buildFigure(shot0D(MAX_EXPORT_FRAMES), 'traces'));
    expect(Math.max(...exact)).toBe(MAX_EXPORT_FRAMES);
    const long = shot0D(30000);
    const thin = lineLengths(buildFigure(long, 'traces'));
    expect(Math.max(...thin)).toBeLessThan(MAX_EXPORT_FRAMES + 200);
    expect(Math.max(...thin)).toBeGreaterThan(500);
    // the P_rad bursts (every 500th frame) are the maxima of a bucket: still in the drawn data
    const fig = buildFigure(long, 'traces');
    const rad = fig.axes.flatMap((ax) => ax.artists).filter((a) => a.k === 'line' && Math.max(...Array.from((a as { y: ArrayLike<number> }).y)) === 60).length;
    expect(rad).toBeGreaterThan(0);
  });

  it('a long 1.5D history is thinned as well', () => {
    const fig = buildFigure(shot15(9000), 'traces');
    expect(Math.max(...lineLengths(fig))).toBeLessThan(9000);
    expect(Math.max(...lineLengths(fig))).toBeGreaterThan(100); // smooth series: only the bucket extremes remain
    expect(Math.max(...lineLengths(buildFigure(shot15(300), 'traces')))).toBe(300);
  });
});
