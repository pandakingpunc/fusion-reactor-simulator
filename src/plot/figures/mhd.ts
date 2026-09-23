/**
 * Şekil: MHD olayları —
 *  (a) testere dişi çöküşü: T_e(ρ) ve q(ρ) çöküşten hemen önce/sonra (Kadomtsev yeniden bağlanması;
 *      ρ(q=1) ve karışım yarıçapı ρ_mix);
 *  (b) tip-I ELM: pedestal bölgesinde T_e ve n_e önce/sonra;
 *  (c) ELM döngüsü: yüksek örnekleme hızlı W_th(t) ve T_e,ped(t);
 *  (d) NTM ada genişlikleri w/a (3/2, 2/1) ve β_N; testere dişi tohumlaması.
 */
import type { CrashSnapshot } from '../../physics/profiles/model';
import { HistoryFrame, SimEvent } from '../../physics/types';
import { Figure } from '../figure';
import { C, COL2, eventTicks, series } from './common';

export interface CrashRecord { t: number; before: CrashSnapshot; after: CrashSnapshot }
export interface ElmZoom { t: number[]; W: number[]; Tped: number[]; elm: number[] }

/** y(x) = v'nin en dıştaki kesişimi (q ≈ 1 platosundaki eksen yakını dalgalanmaları atlar) */
function crossing(x: number[], y: number[], v: number): number {
  let r = NaN;
  for (let i = 1; i < y.length; i++) if ((y[i - 1] - v) * (y[i] - v) <= 0 && y[i] !== y[i - 1]) r = x[i - 1] + ((v - y[i - 1]) / (y[i] - y[i - 1])) * (x[i] - x[i - 1]);
  return r;
}

export function figMHD(o: { saw?: CrashRecord; elm?: CrashRecord; zoom?: ElmZoom; hist: HistoryFrame[]; events: SimEvent[] }): Figure {
  const fig = new Figure(COL2, 5.0, { fontSize: 8, title: 'MHD events' });
  const [a, b, c, d] = fig.subplots(2, 2, { left: 0.55, right: 0.55, top: 0.22, bottom: 0.45, wspace: 0.95, hspace: 0.55 });

  if (o.saw) {
    const { before: B, after: A } = o.saw;
    const r1 = crossing(B.rho, B.q, 1);
    let iMix = 0;
    for (let i = 0; i < B.rho.length; i++) if (Math.abs(A.Te[i] - B.Te[i]) > 1e-6 * B.Te[0]) iMix = i;
    const rmix = B.rho[iMix];
    a.plot(B.rho, B.Te, { color: C.vermilion, label: '$T_e$ before' });
    a.plot(A.rho, A.Te, { color: C.vermilion, dash: 'dashed', label: '$T_e$ after' });
    const a2 = a.twinx();
    a2.plot(B.rho, B.q, { color: C.blue, lw: 0.9, label: '$q$ before' });
    a2.plot(A.rho, A.q, { color: C.blue, lw: 0.9, dash: 'dashed', label: '$q$ after' });
    a2.axhline(1, { color: C.blue, lw: 0.4, dash: 'dotted' });
    if (Number.isFinite(r1)) a.axvline(r1, { color: C.grey, lw: 0.5, dash: 'dotted' });
    a.axvline(rmix, { color: C.grey, lw: 0.5, dash: 'dashed' });
    const top = Math.max(...B.Te) * 1.18;
    if (Number.isFinite(r1)) a.text(r1, top * 0.74, '$\\rho_{q=1}$ ', { size: 6.5, baseline: 'top', anchor: 'end', color: C.grey });
    a.text(rmix, top * 0.74, ' $\\rho_{\\mathrm{mix}}$', { size: 6.5, baseline: 'top', color: C.grey });
    a.set({ xlim: [0, 0.8], ylim: [0, top], xlabel: '$\\rho_{\\mathrm{tor}}$', ylabel: '$T_e$ (keV)', title: `sawtooth crash, t = ${o.saw.t.toFixed(1)} s` }).legend({ loc: 'upper center', ncol: 2, size: 6.5 }).panelLabel('(a)');
    a2.set({ ylim: [0.6, 2.2], ylabel: '$q$' });
  }

  if (o.elm) {
    const { before: B, after: A } = o.elm;
    const sel = (s: CrashSnapshot, k: 'Te' | 'ne') => ({ x: s.rho.filter((r) => r >= 0.6), y: s[k].filter((_, i) => s.rho[i] >= 0.6) });
    const tb = sel(B, 'Te'), ta = sel(A, 'Te'), nb = sel(B, 'ne'), na = sel(A, 'ne');
    b.plot(tb.x, tb.y, { color: C.vermilion, label: '$T_e$ before' });
    b.plot(ta.x, ta.y, { color: C.vermilion, dash: 'dashed', label: '$T_e$ after' });
    const b2 = b.twinx();
    b2.plot(nb.x, nb.y, { color: C.green, lw: 0.9, label: '$n_e$ before' });
    b2.plot(na.x, na.y, { color: C.green, lw: 0.9, dash: 'dashed', label: '$n_e$ after' });
    b.set({ xlim: [0.6, 1], ylim: [0, Math.max(...tb.y) * 1.2], xlabel: '$\\rho_{\\mathrm{tor}}$', ylabel: '$T_e$ (keV)', title: `type-I ELM, t = ${o.elm.t.toFixed(2)} s` }).legend({ loc: 'lower left', size: 6.5 }).panelLabel('(b)');
    b2.set({ ylim: [0, Math.max(...nb.y) * 1.3], ylabel: '$n_e$ ($10^{20}$ m$^{-3}$)' });
  }

  if (o.zoom && o.zoom.t.length > 2) {
    const z = o.zoom;
    const t0 = z.t[0];
    const tt = z.t.map((t) => (t - t0) * 1e3);
    c.plot(tt, z.W, { color: C.blue, lw: 1, label: '$W_{\\mathrm{th}}$' });
    const c2 = c.twinx();
    c2.plot(tt, z.Tped, { color: C.orange, lw: 1, dash: 'dashed', label: '$T_{e,\\mathrm{ped}}$' });
    c.xmarks(z.elm.map((t) => (t - t0) * 1e3), { color: C.black, label: 'ELM' });
    const wmin = Math.min(...z.W), wmax = Math.max(...z.W);
    c.set({ xlim: [0, tt[tt.length - 1]], ylim: [wmin - 0.6 * (wmax - wmin), wmax + 0.4 * (wmax - wmin)], xlabel: `$t - t_0$ (ms),  $t_0$ = ${t0.toFixed(1)} s`, ylabel: '$W_{\\mathrm{th}}$ (MJ)', title: 'ELM cycle (high-cadence window)' })
      .legend({ loc: 'lower left', ncol: 3, size: 6.5 }).panelLabel('(c)');
    const pmin = Math.min(...z.Tped), pmax = Math.max(...z.Tped);
    c2.set({ ylim: [pmin - 0.4 * (pmax - pmin), pmax + 0.6 * (pmax - pmin)], ylabel: '$T_{e,\\mathrm{ped}}$ (keV)' });
  }

  const w32 = series(o.hist, 'w32', 1, true), w21 = series(o.hist, 'w21', 1, true), bn = series(o.hist, 'betaN', 1, true);
  d.plot(w32.t, w32.v, { color: C.purple, label: '$w_{3/2}/a$' });
  d.plot(w21.t, w21.v, { color: C.vermilion, dash: 'dashed', label: '$w_{2/1}/a$' });
  const d2 = d.twinx();
  d2.plot(bn.t, bn.v, { color: C.grey, lw: 0.8, dash: 'dotted', label: '$\\beta_N$' });
  eventTicks(d, o.events, 'sawtooth', C.black, 'sawtooth');
  const wmax = Math.max(0.02, ...w32.v.filter(Number.isFinite), ...w21.v.filter(Number.isFinite));
  d.set({ xlim: [0, o.hist[o.hist.length - 1].t], ylim: [0, wmax * 1.35], xlabel: '$t$ (s)', ylabel: 'island width $w/a$', title: 'neoclassical tearing modes' }).legend({ loc: 'lower right', ncol: 2, size: 6.5, frame: true }).panelLabel('(d)');
  d2.set({ ylim: [0, Math.max(...bn.v.filter(Number.isFinite)) * 1.6], ylabel: '$\\beta_N$' });
  return fig;
}
