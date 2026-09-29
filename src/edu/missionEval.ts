/**
 * Judging a mission: the numbers a finished run is measured by, the goals checked against them, the POPCON
 * mission's operating-point reading, and the headless runner and solver the tests use.
 *
 * The screens run the configuration in a worker and hand the resulting report, frames and events to
 * runMetrics(); the tests run it here with the same Simulation kernel. Both go through judge().
 */
import { computePopcon, PopconGrid } from '../physics/popcon';
import { Simulation } from '../physics/simulation';
import { MagneticConfig, ReactorConfig, ShotReport } from '../physics/types';
import { buildConfig, Edits, Goal, Mission, operatingPoint } from './missions';

export type MetricId =
  | 'noDisruption' | 'hModeFrac' | 'nbarMax' | 'pauxMax' | 'ipMax' | 'qAvg' | 'eFus' | 'elmMax' | 'gain' | 'ignited' | 'inLimits';

export type Metrics = Partial<Record<MetricId, number>>;

/** the unit each metric is shown in */
export const METRIC_UNITS: Record<MetricId, string> = {
  noDisruption: '', hModeFrac: '', nbarMax: '1e20 m⁻³', pauxMax: 'MW', ipMax: 'MA', qAvg: '', eFus: 'MJ', elmMax: 'MJ',
  gain: '', ignited: '', inLimits: '',
};

/** what a finished run leaves: the report, the recorded diagnostics and the events (frames may be UI or history frames) */
export interface RunData {
  report: ShotReport;
  frames: readonly { t: number; d: Record<string, number> }[];
  events: readonly { kind: string; value?: number }[];
  tEnd: number;
}

const finite = (x: number | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

function maxOf(frames: RunData['frames'], key: string): number {
  let m = -Infinity;
  for (const f of frames) { const v = f.d[key]; if (finite(v) && v > m) m = v; }
  return Number.isFinite(m) ? m : 0;
}

/** the numbers of a finished run that the goals of the run missions are written in */
export function runMetrics(run: RunData): Metrics {
  const r = run.report;
  // H-mode share of the flat part of the shot (after the first quarter: heating and density ramps are over)
  const late = run.frames.filter((f) => f.t >= 0.25 * run.tEnd && finite(f.d.H_mode));
  const hFrac = late.length ? late.filter((f) => f.d.H_mode > 0.5).length / late.length : 0;
  const elm = run.events.filter((e) => e.kind === 'ELM').map((e) => e.value ?? 0);
  return {
    noDisruption: r.termination.disruption || !r.termination.natural ? 0 : 1,
    hModeFrac: hFrac,
    nbarMax: maxOf(run.frames, 'nbar'),
    pauxMax: maxOf(run.frames, 'P_aux'),
    ipMax: maxOf(run.frames, 'Ip'),
    qAvg: r.Q_sci_avg,
    eFus: r.E_fusion_MJ,
    elmMax: elm.length ? Math.max(...elm) : 0,
    gain: r.Q_sci_max,
  };
}

/** the POPCON map read at the operating point (nearest grid cell) */
export interface PopconReading {
  /** grid cell that was read */
  n: number; T: number;
  /** required auxiliary power [MW] (≤ 0: the plasma is ignited) */
  Paux_MW: number;
  Pfus_MW: number;
  betaN: number;
  /** n̄ over the Greenwald density of this grid */
  nGfrac: number;
  plhOk: boolean;
}

const nearest = (axis: readonly number[], x: number): number => {
  let best = 0;
  for (let i = 1; i < axis.length; i++) if (Math.abs(axis[i] - x) < Math.abs(axis[best] - x)) best = i;
  return best;
};

export function readPopcon(grid: PopconGrid, point: { n: number; T: number }): PopconReading {
  const i = nearest(grid.n, point.n), j = nearest(grid.T, point.T), k = i * grid.ny + j;
  return {
    n: grid.n[i], T: grid.T[j], Paux_MW: grid.Paux[k] / 1e6, Pfus_MW: grid.Pfus[k] / 1e6, betaN: grid.betaN[k],
    nGfrac: grid.n[i] / grid.nG, plhOk: grid.PLH_ok[k] === 1,
  };
}

/** the POPCON mission's numbers: ignited (P_aux ≤ 0) and inside the density, beta and L-H limits */
export function popconMetrics(cfg: MagneticConfig, reading: PopconReading): Metrics {
  const inLimits = reading.nGfrac <= cfg.limits.greenwald_limit && reading.betaN <= cfg.limits.betaN_limit && reading.plhOk;
  return { ignited: reading.Paux_MW <= 0 ? 1 : 0, inLimits: inLimits ? 1 : 0 };
}

export interface GoalResult { goal: Goal; value: number | undefined; ok: boolean }
export interface Outcome { passed: boolean; results: GoalResult[]; metrics: Metrics }

export function goalMet(g: Goal, value: number | undefined): boolean {
  if (!finite(value)) return false;
  return g.op === '>=' ? value >= g.target : value <= g.target;
}

export function judge(m: Mission, metrics: Metrics): Outcome {
  const results = m.goals.map((goal) => ({ goal, value: metrics[goal.metric], ok: goalMet(goal, metrics[goal.metric]) }));
  return { passed: results.every((r) => r.ok), results, metrics };
}

/** every POPCON grid cell that is ignited and inside the limits, best first (highest fusion power) */
export function ignitionCells(cfg: MagneticConfig, grid: PopconGrid): { n: number; T: number; Pfus_MW: number }[] {
  const cells: { n: number; T: number; Pfus_MW: number }[] = [];
  for (let i = 0; i < grid.nx; i++) {
    for (let j = 0; j < grid.ny; j++) {
      const k = i * grid.ny + j;
      if (grid.Paux[k] > 0) continue;
      const ok = grid.n[i] / grid.nG <= cfg.limits.greenwald_limit && grid.betaN[k] <= cfg.limits.betaN_limit && grid.PLH_ok[k] === 1;
      if (ok) cells.push({ n: grid.n[i], T: grid.T[j], Pfus_MW: grid.Pfus[k] / 1e6 });
    }
  }
  return cells.sort((a, b) => b.Pfus_MW - a.Pfus_MW);
}

/**
 * The POPCON mission's solution script: raise the confinement quality H98 in steps until the map has an
 * ignited region inside the limits, then take its cell of highest fusion power.
 */
export function solveIgnition(m: Mission): Edits {
  const lever = m.levers.find((l) => l.id === 'H98')!;
  for (let h = lever.min ?? 1; h <= (lever.max ?? 2) + 1e-9; h += lever.step ?? 0.05) {
    const cfg = { ...(m.base as MagneticConfig), H98: h };
    const cells = ignitionCells(cfg, computePopcon(cfg));
    if (cells.length) return { H98: +h.toFixed(3), pointN: +(cells[0].n / 1e20).toFixed(4), pointT: +cells[0].T.toFixed(3) };
  }
  throw new Error('mission ignition has no solution in the lever ranges');
}

/** the solution of a mission (the POPCON one is a search) */
export function solveMission(m: Mission): Edits { return m.id === 'ignition' ? solveIgnition(m) : m.solution(); }

/** Run a configuration to its end in this thread (tests, scripts) and return what runMetrics() reads. */
export function runToEnd(cfg: ReactorConfig): RunData {
  const sim = new Simulation(cfg);
  sim.runAll();
  return { report: sim.report(), frames: sim.history, events: sim.events, tEnd: sim.model.tEnd };
}

export interface HeadlessResult { outcome: Outcome; run?: RunData; popcon?: PopconReading }

/** Play a mission with the given edits, headless: build the configuration, run or read the map, judge. */
export function playMission(m: Mission, edits: Edits): HeadlessResult {
  const cfg = buildConfig(m, edits);
  if (m.kind === 'popcon') {
    const mag = cfg as MagneticConfig;
    const point = operatingPoint(m, edits)!;
    const popcon = readPopcon(computePopcon(mag), point);
    return { outcome: judge(m, popconMetrics(mag, popcon)), popcon };
  }
  const run = runToEnd(cfg);
  return { outcome: judge(m, runMetrics(run)), run };
}
