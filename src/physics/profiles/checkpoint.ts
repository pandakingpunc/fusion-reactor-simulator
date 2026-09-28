/**
 * Checkpoints of the 1.5D model (Simulation.rewindTo).
 *
 * A checkpoint holds everything the continuation of the shot depends on besides y. Every part of
 * the model that keeps such state (the shared context, the equilibrium coupling, the step
 * controller, each event model, and any source or transport model with state) implements
 * Checkpointable. Numbers go into the record that Simulation stores in the history frame
 * (Record<string, number>; each part uses its own keys);
 * references and strings (equilibrium and geometry with the GS warm start, disruption text, ELM
 * times, issued warnings) stay in a model-side store under the record's `ck` key. Restoring a
 * checkpoint prunes the store of checkpoints after it: their frames are discarded by the rewind.
 * A record without a stored entry (from elsewhere) restores the numbers only.
 *
 * The contract, which CheckpointStore.save enforces where it can be checked:
 *  - record keys are unique over all parts (a part that writes a key another part wrote, or the
 *    reserved `ck`, is an error, not an overwrite) and their values are numbers; a plug-in prefixes
 *    its keys with its own id (`myModel_…`); the same holds for the keys of `aux`;
 *  - `restore` accepts a record with missing keys (recNum defaults) and no aux;
 *  - what a part puts into `aux` is a copy or an immutable value: a checkpoint must not change when
 *    the part goes on and mutates its own arrays.
 */
import type { DisruptionCause } from '../disruption';
import { PHASES, ProfileContext } from './context';

export type CheckpointRecord = Record<string, number>;
export type CheckpointAux = Record<string, unknown>;

export interface Checkpointable {
  /** writes numbers into rec (keys unique over all parts) and references or strings into aux */
  save(rec: CheckpointRecord, aux: CheckpointAux): void;
  /** aux: what save stored with this record, or undefined for a record from elsewhere */
  restore(rec: Readonly<CheckpointRecord>, aux: Readonly<CheckpointAux> | undefined): void;
}

/** Finite number from a record, or the default */
export function recNum(rec: Readonly<CheckpointRecord>, k: string, dflt: number): number {
  return Number.isFinite(rec[k]) ? rec[k] : dflt;
}

/** A checkpointable part broke the contract above (a key written twice, a non-numeric record value). */
export class CheckpointContractError extends Error {
  override readonly name = 'CheckpointContractError';
}

/** Name of a part in an error message: its id (sources, transport models, event models), else its class, else its position */
function partName(p: Partial<Checkpointable>, index: number): string {
  const id = (p as { id?: unknown }).id;
  if (typeof id === 'string') return `'${id}'`;
  const cls = p.constructor?.name;
  return cls && cls !== 'Object' ? cls : `part ${index}`;
}

export class CheckpointStore {
  /** references and strings of each checkpoint, by the record's `ck` */
  private store = new Map<number, CheckpointAux>();
  private next = 0;

  /**
   * Record and aux of every part, in the order of `parts`. A key written by two parts, or by a part
   * and the store (`ck`), and a record value that is not a number throw a CheckpointContractError
   * naming the parts: a plug-in that reused 'dt' or 'rng' would otherwise corrupt every rewind.
   */
  save(parts: readonly Partial<Checkpointable>[]): CheckpointRecord {
    const ck = this.next;
    const rec: CheckpointRecord = { ck }, aux: CheckpointAux = {};
    const recOwner = new Map<string, string>([['ck', 'the checkpoint store']]);
    const auxOwner = new Map<string, string>();
    parts.forEach((p, i) => {
      if (!p.save) return;
      const name = partName(p, i);
      const own: CheckpointRecord = {}, ownAux: CheckpointAux = {};
      p.save(own, ownAux);
      for (const k of Object.keys(own)) {
        const prev = recOwner.get(k);
        if (prev !== undefined) throw new CheckpointContractError(`checkpoint record key '${k}' is written by ${prev} and by ${name}: keys must be unique over all parts (prefix a plug-in's keys with its id)`);
        if (typeof own[k] !== 'number') throw new CheckpointContractError(`checkpoint record key '${k}' of ${name} is not a number (${typeof own[k]}): references and strings go into aux`);
        recOwner.set(k, name);
        rec[k] = own[k];
      }
      for (const k of Object.keys(ownAux)) {
        const prev = auxOwner.get(k);
        if (prev !== undefined) throw new CheckpointContractError(`checkpoint aux key '${k}' is written by ${prev} and by ${name}: keys must be unique over all parts`);
        auxOwner.set(k, name);
        aux[k] = ownAux[k];
      }
    });
    this.next = ck + 1;
    this.store.set(ck, aux);
    return rec;
  }

  restore(rec: Readonly<CheckpointRecord>, parts: readonly Partial<Checkpointable>[]): void {
    const aux = this.store.get(rec.ck);
    for (const p of parts) p.restore?.(rec, aux);
    if (aux) {
      for (const k of this.store.keys()) if (k > rec.ck) this.store.delete(k);
      // the frames after this one are discarded: the replay numbers its checkpoints like the original run
      this.next = rec.ck + 1;
    }
  }
}

/**
 * Checkpoint part of the shared context: RNG, phase and mode, time step, boundary and controller
 * state (P_SOL filter, Γ_b, n_sep gain), α_ped/α_crit, loop voltage, τ_E used by the fueling loop
 * of the next step, the smoothed dW/dt and the ELM energy not yet booked in it, the ignition state
 * and the start of the ignition test, the disruption state; the equilibrium/geometry pair, the issued warnings, the
 * disruption cause and text and the last diagnostics by reference or copy. Actuator set-points
 * (applyControl) are deliberately not part of it: after a rewind the latest controls stay in
 * force. The output state (termination, pending events, stale flag) is reset.
 *
 * The last diagnostics and profiles are part of it because the quench phases of a disruption
 * patch them in place on top of the values of the last normal step (quenchDiagnostics): they
 * cannot be rebuilt from y there, and a frame or report after a replay from a quench frame would
 * otherwise lack most keys. The diagnostics are a copy (that patching mutates them), the profiles
 * are kept by reference (a step replaces them, never mutates them) and only in the quench phases,
 * where nothing else refreshes them; in the normal phase the next step rewrites both.
 */
export function contextCheckpoint(ctx: ProfileContext): Checkpointable {
  return {
    save(rec, aux) {
      aux.geo = ctx.geo;
      aux.warned = [...ctx.warned];
      aux.disruptCause = ctx.disruption.cause; aux.diagText = ctx.disruption.text;
      aux.lastDiag = { ...ctx.lastDiag };
      if (ctx.phase !== 'normal') aux.lastProf = ctx.lastProf;
      Object.assign(rec, {
        rng: ctx.rng.getState(), phase: PHASES.indexOf(ctx.phase), hmode: +ctx.hmode,
        dt: ctx.dt, PSOL: ctx.PSOL, GammaB: ctx.GammaB, TeB: ctx.bc.Te, TiB: ctx.bc.Ti, nB: ctx.bc.n, nsepGain: ctx.nsepGain,
        tauE: ctx.lastDiag.tauE ?? NaN, alphaRatio: ctx.alphaRatio, lastVloop: ctx.lastVloop,
        dWdtS: ctx.dWdtS, crashE: ctx.crashE, ignited: +ctx.ignited, tAuxOff: ctx.tAuxOff,
        tDisrupt: ctx.disruption.t, Wd: ctx.disruption.W, IpD: ctx.disruption.Ip,
      });
    },
    restore(st, aux) {
      const num = (k: string, dflt: number) => recNum(st, k, dflt);
      if (Number.isFinite(st.rng)) ctx.rng.setState(st.rng);
      ctx.phase = PHASES[st.phase] ?? 'normal';
      ctx.hmode = !!st.hmode;
      ctx.dt = num('dt', 1e-3); ctx.PSOL = num('PSOL', 0); ctx.GammaB = num('GammaB', 0);
      ctx.bc = { Te: num('TeB', 0.1), Ti: num('TiB', num('TeB', 0.1)), n: num('nB', 1e19) };
      ctx.nsepGain = num('nsepGain', 1);
      ctx.alphaRatio = num('alphaRatio', 0); ctx.lastVloop = num('lastVloop', 0);
      ctx.dWdtS = num('dWdtS', 0); ctx.crashE = num('crashE', 0); ctx.ignited = !!st.ignited;
      // Infinity (the external heating stays on) is a number too, but a record that went through JSON has null
      ctx.tAuxOff = typeof st.tAuxOff === 'number' ? st.tAuxOff : Infinity;
      const D = ctx.disruption;
      D.t = num('tDisrupt', 0); D.W = num('Wd', 0); D.Ip = num('IpD', 0);
      ctx.terminated = null; ctx.pending = []; ctx.diagStale = false;
      if (aux) {
        const geo = aux.geo as ProfileContext['geo'];
        if (geo !== ctx.geo) ctx.adoptGeometry(geo);
        // the kernel hands out the flux-surface snapshot of a frame right after saving it, so the restored
        // equilibrium has been snapshotted already (adoptGeometry raised the flag for a swap during the replay)
        ctx.eqDirty = false;
        ctx.warned = new Set(aux.warned as string[]);
        D.cause = aux.disruptCause as DisruptionCause; D.text = aux.diagText as string;
        ctx.lastDiag = { ...(aux.lastDiag as Record<string, number>) };
        if (aux.lastProf) ctx.lastProf = aux.lastProf as ProfileContext['lastProf'];
      } else {
        // a record from elsewhere (no stored references): keep the current equilibrium and disruption
        // text; τ_E of the last diagnostics feeds the fueling loop of the next step, the rest is
        // rebuilt from y by the next diagnostics call
        ctx.warned.clear();
        ctx.lastDiag = Number.isFinite(st.tauE) ? { tauE: st.tauE } : {};
      }
    },
  };
}
