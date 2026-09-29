import { describe, expect, it } from 'vitest';
import { carlsonRD, carlsonRF, ellipticE, ellipticK, ellipticKE } from './elliptic';

/** arithmetic-geometric mean of a and b */
function agm(a: number, b: number): number {
  for (let i = 0; i < 60; i++) { const an = 0.5 * (a + b), bn = Math.sqrt(a * b); if (Math.abs(an - bn) <= 1e-16 * an) return an; a = an; b = bn; }
  return a;
}

/** K and E by the AGM (Abramowitz and Stegun 17.6): K = π/(2 AGM(1, k′)), E = K (1 − Σ 2^(n−1) c_n²), c_0² = m, c_{n+1} = (a_n − b_n)/2 */
function agmKE(m: number, mc: number): { K: number; E: number } {
  let a = 1, b = Math.sqrt(mc), sum = 0.5 * m, p = 0.5;
  for (let n = 1; n < 60; n++) {
    const an = 0.5 * (a + b), bn = Math.sqrt(a * b), c = 0.5 * (a - b);
    a = an; b = bn; p *= 2; // p = 2^(n−1)
    sum += p * c * c;
    if (Math.abs(c) < 1e-17 * a) break;
  }
  const K = Math.PI / (2 * a);
  return { K, E: K * (1 - sum) };
}

const rel = (a: number, b: number) => Math.abs(a / b - 1);

describe('Carlson R_F and R_D', () => {
  it('reduce to powers when the arguments agree, are symmetric, and are homogeneous', () => {
    for (const x of [1e-6, 0.3, 1, 17, 4e5]) {
      expect(rel(carlsonRF(x, x, x), 1 / Math.sqrt(x))).toBeLessThan(1e-15);
      expect(rel(carlsonRD(x, x, x), Math.pow(x, -1.5))).toBeLessThan(1e-15);
    }
    const [x, y, z] = [0.4, 2.5, 7.1];
    const f = carlsonRF(x, y, z), d = carlsonRD(x, y, z);
    for (const [a, b, c] of [[y, x, z], [z, y, x], [x, z, y], [y, z, x]]) expect(rel(carlsonRF(a, b, c), f)).toBeLessThan(1e-15);
    expect(rel(carlsonRD(y, x, z), d)).toBeLessThan(1e-15);
    for (const lam of [1e-4, 3, 250]) {
      expect(rel(carlsonRF(lam * x, lam * y, lam * z), f / Math.sqrt(lam))).toBeLessThan(1e-14);
      expect(rel(carlsonRD(lam * x, lam * y, lam * z), d / Math.pow(lam, 1.5))).toBeLessThan(1e-14);
    }
  });

  it('satisfy the identity R_D(y, z, x) + R_D(z, x, y) + R_D(x, y, z) = 3 / √(xyz) (Carlson 1979) and reproduce the tabulated R_D(0, 2, 1), R_D(2, 3, 4), R_F(2, 3, 4)', () => {
    for (const [x, y, z] of [[1, 2, 3], [0.1, 5, 40], [2e-3, 0.7, 1]]) {
      const s = carlsonRD(y, z, x) + carlsonRD(z, x, y) + carlsonRD(x, y, z);
      expect(rel(s, 3 / Math.sqrt(x * y * z))).toBeLessThan(1e-14);
    }
    expect(rel(carlsonRD(0, 2, 1), 1.7972103521033883)).toBeLessThan(2e-15);
    expect(rel(carlsonRD(2, 3, 4), 0.16510527294261053)).toBeLessThan(2e-15);
    expect(rel(carlsonRF(2, 3, 4), 0.5840828416771517)).toBeLessThan(2e-15);
  });

  it('a zero argument is allowed once (the complete integrals), twice or a negative one is refused', () => {
    expect(carlsonRF(0, 1, 2)).toBeCloseTo(1.3110287771461, 12); // K(1/2)/√2
    expect(carlsonRD(0, 1, 2)).toBeGreaterThan(0);
    expect(() => carlsonRF(0, 0, 1)).toThrow(RangeError);
    expect(() => carlsonRF(-1, 1, 1)).toThrow(/finite arguments/);
    expect(() => carlsonRF(1, NaN, 1)).toThrow(RangeError);
    expect(() => carlsonRD(0, 0, 1)).toThrow(/at most one/);
    expect(() => carlsonRD(1, 1, 0)).toThrow(RangeError);
    expect(() => carlsonRD(-1, 1, 1)).toThrow(RangeError);
    expect(() => carlsonRD(1, Infinity, 1)).toThrow(RangeError);
  });
});

describe('complete elliptic integrals K(m) and E(m)', () => {
  it('have the tabulated values (Abramowitz and Stegun 17.9): K(0) = E(0) = π/2, E(1) = 1, K(1/2), E(1/2)', () => {
    expect(rel(ellipticK(0), Math.PI / 2)).toBeLessThan(1e-15);
    expect(rel(ellipticE(0), Math.PI / 2)).toBeLessThan(1e-15);
    expect(rel(ellipticK(0.5), 1.8540746773013719)).toBeLessThan(1e-15);
    expect(rel(ellipticE(0.5), 1.3506438810476755)).toBeLessThan(1e-15);
    // E(1) = 1 from the difference of two large numbers, K ≈ 350: about K·ε
    expect(rel(ellipticE(1 - 1e-300, 1e-300), 1)).toBeLessThan(2e-13);
  });

  it('agree with the arithmetic-geometric mean to 1e-14 from m = 1e-12 to the complement 1e-13, the complement given exactly', () => {
    const ms = [1e-12, 1e-8, 1e-4, 0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99, 0.999, 0.999999];
    for (const m of ms) {
      const a = agmKE(m, 1 - m), b = ellipticKE(m);
      expect(rel(b.K, a.K), `K(${m})`).toBeLessThan(1e-14);
      expect(rel(b.E, a.E), `E(${m})`).toBeLessThan(1e-14);
    }
    // near 1 the complement is what is known: m = 1 − mc with mc as small as 1e-13
    for (const mc of [1e-3, 1e-7, 1e-10, 1e-13]) {
      const a = agmKE(1 - mc, mc), b = ellipticKE(1 - mc, mc);
      expect(rel(b.K, a.K), `K, 1 − m = ${mc}`).toBeLessThan(1e-14);
      expect(rel(b.E, a.E), `E, 1 − m = ${mc}`).toBeLessThan(1e-14);
    }
    expect(rel(ellipticK(0.3), 2 * Math.PI / (2 * agm(1, Math.sqrt(0.7))) / 2 * 1)).toBeLessThan(1e-14); // K = π/(2 AGM(1, k′))
  });

  it('satisfy Legendre\'s relation E K′ + E′ K − K K′ = π/2 to 1e-14', () => {
    for (const m of [1e-6, 0.01, 0.2, 0.5, 0.8, 0.99, 1 - 1e-9]) {
      const mc = 1 - m;
      const a = ellipticKE(m, mc), b = ellipticKE(mc, m);
      expect(Math.abs(a.E * b.K + b.E * a.K - a.K * b.K - Math.PI / 2)).toBeLessThan(2e-14 * a.K * b.K);
    }
  });

  it('K grows like ln(4/k′) towards 1 and both are monotone; the domain is guarded', () => {
    const mc = 1e-12;
    expect(rel(ellipticK(1 - mc, mc), Math.log(4 / Math.sqrt(mc)))).toBeLessThan(1e-11);
    let pk = 0, pe = 2;
    for (let i = 0; i < 100; i++) {
      const m = i / 100;
      const { K, E } = ellipticKE(m);
      expect(K).toBeGreaterThan(pk);
      expect(E).toBeLessThan(pe);
      pk = K; pe = E;
    }
    expect(() => ellipticKE(1)).toThrow(RangeError);
    expect(() => ellipticKE(-0.1)).toThrow(RangeError);
    expect(() => ellipticKE(0.5, 0)).toThrow(RangeError);
    expect(() => ellipticKE(NaN)).toThrow(RangeError);
  });
});
