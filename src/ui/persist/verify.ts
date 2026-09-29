/**
 * Verified reproduction: does a run file describe a run this simulator reproduces?
 *
 * The file's inputs are re-run (replay.ts, off the main thread). Two things are compared:
 *  - the FINGERPRINT: the runFingerprint of the re-run's inputs (computed with the version the file names) must be
 *    the fingerprint the file claims: the inputs were not edited after export;
 *  - the RESULT: the re-run's ShotReport AND event list must be the file's, number for number (canonical form: NaN
 *    equals NaN, -0 differs from 0, key order does not matter). The events are part of what the Report and the
 *    comparison show, so a file whose events were edited is not a faithful record either.
 * Both agreeing, on the simulator version that wrote the file, is 'verified'. The other outcomes and what they mean
 * are in VerifyStatus (types.ts); each is a definite statement, none is a guess.
 */
import { canonicalString } from '../../physics/kernel/canonical';
import type { ShotReport } from '../../physics/types';
import type { ParsedRecord } from './runRecord';
import type { ReplayFn, ReplayOptions } from './replay';
import type { ReplayResult } from './replayCore';
import type { VerifyStatus } from './types';
import { APP_VERSION } from './version';

export interface VerifyReport {
  status: VerifyStatus;
  /** the fingerprint the file claims, and the one the re-run computed from the file's inputs */
  fingerprint: { claimed?: string; computed: string };
  /** true/false: the file's inputs do / do not hash to its fingerprint; null: the file has no fingerprint */
  inputsIntact: boolean | null;
  /** the version that wrote the file (absent in an older export) and the one running now */
  versions: { file?: string; current: string };
  /** the re-run's result equals the file's: the report and the events */
  reportMatch: boolean;
  /** the events alone (true when the file's events are the re-run's) */
  eventsMatch: boolean;
  /** paths of the report fields that differ (at most 8), and 'events' when the event lists differ */
  differences: string[];
}

export interface Verified {
  verify: VerifyReport;
  /** the re-run: its report, meta, events and (for display) frames */
  result: ReplayResult;
}

/** Paths at which two values differ (canonically), at most `max`. */
export function diffPaths(a: unknown, b: unknown, max = 8, path = ''): string[] {
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, p: string): void => {
    if (out.length >= max || canonicalString(x) === canonicalString(y)) return;
    const objX = x !== null && typeof x === 'object';
    const objY = y !== null && typeof y === 'object';
    if (objX && objY && Array.isArray(x) === Array.isArray(y)) {
      const kx = Object.keys(x as object);
      const ky = Object.keys(y as object);
      const keys = [...new Set([...kx, ...ky])].sort();
      for (const k of keys) walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], p ? `${p}.${k}` : k);
      return;
    }
    out.push(p || '(root)');
  };
  walk(a, b, path);
  return out;
}

export function classify(rec: Pick<ParsedRecord, 'fingerprint' | 'appVersion'>, computed: string, reportMatch: boolean, current: string): { status: VerifyStatus; inputsIntact: boolean | null } {
  if (rec.fingerprint === undefined) return { status: 'unsigned', inputsIntact: null };
  const inputsIntact = computed === rec.fingerprint;
  if (!inputsIntact) return { status: 'tampered', inputsIntact };
  if (rec.appVersion !== current) return { status: 'other-version', inputsIntact };
  return { status: reportMatch ? 'verified' : 'mismatch', inputsIntact };
}

/**
 * Re-run a parsed run file and compare. Rejects when the re-run itself cannot be done (an invalid configuration,
 * a scenario this build cannot run, an aborted replay); a result that differs from the file's is a VerifyReport, not an error.
 */
export async function verifyRecord(rec: ParsedRecord, replay: ReplayFn, opts: ReplayOptions & { currentVersion?: string } = {}): Promise<Verified> {
  const current = opts.currentVersion ?? APP_VERSION;
  const result = await replay(
    { cfg: rec.cfg, actuatorLog: rec.actuatorLog, breakpoints: rec.breakpoints, scenario: rec.scenario, appVersion: rec.appVersion ?? current, keepFrames: true },
    { onProgress: opts.onProgress, signal: opts.signal },
  );
  const reportOnly = canonicalString(result.report) === canonicalString(rec.report);
  const eventsMatch = canonicalString(result.events) === canonicalString(rec.events);
  const reportMatch = reportOnly && eventsMatch;
  const { status, inputsIntact } = classify(rec, result.fingerprint, reportMatch, current);
  const verify: VerifyReport = {
    status,
    fingerprint: { claimed: rec.fingerprint, computed: result.fingerprint },
    inputsIntact,
    versions: { file: rec.appVersion, current },
    reportMatch,
    eventsMatch,
    differences: [...(reportOnly ? [] : diffPaths(result.report as ShotReport, rec.report)), ...(eventsMatch ? [] : ['events'])],
  };
  return { verify, result };
}
