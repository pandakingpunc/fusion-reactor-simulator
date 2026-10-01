/**
 * Update after an accepted transport step from t to t + dt: the global (0D) quantities that are
 * integrated explicitly over the step, in this order:
 *
 *   power totals, fast-ion pools and stored energy (dW/dt from the old state with the old ion density) → boundary
 *   outflux Γ_b and loop voltage → ELM power average → smoothed dW/dt → lagged P_SOL (from the smoothed,
 *   ELM-inclusive dW/dt) → loss power and confinement times → C_χ controller → separatrix density gain → He ash, impurity and fuel
 *   mix → energy, neutron and tritium counters → NTM islands → the transport model's and the
 *   sources' `accepted` hooks → diagnostics of the new state.
 *
 * The equilibrium update check follows (ProfileModel).
 */
import type { ProfileContext } from '../context';
import { evolveInventories } from '../composition';
import { advanceFastIons } from '../fastIons';
import { updatePsol } from '../boundary/sol';
import { confinementTimes, emergentH, lossPower, updateTransportMultiplier } from '../control/confinement';
import { FuelingControl } from '../control/fueling';
import { powerTotals, writeDiagnostics } from '../diagnostics';
import { evolveIslands } from '../events/ntm';
import { volumeIntegral } from '../sources/deposition';
import type { PhysicsPipeline } from './pipeline';

export function acceptStep(ctx: ProfileContext, fueling: FuelingControl, physics: PhysicsPipeline, t: number, dt: number, yOld: Float64Array, y: Float64Array): void {
  const N = ctx.N, w = ctx.w, g = ctx.tg, c = ctx.cfg;
  const predictive = physics.transport.predictive;
  const v = ctx.view(y), o = ctx.view(yOld), s = v.s;
  const K = ctx.lastK!;
  // volume integrals [W]
  const P = powerTotals(ctx, K);
  advanceFastIons(ctx, P, dt);
  const Rfus = volumeIntegral(g, w.Rfus), Nn = volumeIntegral(g, w.Nfus), ashRate = volumeIntegral(g, w.ash);
  // stored energy: one definition (ctx.storedEnergy), with the ion density of the old composition for the old state
  const W = ctx.storedEnergy(v);
  const W0 = ctx.storedEnergy(o, w.ni0);
  const dWdt = (W - W0) / dt;
  ctx.GammaB = ctx.dens.GammaF[N];
  ctx.flux.advance(ctx, o, v, dt); // loop voltage and the flux accounting (current/flux.ts)
  // ELM power, exponential memory τ = 1 s
  s.Pelm = o.s.Pelm * Math.exp(-dt / 1.0);
  // smoothed dW/dt of the loss power: the average rate of change of W, which includes the energy the ELM
  // crashes took out of the plasma between the previous step and this one (booked in ctx.crashE), so that it
  // vanishes in a steady H-mode; low-pass filtered with τ_E of the previous step (5 ms at least), as in the 0D model
  const dWdtTotal = (W - W0 - ctx.crashE) / dt;
  ctx.crashE = 0;
  ctx.dWdtS += (dWdtTotal - ctx.dWdtS) * (1 - Math.exp(-dt / Math.max(ctx.lastDiag.tauE ?? 0.1, 5e-3)));
  // P_SOL: the ELM-averaged power that crosses the separatrix, P_heat − P_rad − (dW/dt including the ELM crashes)
  updatePsol(ctx, dt, P.P_heat, P.P_rad, ctx.dWdtS);
  // confinement
  const nbar = ctx.lineAvg(v.ne);
  const P_loss = lossPower(ctx, P.P_heat, P.P_rad_core, ctx.dWdtS);
  const { tauScal, tauE, tauT } = confinementTimes(ctx, predictive, v, W, P_loss, nbar);
  const H = predictive ? emergentH(ctx, s.Ip / 1e6, nbar, P_loss, tauE) : undefined;
  updateTransportMultiplier(ctx, predictive, dt, o, v, W, P_loss, tauScal);
  fueling.updateSeparatrixGain(ctx, t, dt, nbar, tauT);
  // He ash, impurity, fuel mix
  const Sf = s.Sfuel * FuelingControl.efficiency(ctx);
  const wA = c.fueling.method === 'nbi' ? 1 : c.fuelFracA;
  evolveInventories(ctx, o, v, { dt, tauT, ashRate, Sf, S_nbi: K.S_nbi, wA });
  // counters
  s.Efus = o.s.Efus + P.P_fus * dt;
  s.Ein = o.s.Ein + (K.P_NBI + K.P_IC + K.P_EC + P.P_oh) * dt;
  s.Nn = o.s.Nn + Nn * dt;
  if (c.fuel === 'DT') { s.NTburn = o.s.NTburn + Rfus * dt; s.NTfuel = o.s.NTfuel + Sf * (1 - wA) * dt; }
  // NTM islands (modified Rutherford equation, explicit substeps)
  evolveIslands(ctx, dt, o, v);
  // state of plug-in modules
  physics.accepted(t, dt, o, v);
  writeDiagnostics(ctx, v, { ...P, W, dWdt, W_alpha: ctx.WfAlpha, W_beam: ctx.WfBeam, tauE, tauScal, P_loss, nbar, P_bound: ctx.Pbound, H });
  // the barrier depth of the EPED1-type pedestal follows the pressure ratio of the new state (pedestal/PedestalModel.ts)
  ctx.ped?.advance(ctx, dt);
}
