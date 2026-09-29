/**
 * The Redl et al. (2021) neoclassical coefficients (current/redl.ts) beside the Sauter ones: the analytic limits of the fits, the values that
 * can be read off the figures of the paper, the comparison with Sauter's model in the regimes the paper says differ, and the option in a shot.
 */
import { describe, expect, it } from 'vitest';
import { ITER_15D } from '../../presets';
import { Simulation } from '../../simulation';
import { sauterCoefficients, sigmaNeo, sigmaSpitzer } from '../neoclassical';
import { redlCoefficients, sigmaNeoRedl } from './redl';

describe('the limits of the fits', () => {
  it('L31 is 1 for f_trap = 1 in the banana regime and 0 for f_trap = 0, at every Z_eff (the polynomial of eq. 10 sums to 1 at X = 1)', () => {
    for (const Z of [1, 1.4, 1.8, 2.5, 3.5]) {
      expect(redlCoefficients(1, 1e-20, 1e-20, Z).L31, `Z ${Z}`).toBeCloseTo(1, 8);
      expect(redlCoefficients(0, 1e-3, 1e-3, Z).L31).toBe(0);
    }
  });

  it('L32 vanishes at f_trap = 0 and, in the banana regime, at f_trap = 1 (F32ee(1) + F32ei(1) = 1.3/(1 + Z/2) - 1.3/(1 + Z/2))', () => {
    for (const Z of [1, 1.8, 3]) {
      expect(redlCoefficients(0, 1e-3, 1e-3, Z).L32).toBeCloseTo(0, 12);
      expect(redlCoefficients(1, 1e-20, 1e-20, Z).L32, `Z ${Z}`).toBeCloseTo(0, 8);
    }
  });

  it('L34 = L31 (eq. 19)', () => {
    for (const [ft, ne, ni, Z] of [[0.3, 0.1, 0.05, 1.5], [0.6, 5, 2, 2.2], [0.1, 40, 30, 1]]) {
      const c = redlCoefficients(ft, ne, ni, Z);
      expect(c.L34).toBe(c.L31);
    }
  });

  it('alpha is -1.17 at f_trap = 0 and Z_eff = 1 in the banana regime (the value of Sauter) and goes to -0.5 at high ion collisionality (the new limit)', () => {
    expect(redlCoefficients(0, 1e-6, 1e-6, 1).alpha).toBeCloseTo(-(0.62 / 0.53), 3);
    expect(redlCoefficients(0, 1e-6, 1e-6, 1).alpha).toBeCloseTo(-1.17, 2);
    expect(redlCoefficients(0.5, 1, 1e6, 1.5).alpha).toBeCloseTo(-0.5, 4);
    // Sauter's alpha goes to +2.1 there
    expect(sauterCoefficients(0.5, 1, 1e6, 1.5).alpha).toBeGreaterThan(1.5);
  });

  it('the conductivity goes to the Spitzer value at high collisionality and to 0 with only trapped particles in the banana regime', () => {
    const ne = 5e19, TeV = 3000;
    expect(sigmaNeoRedl(0.4, 1e7, ne, TeV, 1.5) / sigmaSpitzer(ne, TeV, 1.5)).toBeCloseTo(1, 4);
    expect(sigmaNeoRedl(1, 1e-9, ne, TeV, 1.5) / sigmaSpitzer(ne, TeV, 1.5)).toBeCloseTo(0, 5);
    expect(sigmaNeoRedl(0, 1e-3, ne, TeV, 2) / sigmaSpitzer(ne, TeV, 2)).toBeCloseTo(1, 12);
  });
});

describe('values that can be read off the figures of the paper', () => {
  // Figs. 2 and 3: profiles against f_trap at constant collisionality in the deep banana regime (nu_e* about 4e-5, nu_i* about 1e-5), Z_eff = 1
  const banana = (ft: number, Z = 1) => redlCoefficients(ft, 4e-5, 1e-5, Z);

  it('Fig. 2a: L31 = 0.58 at f_trap = 0.5 and rises to 1 at f_trap = 1', () => {
    expect(banana(0.5).L31).toBeGreaterThan(0.57);
    expect(banana(0.5).L31).toBeLessThan(0.60);
    expect(banana(0.24).L31).toBeGreaterThan(0.31); // Fig. 4a plateau of the new model, 0.31 at f_trap = 0.24
    expect(banana(0.24).L31).toBeLessThan(0.33);
  });

  it('Fig. 2b: L32 is a well with a minimum of -0.225 near f_trap = 0.45 (Sauter: -0.24)', () => {
    let min = 0, at = 0;
    for (let f = 0.05; f < 1; f += 0.01) { const l = banana(f).L32; if (l < min) { min = l; at = f; } }
    expect(min).toBeGreaterThan(-0.24);
    expect(min).toBeLessThan(-0.21);
    expect(at).toBeGreaterThan(0.4);
    expect(at).toBeLessThan(0.5);
    const s = sauterCoefficients(0.45, 4e-5, 1e-5, 1).L32;
    expect(s).toBeLessThan(min); // Sauter's well is deeper
  });

  it('Fig. 2c: alpha rises from -1.17 to 0 with f_trap (about -0.75 at 0.5)', () => {
    expect(banana(0.5).alpha).toBeGreaterThan(-0.8);
    expect(banana(0.5).alpha).toBeLessThan(-0.7);
    expect(banana(0.95).alpha).toBeGreaterThan(-0.15);
  });

  it('Fig. 6: L31 at fixed f_trap falls with Z_eff towards X31 = f_trap (eq. 9: the limit of infinite Z_eff)', () => {
    const l = [1, 1.5, 2.5, 3.5].map((Z) => banana(0.45, Z).L31);
    for (let k = 1; k < l.length; k++) expect(l[k]).toBeLessThan(l[k - 1]);
    expect(l[3]).toBeGreaterThan(0.45 * 0.98); // above the limit of Z -> infinity, X31 = f_trap
    expect(l[3]).toBeLessThan(0.47);
  });
});

describe('against the model of Sauter', () => {
  it('in the collisional edge (nu_e* of a few tens) the bootstrap coefficient L31 of Redl is smaller: Sauter overestimates it there (Figs. 4a and 5a)', () => {
    for (const [ft, Z] of [[0.24, 1], [0.45, 1], [0.63, 1.8]]) {
      for (const nu of [10, 30, 100]) {
        const r = redlCoefficients(ft, nu, nu, Z), s = sauterCoefficients(ft, nu, nu, Z);
        expect(r.L31, `f ${ft} Z ${Z} nu ${nu}`).toBeLessThan(s.L31);
      }
    }
  });

  it('in the banana regime the two agree within 25 % on L31 (Redl smaller, more so with Z_eff: Figs. 4a, 5a and 6, 9 % at Z = 1 and f = 0.24, 24 % at Z = 1.8) and within 0.1 on L32', () => {
    for (const ft of [0.2, 0.4, 0.6]) {
      const r = redlCoefficients(ft, 1e-3, 1e-3, 1.5), s = sauterCoefficients(ft, 1e-3, 1e-3, 1.5);
      expect(r.L31, `L31 at f ${ft}`).toBeLessThan(s.L31);
      expect(r.L31 / s.L31, `L31 at f ${ft}`).toBeGreaterThan(0.75);
      expect(Math.abs(r.L32 - s.L32), `L32 at f ${ft}`).toBeLessThan(0.1);
    }
  });

  it('the conductivities agree within 10 % in a core-like state', () => {
    const ne = 8e19, TeV = 8000, nuE = 0.02, ft = 0.3;
    expect(Math.abs(sigmaNeoRedl(ft, nuE, ne, TeV, 1.6) / sigmaNeo(ft, nuE, ne, TeV, 1.6) - 1)).toBeLessThan(0.1);
  });

  it('every coefficient is finite over the whole domain, including Z_eff = 1 and the collisionality of the axis and of the separatrix', () => {
    for (const ft of [0, 0.01, 0.3, 0.7, 0.99, 1]) {
      for (const nuE of [1e-8, 1e-3, 1, 100, 1e5]) {
        for (const Z of [1, 1.0001, 2, 5]) {
          const c = redlCoefficients(ft, nuE, 0.5 * nuE, Z);
          for (const v of [c.L31, c.L32, c.L34, c.alpha]) expect(Number.isFinite(v), `f ${ft} nu ${nuE} Z ${Z}`).toBe(true);
          expect(Number.isFinite(sigmaNeoRedl(ft, nuE, 1e19, 500, Z))).toBe(true);
        }
      }
    }
  });
});

describe('the option in a shot', () => {
  const run = (neoclassicalModel?: 'sauter' | 'redl') => {
    const cfg = { ...ITER_15D, t_end: 12, profiles: { ...ITER_15D.profiles, ...(neoclassicalModel ? { neoclassicalModel } : {}) } };
    const sim = new Simulation(cfg);
    sim.runAll();
    return sim.history;
  };
  const base = run(), sauter = run('sauter'), redl = run('redl');
  const last = (h: typeof base) => h[h.length - 1].d;

  it("'sauter' is the default: naming it changes nothing, bit for bit", () => {
    expect(last(sauter).f_bs).toBe(last(base).f_bs);
    expect(last(sauter).V_loop).toBe(last(base).V_loop);
    expect(last(sauter).W).toBe(last(base).W);
  });

  it("'redl' gives another bootstrap current of the same size, and the same run otherwise", () => {
    const a = last(base).f_bs, b = last(redl).f_bs;
    expect(a).toBeGreaterThan(0.05);
    expect(b).not.toBe(a);
    expect(Math.abs(b / a - 1)).toBeLessThan(0.4);
    expect(Math.abs(last(redl).W / last(base).W - 1)).toBeLessThan(0.1);
    // the non-inductive fraction is the sum of the two parts
    expect(last(redl).f_NI).toBeCloseTo(last(redl).f_bs + last(redl).f_cd, 12);
  });
});
