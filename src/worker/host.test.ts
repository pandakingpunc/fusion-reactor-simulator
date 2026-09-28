/// <reference types="node" />
import v8 from 'node:v8';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../physics/simulation';
import { ITER, ITER_15D, MIRROR, NIF, TAE } from '../physics/presets';
import { ReactorConfig } from '../physics/types';
import { createSimHost } from './host';
import { FromWorker, PROTOCOL_VERSION, ToWorker, toUiFrame } from './protocol';

function harness() {
  const out: FromWorker[] = [];
  const host = createSimHost((m) => out.push(m));
  const take = () => out.splice(0, out.length);
  const init = (cfg: ReactorConfig, id = 7) => host.handle({ type: 'init', protocolVersion: PROTOCOL_VERSION, id, cfg });
  return { host, out, take, init };
}
const ofType = <K extends FromWorker['type']>(ms: FromWorker[], type: K) => ms.filter((m): m is Extract<FromWorker, { type: K }> => m.type === type);

describe('simulation worker host (protocol v2)', () => {
  it('answers init with a versioned ready message whose frame carries no rewind state', () => {
    const h = harness();
    h.init(TAE);
    const [ready] = h.take();
    expect(ready.type).toBe('ready');
    if (ready.type !== 'ready') return;
    expect(ready.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(ready.id).toBe(7);
    expect(ready.meta.controls).toEqual({ P_NBI_MW: 13, kappa_conf: 10 });
    expect(Object.keys(ready.frame).sort()).toEqual(['d', 't']);
  });

  it('tags frames with the run id and the timeline branch, and switches branch on rewind', () => {
    const h = harness();
    h.init(TAE);
    h.take();
    h.host.handle({ type: 'step', simDt: TAE.t_end / 4 });
    const [frames] = ofType(h.take(), 'frames');
    expect(frames).toMatchObject({ id: 7, branchId: 0, done: false });
    expect(frames.frames.length).toBeGreaterThan(3);
    for (const f of frames.frames) expect('y' in f || 'internal' in f).toBe(false);

    h.host.handle({ type: 'rewind', index: 2, branchId: 1 });
    const [rewound] = h.take();
    expect(rewound).toMatchObject({ type: 'rewound', id: 7, branchId: 1, index: 2 });

    h.host.handle({ type: 'step', simDt: TAE.t_end });
    const after = h.take();
    expect(ofType(after, 'frames').every((m) => m.branchId === 1)).toBe(true);
    expect(ofType(after, 'done')).toHaveLength(1);
    expect(ofType(after, 'done')[0]).toMatchObject({ id: 7, branchId: 1 });
  });

  it('clamps rewind indices to the recorded history', () => {
    const h = harness();
    h.init(TAE);
    h.host.handle({ type: 'step', simDt: TAE.t_end / 10 });
    h.take();
    h.host.handle({ type: 'rewind', index: -5, branchId: 1 });
    expect(h.take()[0]).toMatchObject({ type: 'rewound', index: 0, t: 0 });
    h.host.handle({ type: 'rewind', index: 1e9, branchId: 2 });
    expect(h.take()[0]).toMatchObject({ type: 'rewound', index: 0, branchId: 2 });
  });

  it('refuses a page that speaks another protocol version', () => {
    const h = harness();
    h.host.handle({ type: 'init', protocolVersion: 1, id: 3, cfg: TAE } as ToWorker);
    const [err] = h.take();
    expect(err).toMatchObject({ type: 'error', id: 3 });
    if (err.type === 'error') expect(err.msg).toMatch(/protocol mismatch/i);
  });

  it('reports progress during a background full run and returns the same report as Simulation.runAll', () => {
    const h = harness();
    h.host.handle({ type: 'runAll', protocolVersion: PROTOCOL_VERSION, id: 11, cfg: MIRROR, keepFrames: true, progress: true });
    const ms = h.take();
    const progress = ofType(ms, 'progress');
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((p) => p.id === 11 && p.tEnd === MIRROR.t_end && p.t > 0)).toBe(true);
    const [done] = ofType(ms, 'runAllDone');
    expect(done.protocolVersion).toBe(PROTOCOL_VERSION);
    const ref = new Simulation(MIRROR);
    expect(done.report).toEqual(ref.runAll());
    expect(done.frames).toHaveLength(ref.history.length);
  });
});

describe('UiFrame payload', () => {
  /** structured-clone size, the cost of postMessage */
  const bytes = (x: unknown) => v8.serialize(x).length;

  function history(cfg: ReactorConfig, chunks: number) {
    const s = new Simulation(cfg);
    for (let i = 0; i < chunks && !s.done; i++) s.advance(s.model.tEnd / 100);
    return s.history;
  }

  // Measured on the first 20 % of every preset (v8 structured clone): 0D magnetic -33 %, pulsed -25…-31 %,
  // 1.5D -16…-42 % (the radial profiles, which the UI needs, dominate those frames); all presets together -30 %.
  it('drops the rewind-only state: 0D and pulsed frames shrink by more than a quarter', () => {
    const cases = [
      { name: 'ITER 0D', h: history(ITER, 5), min: 0.3 },
      { name: 'NIF', h: history(NIF, 100), min: 0.28 },
      { name: 'TAE FRC', h: history(TAE, 100), min: 0.22 },
      { name: 'ITER 1.5D', h: history(ITER_15D, 2), min: 0.1 },
    ];
    let full = 0, ui = 0;
    for (const c of cases) {
      const a = bytes(c.h), b = bytes(c.h.map(toUiFrame));
      expect(1 - b / a, c.name).toBeGreaterThan(c.min);
      if (c.name !== 'ITER 1.5D') { full += a; ui += b; }
    }
    expect(1 - ui / full).toBeGreaterThan(0.25);
  });
});
