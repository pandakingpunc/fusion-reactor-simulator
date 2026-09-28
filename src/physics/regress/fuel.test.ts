/**
 * Regression tests for the fuel bookkeeping of the 0D models (lane ws2b, fix D2):
 *  - single-species D-D fuel: n_a + n_b is the deuterium density whatever fuelFracA says;
 *  - D-³He includes its D-D side reactions (the only neutron source of that fuel).
 */
import { describe, expect, it } from 'vitest';
import { MagneticModel } from '../confinement/magnetic';
import { fusionRates } from '../confinement/common';
import { computePopcon } from '../popcon';
import { DIIID, ITER, MIRROR } from '../presets';
import { FUEL_CHANNELS, sigmav } from '../reactivity';
import { Simulation } from '../simulation';
import { MagneticConfig, MirrorConfig } from '../types';

const MEV = 1.602176634e-13;

/** diagnostics of a fresh 0D model at its initial state */
function initialDiag(cfg: MagneticConfig, t = 0) {
  const m = new MagneticModel(cfg);
  return m.diagnostics(t, m.initialState());
}

describe('D-D fuel with fuelFracA < 1 (both fuel slots hold deuterium)', { timeout: 60_000 }, () => {
  it('0D thermal fusion power does not depend on how D is split between the two slots', () => {
    const full = initialDiag({ ...DIIID, fuelFracA: 1.0 });
    const half = initialDiag({ ...DIIID, fuelFracA: 0.5 });
    expect(full.P_fus).toBeGreaterThan(0);
    expect(half.P_fus / full.P_fus).toBeCloseTo(1, 10);
    expect(half.P_neutron / full.P_neutron).toBeCloseTo(1, 10);
  });

  it('0D beam-target fusion uses the whole deuterium density as the target', () => {
    // after the heating ramp (0.3 s) the 12 MW, 80 keV NBI is on
    const full = initialDiag({ ...DIIID, fuelFracA: 1.0 }, 1);
    const half = initialDiag({ ...DIIID, fuelFracA: 0.3 }, 1);
    expect(full.P_bt).toBeGreaterThan(0);
    expect(half.P_bt / full.P_bt).toBeCloseTo(1, 10);
  });

  it('a whole D-D discharge gives the same fusion yield for fuelFracA = 0.5 and 1', () => {
    const run = (fA: number) => new Simulation({ ...DIIID, fuelFracA: fA, t_end: 1.5 }).runAll();
    const a = run(1.0), b = run(0.5);
    expect(b.E_fusion_MJ / a.E_fusion_MJ).toBeGreaterThan(0.9);
    expect(b.E_fusion_MJ / a.E_fusion_MJ).toBeLessThan(1.1);
  });

  it('POPCON fusion power does not depend on fuelFracA for D-D', () => {
    const cfg = (fA: number): MagneticConfig => ({ ...ITER, fuel: 'DD', fuelFracA: fA });
    const a = computePopcon(cfg(1.0), { nx: 6, ny: 6 }), b = computePopcon(cfg(0.5), { nx: 6, ny: 6 });
    for (let k = 0; k < a.Pfus.length; k++) expect(b.Pfus[k] / a.Pfus[k]).toBeCloseTo(1, 9);
  });
});

describe('D-³He fuel includes the D-D side reactions', { timeout: 60_000 }, () => {
  it('lists D(d,p)T and D(d,n)³He as deuterium-deuterium channels after the main reaction', () => {
    const ch = FUEL_CHANNELS.DHe3;
    expect(ch[0].name).toBe('D+He3');
    const dd = ch.filter((c) => c.sameSpecies);
    expect(dd.map((c) => c.Etot_MeV).sort()).toEqual([3.27, 4.03]);
    expect(dd.some((c) => c.Eneutron_MeV > 0)).toBe(true);
  });

  it('volumetric rates: the D-D neutron branch is ½ n_D² ⟨σv⟩_DD,n and adds to the total power', () => {
    const nD = 5e19, nHe3 = 5e19, T = 30;
    const r = fusionRates('DHe3', nD, nHe3, T);
    const nDD = 0.5 * nD * nD * sigmav.DD_nHe3(T);
    const pDD = 0.5 * nD * nD * (sigmav.DD_pT(T) * 4.03 + sigmav.DD_nHe3(T) * 3.27) * MEV;
    const pDHe3 = nD * nHe3 * sigmav.DHe3(T) * 18.35 * MEV;
    expect(r.neutrons).toBeCloseTo(nDD, -Math.floor(Math.log10(nDD)) + 9);
    expect(r.P_neutron / (nDD * 2.45 * MEV)).toBeCloseTo(1, 10);
    expect(r.P_total / (pDD + pDHe3)).toBeCloseTo(1, 10);
  });

  it('a D-³He tokamak and mirror produce neutrons', () => {
    const d = initialDiag({ ...ITER, fuel: 'DHe3' }, 50);
    expect(d.P_neutron).toBeGreaterThan(0);
    const mirror = new Simulation({ ...MIRROR, fuel: 'DHe3' } as MirrorConfig).runAll();
    expect(mirror.neutronYield).toBeGreaterThan(0);
  });
});
