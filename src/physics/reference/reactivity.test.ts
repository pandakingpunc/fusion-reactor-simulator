/**
 * Reference pack: fusion reactivities, cross-sections and reaction bookkeeping (src/physics/reactivity.ts).
 *
 * Reference data are typed in from the publications, never computed with the code under test:
 *  [BH92]  H.-S. Bosch and G.M. Hale, "Improved formulas for fusion cross-sections and thermal
 *          reactivities", Nucl. Fusion 32 (1992) 611 — Table IV (cross-section fit parameters),
 *          Table V (cross-sections), Table VII (reactivity fit parameters), Table VIII (reactivities).
 *  [NS00]  W.M. Nevins and R. Swain, "The thermonuclear fusion rate coefficient for p-11B
 *          reactions", Nucl. Fusion 40 (2000) 865 — low-energy S-factor, Eq. (3); parameters as
 *          reproduced in H.-Y. Wang et al., arXiv:2601.00241 (2026), Table I.
 *  [AME20] W.J. Huang et al., Chin. Phys. C 45 (2021) 030002 and M. Wang et al., Chin. Phys. C 45
 *          (2021) 030003 (atomic masses); CODATA 2018 for u c² and the neutron mass.
 */
import { describe, expect, it } from 'vitest';
import { FUEL_CHANNELS, FUEL_SPECIES, FuelType, beamTargetReactivity, crossSection, pB11_sigma_m2, sigmav } from '../reactivity';
import { forAll, gen } from '../../testing/prop';

const keV_J = 1.602176634e-16;
const amu_kg = 1.6605390666e-27;
const c_ms = 299792458;
const rel = (a: number, b: number) => Math.abs(a / b - 1);

type BHKey = 'DT' | 'DHe3' | 'DD_pT' | 'DD_nHe3';
type SigmaKey = 'DT' | 'DHe3' | 'DD_pT' | 'DD_nHe3';

// ---------------------------------------------------------------------------------------------
// [BH92] Table VIII — thermal reactivities <σv> [cm³/s]. The table ends at T_i = 50 keV.
const TABLE_VIII_T = [1, 2, 5, 10, 20, 50];
const TABLE_VIII: Record<BHKey, number[]> = {
  DT: [6.857e-21, 2.977e-19, 1.366e-17, 1.136e-16, 4.330e-16, 8.649e-16], // D(t,n)α
  DHe3: [3.057e-26, 1.399e-23, 6.377e-21, 2.126e-19, 3.482e-18, 5.554e-17], // ³He(d,p)α
  DD_pT: [1.017e-22, 3.150e-21, 9.024e-20, 5.781e-19, 2.399e-18, 9.838e-18], // D(d,p)T
  DD_nHe3: [9.933e-23, 3.110e-21, 9.128e-20, 6.023e-19, 2.603e-18, 1.133e-17], // D(d,n)³He
};

// [BH92] Table VII — reactivity fit, Eqs. (12)–(14); last two entries: validity range and max. deviation.
const TABLE_VII: Record<BHKey, { BG: number; mrc2: number; C: number[]; Tmax: number; dev: number }> = {
  DT: { BG: 34.3827, mrc2: 1124656, C: [1.17302e-9, 1.51361e-2, 7.51886e-2, 4.60643e-3, 1.35e-2, -1.0675e-4, 1.366e-5], Tmax: 100, dev: 0.0025 },
  DHe3: { BG: 68.7508, mrc2: 1124572, C: [5.51036e-10, 6.41918e-3, -2.02896e-3, -1.9108e-5, 1.35776e-4, 0, 0], Tmax: 190, dev: 0.025 },
  DD_pT: { BG: 31.397, mrc2: 937814, C: [5.65718e-12, 3.41267e-3, 1.99167e-3, 0, 1.0506e-5, 0, 0], Tmax: 100, dev: 0.0035 },
  DD_nHe3: { BG: 31.397, mrc2: 937814, C: [5.4336e-12, 5.85778e-3, 7.68222e-3, 0, -2.964e-6, 0, 0], Tmax: 100, dev: 0.003 },
};

/** [BH92] Eqs. (12)–(14), <σv> in cm³/s — an independent transcription of the published fit */
function bhReactivity(k: BHKey, T: number): number {
  const { BG, mrc2, C } = TABLE_VII[k];
  const [C1, C2, C3, C4, C5, C6, C7] = C;
  const theta = T / (1 - (T * (C2 + T * (C4 + T * C6))) / (1 + T * (C3 + T * (C5 + T * C7))));
  const xi = Math.cbrt((BG * BG) / (4 * theta));
  return C1 * theta * Math.sqrt(xi / (mrc2 * T ** 3)) * Math.exp(-3 * xi);
}

// [BH92] Table IV — cross-section fit, Eqs. (8)–(9): σ = S(E)/(E exp(B_G/√E)) [mb], E c.m. [keV].
const TABLE_IV: Record<SigmaKey, { BG: number; A: number[]; B: number[]; Emin: number; Emax: number; dS: number }> = {
  DT: { BG: 34.3827, A: [6.927e4, 7.454e8, 2.05e6, 5.2002e4, 0], B: [63.8, -0.995, 6.981e-5, 1.728e-4], Emin: 0.5, Emax: 550, dS: 0.019 },
  DHe3: { BG: 68.7508, A: [5.7501e6, 2.5226e3, 45.566, 0, 0], B: [-3.1995e-3, -8.553e-6, 5.9014e-8, 0], Emin: 0.3, Emax: 900, dS: 0.022 },
  DD_pT: { BG: 31.397, A: [5.5576e4, 210.54, -3.2638e-2, 1.4987e-6, 1.8181e-10], B: [0, 0, 0, 0], Emin: 0.5, Emax: 5000, dS: 0.02 },
  DD_nHe3: { BG: 31.397, A: [5.3701e4, 330.27, -0.12706, 2.9327e-5, -2.5151e-9], B: [0, 0, 0, 0], Emin: 0.5, Emax: 4900, dS: 0.025 },
};

/** [BH92] Eq. (9) Padé S-factor [keV mb] */
function bhSfactor(k: SigmaKey, E: number): number {
  const { A, B } = TABLE_IV[k];
  return (A[0] + E * (A[1] + E * (A[2] + E * (A[3] + E * A[4])))) / (1 + E * (B[0] + E * (B[1] + E * (B[2] + E * B[3]))));
}

// [BH92] Table V — cross-sections [mb] at E_cm = 10, 20, 50, 100, 200, 400 keV.
const TABLE_V_E = [10, 20, 50, 100, 200, 400];
const TABLE_V: Record<SigmaKey, number[]> = {
  DT: [2.702e1, 4.077e2, 4.219e3, 3.427e3, 1.138e3, 4.126e2],
  DHe3: [2.160e-4, 6.568e-2, 8.688, 1.021e2, 6.378e2, 5.304e2],
  DD_pT: [2.812e-1, 2.670, 1.557e1, 3.304e1, 5.234e1, 7.005e1],
  DD_nHe3: [2.779e-1, 2.691, 1.649e1, 3.701e1, 6.239e1, 8.702e1],
};

/** composite Simpson rule in ln x on [lo, hi] (n even) — the independent quadrature of this file */
function simpsonLog(f: (x: number) => number, lo: number, hi: number, n: number): number {
  const a = Math.log(lo), h = (Math.log(hi) - a) / n;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const x = Math.exp(a + i * h);
    s += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * f(x) * x;
  }
  return (s * h) / 3;
}

/** Maxwellian reactivity [m³/s]: <σv> = sqrt(8/(π μ)) (kT)^(−3/2) ∫ σ(E) E exp(−E/kT) dE */
function maxwellian(sigma_m2: (E_keV: number) => number, mu_kg: number, T: number, Elo: number, Ehi: number, n = 20000): number {
  const I = simpsonLog((E) => sigma_m2(E) * E * Math.exp(-E / T), Elo, Ehi, n); // m² keV²
  return Math.sqrt(8 / (Math.PI * mu_kg)) * Math.pow(T * keV_J, -1.5) * I * keV_J * keV_J;
}

describe('[BH92] thermal reactivities', () => {
  it.each(Object.keys(TABLE_VIII) as BHKey[])('%s matches Table VIII within 0.5 % at 1–50 keV', (k) => {
    TABLE_VIII_T.forEach((T, i) => {
      const cgs = sigmav[k](T) * 1e6;
      expect(rel(cgs, TABLE_VIII[k][i]), `${k} at ${T} keV: ${cgs} vs ${TABLE_VIII[k][i]} cm³/s`).toBeLessThan(0.005);
    });
  });

  it.each(Object.keys(TABLE_VII) as BHKey[])('%s at 100 keV (beyond Table VIII) equals the Table VII fit within 0.5 %', (k) => {
    for (const T of [100, TABLE_VII[k].Tmax]) expect(rel(sigmav[k](T) * 1e6, bhReactivity(k, T))).toBeLessThan(0.005);
  });

  it('D-D total is the sum of both branches; all reactivities are positive and finite (0.2–2000 keV)', () => {
    forAll(gen.logFloat(0.2, 2000), (T) => {
      expect(rel(sigmav.DD_total(T), sigmav.DD_pT(T) + sigmav.DD_nHe3(T))).toBeLessThan(1e-14);
      for (const k of ['DT', 'DHe3', 'DD_pT', 'DD_nHe3', 'pB11'] as const) {
        const v = sigmav[k](T);
        expect(Number.isFinite(v) && v > 0, `${k}(${T})`).toBe(true);
      }
    }, { runs: 200, label: 'reactivity positivity' });
  });

  it('reactivities increase with temperature below their maxima', () => {
    const rising: [keyof typeof sigmav, number, number][] = [['DT', 0.2, 60], ['DD_pT', 0.2, 100], ['DD_nHe3', 0.2, 100], ['DHe3', 0.5, 190], ['pB11', 1, 1000]];
    forAll(gen.tuple(gen.oneOf(rising), gen.float(0, 1), gen.float(0, 1)), ([[k, lo, hi], u, w]) => {
      const T1 = lo * Math.pow(hi / lo, Math.min(u, w)), T2 = lo * Math.pow(hi / lo, Math.max(u, w));
      if (T2 / T1 < 1 + 1e-9) return;
      expect(sigmav[k](T2)).toBeGreaterThan(sigmav[k](T1));
    }, { runs: 300, label: 'monotone reactivity' });
  });

  it('D-T is the most reactive fuel for 1–100 keV', () => {
    for (const T of [1, 2, 5, 10, 20, 50, 100]) {
      expect(sigmav.DT(T)).toBeGreaterThan(sigmav.DD_total(T));
      expect(sigmav.DT(T)).toBeGreaterThan(sigmav.DHe3(T));
      expect(sigmav.DT(T)).toBeGreaterThan(sigmav.pB11(T));
    }
  });
});

describe('[BH92] cross-sections', () => {
  it.each(Object.keys(TABLE_V) as SigmaKey[])('%s matches Table V within 0.5 %', (k) => {
    TABLE_V_E.forEach((E, i) => {
      const mb = crossSection(k, E) / 1e-31;
      expect(rel(mb, TABLE_V[k][i]), `${k} at ${E} keV: ${mb} mb`).toBeLessThan(0.005);
    });
  });

  it('S(E) = σ E exp(B_G/√E) recovers the Table IV Padé polynomial inside each validity range', () => {
    const keys = Object.keys(TABLE_IV) as SigmaKey[];
    forAll(gen.tuple(gen.oneOf(keys), gen.float(0, 1)), ([k, u]) => {
      const { BG, Emin, Emax } = TABLE_IV[k];
      const E = Emin * Math.pow(Emax / Emin, u);
      const S = (crossSection(k, E) / 1e-31) * E * Math.exp(BG / Math.sqrt(E));
      expect(rel(S, bhSfactor(k, E))).toBeLessThan(1e-12);
    }, { runs: 300, label: 'S-factor' });
  });

  it('D-T resonance: σ peaks at ≈ 5 b between 60 and 70 keV (Table V: 4.984 b at 60 keV, 4.987 b at 70 keV)', () => {
    let best = 0, Ebest = 0;
    for (let E = 40; E <= 100; E += 0.25) { const s = crossSection('DT', E); if (s > best) { best = s; Ebest = E; } }
    expect(Ebest).toBeGreaterThan(60);
    expect(Ebest).toBeLessThan(70);
    expect(best / 1e-28).toBeGreaterThan(4.98);
    expect(best / 1e-28).toBeLessThan(5.1);
  });

  // The two fits describe the same R-matrix data: the Maxwellian average of the cross-section fit
  // must agree with the reactivity fit within the sum of their published maximum deviations
  // ((ΔS)_max of Table IV + (Δ<σv>)_max of Table VII).
  it.each(Object.keys(TABLE_IV) as SigmaKey[])('%s: Maxwellian average of the σ fit reproduces the <σv> fit (1–50 keV)', (k) => {
    const mu = (TABLE_VII[k].mrc2 * keV_J) / (c_ms * c_ms);
    const tol = TABLE_IV[k].dS + TABLE_VII[k].dev;
    for (const T of TABLE_VIII_T) {
      const avg = maxwellian((E) => crossSection(k, E), mu, T, TABLE_IV[k].Emin, Math.min(TABLE_IV[k].Emax, 60 * T + 200));
      expect(rel(avg, sigmav[k](T)), `${k} at ${T} keV`).toBeLessThan(tol);
    }
  });
});

describe('[NS00] p-¹¹B', () => {
  // [NS00] Eq. (3): S(E) = C0 + C1 E + C2 E² + A_L / ((E − E_L)² + δE_L²)  [MeV b], E ≤ 400 keV (c.m.)
  const NS = { C0: 197, C1: 0.24, C2: 2.31e-4, AL: 1.82e4, EL: 148, dEL: 2.35, EG_keV: 22589 };
  const nsSigma = (E: number) => {
    if (E > 400) return 0;
    const S = NS.C0 + NS.C1 * E + NS.C2 * E * E + NS.AL / ((E - NS.EL) ** 2 + NS.dEL ** 2);
    return (S / (E / 1000)) * Math.exp(-Math.sqrt(NS.EG_keV / E)) * 1e-28; // b → m²
  };
  // reduced mass from nuclear masses (atomic mass minus electrons; [AME20])
  const mp = 1.007276467, mB = 11.009305166 - 5 * 0.000548579909;
  const mu = ((mp * mB) / (mp + mB)) * amu_kg;

  it('the cross-section equals the Nevins–Swain S-factor below 400 keV', () => {
    forAll(gen.float(1, 400), (E) => { expect(rel(pB11_sigma_m2(E), nsSigma(E))).toBeLessThan(1e-12); }, { runs: 200 });
  });

  // Below ~20 keV the Maxwellian integrand beyond 400 keV (where the code's newer fit departs
  // from [NS00]) is < 1e-4 of the total, so the reactivity must be that of the [NS00] S-factor.
  it('reactivity agrees with the Maxwellian average of the [NS00] S-factor within 0.5 % at 2–20 keV', () => {
    for (const T of [2, 5, 10, 20]) {
      const ref = maxwellian(nsSigma, mu, T, 0.5, 400, 40000);
      expect(rel(sigmav.pB11(T), ref), `T = ${T} keV`).toBeLessThan(0.005);
    }
  });
});

describe('beam-target reactivity vs an independent 2000-interval quadrature', () => {
  // <σv>_bt = ∫ σ(E_cm) v_b f(E) dE / ∫ f dE, f = √E/(E^{3/2} + E_c^{3/2}) on [max(1.5 T_i, 1 keV), E_0]
  // (steady-state slowing-down distribution, T.H. Stix, Plasma Phys. 14 (1972) 367)
  function reference(fuel: FuelType, E0: number, Ec: number, Ti: number): number[] {
    const { a, b } = FUEL_SPECIES[fuel];
    const keys: Record<FuelType, string[]> = { DT: ['DT'], DD: ['DD_pT', 'DD_nHe3'], DHe3: ['DHe3', 'DD_pT', 'DD_nHe3'], pB11: ['pB11'] };
    const Emin = Math.max(1.5 * Ti, 1);
    if (E0 <= Emin) return keys[fuel].map(() => 0);
    const f = (E: number) => Math.sqrt(E) / (E ** 1.5 + Ec ** 1.5);
    const Ecm = (k: string, E: number) => (k.startsWith('DD') ? E / 2 : (E * b.A) / (a.A + b.A));
    const sig = (k: string, E: number) => (k === 'pB11' ? pB11_sigma_m2(E) : crossSection(k as SigmaKey, E));
    const v = (E: number) => Math.sqrt((2 * E * keV_J) / (a.A * amu_kg));
    const den = simpsonLog(f, Emin, E0, 2000);
    return keys[fuel].map((k) => simpsonLog((E) => sig(k, Ecm(k, E)) * v(E) * f(E), Emin, E0, 2000) / den);
  }

  // Tolerances: the model integrates with 48 log-spaced midpoints. Measured worst cases over the
  // wizard's NBI range (E_0 ≥ 20 keV): 0.6 % (D-T, D-D) and 1.8 % (D-³He at E_0 ≈ 30 keV, where
  // σ rises steeply); the bounds leave headroom and still catch a unit or kinematics slip (≥ 10 %).
  const TOL: Record<FuelType, number> = { DT: 0.01, DD: 0.01, DHe3: 0.025, pB11: 0.025 };
  const arb = gen.record({
    fuel: gen.oneOf(['DT', 'DD', 'DHe3'] as FuelType[]),
    E0: gen.logFloat(20, 2000), Ec: gen.logFloat(5, 3000), Ti: gen.logFloat(0.05, 50),
  });

  it('D-T, D-D and D-³He agree within the quadrature tolerance', () => {
    forAll(arb, ({ fuel, E0, Ec, Ti }) => {
      const got = beamTargetReactivity(fuel, E0, Ec, Ti), ref = reference(fuel, E0, Ec, Ti);
      expect(got.length).toBe(FUEL_CHANNELS[fuel].length);
      got.forEach((x, j) => {
        if (ref[j] === 0) expect(x).toBe(0);
        else expect(rel(x, ref[j])).toBeLessThan(TOL[fuel]);
      });
    }, { runs: 80, label: 'beam-target quadrature' });
  });

  // BUG(ws2a): the 48-point grid cannot resolve the narrow 148 keV p-¹¹B resonance (Γ ≈ 5 keV):
  // beamTargetReactivity('pB11', 200, 10, 0.5) is 31 % off the resolved integral. Latent today —
  // neither the 0D nor the 1.5D model calls it for p-¹¹B — but the function advertises the channel.
  it.fails('p-¹¹B agrees within the quadrature tolerance (BUG(ws2a): unresolved 148 keV resonance)', () => {
    for (const [E0, Ec, Ti] of [[200, 10, 0.5], [170, 50, 1], [500, 100, 5]]) {
      const got = beamTargetReactivity('pB11', E0, Ec, Ti)[0], ref = reference('pB11', E0, Ec, Ti)[0];
      expect(rel(got, ref), `E0 = ${E0} keV`).toBeLessThan(TOL.pB11);
    }
  });
});

describe('reaction energy bookkeeping', () => {
  // [AME20] atomic masses [u] (electron masses cancel in these reactions); u c² = 931.49410242 MeV
  const M = { n: 1.00866491595, H1: 1.00782503223, H2: 2.01410177812, H3: 3.01604928132, He3: 3.01602932197, He4: 4.00260325413, B11: 11.009305166 };
  const uc2 = 931.49410242;
  const Q: Record<string, number> = {
    'D+T': (M.H2 + M.H3 - M.He4 - M.n) * uc2,
    'D+D→p+T': (2 * M.H2 - M.H1 - M.H3) * uc2,
    'D+D→n+He3': (2 * M.H2 - M.n - M.He3) * uc2,
    'D+He3': (M.H2 + M.He3 - M.He4 - M.H1) * uc2,
    'p+B11': (M.H1 + M.B11 - 3 * M.He4) * uc2,
  };
  const all = Object.values(FUEL_CHANNELS).flat();

  it('every channel releases the mass-defect Q-value (within the 3–4 digits quoted)', () => {
    for (const ch of all) expect(rel(ch.Etot_MeV, Q[ch.name]), ch.name).toBeLessThan(1e-3);
  });

  /**
   * Kinetic energies [MeV] of the neutron and the charged product X of A + B → n + X for reactants at
   * rest, exact relativistic two-body kinematics: with the rest energies m_n, m_X [MeV] and
   * M = m_n + m_X + Q, T_n = ((M − m_n)² − m_X²)/(2M) = Q (Q + 2 m_X)/(2M) and T_X = Q − T_n
   * (e.g. PDG Review of Particle Physics, "Kinematics", two-body decay in the rest frame).
   * Nuclear masses: atomic masses minus Z electron masses (binding of the electrons ≪ 0.1 keV).
   */
  const nuclear = (atomic: number, Z: number) => (atomic - Z * 0.000548579909) * uc2;
  const splitAtRest = (Qv: number, mX: number) => {
    const mn = M.n * uc2, T_n = (Qv * (Qv + 2 * mX)) / (2 * (mn + mX + Qv));
    return { neutron: T_n, charged: Qv - T_n };
  };
  const channel = (name: string) => {
    const ch = all.find((c) => c.name === name);
    if (!ch) throw new Error(`no channel ${name}`);
    return ch;
  };

  it('at-rest two-body kinematics with AME2020 masses: D-T gives a 3.561 MeV alpha and a 14.028 MeV neutron', () => {
    const dt = splitAtRest(Q['D+T'], nuclear(M.He4, 2));
    expect(dt.charged).toBeCloseTo(3.5609, 4);
    expect(dt.neutron).toBeCloseTo(14.0284, 4);
    // the non-relativistic limit E_n = Q m_α/(m_n + m_α) is 20 keV higher for the neutron;
    // the often quoted 3.52 + 14.07 MeV is Q/5 : 4Q/5, i.e. integer mass numbers
    const mn = M.n * uc2, ma = nuclear(M.He4, 2);
    expect((Q['D+T'] * ma) / (mn + ma) - dt.neutron).toBeCloseTo(0.0197, 3);
  });

  it('D-D → n + ³He: neutron and helion energies follow two-body kinematics within 0.1 %', () => {
    const ch = channel('D+D→n+He3'), k = splitAtRest(Q['D+D→n+He3'], nuclear(M.He3, 2));
    expect(rel(ch.Eneutron_MeV, k.neutron)).toBeLessThan(1e-3);
    expect(rel(ch.Echarged_MeV, k.charged)).toBeLessThan(1e-3);
  });

  // BUG(ws2a): FUEL_CHANNELS D-T has E_charged = 3.5 MeV (1.7 % below the 3.561 MeV kinematic value)
  // and E_neutron = 14.1 MeV (0.5 % above 14.028 MeV), so the alpha heating per reaction is 1.7 % low.
  // A 0.1 % tolerance separates the exact split from the non-relativistic one (α 0.56 % off) and
  // from 3.52 + 14.07 (α 1.1 % off). Consistent values: 3.561 + 14.028 = 17.589 MeV = E_tot.
  it.fails('D-T: neutron and alpha energies follow two-body kinematics within 0.1 % (BUG(ws2a): 3.5 + 14.1 MeV)', () => {
    const ch = channel('D+T'), k = splitAtRest(Q['D+T'], nuclear(M.He4, 2));
    expect(rel(ch.Eneutron_MeV, k.neutron), 'E_neutron').toBeLessThan(1e-3);
    expect(rel(ch.Echarged_MeV, k.charged), 'E_charged').toBeLessThan(1e-3);
  });

  // BUG(ws2a): D-T lists E_tot = 17.589 MeV but E_charged + E_neutron = 3.5 + 14.1 = 17.6 MeV, so the
  // models create P_charged + P_neutron = 1.000625 P_fus (0.3 MW extra at ITER's 500 MW); constants.ts
  // FUSION.DT has the same pair. The at-rest kinematic split of 17.589 MeV is 3.561 + 14.028 MeV
  // (test above), which also closes this sum.
  it.fails('E_charged + E_neutron = E_tot for every channel (BUG(ws2a): D-T sums to 17.6 MeV)', () => {
    for (const ch of all) expect(ch.Echarged_MeV + ch.Eneutron_MeV, ch.name).toBeCloseTo(ch.Etot_MeV, 9);
  });

  it('fuel species charges and masses are the nuclear ones', () => {
    const nuclear = (atomic: number, Z: number) => atomic - Z * 0.000548579909;
    const table: Record<string, [number, number]> = { D: [1, M.H2], T: [1, M.H3], He3: [2, M.He3], p: [1, M.H1], B11: [5, M.B11] };
    for (const f of Object.values(FUEL_SPECIES)) for (const s of [f.a, f.b]) {
      const [Z, m] = table[s.label];
      expect(s.Z, s.label).toBe(Z);
      expect(Math.abs(s.A - nuclear(m, Z)), s.label).toBeLessThan(0.003);
    }
  });
});
