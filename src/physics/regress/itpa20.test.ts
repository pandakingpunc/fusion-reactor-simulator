/**
 * The ITPA20 and ITPA20-IL H-mode scalings (Verdoolaege et al., Nucl. Fusion 61 (2021) 076006) as selectable
 * MagneticConfig.scaling options (ws2c): the 0D model, POPCON and the 1.5D confinement controller evaluate them with the
 * areal elongation κ_a = V/(2π² R a²) and the average LCFS triangularity, the definitions of the paper, not with the 95 %
 * values of the presets; the default (IPB98(y,2)) is unchanged. The coefficients themselves are checked against the paper in
 * validation/primarySources.test.ts and scalings.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { MagneticModel } from '../confinement/magnetic';
import { arealElongation, boundaryShape } from '../geometry';
import { computePopcon } from '../popcon';
import { ITER, JET, SPARC } from '../presets';
import { scalingTauE } from '../profiles/control/confinement';
import type { ProfileContext } from '../profiles/context';
import { tauHmode, tauIPB98y2, tauITPA20, tauITPA20IL, type HModeScaling } from '../transport';
import type { MagneticConfig } from '../types';

const SCALINGS: HModeScaling[] = ['IPB98y2', 'ITPA20', 'ITPA20-IL'];
const M_DT = (c: MagneticConfig) => c.fuelFracA * 2.014 + (1 - c.fuelFracA) * 3.016;

describe('0D model', () => {
  // 30 s of ITER: L-H at 10 s, then the ramp-up to the flat top (with H98 = 1 the lower ITPA20 τ_E does not sustain the burn: the
  // ITER preset burns out at about 40 s with ITPA20 and ITPA20-IL, the paper predicts 15 % less τ_E than IPB98(y,2) for ITER)
  const run = (scaling: HModeScaling, cfg: MagneticConfig = ITER, tEnd = 30) => {
    const sim = new Simulation({ ...cfg, scaling, t_end: tEnd, events: { ...cfg.events, ntm: false } });
    sim.runAll();
    return sim.history;
  };

  it('τ_E of every H-mode frame is H98 × the selected scaling at the model\'s own n̄, P_L, I_p, B, M, κ_a and LCFS δ', () => {
    for (const scaling of ['ITPA20', 'ITPA20-IL'] as const) {
      const all = run(scaling);
      // the frame of the L-H flip itself carries the diagnostics of the step before the flip (a known Wave-2 item): skip it
      const h = all.filter((f, i) => f.d.H_mode === 1 && all[i - 1].d.H_mode === 1 && f.d.tauE > 2e-3);
      expect(h.length, scaling).toBeGreaterThan(50);
      const gB = boundaryShape(ITER);
      const g = { R: ITER.geometry.R, a: ITER.geometry.a, kappa: arealElongation(gB), delta: gB.delta };
      expect(g.delta).toBe(0.49); // the LCFS triangularity of the preset, not the 0.33 of the 95 % surface
      const f = scaling === 'ITPA20' ? tauITPA20 : tauITPA20IL;
      for (const fr of h) {
        const d = fr.d;
        const ref = ITER.H98 * f(g, d.Ip, ITER.B0, d.nbar * 1e20, d.P_loss * 1e6, M_DT(ITER));
        expect(d.tauE / ref, `${scaling} t = ${fr.t}`).toBeCloseTo(1, 9);
      }
    }
  });

  it('the scaling changes τ_E in the H-mode part of a shot (ITPA20 and ITPA20-IL are 5–25 % below IPB98(y,2) at the ITER point) and nothing before the L–H transition', () => {
    const base = run('IPB98y2'), itpa = run('ITPA20'), il = run('ITPA20-IL');
    const tLH = base.find((f) => f.d.H_mode === 1)!.t;
    expect(tLH).toBeGreaterThan(0);
    const tauAt = (h: typeof base, t: number) => h.filter((f) => f.t >= t).slice(0, 5).reduce((s, f) => s + f.d.tauE, 0) / 5;
    // L-mode frames are ITER89-P: bitwise the same in the runs
    for (const f of base.filter((x) => x.t < 0.9 * tLH).slice(0, 20)) {
      const g = itpa.find((x) => x.t === f.t)!;
      expect(g.d.tauE).toBe(f.d.tauE);
    }
    for (const other of [itpa, il]) {
      const r = tauAt(other, 20) / tauAt(base, 20);
      expect(r).toBeGreaterThan(0.75);
      expect(r).toBeLessThan(0.99);
    }
  });

  it('IPB98y2 is the default of the presets, and an old saved config without the field runs as IPB98y2, bit for bit', () => {
    const old: Partial<MagneticConfig> = { ...JET, t_end: 3 };
    delete old.scaling; // a configuration saved before the field existed
    const a = new Simulation(old as MagneticConfig), b = new Simulation({ ...JET, scaling: 'IPB98y2', t_end: 3 });
    expect(JET.scaling).toBe('IPB98y2');
    expect(ITER.scaling).toBe('IPB98y2');
    a.runAll(); b.runAll();
    expect(b.history.length).toBe(a.history.length);
    expect(b.history[b.history.length - 1].d.tauE).toBe(a.history[a.history.length - 1].d.tauE);
    expect(b.nSteps).toBe(a.nSteps);
  });

  it('the LCFS elongation and triangularity, not the presets\' 95 % ones, enter (SPARC has no separate LCFS shape: its κ, δ are the boundary)', () => {
    const m = new MagneticModel({ ...SPARC, scaling: 'ITPA20' });
    const d = m.diagnostics(0, m.initialState());
    expect(d.tauE).toBeGreaterThan(0);
    expect(boundaryShape(SPARC)).toBe(SPARC.geometry);
    // κ_a of a boundary of κ = 1.97, δ = 0.54: 1.97 × the Miller volume factor (< 1)
    expect(arealElongation(SPARC.geometry)).toBeLessThan(SPARC.geometry.kappa);
    expect(arealElongation(SPARC.geometry)).toBeGreaterThan(0.85 * SPARC.geometry.kappa);
  });
});

describe('POPCON', () => {
  it('takes the selected scaling: a different Paux at the same (n, T) for ITPA20 and ITPA20-IL, the same for the default', () => {
    const o = { nx: 8, ny: 8 };
    const p0 = computePopcon(ITER, o), p1 = computePopcon({ ...ITER, scaling: 'ITPA20' }, o), p2 = computePopcon({ ...ITER, scaling: 'ITPA20-IL' }, o);
    const p3 = computePopcon({ ...ITER, scaling: 'IPB98y2' }, o);
    expect(Array.from(p3.Paux)).toEqual(Array.from(p0.Paux));
    let d1 = 0, d2 = 0;
    for (let k = 0; k < p0.Paux.length; k++) {
      expect(Number.isFinite(p1.Paux[k]) && Number.isFinite(p2.Paux[k])).toBe(true);
      if (p1.Paux[k] !== p0.Paux[k]) d1++;
      if (p2.Paux[k] !== p0.Paux[k]) d2++;
    }
    expect(d1).toBe(p0.Paux.length);
    expect(d2).toBe(p0.Paux.length);
  });
});

describe('1.5D confinement controller', () => {
  // scalingTauE reads only: cfg.scaling/H89, tg (R0, a, B0), kappaA, geomB.delta, hmode, ctrl.H98 and M
  const ctx = (scaling: HModeScaling): ProfileContext => ({
    cfg: { scaling, H89: 1 }, tg: { R0: 6.2, a: 2, B0: 5.3 }, kappaA: 1.72, geomB: { R: 6.2, a: 2, kappa: 1.85, delta: 0.49 },
    hmode: true, ctrl: { H98: 1.1 }, M: 2.5,
  } as unknown as ProfileContext);
  const gS = { R: 6.2, a: 2, kappa: 1.72, delta: 0.49 };

  it('H-mode τ_E is H98 × the selected scaling of (κ_a, LCFS δ); the default is the IPB98(y,2) call of before', () => {
    const P = 87e6, n = 10.3e19;
    expect(scalingTauE(ctx('IPB98y2'), 15, n, P)).toBe(1.1 * tauIPB98y2(gS, 15, 5.3, n, P, 2.5));
    expect(scalingTauE(ctx('ITPA20'), 15, n, P)).toBe(1.1 * tauITPA20(gS, 15, 5.3, n, P, 2.5));
    expect(scalingTauE(ctx('ITPA20-IL'), 15, n, P)).toBe(1.1 * tauITPA20IL(gS, 15, 5.3, n, P, 2.5));
    for (const s of SCALINGS) expect(scalingTauE(ctx(s), 15, n, P)).toBe(1.1 * tauHmode(s, gS, 15, 5.3, n, P, 2.5));
    // the paper's ITER point: ITPA20 3.07 s, ITPA20-IL 2.90 s (H98 = 1, κ_a 1.7, δ 0.48, ε 0.32 → a = 1.984)
    const paper = { R: 6.2, a: 0.32 * 6.2, kappa: 1.7, delta: 0.48 };
    expect(tauITPA20(paper, 15, 5.3, n, P, 2.5)).toBeCloseTo(3.07, 1);
    expect(tauITPA20IL(paper, 15, 5.3, n, P, 2.5)).toBeCloseTo(2.90, 1);
  });
});
