/**
 * Conversions between the UI's shots (SavedShot), the browser archive (ArchivedRun) and the run file (RunRecord).
 */
import type { ShotReport } from '../../physics/types';
import type { SavedShot } from '../state/types';
import type { ArchivedRun, NewRun } from './archive';
import { buildRunRecord, fingerprintOf, ParsedRecord, RunRecord } from './runRecord';
import { expandFrames, slimFrames } from './slim';
import type { ReplayResult } from './replayCore';
import type { VerifyStatus } from './types';
import { APP_VERSION } from './version';

type NewShot = Omit<SavedShot, 'id'>;

/** A completed shot as an archive record. The fingerprint is the run's when its inputs are fully known. */
export function shotToNewRun(shot: Pick<SavedShot, 'name' | 'cfg' | 'meta' | 'report' | 'events' | 'frames' | 'prov' | 'verification'>, opts: { origin?: 'run' | 'import'; appVersion?: string; fingerprint?: string } = {}): NewRun {
  const appVersion = opts.appVersion ?? APP_VERSION;
  const prov = shot.prov;
  const run: NewRun = {
    name: shot.name, appVersion, cfg: shot.cfg, meta: shot.meta, report: shot.report, events: shot.events, frames: slimFrames(shot.frames),
    origin: opts.origin ?? 'run', interventions: prov?.interventions ?? 0,
  };
  const fingerprint = opts.fingerprint ?? fingerprintOf({ cfg: shot.cfg, prov, appVersion });
  if (fingerprint) run.fingerprint = fingerprint;
  if (shot.verification) run.verification = shot.verification;
  if (prov?.actuatorLog?.length) run.actuatorLog = prov.actuatorLog;
  if (prov?.breakpoints?.length) run.breakpoints = prov.breakpoints;
  if (prov?.scenario !== undefined && prov.scenario !== null) run.scenario = prov.scenario;
  return run;
}

/** An archived run as a shot for the Report and the comparison (frames expanded; opening it twice shows the same shot). */
export function runToShot(run: ArchivedRun): NewShot {
  const interventions = run.interventions ?? run.actuatorLog?.length ?? 0;
  const shot: NewShot = {
    name: run.name, cfg: run.cfg, meta: run.meta, report: run.report, events: run.events, frames: expandFrames(run.frames),
    archiveId: run.id, sourceKey: `archive:${run.id}`,
    prov: {
      interventions, ...(run.actuatorLog ? { actuatorLog: run.actuatorLog } : {}), ...(run.breakpoints ? { breakpoints: run.breakpoints } : {}),
      ...(run.scenario !== undefined ? { scenario: run.scenario } : {}), ...(run.fingerprint ? { fingerprint: run.fingerprint } : {}),
    },
  };
  if (run.verification) shot.verification = run.verification;
  return shot;
}

/** An archived run as a run file (the fingerprint it was stored with is kept, so the file verifies as the run did). */
export function runToRecord(run: ArchivedRun): RunRecord {
  return buildRunRecord({
    name: run.name, cfg: run.cfg, report: run.report, events: run.events, appVersion: run.appVersion,
    prov: {
      interventions: run.interventions ?? run.actuatorLog?.length ?? 0, actuatorLog: run.actuatorLog, breakpoints: run.breakpoints,
      scenario: run.scenario, fingerprint: run.fingerprint,
    },
  });
}

/** A verified import as a shot: the report and events are the file's, the frames come from the re-run. */
export function importedShot(rec: ParsedRecord, result: ReplayResult, status: VerifyStatus, key: string): NewShot {
  const prov = {
    interventions: rec.actuatorLog?.length ?? rec.interventionsUnrecorded ?? 0,
    ...(rec.actuatorLog ? { actuatorLog: rec.actuatorLog } : {}), ...(rec.breakpoints ? { breakpoints: rec.breakpoints } : {}),
    ...(rec.scenario !== undefined ? { scenario: rec.scenario } : {}), ...(rec.fingerprint ? { fingerprint: rec.fingerprint } : {}),
  };
  return {
    name: rec.name, cfg: rec.cfg, meta: result.meta, report: rec.report as ShotReport, events: rec.events, frames: result.frames ?? [],
    sourceKey: key, verification: status, prov,
  };
}
