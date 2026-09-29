/**
 * Şekil: doğrulama — benzetim / yayımlanmış referans oranı (log ölçek), 0D ve 1.5D modeller için.
 * Gölgeli bantlar ±%30 ve ×2. Sağ eksende referans değerleri.
 */
import { Figure } from '../figure';
import { C, COL1 } from './common';

export interface ValidationRow {
  /** sol etiket (mathtext) */
  label: string;
  /** yayımlanmış referans değer ve kısa gösterimi */
  ref: number;
  refText: string;
  v0D?: number;
  v15D?: number;
  /**
   * Published uncertainty range of the reference (same unit as `ref`), drawn as a band around the row's
   * reference (ratio 1). Values must come from the reference itself, never from model output.
   */
  refLo?: number;
  refHi?: number;
  /** interval of the simulated value (e.g. a 5-95 % UQ interval), same unit as `ref`, drawn as an error bar */
  v0DLo?: number;
  v0DHi?: number;
  v15DLo?: number;
  v15DHi?: number;
}

const fin = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && v > 0;

export function figValidation(rows: ValidationRow[]): Figure {
  const n = rows.length;
  const H = 0.75 + 0.2 * n;
  const fig = new Figure(COL1 * 1.5, H, { fontSize: 8, title: 'Validation against published values' });
  const [ax] = fig.subplots(1, 1, { left: 1.35, right: 0.95, top: 0.22, bottom: 0.5 });
  const ys = rows.map((_, k) => n - k);
  ax.axvspan(0.5, 2, { color: C.grey, alpha: 0.1, label: '×2' });
  ax.axvspan(1 / 1.3, 1.3, { color: C.grey, alpha: 0.22, label: '±30%' });
  ax.axvline(1, { color: C.black, lw: 0.6, dash: 'solid' });
  // published uncertainty of the reference: a band around ratio 1 in each row that has one
  let bandLabel: string | undefined = 'reference range';
  rows.forEach((r, k) => {
    if (!fin(r.refLo) || !fin(r.refHi) || !fin(r.ref)) return;
    const a = Math.min(r.refLo, r.refHi) / r.ref, b = Math.max(r.refLo, r.refHi) / r.ref;
    ax.polygon([a, b, b, a], [ys[k] - 0.36, ys[k] - 0.36, ys[k] + 0.36, ys[k] + 0.36], { fill: C.sky, alpha: 0.55, lw: 0, z: 0, label: bandLabel });
    bandLabel = undefined;
  });
  // intervals of the simulated values: horizontal error bars with end caps
  const errBars = (lo: (r: ValidationRow) => number | undefined, hi: (r: ValidationRow) => number | undefined, v: (r: ValidationRow) => number | undefined, dy: (r: ValidationRow) => number, color: string) => {
    const bx: number[] = [], by: number[] = [], cx: number[] = [], cy: number[] = [];
    rows.forEach((r, k) => {
      const a = lo(r), b = hi(r);
      if (!fin(v(r)) || !fin(a) || !fin(b) || !fin(r.ref)) return;
      const y = ys[k] + dy(r);
      bx.push(a / r.ref, b / r.ref, NaN); by.push(y, y, NaN);
      for (const e of [a, b]) { cx.push(e / r.ref, e / r.ref, NaN); cy.push(y - 0.07, y + 0.07, NaN); }
    });
    if (bx.length) { ax.plot(bx, by, { color, lw: 0.7 }); ax.plot(cx, cy, { color, lw: 0.7 }); }
  };
  errBars((r) => r.v0DLo, (r) => r.v0DHi, (r) => r.v0D, (r) => (r.v15D !== undefined ? 0.13 : 0), C.blue);
  errBars((r) => r.v15DLo, (r) => r.v15DHi, (r) => r.v15D, (r) => (r.v0D !== undefined ? -0.13 : 0), C.vermilion);
  const x0: number[] = [], y0: number[] = [], x1: number[] = [], y1: number[] = [];
  rows.forEach((r, k) => {
    if (r.v0D !== undefined && Number.isFinite(r.v0D)) { x0.push(r.v0D / r.ref); y0.push(ys[k] + (r.v15D !== undefined ? 0.13 : 0)); }
    if (r.v15D !== undefined && Number.isFinite(r.v15D)) { x1.push(r.v15D / r.ref); y1.push(ys[k] - (r.v0D !== undefined ? 0.13 : 0)); }
  });
  ax.plot(x0, y0, { marker: 'o', ms: 4, mfc: 'none', color: C.blue, lw: 0, label: '0D' });
  ax.plot(x1, y1, { marker: 's', ms: 3.6, color: C.vermilion, lw: 0, label: '1.5D' });
  // satır ayırıcıları (makine grupları)
  let prev = '';
  rows.forEach((r, k) => {
    const m = r.label.split(' ')[0];
    if (prev && m !== prev) ax.axhline(ys[k] + 0.5, { color: '#cccccc', lw: 0.4, dash: 'solid' });
    prev = m;
  });
  const yl: [number, number] = [0.4, n + 0.6];
  ax.set({ xscale: 'log', xlim: [0.25, 4], ylim: yl, yticks: ys, yticklabels: rows.map((r) => r.label), xlabel: 'simulation / reference', xticks: [0.25, 0.5, 1, 2, 4], xticklabels: ['0.25', '0.5', '1', '2', '4'] })
    .legend({ loc: 'lower right', frame: true, size: 6.5 });
  const right = ax.twinx();
  right.plot([1, 1], yl, { lw: 0 });
  right.set({ ylim: yl, yticks: ys, yticklabels: rows.map((r) => r.refText) });
  fig.text(1 - 0.02, 1 - 0.19 / H, 'reference', { anchor: 'end', size: 7 });
  return fig;
}
