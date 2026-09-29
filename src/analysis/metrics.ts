/**
 * Scalar outputs of one simulated shot, for the UQ ensembles: what a study reports quantiles, probabilities and
 * sensitivity indices of. They are computed from the run's history, events and report with the project's flat-top
 * definition (flatTopMean: mean over the last 30 % of the frames, the same as the shot report, the validation table and
 * the golden harness), so they agree with the numbers everywhere else.
 *
 *  performance metrics (meaningful for a shot that ran to its scheduled end):
 *    Q_flat          flat-top mean of the scientific gain Q = P_fus / P_in
 *    Q_max           maximum of Q over the shot (ShotReport.Q_sci_max)
 *    Pfus_flat_MW    flat-top mean of the fusion power [MW]
 *    Pfus_max_MW     maximum of the fusion power [MW]
 *    E_fusion_MJ     fusion energy released [MJ]
 *    Q_eng           engineering gain of the shot report
 *    tauE_flat_s     flat-top mean of the energy confinement time [s]
 *  operating-point metrics (limit proximity; meaningful for every shot):
 *    nG_flat, nG_max          flat-top mean and maximum of n_bar / n_Greenwald (the diagnostic nG_frac)
 *    betaN_flat, betaN_max    flat-top mean and maximum of the normalised beta
 *  flags:
 *    disrupted       1 if the shot had a disruption event
 *    completed       1 if it ran to its scheduled end without disruption
 *
 * Disrupted shots. After the onset of a disruption the plasma current collapses and ratios such as n/n_G (which divide by the
 * instantaneous I_p) blow up, so the history-based metrics of a disrupted shot are taken over the frames up to the onset
 * only: they describe the plateau the shot had reached when it disrupted (a shot that disrupts during the ramp-up simply
 * has a short "flat top"). E_fusion_MJ and Q_eng are the report's, for the whole shot.
 *
 * A metric whose diagnostic the model does not have (e.g. Q of an ICF capsule) is NaN. Pure TypeScript.
 */
import { flatTopMean } from '../physics/analysis/flatTop';
import type { HistoryFrame, ShotReport, SimEvent } from '../physics/types';

export const METRIC_KEYS = [
  'Q_flat', 'Q_max', 'Pfus_flat_MW', 'Pfus_max_MW', 'E_fusion_MJ', 'Q_eng', 'tauE_flat_s',
  'nG_flat', 'nG_max', 'betaN_flat', 'betaN_max', 'disrupted', 'completed',
] as const;
export type MetricKey = typeof METRIC_KEYS[number];

/** metrics that describe the performance of a shot that reached its scheduled end */
export const PERFORMANCE_METRICS: readonly MetricKey[] = ['Q_flat', 'Q_max', 'Pfus_flat_MW', 'Pfus_max_MW', 'E_fusion_MJ', 'Q_eng', 'tauE_flat_s'];
/** metrics that describe how close a shot came to its limits; defined for every shot */
export const OPERATING_METRICS: readonly MetricKey[] = ['nG_flat', 'nG_max', 'betaN_flat', 'betaN_max'];

export const METRIC_INFO: Record<MetricKey, { label: string; unit: string }> = {
  Q_flat: { label: 'flat-top Q', unit: '' },
  Q_max: { label: 'peak Q', unit: '' },
  Pfus_flat_MW: { label: 'flat-top fusion power', unit: 'MW' },
  Pfus_max_MW: { label: 'peak fusion power', unit: 'MW' },
  E_fusion_MJ: { label: 'fusion energy', unit: 'MJ' },
  Q_eng: { label: 'engineering gain', unit: '' },
  tauE_flat_s: { label: 'flat-top energy confinement time', unit: 's' },
  nG_flat: { label: 'flat-top n/n_G', unit: '' },
  nG_max: { label: 'peak n/n_G', unit: '' },
  betaN_flat: { label: 'flat-top beta_N', unit: '' },
  betaN_max: { label: 'peak beta_N', unit: '' },
  disrupted: { label: 'disruption (0/1)', unit: '' },
  completed: { label: 'ran to the scheduled end (0/1)', unit: '' },
};

export interface RunMetrics {
  values: Record<MetricKey, number>;
  /** ShotReport.termination.reason */
  endReason: string;
}

/** maximum of the finite values of a diagnostic over the history; NaN if there is none */
function maxOf(hist: readonly Pick<HistoryFrame, 'd'>[], key: string): number {
  let m = -Infinity;
  for (const f of hist) { const v = f.d[key]; if (Number.isFinite(v) && v > m) m = v; }
  return m === -Infinity ? NaN : m;
}

const fin = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);

/** The metrics of a finished run. */
export function runMetrics(history: readonly HistoryFrame[], events: readonly SimEvent[], report: ShotReport): RunMetrics {
  const onset = events.find((e) => e.kind === 'disruption');
  const disrupted = onset !== undefined;
  const natural = report.termination.natural && !disrupted;
  // a disrupted shot: only the frames up to the onset (see the header)
  const frames = onset ? history.filter((f) => f.t <= onset.t) : history;
  const hist = frames.length ? frames : history;
  const flat = (key: string) => (hist.length ? flatTopMean(hist, key) : NaN);
  const qMax = disrupted ? maxOf(hist, 'Q') : fin(report.Q_sci_max);
  return {
    values: {
      Q_flat: flat('Q'), Q_max: qMax, Pfus_flat_MW: flat('P_fus'), Pfus_max_MW: maxOf(hist, 'P_fus'),
      E_fusion_MJ: fin(report.E_fusion_MJ), Q_eng: fin(report.Q_eng), tauE_flat_s: flat('tauE'),
      nG_flat: flat('nG_frac'), nG_max: maxOf(hist, 'nG_frac'), betaN_flat: flat('betaN'), betaN_max: maxOf(hist, 'betaN'),
      disrupted: disrupted ? 1 : 0, completed: natural ? 1 : 0,
    },
    endReason: report.termination.reason,
  };
}
