/**
 * The fuelling command of the 0D density controller (densityControl.ts): the command itself, and the loop it closes with the inventory
 * balance dn/dt = flow - L n and an actuator that is a first-order lag, against the proportional command it replaced.
 */
import { describe, expect, it } from 'vitest';
import { FuelCommandInput, RAMP_LEAD, fuelCommand } from './densityControl';

const base: FuelCommandInput = { nSet: 1, dnSet: 0, ne: 1, dn: 0, flowIn: 3, flowKnown: 0, kp: 18, tauAct: 0.25, gain: 0.3, Smax: 1e9 };

describe('the command', () => {
  it('holds a plasma that is on target and not changing: the command is the flow that is delivered (no droop, no integrator)', () => {
    expect(fuelCommand(base) * base.gain).toBeCloseTo(3, 12);
    expect(fuelCommand({ ...base, flowIn: 7.5 }) * base.gain).toBeCloseTo(7.5, 12);
  });

  it('takes the beams off what the actuator supplies, and the losses of the moment from the delivered flow and the rate of change', () => {
    // a plasma on target and growing at dn = 0.5 with a delivered flow of 3 loses 2.5: the command holds that against the prediction of the rise
    const c = fuelCommand({ ...base, dn: 0.5 });
    expect(c * base.gain).toBeCloseTo(18 * (1 - (1 + 0.25 * 0.5)) + 2.5, 12);
    // beams that inject 1 of the 3: the actuator supplies the other 2 to hold the same loss
    expect(fuelCommand({ ...base, flowIn: 2, flowKnown: 1 }) * base.gain).toBeCloseTo(2, 12);
  });

  it('feeds the ramp of the set-point forward with a part of the lead of the actuator', () => {
    // dn = dnSet = 2: the plasma follows the ramp, its prediction is ahead by tau dn = 0.5 and the set-point by RAMP_LEAD tau dnSet
    const c = fuelCommand({ ...base, nSet: 1, dnSet: 2, dn: 2, ne: 1, flowIn: 5 });
    expect(RAMP_LEAD).toBe(0.5);
    expect(c * base.gain).toBeCloseTo(18 * (1 + 0.5 * 0.25 * 2 - (1 + 0.25 * 2)) + 3 + 2, 12); // losses 5 - 2 = 3, the ramp 2
    // with no lead the same state would be at rest against its prediction
    expect(c * base.gain).toBeLessThan(3 + 2);
  });

  it('is limited to [0, S_max]', () => {
    expect(fuelCommand({ ...base, nSet: 100, Smax: 40 })).toBe(40);
    expect(fuelCommand({ ...base, nSet: 0, ne: 5 })).toBe(0);
  });
});

/** The loop the model closes: dn/dt = gain S - L n, the actuator state S following the command with the lag tau (electrons in units of n/s). */
function simulate(cmd: (n: number, dn: number, S: number, r: number, dr: number, L: number) => number, opts: { n0: number; L0: number; L1: number; tLoss: number; ref: (t: number) => number; T: number }) {
  const tau = 0.25, gain = 0.3, dt = 1e-4;
  let n = opts.n0, S = (opts.L0 * opts.n0) / gain;
  const trace: { t: number; n: number; r: number }[] = [];
  for (let t = 0; t < opts.T; t += dt) {
    const L = t < opts.tLoss ? opts.L0 : opts.L1;
    const r = opts.ref(t), dr = (opts.ref(t + 1e-6) - r) / 1e-6;
    const dn = gain * S - L * n;
    const S_cmd = cmd(n, dn, S, r, dr, L);
    S += ((S_cmd - S) / tau) * dt;
    n += dn * dt;
    if (Math.round(t / dt) % 100 === 0) trace.push({ t, n, r });
  }
  return trace;
}

const K = 18.7, TAU = 0.25;
const proportional = (n: number, _dn: number, _S: number, r: number, _dr: number, L: number) => (K * (r - n) + L * n) / 0.3;
const predictive = (n: number, dn: number, S: number, r: number, dr: number, _L: number) =>
  fuelCommand({ nSet: r, dnSet: dr, ne: n, dn, flowIn: 0.3 * S, flowKnown: 0, kp: K, tauAct: TAU, gain: 0.3, Smax: 1e9 });
const overshoot = (tr: { t: number; n: number; r: number }[], from: number) => Math.max(...tr.filter((p) => p.t >= from).map((p) => p.n / p.r - 1));

describe('the closed loop (DIII-D numbers: L = 3.1 /s, k_p = 18.7 /s, gas lag 0.25 s)', () => {
  it('a step of the set-point rings with about 25 % overshoot under proportional control and not at all with the predictor', () => {
    // 20 % in 50 ms (a step has no rate to feed forward)
    const ref = (t: number) => 1 + 0.2 * Math.min(1, Math.max(0, (t - 0.5) / 0.05));
    const o = { n0: 1, L0: 3.1, L1: 3.1, tLoss: 1e9, ref, T: 4 };
    const p = overshoot(simulate(proportional, o), 0.55) / 0.2;
    const q = overshoot(simulate(predictive, o), 0.55) / 0.2;
    expect(p).toBeGreaterThan(0.1);
    expect(q).toBeLessThan(0.02);
  });

  it('a drop of the loss rate to two thirds (an NTM that ends) overshoots by about 40 % less than before', () => {
    // the plasma is at the target with the flow of the NTM phase; the actuator keeps delivering it for one lag after the losses fall
    const o = { n0: 1, L0: 3.1 * 1.5, L1: 3.1, tLoss: 0.2, ref: () => 1, T: 4 };
    const p = overshoot(simulate(proportional, o), 0.2);
    const q = overshoot(simulate(predictive, o), 0.2);
    expect(p).toBeGreaterThan(0.08);
    expect(q).toBeLessThan(0.7 * p);
    expect(q).toBeLessThan(0.07); // what the lag of the actuator leaves: no command can cancel a flow that is already on its way
  });

  it('a set-point ramp is followed as closely as before (11 % of the final density behind at the end of a 1 s ramp) and ends without overshoot', () => {
    for (const ramp of [0.3, 1]) {
      const ref = (t: number) => 0.3 + 0.7 * Math.min(1, t / ramp);
      const o = { n0: 0.3, L0: 3.1, L1: 3.1, tLoss: 1e9, ref, T: 6 };
      const p = simulate(proportional, o), q = simulate(predictive, o);
      const lag = (tr: typeof p) => Math.max(...tr.filter((x) => x.t < ramp).map((x) => x.r - x.n));
      if (ramp === 1) expect(lag(q)).toBeLessThan(0.125);
      expect(lag(q), `ramp ${ramp} s`).toBeLessThan(lag(p) + 0.04);
      // the proportional command runs past the target at the end of the ramp, the predictor does not
      expect(overshoot(p, ramp), `ramp ${ramp} s`).toBeGreaterThan(ramp === 1 ? 0.02 : 0.01);
      expect(overshoot(q, ramp), `ramp ${ramp} s`).toBeLessThan(0.002);
      expect(Math.abs(q[q.length - 1].n - 1)).toBeLessThan(1e-3);
    }
  });
});
