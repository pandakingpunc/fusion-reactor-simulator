/**
 * Transport geometry from an equilibrium (geometryFromEquilibrium) against an analytic Solov'ev
 * equilibrium: Cerfon & Freidberg, "'One size fits all' analytic solutions to the Grad–Shafranov
 * equation", Phys. Plasmas 17 (2010) 032502 (src/physics/equilibrium/solovev.ts), with the
 * ITER-like shape of the equilibrium tests.
 *
 * The equilibrium tables come from tracing the flux surfaces of the exact ψ(R, Z) with the
 * equilibrium module's tracer (as the Grad–Shafranov solver does for its own ψ). The reference
 * values are computed independently, as volume and surface integrals of the analytic field in
 * polar coordinates about the magnetic axis, and checked through identities the transport
 * equations rely on:
 *
 *   V(ρ̂)                       volume inside the surface ρ̂ = √(Φ/Φ_b)           (cell volumes ΔV)
 *   V' g2 ψ'/(2π μ0) = I(ρ̂)    Ampère: enclosed toroidal current                 (current diffusion)
 *   V' g1 ψ' = −∫∇²ψ dV         Gauss: ∮|∇ψ| dS                                   (heat and particle fluxes)
 *   V' ⟨|∇ρ̂|⟩ = S(ρ̂)            surface area                                      (convection, pinch)
 *   q(ρ̂), R_in(ρ̂), R_out(ρ̂)
 *
 * with ψ' = dψ/dρ̂ = Φ_b ρ̂/(π q), V' = dV/dρ̂, g1 = ⟨|∇ρ̂|²⟩, g2 = ⟨|∇ρ̂|²/R²⟩.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PhysicalSolovev } from '../equilibrium/solovev';
import { magneticAverages, surfaceMetrics, traceSurfaces } from '../equilibrium/fluxsurface';
import type { ShapeBoundary } from '../equilibrium/miller';
import { Bicubic, CubicSpline } from '../numerics/interp';
import { gaussLegendre } from '../numerics/quadrature';
import { EquilibriumTables, geometryFromEquilibrium, TransportGeometry } from './geometry1d';

const MU0 = 1.25663706212e-6;
const R0 = 6.2, B0 = 5.3, Ip = 15e6;
const SHAPE = { epsilon: 0.32, kappa: 1.7, delta: 0.33, A: -0.155 };

/** The analytic equilibrium: ψ > 0 inside, ψ = 0 on the boundary, constant p′ and FF′ */
class Solovev {
  readonly sol = new PhysicalSolovev(R0, B0, Ip, SHAPE, 100);
  readonly Rax: number;
  readonly psiAx: number;
  /** a radius outside the plasma along each reference ray θ_j = 2πj/nTheta */
  private readonly rOut: Float64Array;
  constructor(readonly nTheta = 64, private readonly gl = gaussLegendre(12)) {
    const eq = this.sol.eq;
    let xa = 1.05;
    for (let it = 0; it < 30; it++) xa -= eq.psiBar(xa, 0, 1, 0) / eq.psiBar(xa, 0, 2, 0);
    this.Rax = xa * R0;
    this.psiAx = this.sol.psi(this.Rax, 0);
    this.rOut = Float64Array.from({ length: nTheta }, (_, j) => {
      const c = Math.cos((2 * Math.PI * j) / nTheta), s = Math.sin((2 * Math.PI * j) / nTheta);
      let r = 0.05;
      while (this.sol.inPlasma((this.Rax + r * c) / R0, (r * s) / R0)) r += 0.05;
      return r;
    });
  }

  /** F(ψ) at ψ_N = x */
  F(x: number): number { return this.sol.F(this.psiAx * (1 - x)); }

  /** Equilibrium tables from the flux surfaces of the exact field, assembled as the GS solver does */
  tables(nS = 51, nTheta = 128): EquilibriumTables {
    const sol = this.sol, Rax = this.Rax, psiAx = this.psiAx;
    // the tracer needs ψ and ∇ψ only: the analytic field stands in for the solver's bicubic spline
    const field = {
      evalGrad(R: number, Z: number, out: Float64Array | number[] = new Float64Array(3)) {
        const [gR, gZ] = sol.grad(R, Z);
        out[0] = sol.psi(R, Z); out[1] = gR; out[2] = gZ;
        return out;
      },
    } as Pick<Bicubic, 'evalGrad'> as Bicubic;
    const unused = (): never => { throw new Error('not used by traceSurfaces'); };
    const boundary: ShapeBoundary = {
      R0, a: SHAPE.epsilon * R0, kappa: SHAPE.kappa, delta: SHAPE.delta,
      inside: (R, Z) => sol.inPlasma(R / R0, Z / R0), rRange: unused, zTop: unused, point: unused,
    };
    const lev = Float64Array.from({ length: nS - 1 }, (_, k) => ((k + 1) / (nS - 1)) ** 2);
    const tr = traceSurfaces({ bi: field, psiAxis: psiAx, psiB: 0, Rax, Zax: 0 }, boundary, lev, nTheta, 64);
    const z = () => new Float64Array(nS);
    const P = {
      psiN: z(), rhoTor: z(), q: z(), F: z(), V: z(), dVdpsiN: z(), area: z(), avgR2inv: z(), avgGrad2R2: z(),
      avgGrad2: z(), avgGrad: z(), avgB2: z(), ft: z(), Rin: z(), Rout: z(),
    };
    const lam = gaussLegendre(24);
    P.F[0] = this.F(0); P.avgR2inv[0] = 1 / (Rax * Rax); P.avgB2[0] = (P.F[0] / Rax) ** 2; P.Rin[0] = P.Rout[0] = Rax;
    lev.forEach((x, k) => {
      const i = k + 1, m = surfaceMetrics(tr, k), F = this.F(x);
      P.psiN[i] = x; P.F[i] = F; P.V[i] = m.V; P.area[i] = m.A; P.dVdpsiN[i] = m.dVdpsi * psiAx;
      P.avgR2inv[i] = m.avgR2inv; P.avgGrad2R2[i] = m.avgGrad2R2; P.avgGrad2[i] = m.avgGrad2; P.avgGrad[i] = m.avgGrad;
      const mag = magneticAverages(tr, k, F, lam);
      P.avgB2[i] = mag.avgB2; P.ft[i] = mag.ft; P.q[i] = (F / (2 * Math.PI)) * m.intDlOverR2Grad;
      P.Rin[i] = m.Rmin; P.Rout[i] = m.Rmax;
    });
    const ex = (a: Float64Array) => a[1] - (a[2] - a[1]) * (P.psiN[1] / (P.psiN[2] - P.psiN[1]));
    P.q[0] = ex(P.q); P.dVdpsiN[0] = ex(P.dVdpsiN);
    // Φ(ψ_N) = 2π Δψ ∫ q dψ_N
    const qS = new CubicSpline(P.psiN, P.q);
    const Phi = Float64Array.from(P.psiN, (x) => 2 * Math.PI * psiAx * qS.integral(x));
    const PhiB = Phi[nS - 1];
    Phi.forEach((v, i) => { P.rhoTor[i] = Math.sqrt(v / PhiB); });
    let perimeter = 0;
    for (const dl of tr.dlw[nS - 2]) perimeter += dl;
    return { prof: P, surfaces: tr, psiAxis: psiAx, Raxis: Rax, PhiB, rhoTorB: Math.sqrt(PhiB / (Math.PI * B0)), B0, R0, volume: P.V[nS - 1], perimeter };
  }

  /** Radius of the surface ψ_N = x along the ray at angle θ from the axis (bisection, Newton polish) */
  contour(j: number, x: number): number {
    const sol = this.sol, th = (2 * Math.PI * j) / this.nTheta, c = Math.cos(th), s = Math.sin(th);
    const target = this.psiAx * (1 - x);
    let lo = 0, hi = this.rOut[j];
    for (let it = 0; it < 40; it++) { const m = 0.5 * (lo + hi); if (sol.psi(this.Rax + m * c, m * s) > target) lo = m; else hi = m; }
    let r = 0.5 * (lo + hi);
    for (let it = 0; it < 2; it++) {
      const R = this.Rax + r * c, Z = r * s, [gR, gZ] = sol.grad(R, Z);
      r -= (sol.psi(R, Z) - target) / (gR * c + gZ * s);
    }
    return r;
  }

  /** Toroidal flux inside ψ_N = x: ∫ F(ψ)/R dA */
  flux(x: number): number {
    let Phi = 0;
    this.polar(x, (R, _Z, w) => { Phi += (this.sol.F(this.sol.psi(R, _Z)) / R) * w; });
    return Phi;
  }

  /**
   * Reference integrals inside and on the surface ψ_N = x: volume, enclosed toroidal current
   * ∫ j_φ dA with j_φ = R p′ + FF′/(μ0 R), ∫∇²ψ dV with ∇²ψ = Δ*ψ + (2/R) ∂ψ/∂R, surface area
   * 2π∮R dl, q = (F/2π)∮ dl/(R|∇ψ|), and the outboard and inboard mid-plane radii.
   */
  reference(x: number) {
    const sol = this.sol, n = this.nTheta, dth = (2 * Math.PI) / n;
    let V = 0, I = 0, lap = 0;
    this.polar(x, (R, Z, w) => {
      V += 2 * Math.PI * R * w;
      I += (R * sol.pPrime + sol.FFprime / (MU0 * R)) * w;
      lap += (sol.source(R) + (2 * sol.grad(R, Z)[0]) / R) * 2 * Math.PI * R * w;
    });
    let S = 0, qInt = 0;
    for (let j = 0; j < n; j++) {
      const th = j * dth, c = Math.cos(th), s = Math.sin(th), r = this.contour(j, x);
      const R = this.Rax + r * c, [gR, gZ] = sol.grad(R, r * s);
      const drdth = (-r * (-gR * s + gZ * c)) / (gR * c + gZ * s); // along ψ = const
      const dl = Math.hypot(r, drdth) * dth;
      S += 2 * Math.PI * R * dl;
      qInt += dl / (R * Math.hypot(gR, gZ));
    }
    return { V, I, lap, S, q: (this.F(x) / (2 * Math.PI)) * qInt, Rout: this.Rax + this.contour(0, x), Rin: this.Rax - this.contour(n / 2, x) };
  }

  /** Σ f(R, Z) r dr dθ over the inside of ψ_N = x (Gauss–Legendre in r, trapezoid in θ) */
  private polar(x: number, f: (R: number, Z: number, w: number) => void): void {
    const n = this.nTheta, dth = (2 * Math.PI) / n, { x: gx, w: gw } = this.gl;
    for (let j = 0; j < n; j++) {
      const c = Math.cos(j * dth), s = Math.sin(j * dth), rb = this.contour(j, x);
      for (let k = 0; k < gx.length; k++) {
        const r = 0.5 * rb * (gx[k] + 1);
        f(this.Rax + r * c, r * s, 0.5 * rb * gw[k] * r * dth);
      }
    }
  }
}

describe("transport geometry from an analytic Solov'ev equilibrium", () => {
  const N = 50;
  let an: Solovev, g: TransportGeometry, xOf: (rho: number) => number, PhiRef: number;
  /** reference integrals on the surface ρ̂ (cached) */
  const at = new Map<number, ReturnType<Solovev['reference']>>();
  const ref = (rho: number) => { let r = at.get(rho); if (!r) { r = an.reference(xOf(rho)); at.set(rho, r); } return r; };
  beforeAll(() => {
    an = new Solovev();
    g = geometryFromEquilibrium(an.tables(), N, { a: SHAPE.epsilon * R0, kappa: SHAPE.kappa, delta: SHAPE.delta });
    // ρ̂ → ψ_N from the reference toroidal flux Φ(ψ_N) (linear in ψ_N at the axis) on nodes (k/24)²
    // that crowd towards the axis, then Newton on the exact flux with dΦ/dψ_N = 2π Δψ q
    const x = Array.from({ length: 25 }, (_, k) => (k / 24) ** 2);
    const Phi = x.map((v) => (v === 0 ? 0 : an.flux(v)));
    PhiRef = Phi[Phi.length - 1];
    const PhiS = new CubicSpline(x, Phi);
    xOf = (rho) => {
      let lo = 0, hi = 1;
      for (let it = 0; it < 60; it++) { const m = 0.5 * (lo + hi); if (PhiS.eval(m) < rho * rho * PhiRef) lo = m; else hi = m; }
      let xk = 0.5 * (lo + hi);
      if (rho > 0 && rho < 1) for (let it = 0; it < 2; it++) xk -= (an.flux(xk) - rho * rho * PhiRef) / (2 * Math.PI * an.psiAx * an.reference(xk).q);
      return rho >= 1 ? 1 : xk;
    };
  }, 60000);

  const rel = (a: number, b: number) => Math.abs(a / b - 1);
  // faces near the axis, through the core and at the edge; the cells between faces of this list
  const FACES = [1, 2, 3, 5, 10, 20, 30, 40, 45, 48, 49, 50];
  const CELLS = [0, 1, 2, 48, 49];

  it('global values: toroidal flux, ρ_tor of the boundary, volume and surface area', () => {
    const r = ref(1);
    expect(rel(g.PhiB, PhiRef)).toBeLessThan(5e-5);
    expect(rel(g.rhoTorB, Math.sqrt(PhiRef / (Math.PI * B0)))).toBeLessThan(5e-5);
    expect(rel(g.volume, r.V)).toBeLessThan(5e-5);
    expect(rel(g.surface, r.S)).toBeLessThan(5e-5);
    // cell volumes add up to the plasma volume; V' vanishes on the axis
    expect(rel(g.dV.reduce((a, b) => a + b, 0), g.volume)).toBeLessThan(1e-14);
    expect(g.VpF[0]).toBe(0);
    for (let i = 0; i < N; i++) expect(g.dV[i]).toBeGreaterThan(0);
  }, 60000);

  it('volume, Ampère and Gauss integrals, surface area and mid-plane radii on the faces', () => {
    for (const f of FACES) {
      const rho = g.rhoF[f], r = ref(rho);
      const dpsi = (g.PhiB * rho) / (Math.PI * r.q); // ψ' = dψ/dρ̂
      expect(rel(g.VF[f], r.V)).toBeLessThan(5e-5);
      expect(rel((g.VpF[f] * g.g2F[f] * dpsi) / (2 * Math.PI * MU0), r.I)).toBeLessThan(2e-4);
      expect(rel(g.VpF[f] * g.g1F[f] * dpsi, -r.lap)).toBeLessThan(2e-4);
      expect(rel(g.VpF[f] * g.gradRhoF[f], r.S)).toBeLessThan(1e-4);
      expect(Math.abs(g.RoutF[f] - r.Rout)).toBeLessThan(5e-5 * g.a);
      expect(Math.abs(g.RinF[f] - r.Rin)).toBeLessThan(5e-5 * g.a);
    }
  }, 60000);

  it('cell volumes (innermost and outermost) and the safety factor at the cell centres', () => {
    // the innermost cell was 1.3 % too small when V was splined against ρ̂ with a natural end condition
    for (const i of CELLS) expect(rel(g.dV[i], ref(g.rhoF[i + 1]).V - (i ? ref(g.rhoF[i]).V : 0))).toBeLessThan(3e-4);
    for (const i of [0, 1, 2, 10, 25, 48, 49]) expect(rel(g.qEqC[i], ref(g.rhoC[i]).q)).toBeLessThan(3e-4);
  }, 60000);
});
