/**
 * Event localisation (solver/localise.ts): the dense output of a TR-BDF2 step and the crossing of a trigger margin inside a step.
 */
import { describe, expect, it } from 'vitest';
import { TRBDF2_GAMMA } from './trbdf2';
import { EVENT_MIN_GAIN, EVENT_OVERSHOOT, locateEvent, stageWeights } from './localise';

describe('stageWeights (the quadratic through the states at θ = 0, γ, 1)', () => {
  it('are a partition of unity and interpolate the three states exactly', () => {
    for (const th of [0, 0.1, TRBDF2_GAMMA, 0.8, 1, 1.2]) {
      const w = stageWeights(th);
      expect(w[0] + w[1] + w[2]).toBeCloseTo(1, 13);
    }
    const w0 = stageWeights(0);
    expect(w0[0]).toBeCloseTo(1, 14); expect(w0[1]).toBeCloseTo(0, 14); expect(w0[2]).toBeCloseTo(0, 14);
    const wg = stageWeights(TRBDF2_GAMMA);
    expect(wg[0]).toBeCloseTo(0, 14); expect(wg[1]).toBeCloseTo(1, 14); expect(wg[2]).toBeCloseTo(0, 14);
    const w1 = stageWeights(1);
    expect(w1[0]).toBeCloseTo(0, 14); expect(w1[1]).toBeCloseTo(0, 14); expect(w1[2]).toBeCloseTo(1, 14);
  });

  it('reproduce any quadratic in θ exactly (the interpolation is of second order)', () => {
    const q = (th: number) => 3 - 2 * th + 5 * th * th;
    const nodes = [q(0), q(TRBDF2_GAMMA), q(1)];
    for (const th of [0.13, 0.5, 0.77, 0.95]) {
      const w = stageWeights(th);
      expect(w[0] * nodes[0] + w[1] * nodes[1] + w[2] * nodes[2]).toBeCloseTo(q(th), 12);
    }
  });
});

describe('locateEvent', () => {
  // a margin rising through zero at θ = 0.4: m(θ) = 2 (θ − 0.4)
  const rising = (th: number) => 2 * (th - 0.4);
  const δ = EVENT_OVERSHOOT;

  it('finds the fraction at which the margin reaches the overshoot (the event is aimed slightly beyond the crossing)', () => {
    const th = locateEvent(rising, rising(0), rising(1), 0);
    expect(th).toBeCloseTo(0.4 + δ / 2, 6);
    expect(rising(th)).toBeCloseTo(δ, 6);
  });

  it('leaves the step alone: no crossing inside it, or the crossing is within EVENT_MIN_GAIN of its end', () => {
    // negative all along
    expect(locateEvent((th) => -1 + 0.5 * th, -1, -0.5, 0)).toBe(1);
    // positive all along and ready from the start: an event overdue at the start fires at the end of the step
    expect(locateEvent(() => 0.3, 0.3, 0.3, 0)).toBe(1);
    // crossing at 0.99
    const late = (th: number) => th - 0.99;
    expect(locateEvent(late, late(0), late(1), 0)).toBe(1);
    expect(EVENT_MIN_GAIN).toBeGreaterThan(0.01);
    // the end of the step is beyond the threshold by less than the overshoot: nothing to shorten
    const shy = (th: number) => -0.5 + (0.5 + δ / 2) * th;
    expect(locateEvent(shy, shy(0), shy(1), 0)).toBe(1);
  });

  it('a step in which the event is not ready is left alone; one that becomes ready inside it ends there', () => {
    expect(locateEvent(rising, rising(0), rising(1), 1.2)).toBe(1);
    expect(locateEvent(rising, rising(0), rising(1), 1)).toBe(1);
    // the margin is already above the overshoot when the refractory period ends: the event fires as soon as it can
    const high = () => 0.5;
    expect(locateEvent(high, 0.5, 0.5, 0.35)).toBeCloseTo(0.35, 12);
    // ready before the crossing: the crossing decides
    expect(locateEvent(rising, rising(0), rising(1), 0.1)).toBeCloseTo(0.4 + δ / 2, 6);
    // ready after the crossing, margin above the target then: ready
    expect(locateEvent(rising, rising(0), rising(1), 0.6)).toBeCloseTo(0.6, 12);
  });

  it('a jump (the margin is −1 while the trigger is not armed, then a value beyond the threshold) is located at the jump', () => {
    const jump = (th: number) => (th < 0.3 ? -1 : 0.15);
    const th = locateEvent(jump, -1, 0.15, 0);
    expect(th).toBeGreaterThan(0.2999);
    expect(th).toBeLessThan(0.3001);
  });

  it('accepts a non-monotone margin as long as the ends differ in sign: the first sign change that Brent brackets', () => {
    const wiggle = (th: number) => 0.6 * (th - 0.5) + 0.05 * Math.sin(20 * th);
    const th = locateEvent(wiggle, wiggle(0), wiggle(1), 0);
    expect(Math.abs(wiggle(th) - δ)).toBeLessThan(1e-6);
  });
});
