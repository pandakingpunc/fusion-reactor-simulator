/**
 * Table helpers of the Grad–Shafranov coupling: the transport profiles p(ρ) and ⟨j_φ/R⟩(ρ) are handed to the
 * solver as tables on ψ_N nodes, and the equilibrium's own tables can be read back on any ψ_N nodes.
 *
 * The nodes of the input table are the transport radii ρ_j = j/N (the transport grid's faces) mapped to ψ_N through the
 * ρ_tor(ψ_N) of an equilibrium. They are uniform in ρ, so the table is as fine as the profiles it carries and no
 * finer: a table on the solver's output surfaces (ψ_N = surfaceLevels(101), clustered at the edge) has nodes within
 * 1e−3 of ψ_N of one another at the LCFS, which the grid cannot resolve, and the iteration then sees the pedestal
 * at sub-grid scale (JET15: the second update fails to converge in 100 iterations with such a table, in 7 with this one).
 */
import { Pchip } from '../../numerics/interp';
import type { Equilibrium } from '../../equilibrium/gs';

const MU0 = 1.25663706212e-6;

type Tables = Pick<Equilibrium, 'prof'>;

/** ⟨j_φ/R⟩ = p′ + FF′⟨R⁻²⟩/μ0 [A/m³] on the ψ_N nodes of the equilibrium's own tables (S. P. Hirshman & S. C. Jardin, Phys. Fluids 22 (1979) 731) */
export function currentTable(eq: Tables): Float64Array {
  const P = eq.prof;
  return Float64Array.from(P.psiN, (_, i) => P.pp[i] + (P.FFp[i] * P.avgR2inv[i]) / MU0);
}

/** ρ_tor of the equilibrium at ψ_N = x (monotone cubic through its table) */
export function rhoOfPsiN(eq: Tables, x: ArrayLike<number>): Float64Array {
  const S = new Pchip(eq.prof.psiN, eq.prof.rhoTor);
  return Float64Array.from(x, (v) => S.eval(Math.min(Math.max(v, 0), 1)));
}

/** ψ_N of the radii ρ on the equilibrium (the inverse of ρ_tor(ψ_N)); ψ_N(0) = 0 and ψ_N(1) = 1 exactly */
export function psiNOfRho(eq: Tables, rho: ArrayLike<number>): Float64Array {
  const S = new Pchip(eq.prof.rhoTor, eq.prof.psiN);
  return Float64Array.from(rho, (r) => (r <= 0 ? 0 : r >= 1 ? 1 : S.eval(r)));
}

/** The equilibrium's own p(ψ_N) and ⟨j_φ/R⟩(ψ_N) on the nodes x: the tables that reproduce it */
export function equilibriumTables(eq: Tables, x: ArrayLike<number>): { p: Float64Array; jR: Float64Array } {
  const P = eq.prof;
  const pS = new Pchip(P.psiN, P.p), jS = new Pchip(P.psiN, currentTable(eq));
  const c = (v: number) => Math.min(Math.max(v, 0), 1);
  return { p: Float64Array.from(x, (v) => pS.eval(c(v))), jR: Float64Array.from(x, (v) => jS.eval(c(v))) };
}

/** a + s (b − a) */
export function blend(a: ArrayLike<number>, b: ArrayLike<number>, s: number): Float64Array {
  return Float64Array.from(a, (v, i) => v + s * (b[i] - v));
}

/**
 * How far the tables are from consistent with an equilibrium: the rms over the interior nodes with ρ_j ≥ rhoMin of
 * ρ_tor(x_j) of the equilibrium minus the ρ_j the node was made for (it would be 0 if the table were the transport
 * profile at exactly the equilibrium's own radii). Nodes uniform in ρ: the plain rms is the rms over the radius. The
 * core below rhoMin is left out: within a couple of grid cells of the axis ρ_tor(ψ_N) = √(Φ/Φ_b) follows q(0), which
 * the grid does not resolve (it changes by tens of percent between two equilibria of the same tables) and the tables
 * do not depend on (`coreFlat`).
 */
export function mappingMismatch(eq: Tables, x: ArrayLike<number>, rho: ArrayLike<number>, rhoMin = 0): number {
  const r = rhoOfPsiN(eq, x);
  let s = 0, n = 0;
  for (let j = 1; j < rho.length - 1; j++) if (rho[j] >= rhoMin) { s += (r[j] - rho[j]) ** 2; n++; }
  return Math.sqrt(s / Math.max(n, 1));
}

/**
 * The profile with its values below rhoCore replaced by its value at rhoCore: a table that carries no structure in the
 * core the grid cannot resolve (the transport's ⟨j_φ/R⟩ = 2π dI/dV of the innermost cells is a ratio of two small
 * numbers and dips there: JET15 173 kA/m³ at ρ = 0 against 470 at 0.14).
 */
export function coreFlat(values: ArrayLike<number>, rho: ArrayLike<number>, rhoCore: number): Float64Array {
  let k = 0;
  while (k < rho.length - 1 && rho[k] < rhoCore) k++;
  // linear interpolation between the nodes that bracket rhoCore
  const t = k > 0 ? (rhoCore - rho[k - 1]) / (rho[k] - rho[k - 1]) : 0;
  const v = k > 0 ? values[k - 1] + t * (values[k] - values[k - 1]) : values[0];
  return Float64Array.from(values, (val, j) => (rho[j] < rhoCore ? v : val));
}
