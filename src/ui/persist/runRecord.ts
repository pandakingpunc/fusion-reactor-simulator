/**
 * The run file: a completed run as a JSON document that can be imported and verified.
 *
 * It holds everything that DEFINES the run (configuration, seed, the live interventions, breakpoints, scenario, the
 * simulator version), the runFingerprint of those inputs, and the results (the report and the events). Another
 * copy of the simulator can re-run the inputs and compare: if the same fingerprint comes out and the same report,
 * the file is a faithful record of that run (verify.ts). The time series is not in the file: it is what the
 * re-run regenerates.
 *
 * Older exports (`{name, exportedAt, cfg, report, events}`, written before v4.0) are read too; they have no
 * fingerprint, so they can be re-run and compared but not called verified.
 *
 * Numbers JSON has no form for (NaN, ±Infinity, -0) are written in the tagged form of json.ts; a report with none
 * of them is plain JSON.
 */
import { runFingerprint } from '../../physics/kernel/fingerprint';
import type { ActuatorEntry, ReactorConfig, ShotReport, SimEvent } from '../../physics/types';
import { parseJson, stringifyJson } from './json';
import type { RunProvenance } from './types';
import { APP_VERSION } from './version';
import { checkRunInputs, isFingerprint, isPlainObject, LIMITS } from './validate';

export const RUN_RECORD_FORMAT = 'fusion-simulator-run';
export const RUN_RECORD_VERSION = 1;
/** Largest run file read (a report and the events of a long run are a few hundred kB at most). */
export const MAX_RECORD_CHARS = 20_000_000;

export interface RunRecord {
  format: typeof RUN_RECORD_FORMAT;
  formatVersion: typeof RUN_RECORD_VERSION;
  name: string;
  exportedAt: string;
  appVersion: string;
  seed: number;
  cfg: ReactorConfig;
  actuatorLog?: ActuatorEntry[];
  breakpoints?: number[];
  scenario?: unknown;
  /** runFingerprint of the inputs above; absent when the run's live interventions were not recorded */
  fingerprint?: string;
  /** number of live interventions the run received that this file does not carry (then there is no fingerprint) */
  interventionsUnrecorded?: number;
  report: ShotReport;
  events: SimEvent[];
}

/** What a file gives after reading and validation (an older export has no version, seed or fingerprint). */
export interface ParsedRecord {
  name: string;
  exportedAt?: string;
  appVersion?: string;
  cfg: ReactorConfig;
  actuatorLog?: ActuatorEntry[];
  breakpoints?: number[];
  scenario?: unknown;
  fingerprint?: string;
  interventionsUnrecorded?: number;
  report: ShotReport;
  events: SimEvent[];
  /** true for an export written before the run file format existed */
  legacy: boolean;
}

export class RunRecordError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message);
    this.name = 'RunRecordError';
  }
}

export interface FingerprintInputs {
  cfg: ReactorConfig;
  prov?: RunProvenance;
  appVersion?: string;
}

/**
 * The fingerprint of a run from what the page knows, or undefined when the run's inputs are not fully known
 * (it received live interventions whose actuator log is not available, or it had a scenario, which only the
 * simulation worker can fingerprint). A fingerprint the worker computed (`prov.fingerprint`) is used as it is.
 */
export function fingerprintOf({ cfg, prov, appVersion = APP_VERSION }: FingerprintInputs): string | undefined {
  if (prov?.fingerprint) return prov.fingerprint;
  if (prov?.scenario !== undefined && prov.scenario !== null) return undefined;
  if ((prov?.interventions ?? 0) > 0 && !prov?.actuatorLog) return undefined;
  const seed = (cfg as { seed?: number }).seed ?? 0;
  return runFingerprint(cfg, seed, prov?.actuatorLog ?? [], appVersion, prov?.breakpoints);
}

export interface RecordInputs {
  name: string;
  cfg: ReactorConfig;
  report: ShotReport;
  events: SimEvent[];
  prov?: RunProvenance;
  appVersion?: string;
  exportedAt?: Date;
}

export function buildRunRecord(i: RecordInputs): RunRecord {
  const appVersion = i.appVersion ?? APP_VERSION;
  const rec: RunRecord = {
    format: RUN_RECORD_FORMAT, formatVersion: RUN_RECORD_VERSION, name: i.name, exportedAt: (i.exportedAt ?? new Date()).toISOString(),
    appVersion, seed: (i.cfg as { seed?: number }).seed ?? 0, cfg: i.cfg, report: i.report, events: i.events,
  };
  if (i.prov?.actuatorLog?.length) rec.actuatorLog = i.prov.actuatorLog;
  if (i.prov?.breakpoints?.length) rec.breakpoints = i.prov.breakpoints;
  if (i.prov?.scenario !== undefined && i.prov.scenario !== null) rec.scenario = i.prov.scenario;
  const fingerprint = fingerprintOf({ cfg: i.cfg, prov: i.prov, appVersion });
  if (fingerprint) rec.fingerprint = fingerprint;
  else if ((i.prov?.interventions ?? 0) > 0) rec.interventionsUnrecorded = i.prov!.interventions;
  return rec;
}

export const serializeRunRecord = (rec: RunRecord): string => stringifyJson(rec, 2);

const isNum = (x: unknown): x is number => typeof x === 'number';

/** Read and validate a run file (or an older export). Throws RunRecordError with the reasons. */
export function parseRunRecord(text: string): ParsedRecord {
  if (text.length > MAX_RECORD_CHARS) throw new RunRecordError('The file is too large to be a run file.');
  let raw: unknown;
  try {
    raw = parseJson(text);
  } catch {
    throw new RunRecordError('The file is not valid JSON.');
  }
  if (!isPlainObject(raw)) throw new RunRecordError('The file does not hold a run.');
  const issues: string[] = [];
  const legacy = raw.format === undefined;
  if (!legacy) {
    if (raw.format !== RUN_RECORD_FORMAT) throw new RunRecordError(`The file is a '${String(raw.format).slice(0, 40)}' document, not a run file.`);
    if (raw.formatVersion !== RUN_RECORD_VERSION) {
      throw new RunRecordError(`The run file uses format version ${String(raw.formatVersion).slice(0, 10)}; this version of the simulator reads version ${RUN_RECORD_VERSION}.`);
    }
  }
  const inputs = checkRunInputs(raw);
  issues.push(...inputs.errors);

  const report = raw.report;
  if (!isPlainObject(report)) issues.push('report: missing or not an object');
  else {
    const cfg = raw.cfg as { method?: unknown } | undefined;
    if (report.method !== cfg?.method) issues.push('report.method does not match the configuration');
    if (!isNum(report.duration) || !isPlainObject(report.termination)) issues.push('report: not a shot report');
  }
  let events: SimEvent[] = [];
  if (raw.events !== undefined) {
    if (!Array.isArray(raw.events)) issues.push('events: not an array');
    else if (raw.events.length > 100_000) issues.push('events: too many');
    else if (!raw.events.every((e) => isPlainObject(e) && isNum(e.t) && typeof e.kind === 'string' && typeof e.msg === 'string')) issues.push('events: an entry is not an event');
    else events = raw.events as SimEvent[];
  }
  const name = raw.name === undefined ? 'Imported run' : raw.name;
  if (typeof name !== 'string' || name.length > LIMITS.nameChars) issues.push('name: not a text of at most 200 characters');
  if (raw.appVersion !== undefined && (typeof raw.appVersion !== 'string' || raw.appVersion.length > 32)) issues.push('appVersion: not a short text');
  if (raw.fingerprint !== undefined) {
    if (!isFingerprint(raw.fingerprint)) issues.push('fingerprint: not 64 hexadecimal digits');
    else if (typeof raw.appVersion !== 'string') issues.push('fingerprint: given without the simulator version it was computed with');
  }
  if (raw.exportedAt !== undefined && typeof raw.exportedAt !== 'string') issues.push('exportedAt: not a text');
  if (raw.interventionsUnrecorded !== undefined && !(Number.isInteger(raw.interventionsUnrecorded) && (raw.interventionsUnrecorded as number) > 0)) issues.push('interventionsUnrecorded: not a positive integer');
  if (issues.length) throw new RunRecordError(`The run file is not valid: ${issues[0]}`, issues);

  const rec: ParsedRecord = { name: name as string, cfg: raw.cfg as ReactorConfig, report: report as unknown as ShotReport, events, legacy };
  if (typeof raw.exportedAt === 'string') rec.exportedAt = raw.exportedAt;
  if (typeof raw.appVersion === 'string') rec.appVersion = raw.appVersion;
  if (Array.isArray(raw.actuatorLog)) rec.actuatorLog = raw.actuatorLog as ActuatorEntry[];
  if (Array.isArray(raw.breakpoints)) rec.breakpoints = raw.breakpoints as number[];
  if (raw.scenario !== undefined && raw.scenario !== null) rec.scenario = raw.scenario;
  if (typeof raw.fingerprint === 'string') rec.fingerprint = raw.fingerprint;
  if (typeof raw.interventionsUnrecorded === 'number') rec.interventionsUnrecorded = raw.interventionsUnrecorded;
  return rec;
}
