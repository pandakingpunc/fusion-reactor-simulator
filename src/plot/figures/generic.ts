/**
 * Arayüzden dışa aktarım için genel figürler: tanı gruplarından çok satırlı zaman izleri (her
 * yöntem), 1.5D denge anlık görüntüsünden (EqSnapshot) T_e renkli poloidal kesit.
 */
import { DiagSpec, EqSnapshot, HistoryFrame, SimEvent } from '../../physics/types';
import { Dash, Figure } from '../figure';
import { colormap } from '../colors';
import { C, COL1, COL2 } from './common';

const SUP: Record<string, string> = { '⁻': '-', '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/** Arayüz etiketlerini (Unicode üst simge, X_y) mathtext'e çevir: "n_e [1e20 m⁻³]" → "$n_{\mathrm{e}}$ [$10^{20}$ m$^{-3}$]" */
export function texify(s: string): string {
  return s
    .replace(/̄/g, '') // birleşik üst çizgi (n̄) — standart yazı tiplerinde yok
    .replace(/1e(\d+)/g, (_, e) => `$10^{${e}}$`)
    .replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => `$^{${[...m].map((c) => SUP[c]).join('')}}$`)
    .replace(/([A-Za-zα-ωΑ-Ω])_([A-Za-z0-9]+)/g, (_, a, b) => `$${a}_{\\mathrm{${b}}}$`);
}

const PAL = [C.vermilion, C.blue, C.green, C.purple, C.orange, C.sky, C.black];
const DASH: Dash[] = ['solid', 'dashed', 'dashdot', 'dotted'];

/** Seçili tanı gruplarından ortak zaman eksenli satırlar (en fazla 6 seri/satır) */
export function figDiagGroups(frames: HistoryFrame[], specs: DiagSpec[], groups: string[], timeUnit: string, title: string, events: SimEvent[] = []): Figure {
  const rows = groups
    .map((g) => ({ g, s: specs.filter((sp) => sp.group === g && frames.some((f) => Number.isFinite(f.d[sp.key]))).slice(0, 6) }))
    .filter((r) => r.s.length);
  const fig = new Figure(COL2, 0.75 + 1.3 * Math.max(rows.length, 1), { fontSize: 8, title });
  const axes = fig.subplots(Math.max(rows.length, 1), 1, { left: 0.62, right: 0.2, top: 0.3, bottom: 0.45, hspace: 0.12 });
  const t = frames.map((f) => f.t);
  rows.forEach((row, r) => {
    const ax = axes[r];
    if (r > 0) ax.sharex(axes[0]);
    const units = [...new Set(row.s.map((s) => s.unit))];
    row.s.forEach((s, k) => ax.plot(t, frames.map((f) => f.d[s.key] ?? NaN), { color: PAL[k % PAL.length], dash: DASH[k % DASH.length], lw: 1, label: texify(units.length > 1 && s.unit ? `${s.label} [${s.unit}]` : s.label) }));
    const log = row.s.some((s) => s.log);
    const last = r === rows.length - 1;
    ax.set({ yscale: log ? 'log' : 'linear', ylabel: texify(units.length === 1 && units[0] ? `${row.g} [${units[0]}]` : row.g), hideXLabels: !last, xlabel: last ? `$t$ (${timeUnit})` : undefined })
      .legend({ loc: 'best', ncol: 2, size: 6.5 }).panelLabel(`(${String.fromCharCode(97 + r)})`);
    for (const e of events) if (e.kind === 'LH' || e.kind === 'disruption' || e.kind === 'ignition') ax.axvline(e.t, { color: C.grey, lw: 0.5, dash: 'dotted' });
  });
  fig.text(0.5, 1 - 0.2 / (0.75 + 1.3 * Math.max(rows.length, 1)), title, { anchor: 'middle', size: 8 });
  return fig;
}

function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((x - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1]);
  return ys[ys.length - 1];
}
const hex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(Math.min(Math.max(v, 0), 1) * 255).toString(16).padStart(2, '0')).join('');

/** 1.5D denge anlık görüntüsü: akı yüzeyleri T_e(ρ) ile renkli (her yüzeyin iç bandı), LCFS, eksen */
export function figEqSnapshot(eq: EqSnapshot, prof: { rho: number[]; Te: number[] } | null, title: string): Figure {
  const H = COL1 * 1.3;
  const fig = new Figure(COL1, H, { fontSize: 8, title: 'Poloidal cross-section' });
  const [ax] = fig.subplots(1, 1, { left: 0.55, right: 0.75, top: 0.25, bottom: 0.45 });
  const cmap = colormap('inferno');
  const Tmax = prof?.Te.length ? Math.max(...prof.Te) : 1;
  for (let k = eq.R.length - 1; k >= 0; k--) {
    const rIn = k > 0 ? eq.rho[k - 1] : 0;
    const T = prof ? interp(prof.rho, prof.Te, 0.5 * (rIn + eq.rho[k])) : Tmax * (1 - eq.rho[k] ** 2);
    ax.polygon(eq.R[k], eq.Z[k], { fill: hex(cmap(T / Tmax)), lw: 0, z: 1 });
  }
  for (let k = 1; k < eq.R.length - 1; k += 2) ax.polygon(eq.R[k], eq.Z[k], { stroke: '#ffffff', lw: 0.4, z: 2 });
  ax.polygon(eq.R[eq.R.length - 1], eq.Z[eq.R.length - 1], { stroke: C.black, lw: 1, z: 3 });
  ax.plot([eq.Raxis], [eq.Zaxis], { marker: '+', ms: 6, color: C.black, lw: 0 });
  fig.colorbar({ cmap, vmin: 0, vmax: Tmax, log: false }, ax, { label: '$T_e$ (keV)', width: 0.09, pad: 0.06 });
  ax.set({ aspect: 'equal', xlabel: '$R$ (m)', ylabel: '$Z$ (m)', title });
  ax.text(0.97, 0.03, `$q_{95}$ = ${eq.q95.toFixed(2)}, $\\beta_p$ = ${eq.betaP.toFixed(2)}`, { coords: 'axes', anchor: 'end', size: 6.5 });
  return fig;
}
