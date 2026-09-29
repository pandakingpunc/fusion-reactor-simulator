/**
 * Live POPCON: a React hook that keeps the operating map of a configuration up to date in a worker, plus the small
 * pure helpers the map needs (the configuration with the live controls applied, click-to-steer).
 *
 * Every change of the configuration starts a job in the POPCON worker (src/worker/popconHost.ts): a 16 × 16 grid,
 * ready in about 10 ms, and, once nothing newer has arrived for 150 ms, the 44 × 44 grid. A grid that belongs to a
 * job that is no longer the newest is dropped here, and the worker drops the stages of a job that a newer one has
 * replaced, so a slider drag costs the page one small render per change and never blocks it on the model (the
 * 44 × 44 grid used to be computed on the page, 55-85 ms per change).
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { PopconGrid } from '../../physics/popcon';
import type { MagneticConfig } from '../../physics/types';
import { DEFAULT_POPCON_STAGES } from '../../worker/popconProtocol';
import type { FromPopcon, PopconAxes, PopconStage, ToPopcon } from '../../worker/popconProtocol';
import { CONTROL_DEFS } from '../run/controls';

/** The part of the Worker interface the hook uses (a real Worker or a test double). */
export interface PopconWorkerLike {
  postMessage(msg: ToPopcon): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<FromPopcon>) => unknown) | null;
  onerror: ((ev: ErrorEvent) => unknown) | null;
}
/** null: no worker can be created here (no Worker in this environment) */
export type PopconWorkerFactory = () => PopconWorkerLike | null;

/** The POPCON worker, in a chunk of its own (Vite bundles the `new Worker(new URL(…))` pattern separately). */
export function createPopconWorker(): PopconWorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('../../worker/popcon.worker.ts', import.meta.url), { type: 'module' }) as PopconWorkerLike;
}

/** The worker factory of the maps below it in the tree (the real worker by default; tests provide fakes). */
export const PopconWorkerContext = createContext<PopconWorkerFactory>(createPopconWorker);

export interface PopconState {
  /** the newest grid of the newest job (kept while the next job's first grid is on its way) */
  grid: PopconGrid | null;
  axes: PopconAxes | null;
  /** 0-based index of the stage of `grid` and the number of stages of its job */
  stage: number;
  stages: number;
  /** a job is running or waiting for the controls to rest: `grid` is not the last word yet */
  pending: boolean;
  error: string | null;
  /** wall time the worker took for the stage of `grid` [ms] */
  ms: number;
  /** false when no worker could be created */
  available: boolean;
}

const INITIAL: PopconState = { grid: null, axes: null, stage: 0, stages: 0, pending: false, error: null, ms: 0, available: true };

export interface PopconOptions {
  createWorker?: PopconWorkerFactory;
  /** stage plan (default: 16 × 16, then 44 × 44 at rest); keep the array stable between renders */
  stages?: readonly PopconStage[];
  /** add the edge model's maps (P_sep/R, peak target heat flux, target T_e) to the grids; tokamaks only, a stellarator's grid has none */
  edge?: boolean;
}

/** POPCON grid of `cfg`, computed off the page's thread and refined while the configuration rests. */
export function usePopcon(cfg: MagneticConfig | null, opts: PopconOptions = {}): PopconState {
  const provided = useContext(PopconWorkerContext);
  const create = opts.createWorker ?? provided;
  const stages = opts.stages ?? DEFAULT_POPCON_STAGES;
  const edge = opts.edge === true;
  const [state, setState] = useState<PopconState>(INITIAL);
  const workerRef = useRef<PopconWorkerLike | null>(null);
  const jobRef = useRef(0);

  // the worker lives as long as the component
  useEffect(() => {
    const w = create();
    workerRef.current = w;
    if (!w) { setState((s) => (!s.available && !s.pending ? s : { ...s, available: false, pending: false })); return; } // (bail out when unchanged: a factory that is new on every render must not loop)
    w.onmessage = (e) => {
      const m = e.data;
      if (m.job !== jobRef.current) return; // a grid or an error of a job that a newer one has replaced
      if (m.type === 'grid') setState({ grid: m.grid, axes: m.axes, stage: m.stage, stages: m.stages, pending: m.stage + 1 < m.stages, error: null, ms: m.ms, available: true });
      else setState((s) => ({ ...s, pending: false, error: m.msg }));
    };
    w.onerror = (e) => setState((s) => ({ ...s, pending: false, error: e.message || 'POPCON worker failed' }));
    return () => {
      w.onmessage = null; w.onerror = null;
      w.terminate();
      if (workerRef.current === w) workerRef.current = null;
    };
  }, [create]);

  // one job per configuration; the previous one is replaced in the worker
  useEffect(() => {
    const w = workerRef.current;
    if (!cfg || !w) return;
    const job = ++jobRef.current;
    setState((s) => ({ ...s, pending: true }));
    w.postMessage({ type: 'compute', job, cfg, stages, ...(edge ? { edge: true } : {}) });
  }, [cfg, stages, edge, create]);

  return state;
}

/**
 * The configuration the map is drawn for: `cfg` with the live controls that enter the steady-state balance applied
 * (confinement multiplier, impurity fraction). Returns `cfg` itself while they equal its own values, so an unchanged
 * map is not recomputed. The heating powers and the density set-point are not part of the map: the map is what they
 * are chosen from (the map solves for the heating power at each density and temperature).
 */
export function popconCfg(cfg: MagneticConfig, controls?: Readonly<Record<string, number>>): MagneticConfig {
  if (!controls) return cfg;
  const { H98, H_ISS04, cZ } = controls;
  const sameH = H98 === undefined || H98 === cfg.H98;
  const sameI = H_ISS04 === undefined || H_ISS04 === cfg.stellarator.H_ISS04;
  const sameZ = cZ === undefined || cZ === cfg.impurity.concentration;
  if (sameH && sameI && sameZ) return cfg;
  return {
    ...cfg,
    H98: H98 ?? cfg.H98,
    stellarator: H_ISS04 === undefined ? cfg.stellarator : { ...cfg.stellarator, H_ISS04 },
    impurity: cZ === undefined ? cfg.impurity : { ...cfg.impurity, concentration: cZ },
  };
}

/** heating controls, in the order the steady-state power is put on them when none of them is in use */
const HEATING_KEYS = ['P_NBI_MW', 'P_ICRH_MW', 'P_ECRH_MW'] as const;

/**
 * Live-control patch that steers the shot toward a point of the map: the density set-point becomes the point's
 * ⟨n_e⟩ and the auxiliary heating becomes the power the map says that point needs in steady state, spread over the
 * heating controls in proportion to what they carry now (all on the first one when they are all zero), each within
 * its slider range. A point that heats itself (P_aux ≤ 0) sets the heating to zero. The map is a 0D steady-state
 * estimate and the injected power is not the absorbed power, so this is a nudge, not a guarantee of arrival.
 * @param target the point: ⟨n_e⟩ [m⁻³] and the P_aux the map gives there [MW]
 * @param controls the live controls of the run; only keys present in it are patched
 */
export function steerPatch(target: { n: number; Paux_MW: number }, controls: Readonly<Record<string, number>>): Record<string, number> {
  const patch: Record<string, number> = {};
  const nDef = CONTROL_DEFS.n_target_1e20;
  if ('n_target_1e20' in controls && Number.isFinite(target.n)) {
    patch.n_target_1e20 = Math.min(nDef.max, Math.max(nDef.min, Math.round((target.n / 1e20) * 1000) / 1000));
  }
  const keys = HEATING_KEYS.filter((k) => k in controls);
  if (keys.length) {
    const total = Number.isFinite(target.Paux_MW) ? Math.max(0, target.Paux_MW) : 0;
    const now = keys.map((k) => Math.max(0, controls[k]));
    const sum = now.reduce((a, b) => a + b, 0);
    const share = sum > 1e-9 ? now.map((v) => v / sum) : keys.map((_, i) => (i === 0 ? 1 : 0));
    const cap = keys.map((k) => CONTROL_DEFS[k].max);
    const v = keys.map((_, i) => Math.min(total * share[i], cap[i]));
    let spill = total - v.reduce((a, b) => a + b, 0); // what a slider's range could not take goes to the others
    for (let i = 0; i < keys.length && spill > 1e-9; i++) { const add = Math.min(spill, cap[i] - v[i]); v[i] += add; spill -= add; }
    keys.forEach((k, i) => { patch[k] = Math.round(v[i] * 10) / 10; });
  }
  return patch;
}
