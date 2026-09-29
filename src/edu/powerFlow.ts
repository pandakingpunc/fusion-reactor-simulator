/**
 * The power balance of a magnetic run as a flow diagram: what heats the plasma (auxiliary heating, ohmic heating, the
 * alpha particles) and where the power goes (radiation, conduction, ELM crashes, the stored energy W growing,
 * whatever the model does not itemise). Pure functions over diagnostic records; the drawing is in src/ui/edu.
 *
 * The 0D and 1.5D models keep the ledger P_heat = P_rad + P_transport + dW/dt (P_transport = P_cond + P_ELM); the
 * heating power that is injected but not yet deposited (a neutral beam whose fast ions are still slowing down,
 * shine-through) is the only place the itemised terms do not close, and it is shown as its own bar ("other")
 * instead of being hidden.
 */
import type { SankeyLinkIn, SankeyNodeIn } from './sankey';

type Diag = Readonly<Record<string, number>>;

/** All powers in MW. */
export interface PowerBalance {
  /** sources */
  aux: number; ohmic: number; alpha: number;
  /** sinks */
  brems: number; sync: number; line: number; conduction: number; elm: number;
  /** dW/dt: positive = the plasma heats up (a sink), negative = it gives back stored energy (a source) */
  stored: number;
  /** (aux + ohmic + alpha) − (radiation + transport + dW/dt): positive = power not (yet) deposited, negative = released */
  other: number;
  /** radiation not split into bremsstrahlung, synchrotron and line (P_rad minus the three) */
  radOther: number;
}

const val = (d: Diag, k: string): number | undefined => { const v = d[k]; return typeof v === 'number' && Number.isFinite(v) ? v : undefined; };
const pos = (x: number) => Math.max(x, 0);

/** The balance of one diagnostic record, or null when the record has no power channels (pulsed devices, muon). */
export function powerBalance(d: Diag): PowerBalance | null {
  const aux = val(d, 'P_aux'), rad = val(d, 'P_rad');
  if (aux === undefined || rad === undefined) return null;
  const ohmic = pos(val(d, 'P_oh') ?? 0), alpha = pos(val(d, 'P_alpha') ?? 0);
  const elmRaw = pos(val(d, 'P_ELM') ?? 0);
  const total = val(d, 'P_transport') ?? ((val(d, 'P_cond') ?? 0) + elmRaw);
  const elm = Math.min(elmRaw, total);
  const conduction = pos(val(d, 'P_ELM') !== undefined && val(d, 'P_cond') !== undefined ? val(d, 'P_cond')! : total - elm);
  const stored = val(d, 'dWdt') ?? val(d, 'dWdt_s') ?? 0;
  const brems = pos(val(d, 'P_brems') ?? 0), sync = pos(val(d, 'P_sync') ?? 0), line = pos(val(d, 'P_line') ?? 0);
  const radOther = rad - brems - sync - line;
  const other = pos(aux) + ohmic + alpha - (rad + conduction + elm + stored);
  return { aux: pos(aux), ohmic, alpha, brems, sync, line, conduction, elm, stored, other, radOther };
}

/** total power going in (sources incl. released energy) = total going out (sinks incl. stored and other) */
export function balanceTotals(pb: PowerBalance): { in: number; out: number } {
  const radiation = pb.brems + pb.sync + pb.line + pb.radOther;
  const sources = pb.aux + pb.ohmic + pb.alpha + pos(-pb.stored) + pos(-pb.other);
  const sinks = radiation + pb.conduction + pb.elm + pos(pb.stored) + pos(pb.other);
  return { in: sources, out: sinks };
}

/** The bars and bands of the diagram, in MW: four columns (sources · plasma · sinks · radiation split). */
export function powerFlowGraph(pb: PowerBalance, minMW = 1e-3): { nodes: SankeyNodeIn[]; links: SankeyLinkIn[] } {
  const radiation = pb.brems + pb.sync + pb.line + pb.radOther;
  const nodes: SankeyNodeIn[] = [];
  const links: SankeyLinkIn[] = [];
  const add = (id: string, layer: number) => nodes.push({ id, layer });
  const link = (source: string, target: string, value: number) => { if (value > minMW) links.push({ source, target, value }); };

  for (const id of ['aux', 'ohmic', 'alpha', 'release']) add(id, 0);
  add('plasma', 1);
  for (const id of ['radiation', 'conduction', 'elm', 'stored', 'other']) add(id, 2);
  for (const id of ['brems', 'sync', 'line', 'radMisc']) add(id, 3);

  link('aux', 'plasma', pb.aux);
  link('ohmic', 'plasma', pb.ohmic);
  link('alpha', 'plasma', pb.alpha);
  link('release', 'plasma', pos(-pb.stored) + pos(-pb.other));
  link('plasma', 'radiation', radiation);
  link('plasma', 'conduction', pb.conduction);
  link('plasma', 'elm', pb.elm);
  link('plasma', 'stored', pos(pb.stored));
  link('plasma', 'other', pos(pb.other));
  link('radiation', 'brems', pb.brems);
  link('radiation', 'sync', pb.sync);
  link('radiation', 'line', pb.line);
  link('radiation', 'radMisc', pos(pb.radOther));
  return { nodes, links };
}

/** Time-weighted mean of every channel over [t0, t1] (a single record when the window holds one frame). */
export function averageDiag(frames: readonly { t: number; d: Diag }[], t0: number, t1: number): Record<string, number> {
  const inside = frames.filter((f) => f.t >= t0 - 1e-12 && f.t <= t1 + 1e-12);
  if (!inside.length) return {};
  if (inside.length === 1) return { ...inside[0].d };
  const sums: Record<string, number> = {};
  const wsum: Record<string, number> = {};
  for (let i = 0; i < inside.length; i++) {
    const lo = i === 0 ? inside[0].t : (inside[i - 1].t + inside[i].t) / 2;
    const hi = i === inside.length - 1 ? inside[i].t : (inside[i].t + inside[i + 1].t) / 2;
    const w = Math.max(hi - lo, 0);
    for (const [k, v] of Object.entries(inside[i].d)) {
      if (!Number.isFinite(v)) continue;
      sums[k] = (sums[k] ?? 0) + w * v;
      wsum[k] = (wsum[k] ?? 0) + w;
    }
  }
  const out: Record<string, number> = {};
  for (const k of Object.keys(sums)) if (wsum[k] > 0) out[k] = sums[k] / wsum[k];
  return out;
}

/**
 * Which part of a run the diagram shows: 'flat' the mean over the last 30 % of the recorded time (the flat-top),
 * 'shot' the mean over the whole run, 'peak' the record of the highest Q, or the record nearest to a time.
 */
export type PowerWindow = 'flat' | 'shot' | 'peak' | { t: number };

export function pickDiag(frames: readonly { t: number; d: Diag }[], w: PowerWindow): Record<string, number> {
  if (!frames.length) return {};
  const tLast = frames[frames.length - 1].t;
  if (w === 'shot') return averageDiag(frames, frames[0].t, tLast);
  if (w === 'flat') return averageDiag(frames, 0.7 * tLast, tLast);
  if (w === 'peak') {
    let best = 0, bq = -Infinity;
    frames.forEach((f, i) => { const q = f.d.Q; if (typeof q === 'number' && Number.isFinite(q) && q > bq) { bq = q; best = i; } });
    return { ...frames[best].d };
  }
  let near = 0;
  frames.forEach((f, i) => { if (Math.abs(f.t - w.t) < Math.abs(frames[near].t - w.t)) near = i; });
  return { ...frames[near].d };
}
