/**
 * Regression tests (lane ws2b, D2): the tandem-mirror confinement factor R·log10(R) equalled the
 * simple mirror's R at R = 10 and was worse below it. The tandem end plugs must always help.
 */
import { describe, expect, it } from 'vitest';
import { MirrorModel, pastukhovFactor } from '../confinement/mirror';
import { MIRROR } from '../presets';
import { MirrorConfig } from '../types';

const tauE = (cfg: MirrorConfig) => {
  const m = new MirrorModel(cfg);
  return m.diagnostics(0, m.initialState()).tauE;
};

describe('tandem mirror end plugging', () => {
  it('confines better than a simple mirror at every mirror ratio', () => {
    for (const R of [2, 3, 5, 10, 20, 50]) {
      const simple = tauE({ ...MIRROR, mirrorRatio: R, tandem: false });
      const tandem = tauE({ ...MIRROR, mirrorRatio: R, tandem: true });
      expect(tandem / simple, `R_m = ${R}`).toBeGreaterThan(1.5);
    }
  });

  it('enhancement = 1 + F(x), F the Pastukhov potential factor x·e^x/(1 + 1/(2x)), x = eφ_c/T_i', () => {
    const simple = tauE({ ...MIRROR, tandem: false });
    expect(tauE({ ...MIRROR, tandem: true }) / simple).toBeCloseTo(1 + Math.E / 1.5, 12); // default x = 1
    expect(tauE({ ...MIRROR, tandem: true, plugPotential: 2 }) / simple).toBeCloseTo(1 + pastukhovFactor(2), 12);
    expect(pastukhovFactor(2)).toBeCloseTo((2 * Math.exp(2)) / 1.25, 12);
    // no plug potential: a tandem is a simple mirror; a deeper plug confines better
    expect(tauE({ ...MIRROR, tandem: true, plugPotential: 0 }) / simple).toBe(1);
    expect(pastukhovFactor(3)).toBeGreaterThan(pastukhovFactor(2));
  });
});
