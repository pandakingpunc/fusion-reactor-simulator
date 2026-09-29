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
import { lineAverageFactor } from '../physics/limits';
import { arealElongation, boundaryShape, plasmaVolume } from '../physics/geometry';
import { tauHmode, tauISS04, stellaratorHISS04 } from '../physics/transport';
import { FUEL_CHANNELS, FUEL_SPECIES, FuelType } from '../physics/reactivity';
import type { MagneticConfig } from '../physics/types';
import type { FromPopcon, PopconAxes, PopconStage, ToPopcon } from './popconProtocol';
import { Schedule, defaultSchedule } from './schedule';

const MU0 = 1.25663706212e-6;
const E_KEV = 1.602176634e-16;

/** axis maxima from 3 keV up are taken from this ladder (keV); below 3 keV the axis is rounded up to a multiple of T_FINE_STEP */
const T_LADDER = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200, 300];
const T_MAX = T_LADDER[T_LADDER.length - 1];
/** a device whose axis stays under the first rung of the ladder (W-7X, MAST-U: 1 to 2 keV) gets a finer rounding, 0.25 keV, so that its operating region is not lost in the ladder's coarse first steps */
const T_FINE_STEP = 0.25;
/** the axis reaches this many times the temperature the installed heating alone holds (see deviceTmax) */
const T_HEADROOM = 2.5;
/** below this T_aux [keV] the device is heating-dominated (see deviceTmax) and the axis reaches this many times T_aux instead */
const T_AUX_HEATING_DOMINATED = 1.2;
const T_HEADROOM_HEATING_DOMINATED = 2.0;
/** the axis is at least this share of the fuel's ignition optimum (see deviceTmax) */
const T_OPTIMUM_FLOOR = 0.1;
/** a map that spans less than this many keV has a uniform temperature grid (see uniformTemperature) */
const T_UNIFORM_BELOW = 5;

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
    best = 1;
    for (let T = 1; T <= 1000; T *= 1.02) {
      const s = FUEL_CHANNELS[fuel].reduce((a, ch) => a + ch.sigmav(T) * ch.Etot_MeV, 0) / (T * T);
      if (s > top) { top = s; best = T; }
    }
    optimum.set(fuel, best);
  }
  return best;
}

/**
 * Upper end of the temperature axis for a device (a view heuristic, not physics): about 2.5 times the temperature the
 * installed heating alone would hold, T_aux = P_heat τ_E(P_heat) / (3 ⟨n⟩ V f_prof e) at the device's own density
 * (τ_E the same scaling as the model uses; no alpha heating, no radiation). Alpha heating and the H-mode rise lift a
 * real shot to 1.1 to 2 times T_aux (the peak T_i of every 0D magnetic preset: ITER 10.5 keV for T_aux 5.9, SPARC
 * 9.4 for 6.1, DEMO 15.3 for 7.7, JET 5.0 for 3.1, MAST-U 1.4 for 0.9, W7-X 1.0 for 0.9), so the operating region
 * fills the middle of the axis and the ignition optimum of D-T (about 14 keV) stays on the map for the large
 * devices. Two bounds: the beta limit at the device's own density (Troyon: β_t = β_N · I_p / (100 a B); a stellarator,
 * which has no plasma current to scale with, is taken at a volume-average beta of 5 %), which no shot can pass, and a
 * floor of 0.10 of the fuel's ignition optimum, which widens the axis for a fuel that burns only at high
 * temperature (p-11B). The result is rounded up to a 1-2-5 style ladder from 3 to 300 keV, and below 3 keV to a multiple
 * of 0.25 keV. A device whose heating alone holds less than about a keV (T_aux, W-7X and MAST-U) has no alpha heating to
 * lift the shot (its peak T_i is 0.95 to 1.1 T_aux), so it gets 2 T_aux instead of 2.5.
 * ITER: 20 keV, SPARC 20, JET 10, DEMO 20 (ITER15 15), MAST-U and W-7X 1.75. The old axis was 0 to 40 keV for every device,
 * and the first version of this function (the beta limit at 0.4 of the Greenwald density) gave ITER 50 and DEMO 80,
 * with the operating region in the bottom fifth of the map; the ladder that began at 2 and 2.5 keV left W-7X and
 * MAST-U at a third of the axis (peak T_i 0.85 keV of 2.5), which now read 49 %.
 */
export function deviceTmax(cfg: MagneticConfig): number {
  const g = cfg.geometry, n = cfg.n_target;
  const gB = boundaryShape(cfg); // the volume and the ITPA20 shape of the model (0D, POPCON): the boundary Miller shape
  const gITPA = { R: g.R, a: g.a, kappa: arealElongation(gB), delta: gB.delta };
  const stell = cfg.method === 'stellarator';
  const tokamak = !stell && cfg.Ip_MA > 0;
  const betaT = tokamak ? (cfg.limits.betaN_limit * cfg.Ip_MA) / (100 * g.a * cfg.B0) : 0.05;
  const Tbeta = (betaT * cfg.B0 * cfg.B0) / (2 * MU0) / (2 * n * E_KEV); // p = (n_e + n_i) T with n_i = n_e
  const aN = cfg.transport.alpha_n, aT = cfg.transport.alpha_T;
  const nLine = lineAverageFactor(aN) * n;
  const fs = FUEL_SPECIES[cfg.fuel];
  const M = cfg.fuelFracA * fs.a.A + (1 - cfg.fuelFracA) * fs.b.A;
  const h = cfg.heating;
  const P = (h.P_NBI_MW + h.P_ICRH_MW + h.P_ECRH_MW) * 1e6;
  const tau = stell
    ? tauISS04(g, cfg.B0, nLine, P, cfg.stellarator.iota23, stellaratorHISS04(cfg.stellarator, cfg.H98))
    : tauHmode(cfg.scaling, cfg.scaling === 'ITPA20' || cfg.scaling === 'ITPA20-IL' ? gITPA : g, cfg.Ip_MA, cfg.B0, nLine, P, M) * cfg.H98;
  const Wprof = ((1 + aN) * (1 + aT)) / (1 + aN + aT); // ⟨n T⟩ = Wprof ⟨n⟩⟨T⟩
  const Taux = (P * tau) / (3 * n * E_KEV * plasmaVolume(gB) * Wprof);
  // a device whose heating alone holds only about a keV has no alpha heating to lift the shot above T_aux (W-7X, MAST-U: the peak T_i is
  // 0.95 to 1.1 T_aux), so its axis needs less headroom than the large devices, which the alpha heating carries to 1.1 to 2 T_aux
  const headroom = Taux < T_AUX_HEATING_DOMINATED ? T_HEADROOM_HEATING_DOMINATED : T_HEADROOM;
  const want = Math.max(Math.min(headroom * Taux, Tbeta), T_OPTIMUM_FLOOR * fuelOptimumT(cfg.fuel));
  if (!Number.isFinite(want)) return 40;
  if (want <= T_LADDER[0]) return Math.max(T_FINE_STEP, Math.ceil(want / T_FINE_STEP - 1e-9) * T_FINE_STEP);
  return T_LADDER.find((T) => T >= want) ?? T_MAX;
}

/**
 * Whether the temperature grid of a map that spans `Tmax` keV is uniform. The model's own grid is dense at low T, starting at 0.5 keV
 * (physics/popcon.ts); on a map of a few keV (W-7X, MAST-U) that leaves the first cell to hold everything below 0.5 keV and a third of the
 * cells in the first third of the axis, so these maps are computed on equal steps.
 */
export function uniformTemperature(Tmax: number): boolean { return Tmax < T_UNIFORM_BELOW; }

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
  let current: { job: number; cfg: MagneticConfig; stages: readonly PopconStage[]; edge: boolean; next: number; Tmax: number } | null = null;
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
      const grid = compute(cur.cfg, { nx: stage.nx, ny: stage.ny, Tmax: cur.Tmax, uniformT: uniformTemperature(cur.Tmax), ...(cur.edge ? { edge: true } : {}) });
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
        current = { job: msg.job, cfg: msg.cfg, stages: msg.stages, edge: msg.edge === true, next: 0, Tmax: 0 };
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
