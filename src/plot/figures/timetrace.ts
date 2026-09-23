/**
 * Şekil: atış zaman izleri (4 satır, ortak zaman ekseni) — füzyon kazancı Q ve depolanan enerji;
 * güç dengesi; merkez/pedestal sıcaklıkları ve yoğunluk; q(0), ℓ_i, f_bs, β_N. Olaylar: L–H geçişi
 * ve NTM başlangıcı dikey çizgi, testere dişi ve ELM'ler eksen üstünde çentik.
 */
import { HistoryFrame, SimEvent } from '../../physics/types';
import { Dash, Figure } from '../figure';
import { C, COL2, eventTicks, series } from './common';

const fmax = (v: number[]) => Math.max(...v.filter(Number.isFinite));

export function figTimeTraces(hist: HistoryFrame[], events: SimEvent[], label?: string): Figure {
  const fig = new Figure(COL2, 6.2, { fontSize: 8, title: 'Discharge time traces' });
  const [a, b, c, d] = fig.subplots(4, 1, { left: 0.62, right: 0.62, top: 0.25, bottom: 0.45, hspace: 0.12 });
  for (const ax of [b, c, d]) ax.sharex(a);
  const S = (k: string, sc = 1) => series(hist, k, sc, true);
  const tEnd = hist[hist.length - 1].t;
  const xl: [number, number] = [0, tEnd];

  // (a) Q ve W_th (P_fus = Q·P_aux: P_aux sabitken aynı eğri olurdu)
  const q = S('Q'), W = S('W');
  const aTop = fmax(q.v) * 1.18;
  a.plot(q.t, q.v, { color: C.vermilion, label: '$Q$' });
  const a2 = a.twinx();
  a2.plot(W.t, W.v, { color: C.blue, dash: 'dashed', label: '$W_{\\mathrm{th}}$' });
  a.set({ xlim: xl, ylim: [0, aTop], ylabel: '$Q = P_{\\mathrm{fus}}/P_{\\mathrm{aux}}$', hideXLabels: true }).legend({ loc: 'lower right' }).panelLabel('(a)');
  a2.set({ ylim: [0, fmax(W.v) * 1.18], ylabel: '$W_{\\mathrm{th}}$ (MJ)' });

  // (b) güç dengesi
  const pw: [string, string, Dash, string][] = [['P_alpha', C.vermilion, 'solid', '$P_\\alpha$'], ['P_aux', C.blue, 'solid', '$P_{\\mathrm{aux}}$'], ['P_cond', C.green, 'dashed', '$W/\\tau_E$'], ['P_rad', C.purple, 'dashdot', '$P_{\\mathrm{rad}}$'], ['P_oh', C.grey, 'dotted', '$P_{\\mathrm{ohm}}$']];
  let pmax = 0;
  for (const [k, col, dash, lbl] of pw) { const s = S(k); pmax = Math.max(pmax, fmax(s.v)); b.plot(s.t, s.v, { color: col, dash, label: lbl, lw: 1 }); }
  eventTicks(b, events, 'ELM', '#9a9a9a', 'ELM');
  b.set({ xlim: xl, ylim: [0, pmax * 1.45], ylabel: 'power (MW)', hideXLabels: true }).legend({ loc: 'upper right', ncol: 6 }).panelLabel('(b)');

  // (c) sıcaklıklar ve yoğunluk
  const te0 = S('Te0'), ti0 = S('Ti0'), tp = S('Tped'), nb = S('nbar');
  c.plot(te0.t, te0.v, { color: C.vermilion, label: '$T_e(0)$' });
  c.plot(ti0.t, ti0.v, { color: C.blue, dash: 'dashed', label: '$T_i(0)$' });
  c.plot(tp.t, tp.v, { color: C.orange, dash: 'dashdot', label: '$T_{e,\\mathrm{ped}}$' });
  const c2 = c.twinx();
  c2.plot(nb.t, nb.v, { color: C.green, dash: 'dotted', label: '$n_{e,\\mathrm{line}}$' });
  eventTicks(c, events, 'sawtooth', C.black, 'sawtooth');
  c.set({ xlim: xl, ylim: [0, Math.max(fmax(te0.v), fmax(ti0.v)) * 1.12], ylabel: '$T$ (keV)', hideXLabels: true }).legend({ loc: 'upper right', ncol: 5 }).panelLabel('(c)');
  c2.set({ ylim: [0, fmax(nb.v) * 1.6], ylabel: '$n_{e,\\mathrm{line}}$ ($10^{20}$ m$^{-3}$)' });

  // (d) MHD/akım büyüklükleri
  const qq: [string, string, Dash, string][] = [['q0', C.blue, 'solid', '$q(0)$'], ['li', C.vermilion, 'dashed', '$\\ell_i(3)$'], ['f_bs', C.green, 'dashdot', '$f_{\\mathrm{bs}}$'], ['betaN', C.purple, 'dotted', '$\\beta_N$']];
  let dmax = 0;
  for (const [k, col, dash, lbl] of qq) { const s = S(k); dmax = Math.max(dmax, fmax(s.v)); d.plot(s.t, s.v, { color: col, dash, label: lbl }); }
  d.set({ xlim: xl, ylim: [0, Math.min(dmax * 1.3, 4)], xlabel: '$t$ (s)', ylabel: 'dimensionless' }).legend({ loc: 'upper right', ncol: 4 }).panelLabel('(d)');

  // dikey olay çizgileri
  const lh = events.find((e) => e.kind === 'LH');
  const ntm = events.find((e) => e.kind === 'NTM_onset');
  for (const ax of [a, b, c, d]) {
    if (lh) ax.axvline(lh.t, { color: C.grey, lw: 0.5, dash: 'dotted' });
    if (ntm) ax.axvline(ntm.t, { color: C.purple, lw: 0.5, dash: 'dashed' });
  }
  if (ntm) a.text(ntm.t, 0.95 * aTop, ' NTM onset', { size: 6.5, color: C.purple, baseline: 'top' });
  if (label) fig.text(0.5, 0.975, label, { anchor: 'middle', size: 8 });
  return fig;
}
