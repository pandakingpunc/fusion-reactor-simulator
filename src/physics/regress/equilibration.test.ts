/**
 * Regression tests (lane ws2b, consistency pass): electron–ion energy equilibration. The 0D model
 * used lnΛ = 17 and Σ n_j/M (all ions as Z = 1 fuel of mean mass M); the collision rate is
 * ν_eq = 3.2e-9 lnΛ Σ_j n_j Z_j²/A_j / T_e^{3/2} (NRL Plasma Formulary) — impurities and He ash with
 * their Z²/A, and the Coulomb logarithm of the actual n_e, T_e.
 */
import { describe, expect, it } from 'vitest';
import { MagneticModel } from '../confinement/magnetic';
import { IMPURITIES } from '../constants';
import { ITER, SPARC } from '../presets';
import { meanCharge } from '../radiation';
import { coulombLog, equilibrationRate } from '../transport';

const KEV = 1.602176634e-16;

describe('e–i equilibration', () => {
  it('ν_eq = 3.2e-9 lnΛ Σ n_j Z_j²/A_j [cm⁻³] / T_e[eV]^1.5 with the computed Coulomb logarithm', () => {
    const ne = 1e20, Te = 10;
    const ionSum = 1 / 2.014; // pure deuterium: Σ n_j Z_j²/(n_e A_j)
    const lnL = coulombLog(ne, Te);
    expect(lnL).toBeGreaterThan(16);
    expect(lnL).toBeLessThan(18.5);
    expect(equilibrationRate(ne, Te, ionSum)).toBeCloseTo((3.2e-9 * lnL * ne * 1e-6 * ionSum) / Math.pow(Te * 1e3, 1.5), 12);
    expect(equilibrationRate(ne, Te, ionSum, 20) / equilibrationRate(ne, Te, ionSum, 10)).toBeCloseTo(2, 12);
  });

  it('the 0D power balance uses Σ over fuel, ash, impurity and seed with Z²/A', () => {
    for (const cfg of [ITER, SPARC]) {
      const m = new MagneticModel(cfg);
      const y = m.initialState();
      y[4] = 0.02 * y[2]; // some He ash
      const t = 20;
      const d = m.diagnostics(t, y);
      const ne = d.ne * 1e20, Te = d.Te;
      const im = cfg.impurity;
      let s = y[2] / 2.014 + y[3] / 3.016 + (y[4] * 4) / 4.001506;
      const Zz = meanCharge(im.species, Te);
      s += (y[5] * Zz * Zz) / IMPURITIES[im.species].A;
      if (im.seedSpecies && im.seedConcentration) {
        const Zs = meanCharge(im.seedSpecies, Te);
        s += (im.seedConcentration * ne * Zs * Zs) / IMPURITIES[im.seedSpecies].A;
      }
      const V = m.geometryInfo().V;
      const Pei = 1.5 * ne * (Te - d.Ti) * KEV * V * equilibrationRate(ne, Te, s / ne);
      expect(d.P_ei / (Pei / 1e6)).toBeCloseTo(1, 9);
    }
  });
});
