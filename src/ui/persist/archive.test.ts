import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { canonicalString } from '../../physics/kernel/canonical';
import { Simulation } from '../../physics/simulation';
import { TAE } from '../../physics/presets';
import { ShotReport } from '../../physics/types';
import { makeMeta } from '../../worker/host';
import { toUiFrame, UiFrame } from '../../worker/protocol';
import { ArchivedRun, archiveAvailable, ArchiveError, NewRun, RunArchive } from './archive';
import { expandFrames, pickIndices, slimBytes, slimFrames } from './slim';

const fp = (c: string) => c.repeat(64);

/** a small real run, computed once */
const shot = (() => {
  let cached: { meta: ReturnType<typeof makeMeta>; report: ShotReport; frames: UiFrame[]; events: Simulation['events'] } | null = null;
  return () => {
    if (cached) return cached;
    const sim = new Simulation(TAE);
    const report = sim.runAll();
    cached = { meta: makeMeta(sim.model), report, frames: sim.history.map(toUiFrame), events: sim.events };
    return cached;
  };
})();

const newRun = (name: string, extra: Partial<NewRun> = {}): NewRun => {
  const s = shot();
  return { name, appVersion: '4.0.0', cfg: TAE, meta: s.meta, report: s.report, events: s.events, frames: slimFrames(s.frames), ...extra };
};

const open = (over: { maxRuns?: number; now?: () => number } = {}) => {
  let n = 0;
  return RunArchive.open({ factory: new IDBFactory(), newId: () => `id${++n}`, ...over });
};

/** a clock that advances by one millisecond per call: runs saved one after the other have distinct, ordered times */
const ticking = () => { let t = 1_000_000; return () => (t += 1); };

describe('slim frames', () => {
  it('keeps every frame of a short run and round-trips exactly, NaN and Infinity included', () => {
    const frames: UiFrame[] = [
      { t: 0, d: { a: 1, b: NaN } },
      { t: 0.5, d: { a: -0, b: Infinity, c: 3 } },
      { t: 1, d: { a: 1e-300 } },
    ];
    const s = slimFrames(frames);
    expect(s).toMatchObject({ n: 3, sourceCount: 3, keys: ['a', 'b', 'c'] });
    const back = expandFrames(s);
    expect(back.map((f) => f.t)).toEqual([0, 0.5, 1]);
    expect(back[0].d.a).toBe(1);
    expect(Number.isNaN(back[0].d.b)).toBe(true);
    expect(Object.is(back[1].d.a, -0)).toBe(true);
    expect(back[1].d.b).toBe(Infinity);
    expect(Number.isNaN(back[2].d.c)).toBe(true); // a key the frame did not have comes back as NaN
    expect(back[2].d.a).toBe(1e-300);
  });

  it('thins a long run to at most maxFrames, spread evenly, first and last kept, snapshots of the last profile frame attached', () => {
    const frames: UiFrame[] = Array.from({ length: 5000 }, (_, i) => ({ t: i * 0.1, d: { x: i } }));
    frames[4000].prof = { Te: [1, 2, 3] };
    frames[4500].eq = { R: [[1, 2]], Z: [[0, 1]], rho: [0.5], Raxis: 1, Zaxis: 0, q95: 3, li: 1, betaP: 0.5 };
    frames[4500].prof = { Te: [4, 5, 6] };
    const s = slimFrames(frames, { maxFrames: 100 });
    expect(s.n).toBeLessThanOrEqual(102);
    expect(s.sourceCount).toBe(5000);
    const back = expandFrames(s);
    expect(back[0].t).toBe(0);
    expect(back[back.length - 1].t).toBeCloseTo(499.9, 9);
    // strictly increasing times, roughly even spacing
    for (let i = 1; i < back.length; i++) expect(back[i].t).toBeGreaterThan(back[i - 1].t);
    expect(back.filter((f) => f.prof)).toHaveLength(1);
    expect(back.find((f) => f.prof)!.d.x).toBe(4500); // the LAST frame with a profile
    expect(back.find((f) => f.eq)!.d.x).toBe(4500);
    expect(slimBytes(s)).toBeGreaterThan(100 * 16);
    expect(pickIndices(10, 100)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(pickIndices(1000, 5, [999, 3, 5000, -1])).toEqual([0, 3, 250, 500, 749, 999]);
  });

  it('a real run: the archived time series is exact at the kept frames', () => {
    const s = shot();
    const slim = slimFrames(s.frames, { maxFrames: 20 });
    const back = expandFrames(slim);
    expect(back.length).toBeLessThanOrEqual(22);
    const byT = new Map(s.frames.map((f) => [f.t, f]));
    for (const f of back) expect(canonicalString(f.d)).toBe(canonicalString(byT.get(f.t)!.d));
  });
});

describe('the run archive (IndexedDB)', () => {
  it('reports whether IndexedDB exists and refuses to open without it', async () => {
    expect(archiveAvailable(undefined)).toBe(false);
    expect(archiveAvailable(new IDBFactory())).toBe(true);
    // node has no indexedDB of its own here
    expect(archiveAvailable()).toBe(false);
    await expect(RunArchive.open()).rejects.toMatchObject({ name: 'ArchiveError', code: 'unavailable' });
  });

  it('stores a run and reads it back exactly, with a summary that needs none of the heavy data', async () => {
    const a = await open({ now: ticking() });
    const r = newRun('TAE first', { fingerprint: fp('a'), scenario: { schema: 1 }, actuatorLog: [{ t: 0.01, step: 5, patch: { P_NBI_MW: 3 } }], breakpoints: [0.02] });
    const put = await a.put(r);
    expect(put).toEqual({ id: 'id1', added: true, evicted: [] });

    const got = (await a.get('id1')) as ArchivedRun;
    expect(got.name).toBe('TAE first');
    expect(got.method).toBe('frc');
    expect(got.origin).toBe('run');
    expect(got.fingerprint).toBe(fp('a'));
    expect(got.appVersion).toBe('4.0.0');
    expect(got.savedAt).toBe(1_000_001);
    expect(got.termination).toBe(shot().report.termination.reason);
    expect(got.bytes).toBeGreaterThan(1000);
    // the run comes back bit for bit: configuration, meta, report, events, frames, extras
    expect(canonicalString(got.cfg)).toBe(canonicalString(TAE));
    expect(canonicalString(got.report)).toBe(canonicalString(shot().report));
    expect(canonicalString(got.events)).toBe(canonicalString(shot().events));
    expect(canonicalString(got.meta)).toBe(canonicalString(shot().meta));
    expect(canonicalString(expandFrames(got.frames))).toBe(canonicalString(expandFrames(r.frames)));
    expect(got.actuatorLog).toEqual([{ t: 0.01, step: 5, patch: { P_NBI_MW: 3 } }]);
    expect(got.breakpoints).toEqual([0.02]);
    expect(got.scenario).toEqual({ schema: 1 });

    const [summary] = await a.list();
    expect(summary).toMatchObject({ id: 'id1', name: 'TAE first', method: 'frc' });
    expect('frames' in summary).toBe(false);
    expect('cfg' in summary).toBe(false);
    expect(await a.get('nope')).toBeUndefined();
    a.close();
  });

  it('lists newest first, with a limit, and counts', async () => {
    const a = await open({ now: ticking() });
    for (const n of ['one', 'two', 'three']) await a.put(newRun(n));
    expect((await a.list()).map((s) => s.name)).toEqual(['three', 'two', 'one']);
    expect((await a.list({ limit: 2 })).map((s) => s.name)).toEqual(['three', 'two']);
    expect(await a.count()).toBe(3);
    expect(await a.bytes()).toBeGreaterThan(3000);
    a.close();
  });

  it('renames, records a verification, and deletes (summary and data together)', async () => {
    const a = await open({ now: ticking() });
    await a.put(newRun('old name'));
    expect(await a.rename('id1', '  new name  ')).toBe(true);
    expect(await a.rename('id1', '   ')).toBe(true); // a blank name changes nothing
    expect((await a.get('id1'))!.name).toBe('new name');
    expect(await a.rename('id1', 'x'.repeat(500))).toBe(true);
    expect((await a.get('id1'))!.name).toHaveLength(200);
    expect(await a.rename('missing', 'y')).toBe(false);

    expect(await a.setVerification('id1', 'verified')).toBe(true);
    expect((await a.list())[0].verification).toBe('verified');
    expect(await a.setVerification('missing', 'verified')).toBe(false);

    expect(await a.delete('id1')).toBe(true);
    expect(await a.delete('id1')).toBe(false);
    expect(await a.get('id1')).toBeUndefined();
    expect(await a.count()).toBe(0);
    a.close();
  });

  it('clear() empties both stores', async () => {
    const a = await open({ now: ticking() });
    await a.put(newRun('a'));
    await a.put(newRun('b'));
    await a.clear();
    expect(await a.count()).toBe(0);
    expect(await a.get('id1')).toBeUndefined();
    expect(await a.list()).toEqual([]);
    a.close();
  });

  it('an unverified import does not hide the genuine run of the same inputs saved later', async () => {
    const a = await open({ now: ticking() });
    const forged = { ...shot().report, Q_sci_max: 99 };
    await a.put(newRun('imported, edited', { fingerprint: fp('d'), origin: 'import', verification: 'mismatch', report: forged }));
    const genuine = await a.put(newRun('genuine', { fingerprint: fp('d') }));
    expect(genuine.added).toBe(true);
    expect((await a.get(genuine.id))!.report.Q_sci_max).toBe(shot().report.Q_sci_max);
    // a verified import, and a run of this page, do stand for their inputs
    expect((await a.put(newRun('again', { fingerprint: fp('d') }))).added).toBe(false);
    await a.put(newRun('verified import', { fingerprint: fp('e'), origin: 'import', verification: 'verified' }));
    expect((await a.put(newRun('same run', { fingerprint: fp('e') }))).added).toBe(false);
    a.close();
  });

  it('stores a run with a fingerprint once: the same run again is not added', async () => {
    const a = await open({ now: ticking() });
    expect(await a.put(newRun('first', { fingerprint: fp('b') }))).toMatchObject({ id: 'id1', added: true });
    expect(await a.put(newRun('second', { fingerprint: fp('b') }))).toEqual({ id: 'id1', added: false, evicted: [] });
    expect(await a.put(newRun('other', { fingerprint: fp('c') }))).toMatchObject({ id: 'id2', added: true });
    // without a fingerprint nothing can be recognised: every save is a new run
    await a.put(newRun('free 1'));
    await a.put(newRun('free 2'));
    expect(await a.count()).toBe(4);
    expect((await a.byFingerprint(fp('b'))).map((s) => s.name)).toEqual(['first']);
    expect(await a.byFingerprint(fp('z'))).toEqual([]);
    a.close();
  });

  it('keeps at most maxRuns: the oldest go, the run just saved stays', async () => {
    const a = await open({ maxRuns: 3, now: ticking() });
    const ev: string[][] = [];
    for (const n of ['r1', 'r2', 'r3', 'r4', 'r5']) ev.push((await a.put(newRun(n))).evicted);
    expect(ev).toEqual([[], [], [], ['id1'], ['id2']]);
    expect((await a.list()).map((s) => s.name)).toEqual(['r5', 'r4', 'r3']);
    expect(await a.get('id1')).toBeUndefined();
    a.close();
  });

  it('survives closing and reopening the same database', async () => {
    const factory = new IDBFactory();
    const a = await RunArchive.open({ factory, newId: () => 'kept' });
    await a.put(newRun('persisted'));
    a.close();
    const b = await RunArchive.open({ factory });
    expect((await b.get('kept'))!.name).toBe('persisted');
    b.close();
    // another database name is another archive
    const c = await RunArchive.open({ factory, name: 'other' });
    expect(await c.count()).toBe(0);
    c.close();
  });

  it('makes room once when the browser is out of space, then retries', async () => {
    const factory = new IDBFactory();
    let seq = 0;
    const a = await RunArchive.open({ factory, now: ticking(), newId: () => `id${++seq}` });
    for (const n of ['q1', 'q2', 'q3', 'q4']) await a.put(newRun(n));
    // fail the next write of the data store with a quota error, once
    const db = (a as unknown as { db: IDBDatabase }).db;
    const realTx = db.transaction.bind(db);
    let armed = true;
    db.transaction = ((stores: string | string[], mode?: IDBTransactionMode) => {
      const tx = realTx(stores, mode);
      if (armed && mode === 'readwrite' && Array.isArray(stores)) {
        armed = false;
        // abort the transaction with the error a full disk gives
        queueMicrotask(() => { try { tx.abort(); } catch { /* already finished */ } });
        Object.defineProperty(tx, 'error', { get: () => new DOMException('full', 'QuotaExceededError') });
      }
      return tx;
    }) as IDBDatabase['transaction'];
    const r = await a.put(newRun('q5'));
    expect(r.added).toBe(true);
    expect(r.evicted).toEqual(['id1']); // a quarter of the four stored runs: the oldest one
    expect((await a.list()).map((s) => s.name)).toEqual(['q5', 'q4', 'q3', 'q2']);
    a.close();
  });

  it('a write that keeps failing is reported as an ArchiveError, not swallowed', async () => {
    const a = await open({ now: ticking() });
    await a.put(newRun('x'));
    const db = (a as unknown as { db: IDBDatabase }).db;
    const realTx = db.transaction.bind(db);
    db.transaction = ((stores: string | string[], mode?: IDBTransactionMode) => {
      const tx = realTx(stores, mode);
      if (mode === 'readwrite' && Array.isArray(stores)) {
        queueMicrotask(() => { try { tx.abort(); } catch { /* already finished */ } });
        Object.defineProperty(tx, 'error', { get: () => new DOMException('full', 'QuotaExceededError') });
      }
      return tx;
    }) as IDBDatabase['transaction'];
    const err = await a.put(newRun('y')).catch((e) => e);
    expect(err).toBeInstanceOf(ArchiveError);
    expect(err.code).toBe('quota');
    a.close();
  });
});
