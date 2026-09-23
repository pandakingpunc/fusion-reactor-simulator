/**
 * Şekil: manyetik denge — (a) sayısal GS dengesi, akı yüzeyleri üzerinde T_e haritası;
 * (b) Cerfon–Freidberg tek-null analitik Solov'ev dengesi (ayırıcı, X-noktası, SOL);
 * (c) q, manyetik kayma s ve tuzaklı parçacık oranı f_t profilleri.
 */
import { Equilibrium } from '../../physics/equilibrium/gs';
import { PhysicalSolovev } from '../../physics/equilibrium/solovev';
import { Pchip, lerpTable } from '../../physics/numerics/interp';
import { Figure } from '../figure';
import { C, COL2 } from './common';

export interface EqFigInput {
  eq: Equilibrium;
  /** 1.5D profil (renk haritası için): ρ_tor ve T_e [keV] */
  rho?: number[];
  Te?: number[];
  label?: string;
}

/** ψ_N → ρ_tor eşlemesi ve T_e(ρ) ile (R,Z) ızgarasında renk alanı */
function temperatureMap(eq: Equilibrium, rho: number[], Te: number[], nR: number) {
  const g = eq.grid, b = g.boundary;
  const R0 = b.R0, a = b.a, k = b.kappa;
  const Rmin = R0 - 1.08 * a, Rmax = R0 + 1.08 * a, Zmax = 1.08 * k * a;
  const nZ = Math.round((nR * (2 * Zmax)) / (Rmax - Rmin));
  const bi = g.bicubic(eq.psi);
  const toRho = new Pchip(eq.prof.psiN, eq.prof.rhoTor);
  const Z = new Float64Array(nR * nZ);
  const Rs = Array.from({ length: nR }, (_, i) => Rmin + ((i + 0.5) * (Rmax - Rmin)) / nR);
  const Zs = Array.from({ length: nZ }, (_, j) => -Zmax + ((j + 0.5) * 2 * Zmax) / nZ);
  for (let j = 0; j < nZ; j++) for (let i = 0; i < nR; i++) {
    const R = Rs[i], z = Zs[j];
    if (!b.inside(R, z)) { Z[j * nR + i] = NaN; continue; }
    const psiN = Math.min(Math.max((eq.psiAxis - bi.eval(R, z)) / eq.psiAxis, 0), 1);
    Z[j * nR + i] = lerpTable(rho, Te, toRho.eval(psiN));
  }
  return { Z, nR, nZ, extent: [Rmin, Rmax, -Zmax, Zmax] as [number, number, number, number] };
}

export function figEquilibrium(inp: EqFigInput): Figure {
  const { eq } = inp;
  const fig = new Figure(COL2, 3.25, { fontSize: 8, title: 'Magnetic equilibrium' });
  const [a, b, c] = fig.subplots(1, 3, { left: 0.5, right: 0.12, bottom: 0.45, top: 0.2, wspace: 0.85, widthRatios: [1, 1, 1.35] });
  const P = eq.prof, tr = eq.surfaces;
  // (a) GS dengesi + T_e
  if (inp.rho && inp.Te) {
    const m = temperatureMap(eq, inp.rho, inp.Te, 150);
    const map = a.image(m.Z, m.nR, m.nZ, m.extent, { cmap: 'inferno', vmin: 0 });
    fig.colorbar(map, a, { label: '$T_e$ (keV)', width: 0.08, pad: 0.05 });
  }
  const nS = tr.R.length;
  for (const target of [0.2, 0.4, 0.6, 0.8]) {
    let best = 0, bd = Infinity;
    for (let k = 0; k < nS; k++) { const d = Math.abs(P.rhoTor[k + 1] - target); if (d < bd) { bd = d; best = k; } }
    a.plot([...tr.R[best], tr.R[best][0]], [...tr.Z[best], tr.Z[best][0]], { color: '#ffffff', lw: 0.5 });
  }
  a.plot([...tr.R[nS - 1], tr.R[nS - 1][0]], [...tr.Z[nS - 1], tr.Z[nS - 1][0]], { color: C.black, lw: 1.0 });
  a.plot([eq.Raxis], [eq.Zaxis], { marker: '+', ms: 7, color: C.black, lw: 0 });
  a.axvline(eq.grid.boundary.R0, { color: C.grey, lw: 0.5, dash: 'dotted' });
  a.text(0.96, 0.03, `$\\Delta_{\\mathrm{Sh}}$ = ${(eq.shafranovShift * 100).toFixed(0)} cm`, { coords: 'axes', size: 6.5, anchor: 'end' });
  a.set({ aspect: 'equal', xlabel: '$R$ (m)', ylabel: '$Z$ (m)', title: inp.label ?? 'Grad–Shafranov (numerical)' }).panelLabel('(a)');

  // (b) Cerfon–Freidberg tek-null (ITER benzeri)
  const sol = new PhysicalSolovev(6.2, 5.3, 15e6, { epsilon: 0.32, kappa: 1.7, delta: 0.33, A: -0.155, singleNull: true });
  const nx = 170, ny = 230;
  const xs = Array.from({ length: nx }, (_, i) => 6.2 * (0.6 + (0.8 * i) / (nx - 1)));
  const ys = Array.from({ length: ny }, (_, j) => 6.2 * (-0.72 + (1.33 * j) / (ny - 1)));
  const Z = new Float64Array(nx * ny);
  let pmax = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = sol.psi(xs[i], ys[j]); Z[j * nx + i] = v; pmax = Math.max(pmax, v); }
  b.contour(xs, ys, Z, [0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((f) => f * pmax), { colors: C.blue, lw: 0.55 });
  b.contour(xs, ys, Z, [-0.02, -0.05, -0.1, -0.18].map((f) => f * pmax), { colors: C.grey, lw: 0.45 });
  b.contour(xs, ys, Z, [0], { colors: C.vermilion, lw: 1.0, label: 'separatrix' });
  const xp: [number, number] = [6.2 * (1 - 1.1 * 0.33 * 0.32), 6.2 * (-1.1 * 1.7 * 0.32)];
  b.plot([xp[0]], [xp[1]], { marker: 'x', ms: 6, color: C.black, lw: 0 });
  b.text(xp[0] + 0.25, xp[1] - 0.12, 'X-point', { size: 7 });
  b.text(0.97, 0.04, 'SOL', { coords: 'axes', anchor: 'end', size: 7, color: C.grey });
  b.set({ aspect: 'equal', xlabel: '$R$ (m)', ylabel: '$Z$ (m)', title: "Solov'ev single-null (analytic)", xlim: [xs[0], xs[nx - 1]], ylim: [ys[0], ys[ny - 1]] }).panelLabel('(b)');

  // (c) q, s, f_t
  const rho = Array.from(P.rhoTor);
  const qS = new Pchip(P.rhoTor, P.q);
  const s = rho.map((r) => (r > 0.02 ? (r * qS.deriv(r)) / qS.eval(r) : 0));
  for (const qv of [1, 1.5, 2]) c.axhline(qv, { color: C.grey, lw: 0.4, dash: 'dotted' });
  c.plot(rho, Array.from(P.q), { color: C.blue, label: '$q$' });
  c.plot(rho, s, { color: C.vermilion, dash: 'dashed', label: '$s = (\\rho/q)\\,dq/d\\rho$' });
  c.plot(rho, Array.from(P.ft), { color: C.green, dash: 'dashdot', label: '$f_t$ (trapped fraction)' });
  c.text(0.03, 1.07, '$q = 1$', { size: 6.5, color: C.grey, baseline: 'bottom' });
  c.set({ xlabel: '$\\rho_{\\mathrm{tor}}$', ylabel: 'dimensionless', xlim: [0, 1], ylim: [0, Math.max(4, eq.q95 * 1.25)] })
    .legend({ loc: 'upper left' }).panelLabel('(c)');
  c.text(0.97, 0.05, `$q_{95}$ = ${eq.q95.toFixed(2)},  $\\ell_i(3)$ = ${eq.li3.toFixed(2)},  $\\beta_p$ = ${eq.betaP.toFixed(2)}`, { coords: 'axes', anchor: 'end', size: 6.5 });
  return fig;
}
