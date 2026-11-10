import { describe, expect, it } from 'vitest';
import { KEEP_RATIO, SPLIT_RATIO, splitAxes } from './axes';

describe('splitAxes', () => {
  it('Density chart: the fueling rate (154) goes right, the four density curves stay left', () => {
    const r = splitAxes([0.926, 1.03, 0.861, 0.0338, 154], false);
    expect(r.split).toBe(true);
    expect(r.right).toEqual([false, false, false, false, true]);
  });

  it('Confinement chart: tau_E next to P_LH and P_loss; the first series sets the left group', () => {
    const r = splitAxes([4.53, 1, 70.2, 165], false);
    expect(r.split).toBe(true);
    expect(r.right).toEqual([false, false, true, true]);
  });

  it('Engineering chart: when the first series is the large one, the small one goes right', () => {
    expect(splitAxes([36.9, 0.66], false)).toEqual({ split: true, right: [false, true] });
  });

  it('splits at the LARGEST gap, not at the first gap over the threshold', () => {
    // gaps: 1→20 (x20) and 20→5000 (x250)
    expect(splitAxes([1, 20, 5000], false).right).toEqual([false, false, true]);
  });

  it('no split when the largest ratio stays below a decade (the confinement-free example with a 0)', () => {
    const r = splitAxes([1.89, 1.72, 2.67, 3, 0, 15], false);
    expect(r.split).toBe(false);
    expect(r.right.every((x) => !x)).toBe(true);
    expect(r.right).toHaveLength(6);
  });

  it('exactly a decade splits (>= 10)', () => {
    expect(splitAxes([1, 10], false).split).toBe(true);
    expect(splitAxes([1, 9.99], false).split).toBe(false);
  });

  it('works with negative values: the magnitude counts', () => {
    expect(splitAxes([-0.5, 80, -0.2], false).right).toEqual([false, true, false]);
  });

  it('zeros, NaN and infinities are neutral: left, and never part of a ratio', () => {
    const r = splitAxes([0, 2, Number.NaN, 300, Number.POSITIVE_INFINITY, 1], false);
    expect(r.split).toBe(true);
    expect(r.right).toEqual([false, false, false, true, false, false]);
    // the first non-neutral series defines the left group, not index 0
    expect(splitAxes([0, 300, 2], false).right).toEqual([false, false, true]);
  });

  it('fewer than two non-neutral series: one axis', () => {
    expect(splitAxes([], false)).toEqual({ split: false, right: [] });
    expect(splitAxes([5], false)).toEqual({ split: false, right: [false] });
    expect(splitAxes([0, 5, Number.NaN], false)).toEqual({ split: false, right: [false, false, false] });
    expect(splitAxes([0, 0], true).split).toBe(false);
  });

  it('equal magnitudes do not split', () => {
    expect(splitAxes([3, 3, 3], false).split).toBe(false);
  });

  describe('hysteresis', () => {
    it('constants: split at 10, keep down to 7', () => {
      expect(SPLIT_RATIO).toBe(10);
      expect(KEEP_RATIO).toBe(7);
    });
    it('a single axis stays single between 7 and 10', () => {
      expect(splitAxes([1, 8], false).split).toBe(false);
      expect(splitAxes([1, 9.9], false).split).toBe(false);
    });
    it('a split chart stays split between 7 and 10, and drops at < 7', () => {
      expect(splitAxes([1, 8], true)).toEqual({ split: true, right: [false, true] });
      expect(splitAxes([1, 7], true).split).toBe(true);
      expect(splitAxes([1, 6.9], true)).toEqual({ split: false, right: [false, false] });
    });
    it('a live run that creeps over the threshold and back does not flicker', () => {
      let was = false;
      const decisions = [3, 8, 9.9, 10, 9, 8, 7.5, 7, 6.9, 8, 9].map((hi) => (was = splitAxes([1, hi], was).split));
      expect(decisions).toEqual([false, false, false, true, true, true, true, true, false, false, false]);
    });
  });
});
