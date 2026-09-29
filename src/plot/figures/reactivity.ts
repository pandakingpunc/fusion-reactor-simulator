/**
 * Şekil: (a) Maxwell ortalamalı füzyon reaktiviteleri ⟨σv⟩(T) — Bosch & Hale (1992) fitleri kendi
 * geçerlilik aralıklarında, p–¹¹B Nevins & Swain (2000) tesir kesitinin sayısal Maxwell ortalaması;
 * (b) Lawson diyagramı: D–T için sabit Q eğrileri (düz profil, Z_eff = 1, bremsstrahlung dahil)
 *   n τ_E = 3T / [ ⟨σv⟩ E_fus (1/5 + 1/Q)/4 − C_B √T ]
 * ve benzetimlerin hacim-ortalamalı çalışma noktaları.
 */
import { sigmav } from '../../physics/reactivity';
import { Dash, Figure } from '../figure';
import { C, COL2 } from './common';

const KEV = 1.602176634e-16; // J
const E_FUS = 17.589e3 * KEV; // J (17.589 MeV)
const C_B = 5.35e-37; // W m³ keV^-1/2 (Z_eff = 1)

/** Bir makine: 0D ve/veya 1.5D çalışma noktası; etiket konumu (noktalara göre) */
export interface LawsonMachine { label: string; color: string; p0?: { T: number; ntau: number }; p15?: { T: number; ntau: number }; pos?: 'right' | 'left' | 'above' | 'below' }

function logspace(a: number, b: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.pow(10, Math.log10(a) + ((Math.log10(b) - Math.log10(a)) * i) / (n - 1)));
}

/** the reactivity functions <sigma v>(T) [m^3/s, T in keV] the figure draws; the physics module's `sigmav` by default */
export type ReactivityRates = Pick<typeof sigmav, 'DT' | 'DD_total' | 'DHe3' | 'pB11'>;

/** D–T için verilen Q'yu sağlayan n τ_E [m⁻³ s]; ulaşılamazsa NaN */
export function ntauForQ(T: number, Q: number, rates: Pick<ReactivityRates, 'DT'> = sigmav): number {
  const den = (rates.DT(T) * E_FUS * (0.2 + (Number.isFinite(Q) ? 1 / Q : 0))) / 4 - C_B * Math.sqrt(T);
  return den > 0 ? (3 * T * KEV) / den : NaN;
}

export function figReactivityLawson(machines: LawsonMachine[], rates: ReactivityRates = sigmav): Figure {
  const fig = new Figure(COL2, 2.9, { fontSize: 8, title: 'Fusion reactivity and Lawson diagram' });
  const [a, b] = fig.subplots(1, 2, { left: 0.55, right: 0.12, top: 0.22, bottom: 0.45, wspace: 0.65 });

  // (a) reaktiviteler — yalnız fit geçerlilik aralıkları
  const curves: [string, (T: number) => number, number, number, string, Dash][] = [
    ['D–T', rates.DT, 1, 100, C.vermilion, 'solid'],
    ['D–D (both branches)', rates.DD_total, 1, 100, C.blue, 'dashed'],
    ['D–$^3$He', rates.DHe3, 1, 190, C.green, 'dashdot'],
    ['p–$^{11}$B', rates.pB11, 10, 1000, C.purple, 'dotted'],
  ];
  for (const [lbl, f, lo, hi, col, dash] of curves) {
    const T = logspace(lo, hi, 160);
    a.plot(T, T.map(f), { color: col, dash, label: lbl });
  }
  a.set({ xscale: 'log', yscale: 'log', xlim: [1, 1000], ylim: [1e-26, 2e-21], xlabel: '$T$ (keV)', ylabel: '$\\langle\\sigma v\\rangle$ (m$^3$ s$^{-1}$)' })
    .legend({ loc: 'lower right' }).panelLabel('(a)');

  // (b) Lawson
  const T = logspace(2, 100, 300);
  const qs: [number, string, Dash, string][] = [[1, '$Q = 1$', 'dashed', C.blue], [10, '$Q = 10$', 'dashdot', C.green], [Infinity, 'ignition ($Q = \\infty$)', 'solid', C.vermilion]];
  for (const [Q, lbl, dash, col] of qs) b.plot(T, T.map((t) => ntauForQ(t, Q, rates)), { color: col, dash, label: lbl });
  const ok = (p?: { T: number; ntau: number }) => !!p && p.T > 0 && p.ntau > 0;
  for (const m of machines) {
    const pts = [m.p0, m.p15].filter(ok) as { T: number; ntau: number }[];
    if (!pts.length) continue;
    if (pts.length === 2) b.plot(pts.map((p) => p.T), pts.map((p) => p.ntau), { color: m.color, lw: 0.5 });
    if (ok(m.p0)) b.plot([m.p0!.T], [m.p0!.ntau], { marker: 'o', ms: 4, color: m.color, mfc: '#ffffff', lw: 0 });
    if (ok(m.p15)) b.plot([m.p15!.T], [m.p15!.ntau], { marker: 's', ms: 3.8, color: m.color, lw: 0 });
    // etiket: noktaların sınır kutusuna göre
    const Tlo = Math.min(...pts.map((p) => p.T)), Thi = Math.max(...pts.map((p) => p.T));
    const nlo = Math.min(...pts.map((p) => p.ntau)), nhi = Math.max(...pts.map((p) => p.ntau));
    const Tm = Math.sqrt(Tlo * Thi), nm = Math.sqrt(nlo * nhi);
    switch (m.pos ?? 'right') {
      case 'right': b.text(Thi * 1.1, nm, m.label, { size: 6.5, baseline: 'middle', color: m.color }); break;
      case 'left': b.text(Tlo / 1.1, nm, m.label, { size: 6.5, baseline: 'middle', anchor: 'end', color: m.color }); break;
      case 'above': b.text(Tm, nhi * 1.25, m.label, { size: 6.5, baseline: 'bottom', anchor: 'middle', color: m.color }); break;
      case 'below': b.text(Tm, nlo / 1.25, m.label, { size: 6.5, baseline: 'top', anchor: 'middle', color: m.color }); break;
    }
  }
  // model gösterimi (lejant için görünmez örnekler)
  b.plot([NaN], [NaN], { marker: 'o', ms: 4, mfc: '#ffffff', color: C.grey, lw: 0, label: '0D (vol. avg.)' });
  b.plot([NaN], [NaN], { marker: 's', ms: 4, color: C.grey, lw: 0, label: '1.5D (vol. avg.)' });
  b.set({ xscale: 'log', yscale: 'log', xlim: [2, 100], ylim: [3e18, 1e22], xlabel: '$\\langle T_i\\rangle$ (keV)', ylabel: '$\\langle n_e\\rangle\\,\\tau_E$ (m$^{-3}$ s)' })
    .legend({ loc: 'upper right', size: 6.5 }).panelLabel('(b)');
  return fig;
}
