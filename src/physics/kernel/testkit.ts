/**
 * Helpers for the determinism tests (determinism*.test.ts): reference runs, random chunk
 * schedules, bitwise run comparison with a readable first difference. Not used by the app.
 */
import { expect } from 'vitest';
import { Simulation } from '../simulation';
import { PRESETS } from '../presets';
import { RNG } from '../rng';
import type { HistoryFrame, ReactorConfig, SimEvent } from '../types';
import { canonicalString } from './canonical';
import { runDigest } from './fingerprint';

export interface Run {
  history: readonly HistoryFrame[];
  events: readonly SimEvent[];
  digest?: string;
}

/** A preset's configuration, optionally with a shorter t_end. */
export function presetCfg(id: string, tEnd?: number): ReactorConfig {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown preset ${id}`);
  return tEnd === undefined ? p.cfg : ({ ...p.cfg, t_end: tEnd } as ReactorConfig);
}

export function digestOf(r: Run): string {
  return r.digest ?? runDigest(r.history, r.events);
}

const refCache = new Map<string, Required<Run>>();
/** runAll() of a configuration (cached per test file). */
export function referenceRun(cfg: ReactorConfig): Required<Run> {
  const key = canonicalString(cfg);
  let r = refCache.get(key);
  if (!r) {
    const sim = new Simulation(cfg);
    sim.runAll();
    r = { history: sim.history, events: sim.events, digest: runDigest(sim.history, sim.events) };
    refCache.set(key, r);
  }
  return r;
}

/** One chunk length of a random schedule: idle ticks, sub-step ticks and 1e-5…0.3 t_end chunks. */
function randomChunk(rng: RNG, T: number): number {
  const u = rng.next();
  if (u < 0.1) return 0;
  if (u < 0.25) return T * 1e-7 * rng.next();
  return T * Math.exp(Math.log(1e-5) + rng.next() * Math.log(3e4));
}

/** Continues a simulation to the end with a seeded random chunk schedule (and mid-run report() calls, as the worker makes). */
export function advanceRandomly(sim: Simulation, seed: number): Simulation {
  const rng = new RNG(seed);
  let guard = 0;
  while (!sim.done && guard++ < 1e7) {
    sim.advance(randomChunk(rng, sim.model.tEnd));
    if (rng.next() < 0.03) sim.report();
  }
  return sim;
}

/** A fresh run to the end with a seeded random chunk schedule. */
export function runChunked(cfg: ReactorConfig, seed: number): Simulation {
  return advanceRandomly(new Simulation(cfg), seed);
}

/**
 * A run advanced (random chunks) to min(p + 0.2, 1)·t_end, then rewound to the first frame at or
 * after p·t_end: it has a future that was thrown away.
 */
export function rewindAt(cfg: ReactorConfig, p: number, seed: number): Simulation {
  const sim = new Simulation(cfg);
  const T = sim.model.tEnd;
  const rng = new RNG(seed);
  while (!sim.done && sim.t < Math.min(p + 0.2, 1) * T) sim.advance(randomChunk(rng, T));
  let i = sim.history.findIndex((f) => f.t >= p * T);
  if (i < 0) i = sim.history.length - 1;
  sim.rewindTo(i);
  expect(sim.history.length).toBe(i + 1);
  return sim;
}

/**
 * Advances to the end with random chunks and applies a random patch of the model's own controls
 * (one or two of them, ×0.7…1.3) at a fraction `prob` of the chunk boundaries.
 */
export function applyRandomControls(sim: Simulation, seed: number, prob: number): Simulation {
  const rng = new RNG(seed);
  const keys = Object.keys(sim.model.getControls());
  let guard = 0;
  while (!sim.done && guard++ < 1e7) {
    if (keys.length && rng.next() < prob) {
      const ctl = sim.model.getControls();
      const patch: Record<string, number> = {};
      for (let k = 0; k < 1 + Math.floor(rng.next() * 2); k++) {
        const key = keys[Math.floor(rng.next() * keys.length)];
        patch[key] = ctl[key] * (0.7 + 0.6 * rng.next());
      }
      sim.applyControl(patch);
    }
    sim.advance(0.1 * randomChunk(rng, sim.model.tEnd) + 0.005 * sim.model.tEnd);
  }
  return sim;
}

/**
 * RNG.getState() returns mulberry32's unreduced accumulator while setState() reduces it modulo
 * 2^32 (both give the same random sequence), so a rewound run stores smaller numbers in
 * frame.internal.rng. Compare modulo 2^32 until rng.ts keeps its state reduced.
 */
export function normalizeRng(r: Run): Run {
  return {
    history: r.history.map((f) => ('rng' in f.internal ? { ...f, internal: { ...f.internal, rng: f.internal.rng >>> 0 } } : f)),
    events: r.events,
  };
}

/** The run without 'warning' events (and without the event counts that include them). */
export function withoutWarnings(r: Run): Run {
  return {
    history: r.history.map((f) => (f.sim ? { ...f, sim: { ...f.sim, nEvents: -1 } } : f)),
    events: r.events.filter((e) => e.kind !== 'warning'),
  };
}

/** Where two runs first differ, or null if bitwise equal. */
export function firstDifference(a: Run, b: Run): string | null {
  const show = (v: unknown) => { const s = v === undefined ? 'undefined' : canonicalString(v); return s.length > 120 ? `${s.slice(0, 120)}…` : s; };
  const n = Math.min(a.history.length, b.history.length);
  for (let i = 0; i < n; i++) {
    const fa = a.history[i] as unknown as Record<string, unknown>, fb = b.history[i] as unknown as Record<string, unknown>;
    if (canonicalString(fa) === canonicalString(fb)) continue;
    for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
      const va = fa[k], vb = fb[k];
      if (canonicalString(va ?? null) === canonicalString(vb ?? null)) continue;
      if (va && vb && typeof va === 'object' && typeof vb === 'object') {
        const oa = va as Record<string, unknown>, ob = vb as Record<string, unknown>;
        for (const kk of new Set([...Object.keys(oa), ...Object.keys(ob)])) {
          if (canonicalString(oa[kk] ?? null) !== canonicalString(ob[kk] ?? null)) return `frame ${i} (t = ${a.history[i].t}): ${k}.${kk} = ${show(oa[kk])} vs ${show(ob[kk])}`;
        }
      }
      return `frame ${i} (t = ${a.history[i].t}): ${k} = ${show(va)} vs ${show(vb)}`;
    }
  }
  if (a.history.length !== b.history.length) return `frame count ${a.history.length} vs ${b.history.length}`;
  const m = Math.min(a.events.length, b.events.length);
  for (let i = 0; i < m; i++) if (canonicalString(a.events[i]) !== canonicalString(b.events[i])) return `event ${i}: ${show(a.events[i])} vs ${show(b.events[i])}`;
  if (a.events.length !== b.events.length) return `event count ${a.events.length} vs ${b.events.length}`;
  return null;
}

/** Asserts that `actual` is bitwise the same run as `ref` (by digest; a mismatch reports the first difference). */
export function expectSameRun(actual: Run, ref: Run, label: string): void {
  if (digestOf(actual) === digestOf(ref)) return;
  expect(firstDifference(actual, ref) ?? 'digests differ', label).toBe(null);
}
