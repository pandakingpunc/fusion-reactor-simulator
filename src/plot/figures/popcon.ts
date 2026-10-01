/**
 * Şekil: POPCON — (⟨n_e⟩, ⟨T⟩) düzleminde 0D kararlı durum Q haritası (renk), gereken yardımcı
 * güç P_aux eş-eğrileri (etiketli), ateşleme sınırı (P_aux = 0), Greenwald yoğunluğu, β_N sınırı
 * ve L–H eşiği; üzerine 1.5D atışın hacim-ortalamalı yörüngesi.
 */
import { MagneticConfig } from '../../physics/types';
import { PopconGrid, computePopcon } from '../../physics/popcon';
import { Figure } from '../figure';
import { C, COL1, contourLabel } from './common';

export interface PopconFigInput {
  cfg: MagneticConfig;
  /** 1.5D yörünge: ⟨n_e⟩ [10²⁰ m⁻³], ⟨T⟩ = (⟨T_e⟩+⟨T_i⟩)/2 [keV] */
  traj?: { n: number[]; T: number[] };
  label?: string;
  res?: number;
  /** precomputed grid (e.g. from a worker-pool task); computed here when absent */
  grid?: PopconGrid;
}

export function figPopcon(inp: PopconFigInput): Figure {
  const { cfg } = inp;
  const TMAX = 30;
  const g = inp.grid ?? computePopcon(cfg, { nx: inp.res ?? 110, ny: inp.res ?? 110, Tmax: TMAX, nMaxFactor: 1.35, uniformT: true });
  const NX = g.nx, NY = g.ny;
  const x = g.n.map((v) => v / 1e20), y = g.T;
  // PopconGrid indeksi i·ny + j → satır-öncelikli (j·nx + i)
  const T = (src: ArrayLike<number>, f: (v: number) => number = (v) => v) => {
    const out = new Float64Array(NX * NY);
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) out[j * NX + i] = f(src[i * NY + j]);
    return out;
  };
  const Pa = T(g.Paux, (v) => v / 1e6);
  const Qc = T(g.Q, (v) => (Number.isFinite(v) ? Math.min(Math.max(v, 0.01), 100) : 100));
  const bN = T(g.betaN), lh = T(g.PLH_ok);

  const fig = new Figure(COL1 * 1.45, 3.6, { fontSize: 8, title: 'POPCON' });
  const [ax] = fig.subplots(1, 1, { left: 0.52, right: 0.85, top: 0.22, bottom: 0.45 });
  const nMax = x[NX - 1] + x[0];
  const map = ax.image(Qc, NX, NY, [0, nMax, 0, TMAX], { cmap: 'viridis', vmin: 0.3, vmax: 30, log: true });
  fig.colorbar(map, ax, { label: '$Q = P_{\\mathrm{fus}}/P_{\\mathrm{aux}}$', width: 0.1, pad: 0.08 });
  // P_aux eş-eğrileri (beyaz, etiketli)
  const levels = [10, 25, 50, 100, 200];
  ax.contour(x, y, Pa, levels, { colors: '#ffffff', lw: 0.5 });
  // labels away from the trajectory and from each other. The Q = 5 and 10 contours have few free places (they run along the trajectory and
  // the legend), the P_aux contours many, so the Q labels are placed first and the P_aux labels take the remaining room.
  const Qraw = T(g.Q, (v) => (Number.isFinite(v) ? v : 1e3));
  const avoid: [number, number][] = [[0.1, 28], [0.3, 28], [0.1, 24], [0.3, 24]]; // sol üstteki lejant
  if (inp.traj) for (let i = 0; i < inp.traj.n.length; i += 4) avoid.push([inp.traj.n[i], inp.traj.T[i]]);
  if (inp.traj?.n.length) avoid.push([inp.traj.n[inp.traj.n.length - 1], inp.traj.T[inp.traj.T.length - 1]]);
  for (const lv of [5, 10]) { const at = contourLabel(ax, x, y, Qraw, lv, `$Q$ = ${lv}`, { size: 5.5, avoid }); if (at) avoid.push(at); }
  for (const lv of levels) { const at = contourLabel(ax, x, y, Pa, lv, `${lv} MW`, { size: 5.5, avoid }); if (at) avoid.push(at); }
  // sabit Q eğrileri ve ateşleme sınırı (varsa)
  ax.contour(x, y, Qraw, [5, 10], { colors: C.black, lw: 0.7, dash: 'dashed', label: '$Q$ = 5, 10' });
  ax.contour(x, y, Pa, [0], { colors: C.black, lw: 1.1, label: 'ignition ($P_{\\mathrm{aux}} = 0$)' });
  // β_N sınırı ve L–H eşiği
  ax.contour(x, y, bN, [cfg.limits.betaN_limit], { colors: C.vermilion, lw: 0.9, dash: 'dashed', label: `$\\beta_N$ = ${cfg.limits.betaN_limit}` });
  ax.contour(x, y, lh, [0.5], { colors: C.blue, lw: 1.0, dash: 'dotted', label: '$P_{\\mathrm{heat}} = P_{\\mathrm{LH}}$' });
  // Greenwald limit on the volume-average axis: grid.nG = n_G / lineAverageFactor(α_n) (the limit is for the line average)
  const nG = g.nG / 1e20;
  ax.axvline(nG, { color: C.orange, lw: 0.9, dash: 'dashdot', label: '$n_{\\mathrm{G}}$' });
  // 1.5D yörünge
  if (inp.traj && inp.traj.n.length > 1) {
    const { n, T: Tt } = inp.traj;
    ax.plot(n, Tt, { color: '#ffffff', lw: 2.2 });
    ax.plot(n, Tt, { color: C.vermilion, lw: 1.1, label: '1.5D trajectory' });
    ax.plot([n[n.length - 1]], [Tt[Tt.length - 1]], { marker: 'o', ms: 4.5, color: C.vermilion, mfc: '#ffffff', lw: 0 });
  }
  ax.set({ xlim: [0, nMax], ylim: [0, TMAX], xlabel: '$\\langle n_e\\rangle$ ($10^{20}$ m$^{-3}$)', ylabel: '$\\langle T\\rangle$ (keV)', title: inp.label })
    .legend({ loc: 'upper left', frame: true, size: 6.5 });
  return fig;
}
