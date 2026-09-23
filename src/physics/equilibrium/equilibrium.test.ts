import { describe, expect, it } from 'vitest';
import { SolovevEquilibrium, PhysicalSolovev } from './solovev';
import { millerBoundary, shapeIntegrals } from './miller';
import { GSGrid, GSSolver } from './gs';

const ITER_SHAPE = { epsilon: 0.32, kappa: 1.7, delta: 0.33, A: -0.155 };

/** Normalize Δ* operatörü (sonlu fark) */
function gsOpBar(f: (x: number, y: number) => number, x: number, y: number, h = 1e-3): number {
  const fxx = (f(x + h, y) - 2 * f(x, y) + f(x - h, y)) / (h * h);
  const fx = (f(x + h, y) - f(x - h, y)) / (2 * h);
  const fyy = (f(x, y + h) - 2 * f(x, y) + f(x, y - h)) / (h * h);
  return fxx - fx / x + fyy;
}

describe("Cerfon–Freidberg Solov'ev equilibria", () => {
  it('satisfy the normalized Grad–Shafranov equation everywhere', () => {
    for (const sn of [false, true]) {
      const eq = new SolovevEquilibrium({ ...ITER_SHAPE, singleNull: sn });
      for (const [x, y] of [[1.1, 0.2], [0.8, -0.3], [1.25, 0.05], [0.95, 0.4]]) {
        const lhs = gsOpBar((a, b) => eq.psiBar(a, b), x, y);
        expect(lhs).toBeCloseTo(eq.sourceBar(x), 4);
        // analitik türevlerle aynı
        const an = eq.psiBar(x, y, 2, 0) - eq.psiBar(x, y, 1, 0) / x + eq.psiBar(x, y, 0, 2);
        expect(an).toBeCloseTo(eq.sourceBar(x), 10);
      }
    }
  });

  it('vanish at the constraint points and nearly vanish on the whole Miller boundary', () => {
    const e = ITER_SHAPE.epsilon, k = ITER_SHAPE.kappa, d = ITER_SHAPE.delta;
    const eq = new SolovevEquilibrium(ITER_SHAPE);
    expect(Math.abs(eq.psiBar(1 + e, 0))).toBeLessThan(1e-12);
    expect(Math.abs(eq.psiBar(1 - e, 0))).toBeLessThan(1e-12);
    expect(Math.abs(eq.psiBar(1 - d * e, k * e))).toBeLessThan(1e-12);
    expect(Math.abs(eq.psiBar(1 - d * e, k * e, 1, 0))).toBeLessThan(1e-12);
    // eksen değeri (min ψ̄)
    let pmin = 0;
    for (let x = 1 - e; x <= 1 + e; x += e / 200) pmin = Math.min(pmin, eq.psiBar(x, 0));
    const b = millerBoundary({ R: 1, a: e, kappa: k, delta: d });
    let worst = 0;
    for (let t = 0; t < 2 * Math.PI; t += 0.01) { const [x, y] = b.point(t); worst = Math.max(worst, Math.abs(eq.psiBar(x, y))); }
    expect(worst / Math.abs(pmin)).toBeLessThan(0.02);
  });

  it('single-null solution has a genuine X-point (∇ψ = 0 on the separatrix)', () => {
    const eq = new SolovevEquilibrium({ ...ITER_SHAPE, singleNull: true });
    const xp: [number, number] = [1 - 1.1 * ITER_SHAPE.delta * ITER_SHAPE.epsilon, -1.1 * ITER_SHAPE.kappa * ITER_SHAPE.epsilon];
    expect(Math.abs(eq.psiBar(xp[0], xp[1]))).toBeLessThan(1e-12);
    expect(Math.abs(eq.psiBar(xp[0], xp[1], 1, 0))).toBeLessThan(1e-12);
    expect(Math.abs(eq.psiBar(xp[0], xp[1], 0, 1))).toBeLessThan(1e-12);
    // saddle: Hessian determinant < 0
    const hxx = eq.psiBar(xp[0], xp[1], 2, 0), hyy = eq.psiBar(xp[0], xp[1], 0, 2);
    const e = 1e-5, hxy = (eq.psiBar(xp[0], xp[1] + e, 1, 0) - eq.psiBar(xp[0], xp[1] - e, 1, 0)) / (2 * e);
    expect(hxx * hyy - hxy * hxy).toBeLessThan(0);
  });
});

describe('numerical fixed-boundary Grad–Shafranov solver', () => {
  const geom = { R: 6.2, a: 2.0, kappa: 1.7, delta: 0.33 };

  it('converges at second order on a manufactured Solov\'ev solution', () => {
    const sol = new PhysicalSolovev(6.2, 5.3, 15e6, ITER_SHAPE);
    const errs: number[] = [];
    for (const NR of [33, 65, 129]) {
      const grid = new GSGrid(geom, { NR });
      const psi = grid.solveLinear((R) => sol.source(R), (R, Z) => sol.psi(R, Z));
      let emax = 0, pmax = 0;
      for (let k = 0; k < psi.length; k++) {
        if (grid.kind[k] !== 1) continue;
        const R = grid.R(k % grid.NR), Z = grid.Z(Math.floor(k / grid.NR));
        emax = Math.max(emax, Math.abs(psi[k] - sol.psi(R, Z)));
        pmax = Math.max(pmax, Math.abs(sol.psi(R, Z)));
      }
      errs.push(emax / pmax);
    }
    const order1 = Math.log2(errs[0] / errs[1]), order2 = Math.log2(errs[1] / errs[2]);
    expect(errs[2]).toBeLessThan(1e-4);
    expect(order1).toBeGreaterThan(1.6);
    expect(order2).toBeGreaterThan(1.6);
  });

  it('computes a converged ITER-like equilibrium with consistent integrals', () => {
    const solver = new GSSolver(geom, { NR: 65 });
    const eq = solver.solve({ Ip: 15e6, B0: 5.3, profile: { kind: 'shape', alphaM: 2, alphaN: 1.2, betaP: 0.65 } });
    expect(eq.converged).toBe(true);
    const n = eq.prof.psiN.length;
    // toplam akım ve hacim
    expect(eq.prof.Ienc[n - 1] / 15e6).toBeCloseTo(1, 2);
    const shp = shapeIntegrals(millerBoundary(geom));
    expect(eq.volume / shp.volume).toBeCloseTo(1, 3);
    expect(eq.area / shp.area).toBeCloseTo(1, 3);
    // q monoton artan, fiziksel aralıkta
    for (let i = 1; i < n; i++) expect(eq.prof.q[i]).toBeGreaterThan(eq.prof.q[i - 1] - 1e-6);
    expect(eq.q0).toBeGreaterThan(0.6); expect(eq.q0).toBeLessThan(1.4);
    expect(eq.q95).toBeGreaterThan(2.4); expect(eq.q95).toBeLessThan(3.8);
    expect(eq.betaP).toBeCloseTo(0.65, 1);
    // Shafranov kayması dışa doğru, birkaç cm – birkaç on cm
    expect(eq.shafranovShift).toBeGreaterThan(0.02);
    expect(eq.shafranovShift).toBeLessThan(0.5);
    // iç indüktans tipik
    expect(eq.li3).toBeGreaterThan(0.5); expect(eq.li3).toBeLessThan(1.3);
    // tuzaklı oran: 0 eksende, kenarda ~0.6–0.8 (ε≈0.32)
    expect(eq.prof.ft[n - 1]).toBeGreaterThan(0.55); expect(eq.prof.ft[n - 1]).toBeLessThan(0.85);
    // ρ_tor ∈ [0,1] monoton
    expect(eq.prof.rhoTor[n - 1]).toBeCloseTo(1, 12);
    // ⟨R⁻²⟩ q ilişkisi: q = F V' ⟨R⁻²⟩ / (4π² Δψ)
    const i = Math.floor(n / 2);
    const qAlt = (eq.prof.F[i] * eq.prof.dVdpsiN[i] * eq.prof.avgR2inv[i]) / (4 * Math.PI * Math.PI * eq.psiAxis);
    expect(qAlt / eq.prof.q[i]).toBeCloseTo(1, 6);
  });

  it('reproduces an equilibrium from its own p(ψ_N) and I(ψ_N) tables (transport coupling mode)', () => {
    const solver = new GSSolver(geom, { NR: 65 });
    const ref = solver.solve({ Ip: 15e6, B0: 5.3, profile: { kind: 'shape', alphaM: 2, alphaN: 1.5, betaP: 0.5 } });
    const eq = solver.solve({ Ip: 15e6, B0: 5.3, profile: { kind: 'table', psiN: ref.prof.psiN, p: ref.prof.p, I: ref.prof.Ienc.map((v, k) => (k === 0 ? 0 : v)) } });
    expect(eq.converged).toBe(true);
    for (const x of [0.1, 0.3, 0.5, 0.8, 0.95]) {
      const k = Math.round(Math.sqrt(x) * (ref.prof.psiN.length - 1));
      expect(eq.prof.q[k] / ref.prof.q[k]).toBeCloseTo(1, 1);
    }
    expect(eq.q95 / ref.q95).toBeCloseTo(1, 2);
  });
});
