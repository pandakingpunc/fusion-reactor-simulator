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
import { exportFigure, FigureShot } from '../ui/report/exportFigures';

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
