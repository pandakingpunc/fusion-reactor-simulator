/**
 * The browser archive: completed runs kept in IndexedDB, so that a closed tab does not lose them.
 *
 * Two object stores in one database:
 *  - `runs`  one small summary per run (name, method, headline numbers, fingerprint ...): the list reads only
 *            these, newest first, through the `savedAt` index, without touching the heavy data;
 *  - `data`  the run itself: configuration, meta, report, events, the thinned time series (slim.ts) and, when
 *            known, the actuator log / breakpoints / scenario that reproduce it.
 * Both are written and deleted in one transaction, so a summary never points at nothing.
 *
 * A run with a fingerprint is stored once: saving the same run again (the simulation is deterministic, so the
 * same inputs are the same run) keeps the first copy. The archive holds at most `maxRuns` runs (default 40);
 * saving beyond that removes the oldest, and a browser that refuses a write for lack of space has the oldest
 * quarter removed once before the write is retried. A page without IndexedDB (some private windows) gets an
 * ArchiveError('unavailable'); the application then simply works without an archive.
 *
 * Everything stays in this browser profile: nothing is sent anywhere.
 */
import type { ActuatorEntry, Method, ReactorConfig, ShotReport, SimEvent } from '../../physics/types';
import type { SimMeta } from '../../worker/protocol';
import { SlimFrames, slimBytes } from './slim';
import type { VerifyStatus } from './types';

export const ARCHIVE_DB = 'fusion-sim-archive';
export const ARCHIVE_SCHEMA = 1;
export const DEFAULT_MAX_RUNS = 40;
const RUNS = 'runs';
const DATA = 'data';

export type ArchiveErrorCode = 'unavailable' | 'quota' | 'blocked' | 'failed';
export class ArchiveError extends Error {
  constructor(readonly code: ArchiveErrorCode, message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'ArchiveError';
  }
}

/** What the archive list shows of a run. */
export interface RunSummary {
  id: string;
  /** milliseconds since the epoch */
  savedAt: number;
  name: string;
  method: Method;
  /** simulator version that produced the run */
  appVersion: string;
  /** runFingerprint of the run's inputs, when they are fully known */
  fingerprint?: string;
  /** where the run came from: this page ('run') or an imported file ('import') */
  origin: 'run' | 'import';
  /** for an imported run: the outcome of re-simulating it */
  verification?: VerifyStatus;
  duration: number;
  timeUnit: string;
  Q_sci_max: number;
  E_fusion_MJ: number;
  score: number;
  termination: string;
  /** approximate size of the stored run in bytes */
  bytes: number;
}

/** The run itself. */
export interface RunData {
  cfg: ReactorConfig;
  meta: SimMeta;
  report: ShotReport;
  events: SimEvent[];
  frames: SlimFrames;
  actuatorLog?: ActuatorEntry[];
  breakpoints?: number[];
  scenario?: unknown;
}

export type ArchivedRun = RunSummary & RunData;

/** A run to save: its data, and the summary fields that cannot be derived from it. */
export type NewRun = RunData & { name: string; appVersion: string; origin?: 'run' | 'import'; verification?: VerifyStatus; fingerprint?: string };

export interface PutResult {
  id: string;
  /** false when the run was already stored (same fingerprint); `id` is then the existing one */
  added: boolean;
  /** ids of the runs removed to stay within `maxRuns` or to make room */
  evicted: string[];
}

export interface OpenOptions {
  /** an IDBFactory (tests pass fake-indexeddb's); default: the page's indexedDB */
  factory?: IDBFactory;
  name?: string;
  maxRuns?: number;
  /** id and clock, injectable for tests */
  newId?: () => string;
  now?: () => number;
}

/** Whether this environment has IndexedDB at all. */
export function archiveAvailable(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): boolean {
  return !!factory;
}

const defaultId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

const isQuota = (e: unknown) => !!e && typeof e === 'object' && (e as { name?: string }).name === 'QuotaExceededError';

function toError(e: unknown): ArchiveError {
  if (e instanceof ArchiveError) return e;
  if (isQuota(e)) return new ArchiveError('quota', 'The browser has no room left for the archive.', e);
  return new ArchiveError('failed', e instanceof Error ? e.message : String(e), e);
}

function summarize(id: string, savedAt: number, run: NewRun): RunSummary {
  const r = run.report;
  const s: RunSummary = {
    id, savedAt, name: run.name, method: run.cfg.method, appVersion: run.appVersion, origin: run.origin ?? 'run',
    duration: r.duration, timeUnit: r.timeUnit, Q_sci_max: r.Q_sci_max, E_fusion_MJ: r.E_fusion_MJ, score: r.score,
    termination: r.termination.reason, bytes: 0,
  };
  if (run.fingerprint) s.fingerprint = run.fingerprint;
  if (run.verification) s.verification = run.verification;
  // the report, events and configuration are small next to the frames; their JSON length is a good enough size
  s.bytes = slimBytes(run.frames) + JSON.stringify(r).length + JSON.stringify(run.events).length + JSON.stringify(run.cfg).length;
  return s;
}

export class RunArchive {
  private constructor(private readonly db: IDBDatabase, readonly maxRuns: number, private readonly newId: () => string, private readonly now: () => number) {}

  /** Open (creating it on first use) the archive database. Rejects with ArchiveError. */
  static async open(opts: OpenOptions = {}): Promise<RunArchive> {
    const factory = opts.factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
    if (!factory) throw new ArchiveError('unavailable', 'This browser does not offer IndexedDB (a private window?): runs cannot be archived.');
    let db: IDBDatabase;
    try {
      db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = factory.open(opts.name ?? ARCHIVE_DB, ARCHIVE_SCHEMA);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(RUNS)) {
            const runs = d.createObjectStore(RUNS, { keyPath: 'id' });
            runs.createIndex('savedAt', 'savedAt');
            runs.createIndex('fingerprint', 'fingerprint');
          }
          if (!d.objectStoreNames.contains(DATA)) d.createObjectStore(DATA, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('cannot open the archive'));
        req.onblocked = () => reject(new ArchiveError('blocked', 'The archive is open in another tab that must be closed first.'));
      });
    } catch (e) {
      throw toError(e);
    }
    // another tab upgrading the schema must not be blocked by this one
    db.onversionchange = () => db.close();
    return new RunArchive(db, opts.maxRuns ?? DEFAULT_MAX_RUNS, opts.newId ?? defaultId, opts.now ?? Date.now);
  }

  close(): void { this.db.close(); }

  /** Save a run. Rejects with ArchiveError('quota') when the browser has no room even after the oldest quarter was removed. */
  async put(run: NewRun): Promise<PutResult> {
    try {
      return await this.putOnce(run);
    } catch (e) {
      if (!isQuota(e)) throw toError(e);
    }
    // the browser is out of space: drop the oldest quarter of the archive, then retry once
    try {
      const dropped = await this.evictOldest(Math.max(1, Math.ceil((await this.count()) / 4)));
      const r = await this.putOnce(run);
      return { ...r, evicted: [...dropped, ...r.evicted] };
    } catch (e) {
      throw toError(e);
    }
  }

  private async putOnce(run: NewRun): Promise<PutResult> {
    if (run.fingerprint) {
      const same = await this.byFingerprint(run.fingerprint);
      if (same.length) return { id: same[0].id, added: false, evicted: [] };
    }
    const id = this.newId();
    const summary = summarize(id, this.now(), run);
    const data: RunData & { id: string } = {
      id, cfg: run.cfg, meta: run.meta, report: run.report, events: run.events, frames: run.frames,
      ...(run.actuatorLog ? { actuatorLog: run.actuatorLog } : {}),
      ...(run.breakpoints ? { breakpoints: run.breakpoints } : {}),
      ...(run.scenario !== undefined ? { scenario: run.scenario } : {}),
    };
    const tx = this.db.transaction([RUNS, DATA], 'readwrite');
    const done = finished(tx);
    tx.objectStore(RUNS).put(summary);
    tx.objectStore(DATA).put(data);
    await done;
    const evicted = await this.trim(id);
    return { id, added: true, evicted };
  }

  /** Remove the oldest runs beyond `maxRuns`; the run `keep` is never removed. */
  private async trim(keep: string): Promise<string[]> {
    const all = await this.list();
    const excess = all.length - this.maxRuns;
    if (excess <= 0) return [];
    const victims = all.filter((r) => r.id !== keep).slice(-excess).map((r) => r.id);
    await this.deleteMany(victims);
    return victims;
  }

  private async evictOldest(k: number): Promise<string[]> {
    const victims = (await this.list()).slice(-k).map((r) => r.id);
    await this.deleteMany(victims);
    return victims;
  }

  /** Summaries, newest first. */
  async list(opts: { limit?: number } = {}): Promise<RunSummary[]> {
    const tx = this.db.transaction(RUNS, 'readonly');
    const out: RunSummary[] = [];
    const limit = opts.limit ?? Infinity;
    await new Promise<void>((resolve, reject) => {
      const cur = tx.objectStore(RUNS).index('savedAt').openCursor(null, 'prev');
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || out.length >= limit) { resolve(); return; }
        out.push(c.value as RunSummary);
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
    return out;
  }

  async count(): Promise<number> {
    return request(this.db.transaction(RUNS, 'readonly').objectStore(RUNS).count());
  }

  /** The run with its data, or undefined. */
  async get(id: string): Promise<ArchivedRun | undefined> {
    const tx = this.db.transaction([RUNS, DATA], 'readonly');
    const [summary, data] = await Promise.all([
      request(tx.objectStore(RUNS).get(id) as IDBRequest<RunSummary | undefined>),
      request(tx.objectStore(DATA).get(id) as IDBRequest<(RunData & { id: string }) | undefined>),
    ]);
    if (!summary || !data) return undefined;
    const { id: _id, ...rest } = data;
    void _id;
    return { ...summary, ...rest };
  }

  /** Summaries of the runs stored under a fingerprint (newest first). */
  async byFingerprint(fingerprint: string): Promise<RunSummary[]> {
    const rows = await request(this.db.transaction(RUNS, 'readonly').objectStore(RUNS).index('fingerprint').getAll(fingerprint) as IDBRequest<RunSummary[]>);
    return rows.sort((a, b) => b.savedAt - a.savedAt);
  }

  /**
   * Rewrite a run's summary inside one transaction: the record is read and written back from the read's own
   * callback, so the transaction is certainly still active. False when there is no such run.
   */
  private async updateSummary(id: string, change: (s: RunSummary) => RunSummary): Promise<boolean> {
    const tx = this.db.transaction(RUNS, 'readwrite');
    const done = finished(tx);
    const store = tx.objectStore(RUNS);
    let found = false;
    const get = store.get(id) as IDBRequest<RunSummary | undefined>;
    get.onsuccess = () => {
      const s = get.result;
      if (!s) return;
      found = true;
      store.put(change(s));
    };
    await done;
    return found;
  }

  /** Change a run's name (trimmed, at most 200 characters; a blank name is ignored). False when there is no such run. */
  rename(id: string, name: string): Promise<boolean> {
    const n = name.trim().slice(0, 200);
    return this.updateSummary(id, (s) => ({ ...s, name: n || s.name }));
  }

  /** Record how an imported run verified (or change it). False when there is no such run. */
  setVerification(id: string, verification: VerifyStatus): Promise<boolean> {
    return this.updateSummary(id, (s) => ({ ...s, verification }));
  }

  /** Delete a run; false when there was none. */
  async delete(id: string): Promise<boolean> {
    return (await this.deleteMany([id])) > 0;
  }

  private async deleteMany(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const tx = this.db.transaction([RUNS, DATA], 'readwrite');
    const done = finished(tx);
    const runs = tx.objectStore(RUNS);
    const data = tx.objectStore(DATA);
    let n = 0;
    for (const id of ids) {
      // requests of one transaction run in order: the count sees the row before the delete removes it
      const c = runs.count(id);
      c.onsuccess = () => { n += c.result; };
      runs.delete(id);
      data.delete(id);
    }
    await done;
    return n;
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction([RUNS, DATA], 'readwrite');
    const done = finished(tx);
    tx.objectStore(RUNS).clear();
    tx.objectStore(DATA).clear();
    await done;
  }

  /** Approximate bytes held by all runs. */
  async bytes(): Promise<number> {
    return (await this.list()).reduce((a, r) => a + r.bytes, 0);
  }
}
