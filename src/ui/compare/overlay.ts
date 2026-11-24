/**
 * Overlay of runs: which diagnostic channels the shots have in common, and their traces sampled for a shared plot.
 * Pure, no DOM.
 */
import type { DiagSpec } from '../../physics/types';
import type { SavedShot } from '../state/types';

export type TimeAxis = 'abs' | 'norm';

/** the channels that every shot has (label, unit and log flag of the first shot), in the first shot's order */
export function commonChannels(shots: readonly SavedShot[]): DiagSpec[] {
  if (!shots.length) return [];
  const others = shots.slice(1).map((s) => new Set(s.meta.diagSpecs.map((d) => d.key)));
  return shots[0].meta.diagSpecs.filter((d) => others.every((o) => o.has(d.key)));
}

/** absolute time is only meaningful when all shots count time in the same unit (s, ns or µs) */
export function timeAxisAllowed(shots: readonly SavedShot[]): boolean {
  return shots.every((s) => s.meta.timeUnit === shots[0].meta.timeUnit);
}

export interface Trace { shotId: number; points: { x: number; y: number }[] }

export interface ProfileChannel { key: string; label: string; unit: string }

/** Radial profile channels available for 1.5D shot-to-shot comparison. */
export const PROFILE_COMPARE_CHANNELS: readonly ProfileChannel[] = [
  { key: 'Te', label: 'T_e', unit: 'keV' },
  { key: 'Ti', label: 'T_i', unit: 'keV' },
  { key: 'ne', label: 'n_e', unit: '10²⁰ m⁻³' },
  { key: 'q', label: 'q', unit: '' },
  { key: 'shear', label: 's', unit: '' },
  { key: 'j', label: 'j_tot', unit: 'MA m⁻²' },
  { key: 'jbs', label: 'j_bs', unit: 'MA m⁻²' },
  { key: 'chie', label: 'χ_e', unit: 'm² s⁻¹' },
  { key: 'chii', label: 'χ_i', unit: 'm² s⁻¹' },
  { key: 'Palpha', label: 'p_α', unit: 'MW m⁻³' },
];

export interface ProfileOverlayItem { shot: SavedShot; trace: Trace; t: number }

/** Latest radial profile of `key` vs rho_tor for each shot that carries 1.5D profiles. */
export function profileOverlayTraces(shots: readonly SavedShot[], key: string): ProfileOverlayItem[] {
  const out: ProfileOverlayItem[] = [];
  for (const s of shots) {
    let f = null;
    for (let i = s.frames.length - 1; i >= 0; i--) {
      const fr = s.frames[i];
      if (fr.prof?.rho?.length && fr.prof[key]?.length === fr.prof.rho.length) { f = fr; break; }
    }
    if (!f?.prof) continue;
    const rho = f.prof.rho, ys = f.prof[key];
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < rho.length; i++) if (Number.isFinite(rho[i]) && Number.isFinite(ys[i])) points.push({ x: rho[i], y: ys[i] });
    if (points.length >= 2) out.push({ shot: s, trace: { shotId: s.id, points }, t: f.t });
  }
  return out;
}

/**
 * The trace of channel `key` of each shot. x is the time in the shot's unit ('abs') or the fraction of the shot's
 * duration ('norm'); at most `maxPoints` points per trace (evenly thinned, the last frame always kept); frames
 * where the channel is not finite are skipped.
 */
export function overlayTraces(shots: readonly SavedShot[], key: string, axis: TimeAxis, maxPoints = 400): Trace[] {
  return shots.map((s) => {
    const dur = Math.max(s.frames.length ? s.frames[s.frames.length - 1].t : 0, 1e-300);
    const step = Math.max(1, Math.ceil(s.frames.length / maxPoints));
    const points: { x: number; y: number }[] = [];
    s.frames.forEach((f, i) => {
      if (i % step !== 0 && i !== s.frames.length - 1) return;
      const y = f.d[key];
      if (typeof y === 'number' && Number.isFinite(y)) points.push({ x: axis === 'norm' ? f.t / dur : f.t, y });
    });
    return { shotId: s.id, points };
  });
}

/** bounds of a set of traces (undefined for no points); with `log` only positive values count */
export function extent(traces: readonly Trace[], log: boolean): { x0: number; x1: number; y0: number; y1: number } | undefined {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const t of traces) for (const p of t.points) {
    if (log && p.y <= 0) continue;
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return Number.isFinite(x0) ? { x0, x1, y0, y1 } : undefined;
}

/** "nice" tick positions inside [lo, hi] (steps 1, 2, 5 × 10^k); log axes get one tick per decade (a few more for a narrow range) */
export function tickValues(lo: number, hi: number, log: boolean, target = 5): number[] {
  if (!(hi > lo)) return [lo];
  if (log) {
    const a = Math.floor(Math.log10(lo)), b = Math.ceil(Math.log10(hi));
    const out: number[] = [];
    const mults = b - a <= 2 ? [1, 2, 5] : [1];
    for (let e = a; e <= b; e++) for (const m of mults) { const v = m * 10 ** e; if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) out.push(v); }
    return out.length >= 2 ? out : [lo, hi];
  }
  const raw = (hi - lo) / Math.max(target, 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw * 0.9999)!;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}
