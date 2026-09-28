/**
 * Şekil: çok çekirdekli 0D parametre taraması — düz tepe Q'nun H98 ve n̄/n_G'ye bağlılığı
 * (renk), Q = 5, 10, 20 eş-eğrileri ve referans senaryonun konumu.
 */
import { Figure } from '../figure';
import { C, COL1, contourLabel } from './common';

export interface ScanData {
  /** x ekseni: n_hedef / n_G ; y ekseni: H98 */
  x: number[];
  y: number[];
  /** Q[j·nx + i] (satır-öncelikli, j = H98 indeksi) */
  Q: number[];
  Pfus: number[];
  ref: { x: number; y: number; label: string };
  label?: string;
}

export function figScan(s: ScanData): Figure {
  const nx = s.x.length, ny = s.y.length;
  const fig = new Figure(COL1 * 1.35, 3.1, { fontSize: 8, title: 'Operating-space scan' });
  const [ax] = fig.subplots(1, 1, { left: 0.52, right: 0.85, top: 0.22, bottom: 0.45 });
  const dx = s.x[1] - s.x[0], dy = s.y[1] - s.y[0];
  // colour scale capped at Q = 40; missing runs (NaN: aborted discharges) stay blank, and an all-NaN scan still renders
  const finite = s.Q.filter(Number.isFinite);
  const qmax = finite.length ? Math.min(40, Math.max(...finite)) : NaN;
  const vmax = qmax > 0 ? qmax : 1;
  const map = ax.image(s.Q.map((v) => (Number.isFinite(v) ? Math.min(v, vmax) : NaN)), nx, ny, [s.x[0] - dx / 2, s.x[nx - 1] + dx / 2, s.y[0] - dy / 2, s.y[ny - 1] + dy / 2], { cmap: 'magma', vmin: 0, vmax, smooth: true });
  fig.colorbar(map, ax, { label: 'flat-top $Q$', width: 0.1, pad: 0.08 });
  const lv = [5, 10, 15];
  ax.contour(s.x, s.y, s.Q, lv, { colors: ['#ffffff', C.sky, '#ffffff'], lw: 0.9 });
  lv.forEach((v, k) => contourLabel(ax, s.x, s.y, s.Q, v, `$Q$ = ${v}`, { size: 6, pos: 0.3 + 0.2 * k }));
  ax.plot([s.ref.x], [s.ref.y], { marker: 'd', ms: 5, color: '#ffffff', mfc: C.vermilion, lw: 0, label: s.ref.label });
  ax.set({ xlim: [s.x[0] - dx / 2, s.x[nx - 1] + dx / 2], ylim: [s.y[0] - dy / 2, s.y[ny - 1] + dy / 2], xlabel: '$n_{\\mathrm{target}}/n_{\\mathrm{G}}$', ylabel: '$H_{98(y,2)}$', title: s.label })
    .legend({ loc: 'lower right', frame: true, size: 6.5 });
  return fig;
}
