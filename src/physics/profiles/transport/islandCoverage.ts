/**
 * Island flattening on a radial grid.
 *
 * The extra transport of an NTM island (χ_e and χ_i + 5 m²/s across its width, transport/coefficients.ts) is a property of the
 * island, not of the grid: the width in ρ over which the profiles are flattened has to be the island's width whatever the faces are.
 * The transport coefficients live on the faces, and a face stands for its control interval: the stretch of ρ between the
 * midpoints to the two neighbouring faces, which is the stretch between the centres of the two cells that share the face (the nodes whose
 * difference fixes the flux through it). The faces at the axis and at the separatrix own the half cell next to them, so the control
 * intervals tile [0, 1] without a gap or an overlap, on a uniform and on an edge-packed grid alike.
 *
 * The extra χ of a face is weighted by the fraction of its control interval that lies inside the island [ρ_s − w/2, ρ_s + w/2], so
 * that the sum over the faces of (extra χ) × (control interval) is 5 m²/s times the island width (the part inside [0, 1]) on any grid,
 * and a face that the island covers only in part gets only that part.
 * The test this replaces (the whole 5 m²/s on every face with |ρ − ρ_s| < w/2, in the code since v3.0.0) counts whole control intervals
 * or none: the flattened width then depends on where the faces fall (the 3/2 island of ITER15 at w/a = 0.085 was flattened over 0.78 of its
 * width at 25 and at 50 cells, 1.12 at 35, 0.84 at 70 and 0.98 at 100 and 120 cells on the default edge-packed grid), which made the
 * saturated island width, and with it Q, depend on the grid (an independent investigation found Q following w₃₂ with r = −0.998 over 19 grids
 * from 25 to 140 cells), and an island narrower than a face spacing and sitting between two faces had no effect at all.
 */
import type { RadialGrid } from '../geometry1d';

/** χ_e and χ_i added across an NTM island (flattening of the profiles inside it) [m²/s] */
export const ISLAND_CHI = 5;

type Faces = Pick<RadialGrid, 'N' | 'rhoF'>;

/** Lower end of the control interval of face f: the midpoint to face f − 1, or the axis for f = 0 */
function intervalLo(g: Faces, f: number): number {
  return f > 0 ? 0.5 * (g.rhoF[f - 1] + g.rhoF[f]) : 0;
}

/** Upper end of the control interval of face f: the midpoint to face f + 1, or the separatrix for f = N */
function intervalHi(g: Faces, f: number): number {
  return f < g.N ? 0.5 * (g.rhoF[f] + g.rhoF[f + 1]) : 1;
}

/** Control interval [lo, hi] of face f (0 … N): between the midpoints to the neighbouring faces, [0, ρ_C0] at the axis and [ρ_C,N−1, 1] at the separatrix */
export function faceControlInterval(g: Faces, f: number): [number, number] {
  return [intervalLo(g, f), intervalHi(g, f)];
}

/**
 * Fraction (0 … 1) of the control interval of face f that lies inside the island [ρ_s − w/2, ρ_s + w/2]; a part of the island beyond the
 * axis or the separatrix does not exist and covers nothing. 0 for an empty (w ≤ 0) or non-finite island.
 */
export function islandCoverage(g: Faces, f: number, rs: number, width: number): number {
  const lo = intervalLo(g, f), hi = intervalHi(g, f);
  const overlap = Math.min(rs + 0.5 * width, hi) - Math.max(rs - 0.5 * width, lo);
  return overlap > 0 && hi > lo ? overlap / (hi - lo) : 0;
}
