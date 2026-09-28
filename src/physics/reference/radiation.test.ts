/**
 * Reference pack: radiation losses (src/physics/radiation.ts).
 *  [NRL]   J.D. Huba, NRL Plasma Formulary (2019), p. 58: P_Br = 1.69e-32 N_e T_e^{1/2} Σ Z² N_i  W cm⁻³
 *          (N in cm⁻³, T_e in eV), i.e. 1.69e-38 √T_eV n_e Σ Z² n_i in W m⁻³ with n in m⁻³.
 *  [AJG01] F. Albajar, J. Johner and G. Granata, Nucl. Fusion 41 (2001) 665, Eqs. (7), (13), (15), (16),
 *          with the wall-reflection exponents of I. Fidone, G. Giruzzi and G. Granata, Nucl. Fusion 41
 *          (2001) 1755 — cross-checked against the independent implementation in PROCESS
 *          (ukaea/PROCESS, process/models/physics/radiation_power.py, psync_albajar_fidone), ported below.
 *          No PROCESS *output* for an ITER case could be verified, so no absolute ITER value is asserted.
 *  [M18]   A.A. Mavrin, "Improved fits of coronal radiative cooling rates for high-temperature plasmas",
 *          Radiat. Eff. Defects Solids 173 (2018) 388: log10 L_z = Σ_i A_i X^i, X = log10(T_e/keV), and the
 *          <Z>(T_e) fits; coefficients typed from the paper's tables as reproduced in TORAX
 *          (google-deepmind/torax: mavrin_coronal_cooling_rate.py, charge_states.py).
 */
import { describe, expect, it } from 'vitest';
import { bremsstrahlung, coolingRate, lineRadiation, meanCharge, synchrotronTotal } from '../radiation';
import { forAll, gen } from '../../testing/prop';

const rel = (a: number, b: number) => Math.abs(a / b - 1);

describe('[NRL] bremsstrahlung', () => {
  it('reduces to the NRL formula in the non-relativistic limit (T_e ≤ 100 eV) within 0.4 %', () => {
    // 5.35e-37 √T_keV (code) vs 1.69e-38 √(1000 T_keV) = 5.344e-37 √T_keV (NRL): 0.1 %, plus the
    // relativistic factor, which is < 0.2 % below 100 eV.
    forAll(gen.record({ n: gen.logFloat(1e17, 1e22), T: gen.logFloat(0.01, 0.1), Z: gen.float(1, 8) }), ({ n, T, Z }) => {
      const nrl = 1.69e-38 * Math.sqrt(T * 1e3) * n * (Z * n); // Σ Z² n_i = Z_eff n_e
      expect(rel(bremsstrahlung(n, T, Z), nrl)).toBeLessThan(0.004);
    }, { runs: 200 });
  });

  it('applies the documented relativistic factor Z_eff(1 + 0.7936 t + 1.874 t²) + (3/√2) t, t = T_e/m_ec²', () => {
    forAll(gen.record({ n: gen.logFloat(1e17, 1e22), T: gen.logFloat(0.01, 1000), Z: gen.float(1, 8) }), ({ n, T, Z }) => {
      const t = T / 510.99895;
      const ref = 5.35e-37 * n * n * Math.sqrt(T) * (Z * (1 + 0.7936 * t + 1.874 * t * t) + (3 / Math.SQRT2) * t);
      expect(rel(bremsstrahlung(n, T, Z), ref)).toBeLessThan(1e-12);
    }, { runs: 200 });
  });

  it('scales as n_e², grows with T_e and Z_eff, and vanishes without plasma', () => {
    forAll(gen.record({ n: gen.logFloat(1e17, 1e22), T: gen.logFloat(0.01, 1000), Z: gen.float(1, 8), k: gen.float(1.01, 10) }), ({ n, T, Z, k }) => {
      const p = bremsstrahlung(n, T, Z);
      expect(rel(bremsstrahlung(k * n, T, Z), k * k * p)).toBeLessThan(1e-12);
      expect(bremsstrahlung(n, k * T, Z)).toBeGreaterThan(p);
      expect(bremsstrahlung(n, T, k * Z)).toBeGreaterThan(p);
    }, { runs: 200 });
    expect(bremsstrahlung(0, 10, 1)).toBe(0);
    expect(bremsstrahlung(1e20, 0, 1)).toBe(0);
  });
});

describe('[AJG01] synchrotron radiation', () => {
  /** PROCESS psync_albajar_fidone, multiplied back by the volume it divides by: total power [MW] */
  function processPsync(ne0: number, a: number, B: number, A: number, an: number, aT: number, bT: number, T0: number, Rw: number, R: number, kappa: number): number {
    const ne0_20 = 1e-20 * ne0;
    const p_a0 = (6.04e3 * (a * ne0_20)) / B;
    const g = 0.93 * (1 + 0.85 * Math.exp(-0.82 * A));
    const k = (an + 3.87 * aT + 1.46) ** -0.79 * (1.98 + aT) ** 1.36 * bT ** 2.14 * (bT ** 1.53 + 1.87 * aT - 0.16) ** -1.33;
    const dum = (1 + 0.12 * (T0 / p_a0 ** 0.41) * (1 - Rw) ** 0.41) ** -1.51;
    return 3.84e-8 * (1 - Rw) ** 0.62 * R * a ** 1.38 * kappa ** 0.79 * B ** 2.62 * ne0_20 ** 0.38 * T0 * (16 + T0) ** 2.61 * dum * g * k;
  }
  const arb = gen.record({
    R: gen.float(0.5, 10), eps: gen.float(0.15, 0.8), kappa: gen.float(1, 2.8), B: gen.logFloat(0.2, 20),
    ne0: gen.logFloat(1e18, 3e21), T0: gen.logFloat(0.1, 300), an: gen.float(0, 2), aT: gen.float(0.1, 3), bT: gen.float(0.5, 4), Rw: gen.float(0, 0.99),
  });

  it('equals the PROCESS implementation of the Albajar–Fidone formula', () => {
    forAll(arb, (p) => {
      const a = p.eps * p.R;
      const got = synchrotronTotal({ R: p.R, a, kappa: p.kappa, B0: p.B, ne0_1e20: p.ne0 / 1e20, Te0_keV: p.T0, alpha_n: p.an, alpha_T: p.aT, beta_T: p.bT, wallReflectivity: p.Rw });
      expect(rel(got / 1e6, processPsync(p.ne0, a, p.B, 1 / p.eps, p.an, p.aT, p.bT, p.T0, p.Rw, p.R, p.kappa))).toBeLessThan(1e-12);
    }, { runs: 200, label: 'Albajar–Fidone' });
  });

  it('decreases with wall reflectivity (→ 0 for a perfect mirror) and grows with T_e0, B_0 and n_e0', () => {
    forAll(gen.tuple(arb, gen.float(1.01, 3)), ([p, k]) => {
      const base = { R: p.R, a: p.eps * p.R, kappa: p.kappa, B0: p.B, ne0_1e20: p.ne0 / 1e20, Te0_keV: p.T0, alpha_n: p.an, alpha_T: p.aT, beta_T: p.bT, wallReflectivity: p.Rw };
      const P = synchrotronTotal(base);
      expect(P).toBeGreaterThan(0);
      expect(synchrotronTotal({ ...base, wallReflectivity: Math.min(0.999, p.Rw + 0.005) })).toBeLessThan(P);
      expect(synchrotronTotal({ ...base, Te0_keV: k * p.T0 })).toBeGreaterThan(P);
      expect(synchrotronTotal({ ...base, B0: k * p.B })).toBeGreaterThan(P);
      expect(synchrotronTotal({ ...base, ne0_1e20: (k * p.ne0) / 1e20 })).toBeGreaterThan(P);
      expect(synchrotronTotal({ ...base, wallReflectivity: 1 })).toBe(0);
    }, { runs: 150 });
  });
});

describe('[M18] coronal cooling rates and mean charge', () => {
  // log10 L_z [W m³] = A0 + A1 X + A2 X² + A3 X³ + A4 X⁴ on each temperature interval [keV]
  const LZ: Record<'W' | 'Ar' | 'Ne', { edges: number[]; A: number[][] }> = {
    W: { edges: [0.1, 1.5, 4, 100], A: [
      [-30.374, 0.38304, -0.95126, -1.0311, -0.10103],
      [-30.238, -2.9208, 22.824, -63.303, 51.849],
      [-32.153, 5.2499, -6.274, 2.6627, -0.36759]] },
    Ar: { edges: [0.1, 0.6, 3, 100], A: [
      [-32.155, 6.5221, 30.769, 39.161, 15.353],
      [-32.53, 0.5449, 1.5389, -7.6887, 4.9806],
      [-31.853, -1.6674, 0.61339, 0.1748, -0.08226]] },
    Ne: { edges: [0.1, 0.7, 5, 100], A: [
      [-33.132, 1.7309, 15.23, 28.939, 15.648],
      [-33.29, -0.8775, 0.86842, -0.39544, 0.17244],
      [-33.41, -0.45345, 0.29731, 0.04396, -0.02693]] },
  };
  // <Z> = a4 X⁴ + a3 X³ + a2 X² + a1 X + a0 (coefficients listed a4 … a0), intervals split at `bounds`
  const ZF: Record<'W' | 'Ar' | 'Ne', { Z: number; bounds: number[]; a: number[][] }> = {
    W: { Z: 74, bounds: [1.5, 4], a: [
      [16.823, 34.582, 21.027, 16.518, 26.703], [-258.87, -10.577, 255.32, -79.611, 36.902], [15.119, -84.207, 159.85, -100.11, 63.795]] },
    Ar: { Z: 18, bounds: [0.6, 3], a: [
      [6.8717, -11.595, -43.776, -20.781, 13.171], [-0.04883, 1.8455, 2.5023, 1.1413, 15.986], [-0.59213, 3.5667, -8.0048, 7.9986, 14.948]] },
    Ne: { Z: 10, bounds: [0.5, 2], a: [
      [-25.303, -64.696, -53.631, -13.242, 8.9737], [-7.0678, 3.6868, -0.80723, 0.21413, 9.9532], [0, 0, 0, 0, 10]] },
  };
  const lzRef = (s: keyof typeof LZ, T: number) => {
    const { edges, A } = LZ[s];
    const i = Math.max(0, edges.findIndex((e, k) => k > 0 && T <= e) - 1);
    const X = Math.log10(T);
    return 10 ** A[i].reduce((acc, c, p) => acc + c * X ** p, 0);
  };
  const zRef = (s: keyof typeof ZF, T: number) => {
    const { bounds, a } = ZF[s];
    let k = 0;
    while (k < bounds.length && T > bounds[k]) k++;
    const X = Math.log10(T);
    return a[k].reduce((acc, c) => acc * X + c, 0);
  };
  const GRID = [0.1, 0.2, 0.35, 0.5, 0.8, 1, 1.2, 2, 2.5, 3.5, 4.5, 7, 10, 20, 50, 100];
  const species = ['W', 'Ar', 'Ne'] as const;

  it.each(species)('%s: L_z equals the published fit on the 0.1–100 keV grid', (s) => {
    for (const T of GRID) expect(rel(coolingRate(s, T), lzRef(s, T)), `${s} at ${T} keV`).toBeLessThan(1e-9);
  });

  it.each(species)('%s: <Z> equals the published fit on the 0.1–100 keV grid', (s) => {
    for (const T of GRID) expect(meanCharge(s, T), `${s} at ${T} keV`).toBeCloseTo(Math.min(zRef(s, T), ZF[s].Z), 9);
  });

  // The pieces are independent fits; at the nodes they join within ≈ 2 % in L_z (largest: W at
  // 4 keV, 1.8 %) and 0.2 charge units in <Z> (W at 4 keV). A mistyped coefficient breaks this.
  it.each(species)('%s: the piecewise fits join continuously at the nodes', (s) => {
    for (const T of LZ[s].edges.slice(1, -1)) expect(rel(coolingRate(s, T * (1 + 1e-9)), coolingRate(s, T * (1 - 1e-9))), `L_z node ${T} keV`).toBeLessThan(0.025);
    for (const T of ZF[s].bounds) expect(Math.abs(meanCharge(s, T * (1 + 1e-9)) - meanCharge(s, T * (1 - 1e-9))), `<Z> node ${T} keV`).toBeLessThan(0.2);
  });

  it('<Z> stays in [0, Z_nuc], rises with T_e (within the node jumps) and strips light ions', () => {
    for (const s of species) {
      let peak = 0;
      for (let i = 0; i <= 600; i++) {
        const T = 0.1 * 1000 ** (i / 600);
        const z = meanCharge(s, T);
        expect(z).toBeGreaterThanOrEqual(0);
        expect(z).toBeLessThanOrEqual(ZF[s].Z);
        expect(z, `${s} at ${T.toFixed(3)} keV`).toBeGreaterThan(peak - 0.2);
        peak = Math.max(peak, z);
      }
    }
    expect(meanCharge('Ne', 3)).toBe(10);
    expect(meanCharge('Ar', 20)).toBeGreaterThan(17.9);
    expect(meanCharge('Be', 1)).toBe(4);
    expect(meanCharge('He', 1)).toBe(2);
  });

  it('clamps outside 0.1–100 keV and gives n_e n_Z L_z for the line power', () => {
    for (const s of species) {
      expect(coolingRate(s, 0.01)).toBe(coolingRate(s, 0.1));
      expect(coolingRate(s, 1000)).toBe(coolingRate(s, 100));
    }
    forAll(gen.record({ ne: gen.logFloat(1e18, 1e21), c: gen.logFloat(1e-6, 0.1), T: gen.logFloat(0.1, 100), s: gen.oneOf(species) }), ({ ne, c, T, s }) => {
      expect(rel(lineRadiation(ne, c * ne, s, T), ne * c * ne * coolingRate(s, T))).toBeLessThan(1e-14);
      expect(coolingRate(s, T)).toBeGreaterThan(0);
    }, { runs: 100 });
  });
});
