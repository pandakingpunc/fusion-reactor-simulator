import { describe, expect, it } from 'vitest';
import { Bicubic } from '../numerics/interp';
import { gaussLegendre } from '../numerics/quadrature';
import { magneticAverages, surfaceMetrics, traceSurfaces } from './fluxsurface';
import { millerBoundary } from './miller';

const MU0 = 1.25663706212e-6;

describe('flux-surface tracing and averages', () => {
  // concentric circles ψ = ψ0 (1 − r²/a²), r² = (R − R0)² + Z²: ψ_N = r²/a², |∇ψ| = 2ψ0 r/a²
  const R0 = 3, a = 1, psi0 = 2, F = 7;
  const n = 241, x0 = R0 - 1.5 * a, z0 = -1.5 * a, h = (3 * a) / (n - 1);
  const f = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const dR = x0 + i * h - R0, Z = z0 + j * h;
    f[j * n + i] = psi0 * (1 - (dR * dR + Z * Z) / (a * a));
  }
  const bi = new Bicubic(f, n, n, x0, z0, h, h);
  const levels = [0.04, 0.25, 0.64, 1];
  const tr = traceSurfaces({ bi, psiAxis: psi0, psiB: 0, Rax: R0, Zax: 0 }, millerBoundary({ R: R0, a, kappa: 1, delta: 0 }), levels, 128, 64);

  it('concentric circles: every metric matches its closed form', () => {
    for (let k = 0; k < levels.length; k++) {
      const r = a * Math.sqrt(levels[k]);
      const g = (2 * psi0 * r) / (a * a), s = Math.sqrt(R0 * R0 - r * r);
      const m = surfaceMetrics(tr, k);
      const close = (v: number, ref: number) => expect(v / ref).toBeCloseTo(1, 6);
      close(m.A, Math.PI * r * r);
      close(m.V, 2 * Math.PI * Math.PI * R0 * r * r);
      close(m.dVdpsi, (2 * Math.PI * Math.PI * R0 * a * a) / psi0);
      close(m.perimeter, 2 * Math.PI * r);
      close(m.avgR2inv, 1 / (R0 * s)); // ⟨R⁻²⟩ = ∮R⁻¹dl / ∮R dl
      close(m.avgRinv, 1 / R0);
      close(m.avgGrad, g);
      close(m.avgGrad2, g * g);
      close(m.avgGrad2R2, (g * g) / (R0 * s));
      close(m.intDlOverR2Grad, (2 * Math.PI * r) / (s * g));
      close(m.Ienc, (g * 2 * Math.PI * r) / (MU0 * s));
      expect(m.Rmin).toBeCloseTo(R0 - r, 9);
      expect(m.Rmax).toBeCloseTo(R0 + r, 9);
      expect(m.Zmax).toBeCloseTo(r, 3); // θ grid: Z_max sampled, not interpolated
      const mag = magneticAverages(tr, k, F, gaussLegendre(24));
      close(mag.avgB2, ((F * F + g * g) / R0) / s);
      close(mag.Bmax, Math.sqrt(F * F + g * g) / (R0 - r));
      close(mag.Bmin, Math.sqrt(F * F + g * g) / (R0 + r));
    }
  });

  it('trapped fraction grows like 1.46 √ε at small inverse aspect ratio', () => {
    const ft = levels.map((_, k) => magneticAverages(tr, k, F, gaussLegendre(24)).ft);
    for (let k = 1; k < ft.length; k++) expect(ft[k]).toBeGreaterThan(ft[k - 1]);
    const eps = (a * Math.sqrt(levels[0])) / R0; // 0.067
    expect(ft[0] / (1.46 * Math.sqrt(eps))).toBeGreaterThan(0.85);
    expect(ft[0] / (1.46 * Math.sqrt(eps))).toBeLessThan(1.02);
  });
});
