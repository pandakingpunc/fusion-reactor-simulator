/**
 * POPCON worker's message handler (popconProtocol.ts), independent of `self`: popcon.worker.ts wires it to the real
 * worker, tests call it directly with a manual scheduler.
 *
 * A job is computed stage by stage. Between two stages the worker yields to its event loop (a zero-delay task is a
 * message-channel task, see schedule.ts), so a `compute` that is already queued is handled first and replaces the job
 * before its next stage starts: stale work is dropped before it begins. A running stage cannot be interrupted (the
 * model is one synchronous call, about 10 ms at 16 × 16 and 60 to 90 ms at 44 × 44), so the newest request waits for
 * at most that stage.
 */
import { computePopcon } from '../physics/popcon';
import type { PopconGrid } from '../physics/popcon';
import { greenwaldDensity, lineAverageFactor } from '../physics/limits';
import { FUEL_CHANNELS, FuelType } from '../physics/reactivity';
import type { MagneticConfig } from '../physics/types';
import type { FromPopcon, PopconAxes, PopconStage, ToPopcon } from './popconProtocol';
import { Schedule, defaultSchedule } from './schedule';

const MU0 = 1.25663706212e-6;
const E_KEV = 1.602176634e-16;

/** axis maxima are taken from this ladder (keV) */
const T_LADDER = [5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200, 300];
const T_MIN = T_LADDER[0], T_MAX = T_LADDER[T_LADDER.length - 1];

const optimum = new Map<FuelType, number>();
/**
 * Temperature [keV] at which the fuel is easiest to ignite: the maximum of Σ ⟨σv⟩·E/T², the power density per
 * (n T)² (the minimum of the triple product n T τ_E ∝ T²/⟨σv⟩ for one channel; the channels of D-D and D-³He are
 * weighted by their energy release). About 13 keV for D-T.
 */
export function fuelOptimumT(fuel: FuelType): number {
  let best = optimum.get(fuel);
  if (best === undefined) {
    let top = 0;
    best = T_MIN;
    for (let T = 1; T <= 1000; T *= 1.02) {
      const s = FUEL_CHANNELS[fuel].reduce((a, ch) => a + ch.sigmav(T) * ch.Etot_MeV, 0) / (T * T);
      if (s > top) { top = s; best = T; }
    }
    optimum.set(fuel, best);
  }
  return best;
}

/**
 * Upper end of the temperature axis for a device (a view heuristic, not physics): the temperature at which the
 * plasma pressure reaches the beta limit at 0.4 of the Greenwald density, i.e. how hot this device can get at a
 * typical density, from its field, current, minor radius and beta_N limit (Troyon: β_t = β_N · I_p / (100 a B));
 * a stellarator, which has no plasma current to scale with, is taken at a volume-average beta of 5 % and its own
 * target density. A fuel that burns only at high temperature widens the axis to 0.3 of its optimum. The result is
 * rounded up to a 1-2-5 style ladder between 5 and 300 keV. ITER: 50 keV, SPARC 30, JET 15, MAST-U 5.
 * The old axis was 0 to 40 keV for every device.
 */
export function deviceTmax(cfg: MagneticConfig): number {
  const g = cfg.geometry, B0 = cfg.B0;
  const stell = cfg.method === 'stellarator';
  const nG = greenwaldDensity(cfg.Ip_MA, g.a) / lineAverageFactor(cfg.transport.alpha_n);
  const tokamak = !stell && cfg.Ip_MA > 0 && nG > 0;
  const nRef = tokamak ? 0.4 * nG : cfg.n_target;
  const betaT = tokamak ? (cfg.limits.betaN_limit * cfg.Ip_MA) / (100 * g.a * B0) : 0.05;
  const Tbeta = (betaT * B0 * B0) / (2 * MU0) / (2 * nRef * E_KEV); // p = (n_e + n_i) T with n_i = n_e
  const want = Math.max(Tbeta, 0.3 * fuelOptimumT(cfg.fuel));
  if (!Number.isFinite(want)) return 40;
  return T_LADDER.find((T) => T >= want) ?? T_MAX;
}

/** extent of the axes of a grid computed for `cfg` with `Tmax`: the density cells are uniform */
export function popconAxes(grid: PopconGrid, Tmax: number): PopconAxes {
  return { nMax: (grid.n[grid.nx - 1] * grid.nx) / (grid.nx - 0.5), Tmax };
}

/** the buffers of a grid (owned by it alone, so they can be transferred instead of copied) */
export function gridBuffers(grid: PopconGrid): ArrayBuffer[] {
  return [grid.Paux, grid.Pfus, grid.Q, grid.betaN, grid.PLH_ok, grid.fHe].map((a) => a.buffer as ArrayBuffer);
}

export interface PopconHostOptions {
  /** the model (default computePopcon); tests inject a counter */
  compute?: typeof computePopcon;
  /** clock [ms] (default performance.now) */
  now?: () => number;
  /** timer for the stages (default defaultSchedule); tests inject a manual one */
  schedule?: Schedule;
}

export interface PopconHost {
  handle(msg: ToPopcon): void;
  /** cancel the job in progress */
  dispose(): void;
}

const validStage = (s: PopconStage) => Number.isInteger(s.nx) && Number.isInteger(s.ny) && s.nx >= 2 && s.ny >= 2 && s.nx <= 400 && s.ny <= 400
  && (s.delayMs === undefined || (Number.isFinite(s.delayMs) && s.delayMs >= 0));

export function createPopconHost(post: (m: FromPopcon, transfer?: Transferable[]) => void, opts: PopconHostOptions = {}): PopconHost {
  const compute = opts.compute ?? computePopcon;
  const now = opts.now ?? (() => performance.now());
  const schedule = opts.schedule ?? defaultSchedule;
  let current: { job: number; cfg: MagneticConfig; stages: readonly PopconStage[]; next: number; Tmax: number } | null = null;
  let cancelTimer: (() => void) | null = null;

  function stop() {
    if (cancelTimer) { cancelTimer(); cancelTimer = null; }
    current = null;
  }

  function runStage(job: number) {
    cancelTimer = null;
    const cur = current;
    if (!cur || cur.job !== job) return;
    const stage = cur.stages[cur.next];
    try {
      const t0 = now();
      if (cur.next === 0) cur.Tmax = deviceTmax(cur.cfg);
      const grid = compute(cur.cfg, { nx: stage.nx, ny: stage.ny, Tmax: cur.Tmax });
      const ms = now() - t0;
      const index = cur.next++;
      post({ type: 'grid', job, stage: index, stages: cur.stages.length, grid, axes: popconAxes(grid, cur.Tmax), ms }, gridBuffers(grid));
      if (cur.next < cur.stages.length) cancelTimer = schedule(() => runStage(job), cur.stages[cur.next].delayMs ?? 0);
      else current = null;
    } catch (err) {
      current = null;
      post({ type: 'error', job, msg: err instanceof Error ? err.message : String(err) });
    }
  }

  function handle(msg: ToPopcon) {
    switch (msg.type) {
      case 'compute': {
        stop();
        if (!msg.stages.length || !msg.stages.every(validStage)) {
          post({ type: 'error', job: msg.job, msg: 'invalid POPCON stage plan' });
          return;
        }
        current = { job: msg.job, cfg: msg.cfg, stages: msg.stages, next: 0, Tmax: 0 };
        cancelTimer = schedule(() => runStage(msg.job), msg.stages[0].delayMs ?? 0);
        break;
      }
      case 'cancel':
        stop();
        break;
    }
  }

  return { handle, dispose: stop };
}
