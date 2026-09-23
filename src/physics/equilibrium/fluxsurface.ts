/**
 * Akı yüzeyi izleme ve akı-yüzeyi ortalamaları.
 *
 * Manyetik eksenden çıkan Nθ ışın boyunca ψ_N monoton artar (iç içe yüzeyler). Her ışın M
 * noktada (ψ_N, dψ_N/ds) ile örneklenir; her ψ_N seviyesi kübik Hermite ters çevirme +
 * bikübik spline üzerinde Newton cilasıyla bulunur. Kontur θ (ışın açısı) ile parametrelenir;
 * periyodik integrandlar için trapez kuralı spektral doğrulukludur, dl/dθ 4. mertebe merkezi
 * farkla hesaplanır.
 *
 * Tanımlar (ψ rad başına poloidal akı, B_p = |∇ψ|/R):
 *   ⟨f⟩ = ∮ f dl/B_p / ∮ dl/B_p,     dV/dψ = 2π ∮ R dl/|∇ψ|,
 *   q = (F/2π) ∮ dl/(R|∇ψ|),         V = π ∮ R² dZ,   A = ½∮(R dZ − Z dR).
 * Kaynak: Hirshman & Jardin, Phys. Fluids 22 (1979) 731; Wesson "Tokamaks" §3.
 */
import { Bicubic } from '../numerics/interp';
import { ShapeBoundary } from './miller';

export interface TracedSurfaces {
  psiN: Float64Array; // seviye (Ns), artan; son eleman 1
  theta: Float64Array; // ışın açıları (Nθ)
  R: Float64Array[];
  Z: Float64Array[];
  gradPsi: Float64Array[]; // |∇ψ| [Wb/rad/m]
  dlw: Float64Array[]; // dl_j = |dX/dθ| Δθ
  dRdt: Float64Array[]; // dR/dθ
  dZdt: Float64Array[]; // dZ/dθ
}

/** ψ_N(R,Z) = (ψ_ax − ψ)/(ψ_ax − ψ_b) */
export interface PsiField {
  bi: Bicubic;
  psiAxis: number;
  psiB: number;
  Rax: number;
  Zax: number;
}

/** Işın boyunca eksenden sınıra mesafe (ikiye bölme; yıldız-biçimli alan varsayımı) */
function rayToBoundary(b: ShapeBoundary, Rax: number, Zax: number, c: number, s: number): number {
  let lo = 0, hi = 2.5 * (b.a + b.kappa * b.a);
  for (let k = 0; k < 64; k++) {
    const m = 0.5 * (lo + hi);
    if (b.inside(Rax + m * c, Zax + m * s)) lo = m; else hi = m;
  }
  return 0.5 * (lo + hi);
}

export function traceSurfaces(field: PsiField, boundary: ShapeBoundary, levels: ArrayLike<number>, nTheta = 128, nSample = 48): TracedSurfaces {
  const { bi, psiAxis, psiB, Rax, Zax } = field;
  const dpsi = psiAxis - psiB;
  const Ns = levels.length;
  const theta = new Float64Array(nTheta);
  const R: Float64Array[] = [], Z: Float64Array[] = [], G: Float64Array[] = [];
  for (let k = 0; k < Ns; k++) { R.push(new Float64Array(nTheta)); Z.push(new Float64Array(nTheta)); G.push(new Float64Array(nTheta)); }
  const sv = new Float64Array(nSample), fv = new Float64Array(nSample), dv = new Float64Array(nSample);
  const g3 = new Float64Array(3);
  for (let j = 0; j < nTheta; j++) {
    const th = (2 * Math.PI * j) / nTheta;
    theta[j] = th;
    const c = Math.cos(th), s = Math.sin(th);
    const sb = rayToBoundary(boundary, Rax, Zax, c, s);
    for (let m = 0; m < nSample; m++) {
      const u = m / (nSample - 1);
      const sm = sb * u;
      sv[m] = sm;
      bi.evalGrad(Rax + sm * c, Zax + sm * s, g3);
      fv[m] = (psiAxis - g3[0]) / dpsi;
      dv[m] = -(g3[1] * c + g3[2] * s) / dpsi;
    }
    fv[0] = 0; dv[0] = 0; fv[nSample - 1] = 1;
    // monotonluğu zorla (sayısal gürültüye karşı)
    for (let m = 1; m < nSample; m++) if (fv[m] <= fv[m - 1]) fv[m] = fv[m - 1] + 1e-14;
    let m0 = 0;
    for (let k = 0; k < Ns; k++) {
      const L = levels[k];
      let sk: number;
      if (L >= 1) sk = sb;
      else {
        while (m0 < nSample - 2 && fv[m0 + 1] < L) m0++;
        // Hermite ters çevirme [s_m0, s_m0+1]
        const h = sv[m0 + 1] - sv[m0];
        const y0 = fv[m0], y1 = fv[m0 + 1], d0 = dv[m0] * h, d1 = dv[m0 + 1] * h;
        const H = (t: number) => {
          const t2 = t * t, t3 = t2 * t;
          return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * d0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * d1;
        };
        let lo = 0, hi = 1;
        for (let it = 0; it < 40; it++) { const t = 0.5 * (lo + hi); if (H(t) < L) lo = t; else hi = t; }
        sk = sv[m0] + 0.5 * (lo + hi) * h;
        // Newton cilası gerçek bikübik alan üzerinde
        for (let it = 0; it < 3; it++) {
          bi.evalGrad(Rax + sk * c, Zax + sk * s, g3);
          const f = (psiAxis - g3[0]) / dpsi - L;
          const df = -(g3[1] * c + g3[2] * s) / dpsi;
          if (!(df > 0)) break;
          const step = f / df;
          const sn = Math.min(Math.max(sk - step, sv[m0]), sv[m0 + 1]);
          sk = sn;
          if (Math.abs(step) < 1e-13 * sb) break;
        }
      }
      const Rk = Rax + sk * c, Zk = Zax + sk * s;
      bi.evalGrad(Rk, Zk, g3);
      R[k][j] = Rk; Z[k][j] = Zk; G[k][j] = Math.hypot(g3[1], g3[2]);
    }
  }
  // dl/dθ: periyodik 4. mertebe merkezi fark
  const dth = (2 * Math.PI) / nTheta;
  const dlw: Float64Array[] = [], dRdt: Float64Array[] = [], dZdt: Float64Array[] = [];
  for (let k = 0; k < Ns; k++) {
    const r = R[k], z = Z[k];
    const w = new Float64Array(nTheta), dr = new Float64Array(nTheta), dz = new Float64Array(nTheta);
    for (let j = 0; j < nTheta; j++) {
      const jm2 = (j - 2 + nTheta) % nTheta, jm1 = (j - 1 + nTheta) % nTheta, jp1 = (j + 1) % nTheta, jp2 = (j + 2) % nTheta;
      dr[j] = (-r[jp2] + 8 * r[jp1] - 8 * r[jm1] + r[jm2]) / (12 * dth);
      dz[j] = (-z[jp2] + 8 * z[jp1] - 8 * z[jm1] + z[jm2]) / (12 * dth);
      w[j] = Math.hypot(dr[j], dz[j]) * dth;
    }
    dlw.push(w); dRdt.push(dr); dZdt.push(dz);
  }
  return { psiN: Float64Array.from(levels), theta, R, Z, gradPsi: G, dlw, dRdt, dZdt };
}

/** Bir yüzeyin temel integralleri (F bilinmeden hesaplanabilenler) */
export interface SurfaceMetrics {
  dVdpsi: number; // dV/dψ [m³/(Wb/rad)] (pozitif büyüklük)
  V: number; // çevrelenen hacim [m³]
  A: number; // çevrelenen poloidal alan [m²]
  avgR2inv: number; // ⟨R⁻²⟩
  avgRinv: number; // ⟨R⁻¹⟩
  avgGrad2R2: number; // ⟨|∇ψ|²/R²⟩
  avgGrad2: number; // ⟨|∇ψ|²⟩
  avgGrad: number; // ⟨|∇ψ|⟩
  intDlOverR2Grad: number; // ∮ dl/(R|∇ψ|)  (q = F/2π × bu)
  Ienc: number; // çevrelenen akım (1/μ0)∮|∇ψ|/R dl [A]
  Rmin: number; Rmax: number; Zmin: number; Zmax: number;
  RatZmax: number; RatZmin: number;
  perimeter: number;
}

const MU0 = 1.25663706212e-6;

export function surfaceMetrics(tr: TracedSurfaces, k: number): SurfaceMetrics {
  const R = tr.R[k], Z = tr.Z[k], G = tr.gradPsi[k], dl = tr.dlw[k], dZ = tr.dZdt[k], dR = tr.dRdt[k];
  const n = R.length, dth = (2 * Math.PI) / n;
  let sw = 0, sR2 = 0, sR1 = 0, sG2R2 = 0, sG2 = 0, sG = 0, sq = 0, sI = 0, V = 0, A = 0, per = 0;
  let Rmin = Infinity, Rmax = -Infinity, Zmin = Infinity, Zmax = -Infinity, RatZmax = 0, RatZmin = 0;
  for (let j = 0; j < n; j++) {
    const g = Math.max(G[j], 1e-300);
    const w = (R[j] * dl[j]) / g; // dl/B_p
    sw += w;
    sR2 += w / (R[j] * R[j]);
    sR1 += w / R[j];
    sG2R2 += (w * g * g) / (R[j] * R[j]);
    sG2 += w * g * g;
    sG += w * g;
    sq += dl[j] / (R[j] * g);
    sI += (g / R[j]) * dl[j];
    V += Math.PI * R[j] * R[j] * dZ[j] * dth;
    A += 0.5 * (R[j] * dZ[j] - Z[j] * dR[j]) * dth;
    per += dl[j];
    if (R[j] < Rmin) Rmin = R[j];
    if (R[j] > Rmax) Rmax = R[j];
    if (Z[j] > Zmax) { Zmax = Z[j]; RatZmax = R[j]; }
    if (Z[j] < Zmin) { Zmin = Z[j]; RatZmin = R[j]; }
  }
  return {
    dVdpsi: 2 * Math.PI * sw, V, A,
    avgR2inv: sR2 / sw, avgRinv: sR1 / sw, avgGrad2R2: sG2R2 / sw, avgGrad2: sG2 / sw, avgGrad: sG / sw,
    intDlOverR2Grad: sq, Ienc: sI / MU0,
    Rmin, Rmax, Zmin, Zmax, RatZmax, RatZmin, perimeter: per,
  };
}

/**
 * F bilinince: ⟨B²⟩, B_max, B_min ve tuzaklı parçacık oranı
 *   f_t = 1 − (3/4)⟨h²⟩ ∫₀¹ λ dλ / ⟨√(1 − λh)⟩ ,  h = B/B_max  (Lin-Liu & Miller, PoP 2 (1995) 1666, Denk. 3)
 */
export function magneticAverages(tr: TracedSurfaces, k: number, F: number, lambdaNodes: { x: Float64Array; w: Float64Array }) {
  const R = tr.R[k], G = tr.gradPsi[k], dl = tr.dlw[k];
  const n = R.length;
  const B = new Float64Array(n), W = new Float64Array(n);
  let sw = 0, sB2 = 0, sB = 0, Bmax = 0, Bmin = Infinity;
  for (let j = 0; j < n; j++) {
    const g = Math.max(G[j], 1e-300);
    const b = Math.sqrt(F * F + g * g) / R[j];
    B[j] = b;
    const w = (R[j] * dl[j]) / g;
    W[j] = w; sw += w; sB2 += w * b * b; sB += w * b;
    if (b > Bmax) Bmax = b;
    if (b < Bmin) Bmin = b;
  }
  let h2 = 0;
  for (let j = 0; j < n; j++) h2 += W[j] * (B[j] / Bmax) ** 2;
  h2 /= sw;
  // ∫₀¹ λ/⟨√(1−λh)⟩ dλ, Gauss–Legendre [0,1]
  let integ = 0;
  const { x, w } = lambdaNodes;
  for (let m = 0; m < x.length; m++) {
    const lam = 0.5 * (x[m] + 1);
    let avg = 0;
    for (let j = 0; j < n; j++) avg += W[j] * Math.sqrt(Math.max(1 - (lam * B[j]) / Bmax, 0));
    avg /= sw;
    integ += 0.5 * w[m] * lam / Math.max(avg, 1e-12);
  }
  const ft = Math.min(Math.max(1 - 0.75 * h2 * integ, 0), 1);
  return { avgB2: sB2 / sw, avgB: sB / sw, Bmax, Bmin, ft };
}
