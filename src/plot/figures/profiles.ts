/**
 * Şekil: düz tepe (flat-top) radyal profilleri, 2×3 panel — sıcaklıklar (pedestal bölgesi gölgeli),
 * yoğunluk ve Z_eff, q ve manyetik kayma (rasyonel yüzeyler), akım yoğunluğu bileşenleri,
 * ısı yayınımları χ_e/χ_i ve güç yoğunlukları.
 */
import { HistoryFrame } from '../../physics/types';
import { Figure } from '../figure';
import { C, COL2 } from './common';

export interface ProfilesFigInput {
  frame: HistoryFrame;
  pedestalWidth: number;
  label?: string;
}

export function figProfiles(inp: ProfilesFigInput): Figure {
  const P = inp.frame.prof!;
  const rho = P.rho;
  const fig = new Figure(COL2, 4.3, { fontSize: 8, title: 'Flat-top profiles' });
  const ax = fig.subplots(2, 3, { left: 0.5, right: 0.45, top: 0.22, bottom: 0.42, wspace: 0.78, hspace: 0.5 });
  const [a, b, c, d, e, f] = ax;
  const rhoPed = 1 - inp.pedestalWidth;
  const xl: [number, number] = [0, 1];

  // (a) T_e, T_i
  a.axvspan(rhoPed, 1, { color: C.grey, alpha: 0.12, label: 'pedestal' });
  a.plot(rho, P.Te, { color: C.vermilion, label: '$T_e$' });
  a.plot(rho, P.Ti, { color: C.blue, dash: 'dashed', label: '$T_i$' });
  a.set({ xlim: xl, ylim: [0, Math.max(...P.Te, ...P.Ti) * 1.12], xlabel: '$\\rho_{\\mathrm{tor}}$', ylabel: '$T$ (keV)' }).legend({ loc: 'upper right' }).panelLabel('(a)');

  // (b) n_e ve Z_eff (ikiz eksen)
  b.axvspan(rhoPed, 1, { color: C.grey, alpha: 0.12 });
  b.plot(rho, P.ne, { color: C.green, label: '$n_e$' });
  const b2 = b.twinx();
  b2.plot(rho, P.Zeff, { color: C.purple, dash: 'dashdot', label: '$Z_{\\mathrm{eff}}$' });
  const zmax = Math.max(...P.Zeff);
  b.set({ xlim: xl, ylim: [0, Math.max(...P.ne) * 1.25], xlabel: '$\\rho_{\\mathrm{tor}}$', ylabel: '$n_e$ ($10^{20}$ m$^{-3}$)' }).legend({ loc: 'lower left' }).panelLabel('(b)');
  b2.set({ ylim: [1, Math.max(2, zmax * 1.3)], ylabel: '$Z_{\\mathrm{eff}}$' });

  // (c) q ve s
  // rasyonel yüzeyler: q'nun değeri en dıştan kestiği ρ'da dikey çizgi (testere dişi platosunda q ≈ 1 dalgalanır)
  const qTop = Math.max(...P.q) * 1.1;
  for (const [qv, lbl] of [[1, '1'], [1.5, '3/2'], [2, '2']] as const) {
    let r = NaN;
    for (let i = 1; i < rho.length; i++) if ((P.q[i - 1] - qv) * (P.q[i] - qv) <= 0 && P.q[i] !== P.q[i - 1]) r = rho[i - 1] + ((qv - P.q[i - 1]) / (P.q[i] - P.q[i - 1])) * (rho[i] - rho[i - 1]);
    if (!Number.isFinite(r)) continue;
    c.axvline(r, { color: C.grey, lw: 0.4, dash: 'dotted' });
    c.text(r, 0.97 * qTop, lbl, { anchor: 'middle', baseline: 'top', size: 6, color: C.grey, box: true });
  }
  c.plot(rho, P.q, { color: C.blue, label: '$q$' });
  const c2 = c.twinx();
  c2.plot(rho, P.shear, { color: C.vermilion, dash: 'dashed', label: '$s$' });
  c.set({ xlim: xl, ylim: [0, qTop], xlabel: '$\\rho_{\\mathrm{tor}}$', ylabel: '$q$' }).legend({ loc: 'lower right' }).panelLabel('(c)');
  c2.set({ ylim: [Math.min(0, ...P.shear), Math.max(...P.shear) * 1.1], ylabel: 'magnetic shear $s$' });

  // (d) akım yoğunlukları
  d.axhline(0, { color: C.grey, lw: 0.4, dash: 'solid' });
  d.plot(rho, P.j, { color: C.black, label: '$j_{\\mathrm{tot}}$' });
  d.plot(rho, P.johm, { color: C.blue, dash: 'dashed', label: '$j_{\\mathrm{ohm}}$' });
  d.plot(rho, P.jbs, { color: C.vermilion, dash: 'dashdot', label: '$j_{\\mathrm{bs}}$' });
  d.plot(rho, P.jcd, { color: C.green, dash: 'dotted', label: '$j_{\\mathrm{CD}}$' });
  d.set({ xlim: xl, ylim: [Math.min(0, ...P.jbs, ...P.jcd, ...P.johm) * 1.1 - 0.02, Math.max(...P.j) * 1.3], xlabel: '$\\rho_{\\mathrm{tor}}$', ylabel: '$\\langle j_\\parallel B\\rangle/B_0$ (MA m$^{-2}$)' }).legend({ loc: 'upper right' }).panelLabel('(d)');

  // (e) χ_e, χ_i
  e.axvspan(rhoPed, 1, { color: C.grey, alpha: 0.12 });
  e.plot(rho, P.chie, { color: C.vermilion, label: '$\\chi_e$' });
  e.plot(rho, P.chii, { color: C.blue, dash: 'dashed', label: '$\\chi_i$' });
  e.set({ xlim: xl, ylim: [0, Math.max(...P.chie, ...P.chii) * 1.15], xlabel: '$\\rho_{\\mathrm{tor}}$', ylabel: '$\\chi$ (m$^2$ s$^{-1}$)' }).legend({ loc: 'upper left' }).panelLabel('(e)');

  // (f) güç yoğunlukları
  f.plot(rho, P.Palpha, { color: C.vermilion, label: '$p_\\alpha$' });
  f.plot(rho, P.Paux, { color: C.blue, dash: 'dashed', label: '$p_{\\mathrm{aux}}$' });
  f.plot(rho, P.Prad, { color: C.purple, dash: 'dashdot', label: '$p_{\\mathrm{rad}}$' });
  f.plot(rho, P.Pohm, { color: C.green, dash: 'dotted', label: '$p_{\\mathrm{ohm}}$' });
  f.set({ xlim: xl, ylim: [0, Math.max(...P.Palpha, ...P.Paux) * 1.12], xlabel: '$\\rho_{\\mathrm{tor}}$', ylabel: '$p$ (MW m$^{-3}$)' }).legend({ loc: 'upper right' }).panelLabel('(f)');

  fig.text(0.5, 0.965, inp.label ?? `t = ${inp.frame.t.toFixed(0)} s`, { anchor: 'middle', size: 8 });
  return fig;
}
