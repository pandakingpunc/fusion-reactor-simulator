/**
 * The checkpoint contract of the 1.5D model (checkpoint.ts): record keys unique over all parts and
 * numeric, restore tolerant of missing keys and of a record without aux.
 */
import { describe, expect, it } from 'vitest';
import { JET_15D } from '../presets';
import { CheckpointContractError, CheckpointStore } from './checkpoint';
import type { Checkpointable, CheckpointAux, CheckpointRecord } from './checkpoint';
import { ElmEvents } from './events/elm';
import { SawtoothEvents } from './events/sawtooth';
import { ProfileModel } from './model';
import { defaultSources } from './sources';
import type { SourceModel } from './sources';

const part = (keys: Record<string, unknown>, aux: CheckpointAux = {}): Partial<Checkpointable> => ({
  save(rec, a) { Object.assign(rec, keys); Object.assign(a, aux); },
  restore() { /* nothing to restore */ },
});

describe('CheckpointStore.save', () => {
  it('collects the numbers of every part into one record and the references into a store entry restored by ck', () => {
    const store = new CheckpointStore();
    const restored: unknown[] = [];
    const p: Partial<Checkpointable> = { save: (r, a) => { r.a = 1; a.list = [1, 2]; }, restore: (r, a) => { restored.push([r.a, a?.list]); } };
    const rec = store.save([p, part({ b: 2, c: NaN })]);
    expect(Object.keys(rec)).toEqual(['ck', 'a', 'b', 'c']);
    expect(rec.ck).toBe(0);
    expect(store.save([p]).ck).toBe(1);
    store.restore(rec, [p]);
    expect(restored).toEqual([[1, [1, 2]]]);
  });

  it('a key written by two parts is an error naming both, not an overwrite', () => {
    const store = new CheckpointStore();
    const clock: SourceModel = { id: 'clock', save: (r) => { r.dt = 123; } };
    expect(() => store.save([part({ dt: 1e-3 }), clock])).toThrow(CheckpointContractError);
    expect(() => store.save([part({ dt: 1e-3 }), clock])).toThrow(/'dt' is written by part 0 and by 'clock'/);
  });

  it('the record key ck is reserved for the store', () => {
    const store = new CheckpointStore();
    expect(() => store.save([part({ ck: 5 })])).toThrow(/'ck' is written by the checkpoint store and by part 0/);
  });

  it('a record value that is not a number is an error (strings and references belong in aux)', () => {
    const store = new CheckpointStore();
    expect(() => store.save([part({ label: 'x' })])).toThrow(/'label' of part 0 is not a number \(string\)/);
    expect(() => store.save([part({ gone: undefined })])).toThrow(/is not a number \(undefined\)/);
  });

  it('aux keys are unique over the parts as well', () => {
    const store = new CheckpointStore();
    expect(() => store.save([part({}, { geo: 1 }), part({}, { geo: 2 })])).toThrow(/aux key 'geo' is written by part 0 and by part 1/);
  });

  it('a failed save does not consume a checkpoint number or leave an entry behind', () => {
    const store = new CheckpointStore();
    expect(store.save([part({ a: 1 })]).ck).toBe(0);
    expect(() => store.save([part({ a: 1 }), part({ a: 2 })])).toThrow(CheckpointContractError);
    expect(store.save([part({ a: 1 })]).ck).toBe(1);
  });

  it('names a class instance by its class', () => {
    class Clock implements Partial<Checkpointable> { save(r: CheckpointRecord) { r.rng = 1; } }
    expect(() => new CheckpointStore().save([part({ rng: 0 }), new Clock()])).toThrow(/by part 0 and by Clock/);
  });
});

describe('a plug-in that reuses a core key', () => {
  it('is caught when the model saves its checkpoint, before it can corrupt a rewind', () => {
    const clobber: SourceModel = { id: 'clobber', save: (r) => { r.dt = 123; } };
    const m = new ProfileModel({ ...JET_15D, t_end: 0.2 }, { sources: [...defaultSources(), clobber] });
    m.diagnostics(0, m.initialState());
    expect(() => m.saveInternal()).toThrow(/checkpoint record key 'dt' is written by part \d+ and by 'clobber'/);
  });

  it('a plug-in with prefixed keys round-trips through saveInternal and restoreInternal', () => {
    let n = 0;
    const counter: SourceModel = { id: 'counter', accepted: () => { n++; }, save: (r) => { r.counter_n = n; }, restore: (r) => { n = r.counter_n; } };
    const m = new ProfileModel({ ...JET_15D, t_end: 0.3 }, { sources: [...defaultSources(), counter] });
    const y = m.initialState();
    m.diagnostics(0, y);
    let t = 0;
    while (t < 0.1) { const t0 = t; t = m.step(t, y, 0.3); m.postStep(t, t - t0, y); }
    const rec = m.saveInternal();
    expect(rec.counter_n).toBe(n);
    const nAt = n;
    while (t < 0.2) { const t0 = t; t = m.step(t, y, 0.3); m.postStep(t, t - t0, y); }
    expect(n).toBeGreaterThan(nAt);
    m.restoreInternal(rec);
    expect(n).toBe(nAt);
  }, 60000);
});

describe('restore accepts a record with missing keys and no aux', () => {
  it('ELM and sawtooth timers default to "long ago" instead of undefined (which would block every later crash)', () => {
    const elm = new ElmEvents(), saw = new SawtoothEvents();
    elm.restore({}, undefined);
    saw.restore({});
    expect((elm as unknown as { lastElm: number }).lastElm).toBe(-1e9);
    expect((saw as unknown as { lastSaw: number }).lastSaw).toBe(-1e9);
    expect(elm.frequency()).toBe(0);
    elm.restore({ lastElm: 3 }, { elmTimes: [1, 2, 3] });
    expect((elm as unknown as { lastElm: number }).lastElm).toBe(3);
    expect(elm.frequency()).toBe(1);
  });

  it('the whole model restores from a record that holds nothing but ck, keeping the random stream', () => {
    const m = new ProfileModel({ ...JET_15D, t_end: 0.2 });
    const y = m.initialState();
    m.diagnostics(0, y);
    const rng = m.ctx.rng.getState();
    expect(() => m.restoreInternal({ ck: 12345 })).not.toThrow();
    expect(m.ctx.rng.getState()).toBe(rng);
    expect(m.ctx.phase).toBe('normal');
    expect(m.ctx.hmode).toBe(false);
    expect(m.ctx.dt).toBe(1e-3);
  });
});
