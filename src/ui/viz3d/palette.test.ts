import { describe, expect, it } from 'vitest';
import {
  DISRUPTION_MS, NO_DISRUPTION, centralTemperature, disruptionLook, elmFlashAt, greyOut, mixRgb, plasmaColor, scalePosition, scaleTemperature,
  tempColor, temperatureAt,
} from './palette';

describe('temperature colour scale', () => {
  it('runs from dark blue to yellow-white, clamps, and treats NaN as cold', () => {
    expect(tempColor(0)).toEqual([10 / 255, 20 / 255, 60 / 255]);
    expect(tempColor(1)).toEqual([1, 235 / 255, 160 / 255]);
    expect(tempColor(-3)).toEqual(tempColor(0));
    expect(tempColor(7)).toEqual(tempColor(1));
    expect(tempColor(NaN)).toEqual(tempColor(0));
    // monotone luminance
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const c = tempColor(i / 20), y = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });

  it('mixes and desaturates', () => {
    expect(mixRgb([0, 0, 0], [1, 1, 1], 0.25)).toEqual([0.25, 0.25, 0.25]);
    const g = greyOut([1, 0, 0], 1);
    expect(g[0]).toBeCloseTo(g[1], 12); expect(g[1]).toBeCloseTo(g[2], 12);
    expect(greyOut([1, 0.5, 0.2], 0)).toEqual([1, 0.5, 0.2]);
  });
});

describe('temperature of a flux surface', () => {
  it('follows the model profile without a measurement, and the measured profile with one', () => {
    const m = { T0_keV: 20, alphaT: 1.5 };
    expect(temperatureAt(m, 0)).toBeCloseTo(20 * Math.pow(1.02, 1.5), 9);
    expect(temperatureAt(m, 1)).toBeCloseTo(20 * Math.pow(0.02, 1.5), 9);
    const meas = { T0_keV: 20, alphaT: 1.5, prof: { rho: [0, 0.5, 1], Te: [30, 10, 0.1] } };
    expect(temperatureAt(meas, 0.25)).toBeCloseTo(20, 9);
    expect(temperatureAt(meas, 2)).toBe(0.1);
    expect(temperatureAt(meas, -1)).toBe(30);
    // a profile whose arrays disagree in length is ignored
    expect(temperatureAt({ ...meas, prof: { rho: [0, 1], Te: [1] } }, 0)).toBeCloseTo(temperatureAt({ ...m, T0_keV: 1 }, 0), 9);
  });

  it('scale: at least 5 keV, at least 1 eV central; hotter surfaces get warmer colours', () => {
    expect(scaleTemperature({ T0_keV: 2, alphaT: 1 })).toBe(5);
    expect(scaleTemperature({ T0_keV: 30, alphaT: 1 })).toBe(30);
    expect(centralTemperature({ T0_keV: 0, alphaT: 1 })).toBe(1e-3);
    expect(centralTemperature({ T0_keV: 1, alphaT: 1, prof: { rho: [0, 1], Te: [40, 1] } })).toBe(40);
    const m = { T0_keV: 25, alphaT: 1.5 };
    expect(scalePosition(m, 0)).toBeGreaterThan(scalePosition(m, 0.5));
    expect(scalePosition(m, 0.5)).toBeGreaterThan(scalePosition(m, 1));
    expect(plasmaColor(m, 0)[0]).toBeGreaterThan(plasmaColor(m, 1)[0]);
  });
});

describe('ELM flash', () => {
  const events = [{ t: 1, kind: 'ELM' }, { t: 2, kind: 'sawtooth' }, { t: 3, kind: 'ELM' }, { t: 5, kind: 'ELM' }];
  it('is 1 at the ELM, decays linearly over 1 % of the shot plus 0.05, and is 0 before the first ELM', () => {
    expect(elmFlashAt(events, 0.5, 100)).toBe(0);
    expect(elmFlashAt([], 4, 100)).toBe(0);
    expect(elmFlashAt(events, 3, 100)).toBe(1);
    expect(elmFlashAt(events, 3.525, 100)).toBeCloseTo(0.5, 12);
    expect(elmFlashAt(events, 4.5, 100)).toBe(0);
  });
  it('uses the last ELM at or before t (a scrubbed timeline shows the past, not the future)', () => {
    expect(elmFlashAt(events, 4, 100)).toBeCloseTo(1 - 1 / 1.05, 12);
    expect(elmFlashAt(events, 5, 100)).toBe(1);
    expect(elmFlashAt(events, 1, 100)).toBe(1);
    expect(elmFlashAt(events, 2.0, 100)).toBeCloseTo(1 - 1 / 1.05, 12);
  });
});

describe('disruption look', () => {
  it('is nothing without a disruption', () => {
    expect(disruptionLook(null)).toBe(NO_DISRUPTION);
    expect(NO_DISRUPTION).toEqual({ flash: 0, squash: 1, dR: 0, dZ: 0, grey: 0, rim: 0 });
  });
  it('flashes white first, then loses colour, contracts and drops, and settles', () => {
    const at = (ms: number) => disruptionLook(ms);
    expect(at(0).flash).toBe(0);
    expect(at(120).flash).toBe(1);
    expect(at(600).flash).toBe(0);
    expect(at(1000).flash).toBe(0);
    expect(at(0).squash).toBe(1);
    expect(at(0).grey).toBe(0);
    let prevSquash = 1, prevGrey = -1;
    for (let ms = 0; ms <= DISRUPTION_MS; ms += 100) {
      expect(at(ms).squash).toBeLessThanOrEqual(prevSquash + 1e-12);
      expect(at(ms).grey).toBeGreaterThanOrEqual(prevGrey - 1e-12);
      prevSquash = at(ms).squash; prevGrey = at(ms).grey;
    }
    const end = at(DISRUPTION_MS);
    expect(end.squash).toBeCloseTo(0.6, 12);
    expect(end.dR).toBeCloseTo(-0.15, 12); // the 2D view shifts by -0.15 a
    expect(end.grey).toBe(1);
    // the settled state is the limit, whether reached by time or given directly
    expect(disruptionLook(Infinity)).toEqual(disruptionLook(DISRUPTION_MS * 10));
    expect(disruptionLook(Infinity).flash).toBe(0);
    expect(disruptionLook(-50)).toEqual(disruptionLook(0));
  });
});
