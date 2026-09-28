/**
 * Invariants of short preset runs: conservation and bookkeeping properties that must hold whatever the
 * physics constants are, so they stay valid while lane ws2b changes the 0D models.
 *
 * Every run is checked for
 *  - finite diagnostics and state in every history frame, strictly increasing time;
 *  - monotone counters (E_fus, E_in, neutron count) that equal the time integral of the recorded power
 *    traces (trapezoid rule over the output frames);
 *  - particle-count sanity (quasi-neutrality bounds, helium ash ≤ reactions, neutrons ↔ fusion energy);
 * and the magnetic 0D model for an energy ledger closure
 *      ΔW_total = ∫ (P_ohm + P_aux,abs + P_charged − P_rad − P_cond) dt,   W_total = W_e + W_i + Σ fast-ion pools,
 * together with the thermal part ΔW_th = ∫ (P_heat − P_rad − P_cond) dt. The ledger terms follow
 * magnetic.ts rhs(): P_heat = P_ohm + P_aux,direct + (fast-pool → thermal power); the fast pools are fed
 * by P_charged and the absorbed NBI power; P_rad = P_brems + P_line + P_sync; P_cond = W/τ_E − (ELM mean).
 *
 * Discrete events (ELMs, sawteeth — which change the state in postStep — and L–H/H–L/NTM transitions,
 * which switch τ_E between two samples) break the trapezoid rule on the interval that contains them, so
 * those intervals are left out of both sides of every balance; the rest must close.
 */
import { describe, expect, it, vi } from 'vitest';
import { Simulation, createModel } from '../simulation';
import { PRESETS } from '../presets';
import { nbiShineThrough } from '../heating';
import { FUEL_CHANNELS, FuelType } from '../reactivity';
import type { HistoryFrame, MagneticConfig, ReactorConfig, SimEvent } from '../types';

// the first test of each preset runs the simulation (0.1–0.5 s alone; allow for a loaded machine)
vi.setConfig({ testTimeout: 60_000 });

const MeV_J = 1.602176634e-13;
const E_DT_MeV = 17.589; // Q-value of D + T → ⁴He + n (AME2020 mass defect, see reactivity.test.ts)

/** event kinds that change the state or the right-hand side discontinuously */
const DYNAMIC_EVENTS = new Set(['ELM', 'sawtooth', 'LH', 'HL', 'NTM_onset', 'NTM_gone', 'disruption', 'quench']);

interface Run {
  id: string;
  cfg: ReactorConfig;
  sim: Simulation;
  H: HistoryFrame[];
  events: SimEvent[];
  /** seconds per model time unit */
  tu: number;
  magnetic: boolean;
}

const cache = new Map<string, Run>();
function run(id: string, tEnd?: number): Run {
  const key = `${id}:${tEnd ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`no preset ${id}`);
  const cfg = (tEnd !== undefined ? { ...p.cfg, t_end: tEnd } : p.cfg) as ReactorConfig;
  const sim = new Simulation(cfg);
  sim.runAll();
  const tu = sim.model.timeUnit === 's' ? 1 : sim.model.timeUnit === 'µs' ? 1e-6 : 1e-9;
  const r: Run = { id, cfg, sim, H: sim.history, events: sim.events, tu, magnetic: sim.model.kind === 'magnetic' };
  cache.set(key, r);
  return r;
}

/** output intervals (a, b] that contain no dynamic event, up to the first disruption */
function cleanIntervals(r: Run): [HistoryFrame, HistoryFrame][] {
  const evT = r.events.filter((e) => DYNAMIC_EVENTS.has(e.kind)).map((e) => e.t);
  const tStop = r.events.find((e) => e.kind === 'disruption')?.t ?? Infinity;
  const out: [HistoryFrame, HistoryFrame][] = [];
  for (let i = 1; i < r.H.length; i++) {
    const a = r.H[i - 1], b = r.H[i];
    if (b.t > tStop) break;
    if (evT.some((t) => t >= a.t && t <= b.t)) continue;
    out.push([a, b]);
  }
  return out;
}

/** Σ over clean intervals of (Δcounter − trapezoid(rate)), and Σ Δcounter */
function balance(r: Run, counter: (d: Record<string, number>) => number, rate: (d: Record<string, number>) => number) {
  let resid = 0, covered = 0;
  for (const [a, b] of cleanIntervals(r)) {
    const dC = counter(b.d) - counter(a.d);
    resid += dC - 0.5 * (rate(a.d) + rate(b.d)) * (b.t - a.t) * r.tu;
    covered += dC;
  }
  return { resid, covered };
}

/**
 * Energy in fast-ion pools [MJ]: diagnostics whose key starts with "Wf". A pool split is expected to be
 * published as Wf_<name> keys; a plain "Wf" is then taken as their total when it equals their sum.
 */
function fastPoolsMJ(d: Record<string, number>): number {
  const split = Object.keys(d).filter((k) => /^Wf_/.test(k));
  if (!split.length) return d.Wf ?? 0;
  const s = split.reduce((acc, k) => acc + d[k], 0);
  if (d.Wf === undefined) return s;
  return Math.abs(d.Wf - s) <= 1e-9 * Math.max(1, Math.abs(d.Wf)) ? s : d.Wf + s;
}

/**
 * Absorbed auxiliary power [MW]: the model's own diagnostic if it publishes one (requested from ws2b),
 * otherwise injected power minus NBI shine-through — all heating channels share one ramp in magnetic.ts,
 * so the NBI share of the injected power is P_NBI/(P_NBI + P_ICRH + P_ECRH).
 */
function auxAbsorbedMW(r: Run, d: Record<string, number>): number {
  if (d.P_aux_abs !== undefined) return d.P_aux_abs;
  const h = (r.cfg as MagneticConfig).heating;
  const total = h.P_NBI_MW + h.P_ICRH_MW + h.P_ECRH_MW;
  if (total <= 0) return d.P_aux;
  const nbi = (d.P_aux * h.P_NBI_MW) / total;
  return d.P_aux - nbi * nbiShineThrough(d.ne * 1e20, r.sim.model.geometryInfo().a, h.E_NBI_keV);
}

const MAGNETIC: [string, number][] = [['ITER', 3], ['W7X', 3], ['MASTU', 2], ['DIIID', 3]];
const PULSED = ['TAE', 'MIRROR', 'Z', 'GF', 'FRXL', 'ZAP', 'MUON', 'NIF', 'DIRECT'];
const ALL: [string, string, number | undefined][] = [
  ...MAGNETIC.map(([id, t]): [string, string, number] => [id, `t_end = ${t} s`, t]),
  ...PULSED.map((id): [string, string, undefined] => [id, 'preset duration', undefined]),
];
const fuelOf = (r: Run): FuelType => ((r.cfg as { fuel?: FuelType }).fuel ?? 'DT');

describe.each(ALL)('%s (%s)', (id, _label, tEnd) => {
  it('every frame has finite diagnostics and state, and time increases strictly', () => {
    const r = run(id, tEnd);
    expect(r.H.length).toBeGreaterThan(10);
    let tPrev = -Infinity;
    for (const f of r.H) {
      expect(f.t, `${id}: time ${f.t} after ${tPrev}`).toBeGreaterThan(tPrev);
      tPrev = f.t;
      for (const [k, v] of Object.entries(f.d)) if (!Number.isFinite(v)) expect.fail(`${id} t=${f.t}: diagnostic ${k} = ${v}`);
      for (const [i, v] of f.y.entries()) if (!Number.isFinite(v)) expect.fail(`${id} t=${f.t}: state[${i}] = ${v}`);
    }
    expect(r.sim.model.terminated?.natural, `${id} ended by: ${r.sim.model.terminated?.reason}`).toBe(true);
  });

  it('energy and particle counters never decrease', () => {
    const r = run(id, tEnd);
    for (const k of ['Efus_MJ', 'Ein_MJ', 'Nn']) {
      for (let i = 1; i < r.H.length; i++) {
        const a = r.H[i - 1].d[k], b = r.H[i].d[k];
        if (a === undefined || b === undefined) continue;
        if (b < a * (1 - 1e-12)) expect.fail(`${id}: ${k} fell from ${a} to ${b} at t=${r.H[i].t}`);
      }
    }
  });

  it('E_fus equals the trapezoid integral of P_fus within 1e-3', () => {
    const r = run(id, tEnd);
    const E = r.H[r.H.length - 1].d.Efus_MJ;
    const { resid, covered } = balance(r, (d) => d.Efus_MJ, (d) => d.P_fus);
    expect(covered / E, `${id}: share of E_fus in event-free intervals`).toBeGreaterThan(0.5);
    expect(Math.abs(resid) / E, `${id}: E_fus = ${E} MJ, residual ${resid}`).toBeLessThan(1e-3);
  });

  it('E_in equals the trapezoid integral of the input power within 1e-3 (where the model publishes it)', () => {
    const r = run(id, tEnd);
    const d0 = r.H[0].d;
    const rate = r.magnetic ? (d: Record<string, number>) => d.P_aux + d.P_oh
      : d0.P_in !== undefined ? (d: Record<string, number>) => d.P_in
      : d0.P_aux !== undefined ? (d: Record<string, number>) => d.P_aux : undefined;
    if (!rate) return; // ICF/MTF: driver energy is not a published power trace
    const E = r.H[r.H.length - 1].d.Ein_MJ;
    const { resid, covered } = balance(r, (d) => d.Ein_MJ, rate);
    expect(covered / E).toBeGreaterThan(0.5);
    expect(Math.abs(resid) / E, `${id}: E_in = ${E} MJ, residual ${resid}`).toBeLessThan(1e-3);
  });

  it('neutron count matches the fusion energy (one neutron per D-T reaction; D-D: at most one per 3.27 MeV)', () => {
    const r = run(id, tEnd);
    const last = r.H[r.H.length - 1].d;
    if (last.Nn === undefined) return;
    const fuel = fuelOf(r);
    if (fuel === 'DT') {
      expect(Math.abs((last.Nn * E_DT_MeV * MeV_J) / (last.Efus_MJ * 1e6) - 1), `${id}`).toBeLessThan(1e-9);
    } else if (fuel === 'DD') {
      const nChan = FUEL_CHANNELS.DD.find((c) => c.Eneutron_MeV > 0)!;
      expect(last.Nn * nChan.Etot_MeV * MeV_J).toBeLessThanOrEqual(last.Efus_MJ * 1e6 * (1 + 1e-9));
      if (r.magnetic) { // and the count is the integral of P_neutron / E_n
        const { resid, covered } = balance(r, (d) => d.Nn, (d) => (d.P_neutron * 1e6) / (nChan.Eneutron_MeV * MeV_J));
        expect(covered / last.Nn).toBeGreaterThan(0.5);
        expect(Math.abs(resid) / last.Nn).toBeLessThan(1e-3);
      }
    }
  });
});

describe.each(MAGNETIC)('magnetic 0D: %s (t_end = %s s)', (id, tEnd) => {
  it('particle-count sanity: quasi-neutrality bounds and helium ash ≤ reactions', () => {
    const r = run(id, tEnd);
    const V = r.sim.model.geometryInfo().V;
    const fuel = fuelOf(r);
    const minE = Math.min(...FUEL_CHANNELS[fuel].map((c) => c.Etot_MeV)) * MeV_J;
    const ashPerReaction = fuel === 'pB11' ? 3 : 1; // ⁴He nuclei per reaction (D-D makes ³He/T, counted as ≤ 1)
    for (const f of r.H) {
      const d = f.d;
      expect(d.ne, `${id} t=${f.t}`).toBeGreaterThan(0);
      expect(d.Zeff, `${id} t=${f.t}: Z_eff = Σ n_j Z_j² / Σ n_j Z_j ≥ 1`).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(d.fHe).toBeGreaterThanOrEqual(0);
      expect(d.cZ).toBeGreaterThanOrEqual(0);
      expect(d.fuelFracA).toBeGreaterThanOrEqual(0);
      expect(d.fuelFracA).toBeLessThanOrEqual(1);
      expect(d.burnFrac).toBeGreaterThanOrEqual(0);
      const nHeV = d.fHe * d.ne * 1e20 * V;
      const reactions = (d.Efus_MJ * 1e6) / minE;
      expect(nHeV, `${id} t=${f.t}: ash inventory ${nHeV} vs ≤ ${ashPerReaction * reactions} reactions`).toBeLessThanOrEqual(ashPerReaction * reactions * (1 + 1e-6) + 1);
    }
  });

  it('power diagnostics add up: P_rad = P_brems + P_line + P_sync, P_charged + P_neutron = P_fus, P_bt ≤ P_fus', () => {
    const r = run(id, tEnd);
    for (const f of r.H) {
      const d = f.d;
      const sum = d.P_brems + d.P_line + d.P_sync;
      if (Math.abs(d.P_rad - sum) > 1e-12 * Math.max(Math.abs(sum), 1e-30)) expect.fail(`${id} t=${f.t}: P_rad ${d.P_rad} ≠ ${sum}`);
      for (const k of ['P_brems', 'P_line', 'P_sync', 'P_fus', 'P_bt', 'P_charged', 'P_neutron', 'P_oh', 'P_aux', 'W']) {
        if (!(d[k] >= 0)) expect.fail(`${id} t=${f.t}: ${k} = ${d[k]} < 0`);
      }
      if (!(fastPoolsMJ(d) >= 0)) expect.fail(`${id} t=${f.t}: fast pools ${fastPoolsMJ(d)} < 0`);
      // 1e-3 admits the D-T 3.5 + 14.1 ≠ 17.589 MeV split (BUG(ws2a) in reactivity.test.ts, 6e-4)
      if (d.P_fus > 0 && Math.abs((d.P_charged + d.P_neutron) / d.P_fus - 1) > 1e-3) expect.fail(`${id} t=${f.t}: P_charged + P_neutron = ${d.P_charged + d.P_neutron} vs P_fus ${d.P_fus}`);
      if (d.P_bt > d.P_fus * (1 + 1e-12)) expect.fail(`${id} t=${f.t}: beam-target ${d.P_bt} > P_fus ${d.P_fus}`);
    }
  });

  // Tolerance: the residual comes from sampling the power traces every output step (2 ms ≪ the ≥ 50 ms
  // ramp/confinement time scales, trapezoid error O(Δt²)) and from the ELM-averaged loss that postStep
  // updates between two samples. Measured: 1e-6 of ∫P_heat without ELMs (ITER 3 s, W7-X) and ≤ 1.6e-4
  // with frequent ELMs and sawteeth (MAST-U, DIII-D; JT-60SA 1.8e-4). 5e-4 keeps a ≥ 3× margin while any
  // missing ledger term of ≥ 0.05 % of the heating power — NBI shine-through, a fast-ion pool, one
  // radiation channel — fails it.
  const TOL = 5e-4;
  it('thermal energy ledger closes: ΔW_th = ∫(P_heat − P_rad − P_cond) dt', () => {
    const r = run(id, tEnd);
    let heat = 0;
    for (const [a, b] of cleanIntervals(r)) heat += 0.5 * (a.d.P_heat + b.d.P_heat) * (b.t - a.t);
    const { resid } = balance(r, (d) => d.W, (d) => d.P_heat - d.P_rad - d.P_cond);
    expect(heat).toBeGreaterThan(0);
    expect(Math.abs(resid) / heat, `${id}: residual ${resid} MJ of ∫P_heat = ${heat} MJ`).toBeLessThan(TOL);
  });

  it('total energy ledger closes: Δ(W_e + W_i + fast pools) = ∫(P_ohm + P_aux,abs + P_charged − P_rad − P_cond) dt', () => {
    const r = run(id, tEnd);
    let heat = 0;
    for (const [a, b] of cleanIntervals(r)) heat += 0.5 * (a.d.P_heat + b.d.P_heat) * (b.t - a.t);
    const { resid } = balance(r, (d) => d.W + fastPoolsMJ(d),
      (d) => d.P_oh + auxAbsorbedMW(r, d) + d.P_charged - d.P_rad - d.P_cond);
    expect(Math.abs(resid) / heat, `${id}: residual ${resid} MJ of ∫P_heat = ${heat} MJ`).toBeLessThan(TOL);
  });
});

// BUG(ws2a): a frame recorded right after an ELM or sawtooth crash stores the post-crash state y
// but the diagnostics of the pre-crash state: MagneticModel.diagnostics() returns the cache filled by
// the last rhs() call, and postStep() changes y afterwards without invalidating it. T_e, P_fus, P_rad …
// of those frames are 2–4.5 % off their own state (ITER, DIII-D, MAST-U, JET, SPARC, JT-60SA); the
// golden flat-top averages and the UI traces include them. Regular frames agree exactly.
describe('magnetic 0D: recorded diagnostics describe the recorded state', () => {
  const Y_KEYS = ['Te', 'Ti', 'ne', 'P_fus', 'P_rad', 'P_brems', 'W'];
  const compare = (r: Run, frames: HistoryFrame[]) => {
    const model = createModel(r.cfg);
    // the last frame's saved internal state already says "ended" (heating off), unlike its diagnostics
    for (const f of frames.filter((x) => x.t < r.sim.model.tEnd - 1e-9)) {
      model.restoreInternal(f.internal);
      const fresh = model.diagnostics(f.t, Float64Array.from(f.y));
      for (const k of Y_KEYS) {
        const ref = fresh[k], got = f.d[k];
        if (Math.abs(got - ref) > 1e-9 * Math.max(Math.abs(ref), 1e-12)) expect.fail(`${r.id} t=${f.t}: ${k} recorded ${got}, state gives ${ref}`);
      }
    }
  };
  const eventFrames = (r: Run) => {
    const t = new Set(r.events.filter((e) => e.kind === 'ELM' || e.kind === 'sawtooth').map((e) => e.t));
    return r.H.filter((f) => t.has(f.t));
  };

  it('regular output frames', () => {
    const r = run('ITER', 3);
    const ev = new Set(eventFrames(r));
    compare(r, r.H.filter((f) => !ev.has(f)));
  });

  it.fails('frames recorded at ELM / sawtooth events (BUG(ws2a): pre-crash diagnostics)', () => {
    const r = run('ITER', 3);
    const frames = eventFrames(r);
    expect(frames.length).toBeGreaterThan(0);
    compare(r, frames);
  });
});
