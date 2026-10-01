/**
 * The state at the adoption of a new equilibrium: the conservative remap of the contents (lane ws6c).
 *
 * The transport equations are written on the normalised toroidal-flux coordinate ρ̂ with the geometry of the current equilibrium (V', g2, the cell
 * volumes ΔV = ∫V' dρ̂). While that geometry is held the equations conserve what they should: a cell holds N_i = n_i ΔV_i particles and
 * W_i = (3/2)(n_e T_e + n_i T_i) ΔV_i of energy, and the poloidal flux ψ obeys the diffusion equation with the enclosed current
 * I(ρ̂) = V' g2 ∂ρ̂ψ/(2π μ0). A new equilibrium replaces the geometry at one instant (the update is quasi-static, every 5 to 20 s), and the
 * profiles as functions of ρ̂ (T, n_e, ψ) that were the state of the old geometry become the state of the new one. The cell volumes differ (the
 * total volume is that of the fixed boundary, but ΔV of a cell changes by up to 3 % at the L-H transition and 1 % in a flat top: the
 * Shafranov shift and the pedestal move volume between the cells), so without a remap the contents jump: at the 30 adoptions of the first
 * 60 s of ITER15 the stored energy changed by +0.07 to +0.35 % in the ramp-up and by −1.3 to −1.9 % (the particles by −0.5 to −0.7 %) at five
 * of the six adoptions after 42 s, with no source in the balance, and the enclosed current at the faces changed by the ratio of V' g2 with ψ
 * held, so that the boundary condition (the current I_p, imposed on the new geometry) and the interior disagreed and the first step after
 * the update took a loop voltage of 31 V at t = 0.8 s (0.8 V before it) and 1 to 3.5 V late in the flat top (0.02 to 0.03 V before it) to
 * make up the difference in the outermost cells. With the remap the particles are kept to 10⁻⁵ % and the stored energy to 0.025 %
 * (the composition follows n_e through inventories that do not scale with the cell volume).
 *
 * This is what the V̇' terms of the heat and particle equations (∂(n V')/∂t and ∂((3/2) n T V')/∂t at fixed ρ̂ carry the change of V' of a
 * surface into the profile) and the Φ̇_b term of the current equation do over the time the geometry changes, taken to the limit of an
 * instant. The remap keeps, cell by cell,
 *
 *   - the particles:    n_e ← n_e ΔV_old/ΔV_new       (N_i conserved; the composition, which is a function of n_e and the inventories, follows);
 *   - the energy:       T_e, T_i unchanged            (W_i = (3/2) n T ΔV conserved as n scales with 1/ΔV); no work is done on the plasma by the
 *                                                       change of volume (the fixed-boundary equilibrium changes its metric at the accuracy of its
 *                                                       solver and of the profiles it is given, not by a compression that would do pdV work);
 *   - the current:      the enclosed current I(ρ̂_f) at every face is kept, so ∂ρ̂ψ ← ∂ρ̂ψ (V' g2)_old/(V' g2)_new, and the flux at the
 *                       boundary ψ_b (the quantity the loop voltage is made of) is continuous. The boundary face carries I_p on both geometries.
 *
 * What is not kept is the pressure profile as a function of ρ̂ that the equilibrium was solved for (it changes by the ratio of the volumes, at most a
 * few percent of a cell's value): the next update takes the tables from the state as it is. The ledger of the flux
 * (current/flux.ts) is not touched: ψ_b is continuous and the integrals run over the steps.
 */
import { MU0 } from '../context';
import type { TransportGeometry } from '../geometry1d';

/**
 * Remaps the density ne and the poloidal flux psi (arrays of N cells, changed in place) from the geometry `o` to the geometry `n` (built on the same
 * radial grid), at the plasma current Ip [A]. T_e and T_i stay as they are.
 */
export function remapContents(o: TransportGeometry, n: TransportGeometry, ne: Float64Array, psi: Float64Array, Ip: number): void {
  const N = o.N;
  for (let i = 0; i < N; i++) ne[i] *= o.dV[i] / n.dV[i];
  // the boundary gradient of ψ that carries I_p, and the flux at the boundary, which is kept
  const gradB = (g: TransportGeometry) => (2 * Math.PI * MU0 * Ip) / (g.VpF[N] * g.g2F[N]);
  const psiB = psi[N - 1] + gradB(o) * o.distF[N];
  // the differences of ψ between neighbouring centres, scaled so that I = V' g2 ψ'/(2π μ0) is the same on the new geometry
  const step = new Float64Array(N);
  for (let f = 1; f < N; f++) step[f] = (psi[f] - psi[f - 1]) * ((o.VpF[f] * o.g2F[f]) / (n.VpF[f] * n.g2F[f]));
  psi[N - 1] = psiB - gradB(n) * n.distF[N];
  for (let i = N - 1; i >= 1; i--) psi[i - 1] = psi[i] - step[i];
}
