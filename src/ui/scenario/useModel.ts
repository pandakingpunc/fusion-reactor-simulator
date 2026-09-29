/**
 * The model behind a configuration, as the scenario UI needs it: its controls (with their configured values), diagnostics and end time.
 * They come from a probe (worker message `probe`: the model is built, not run), once per configuration object.
 */
import { useEffect, useState } from 'react';
import type { ReactorConfig } from '../../physics/types';
import type { SimMeta } from '../../worker/protocol';
import { probeInWorker } from '../state/oneShot';
import type { WorkerFactory } from '../state/sim';
import { editorContext, type EditorContext } from './model';

export interface ModelState { cfg: ReactorConfig; ctx?: EditorContext; error?: string }

/** one probe per configuration object (a wizard that is left and entered again does not build the model again) */
const probes = new WeakMap<object, Promise<SimMeta>>();

/** The meta of the model of `cfg` (without a scenario: its controls are the configured values), built once per configuration object. */
export function probeOnce(cfg: ReactorConfig, createWorker: WorkerFactory): Promise<SimMeta> {
  let p = probes.get(cfg);
  if (!p) {
    p = probeInWorker(createWorker, cfg);
    probes.set(cfg, p);
    p.catch(() => { probes.delete(cfg); }); // a failure is not remembered: the next visit tries again
  }
  return p;
}

/** The editor context of `cfg` once it is known, or the reason it could not be read. */
export function useModel(cfg: ReactorConfig, createWorker: WorkerFactory): Omit<ModelState, 'cfg'> {
  const [state, setState] = useState<ModelState>({ cfg });
  useEffect(() => {
    let alive = true;
    probeOnce(cfg, createWorker).then(
      (meta) => { if (alive) setState({ cfg, ctx: editorContext(meta) }); },
      (e: unknown) => { if (alive) setState({ cfg, error: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { alive = false; };
  }, [cfg, createWorker]);
  return state.cfg === cfg ? state : {};
}
