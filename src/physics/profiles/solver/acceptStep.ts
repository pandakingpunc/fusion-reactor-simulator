/**
 * Update after an accepted transport step from t to t + dt: the global (0D) quantities that are
 * integrated explicitly over the step, in this order:
 *
 *   power totals and stored energy (dW/dt from the old state with the old ion density) → boundary
 *   outflux Γ_b and loop voltage → ELM power average → lagged P_SOL → loss power and confinement
 *   times → C_χ controller → separatrix density gain → He ash, impurity and fuel mix → energy,
 *   neutron and tritium counters → NTM islands → diagnostics of the new state.
 *
 * The equilibrium update check follows (ProfileModel).
 */
import type { ProfileContext } from '../context';
import { KEV } from '../context';
import { evolveInventories } from '../composition';
import { updatePsol } from '../boundary/sol';
import { confinementTimes, lossPower, updateTransportMultiplier } from '../control/confinement';
import { FuelingControl } from '../control/fueling';
import { powerTotals, writeDiagnostics } from '../diagnostics';
import { evolveIslands } from '../events/ntm';
import { volumeIntegral } from '../sources/deposition';

export function acceptStep(ctx: ProfileContext, fueling: FuelingControl, predictive: boolean, t: number, dt: number, yOld: Float64Array, y: Float64Array): void {
  const N = ctx.N, w = ctx.w, g = ctx.tg, c = ctx.cfg;
  const v = ctx.view(y), o = ctx.view(yOld), s = v.s;
  const K = ctx.lastK!;
  // volume integrals [W]
  const P = powerTotals(ctx, K);
  const Rfus = volumeIntegral(g, w.Rfus), Nn = volumeIntegral(g, w.Nfus);
  let We = 0, Wi = 0;
  for (let i = 0; i < N; i++) { We += 1.5 * v.ne[i] * v.Te[i] * KEV * g.dV[i]; Wi += 1.5 * w.ni[i] * v.Ti[i] * KEV * g.dV[i]; }
  const W = We + Wi;
  let W0 = 0;
  for (let i = 0; i < N; i++) W0 += 1.5 * (o.ne[i] * o.Te[i] + w.ni0[i] * o.Ti[i]) * KEV * g.dV[i];
  const dWdt = (W - W0) / dt;
  ctx.GammaB = ctx.dens.GammaF[N];
  ctx.lastVloop = (2 * Math.PI * (v.psi[N - 1] - o.psi[N - 1])) / dt;
  // ELM power, exponential memory τ = 1 s
  s.Pelm = o.s.Pelm * Math.exp(-dt / 1.0);
  updatePsol(ctx, dt, P.P_heat, P.P_rad, dWdt);
  // confinement
  const nbar = ctx.lineAvg(v.ne);
  const P_loss = lossPower(ctx, P.P_heat, P.P_rad);
  const { tauScal, tauE, tauT } = confinementTimes(ctx, predictive, v, W, P_loss, nbar);
  updateTransportMultiplier(ctx, predictive, dt, o, v, W, P_loss, tauScal);
  fueling.updateSeparatrixGain(ctx, t, dt, nbar, tauT);
  // He ash, impurity, fuel mix
  const Sf = s.Sfuel * FuelingControl.efficiency(ctx);
  const wA = c.fueling.method === 'nbi' ? 1 : c.fuelFracA;
  evolveInventories(ctx, o, v, { dt, tauT, Rfus, Sf, S_nbi: K.S_nbi, wA });
  // counters
  s.Efus = o.s.Efus + P.P_fus * dt;
  s.Ein = o.s.Ein + (K.P_NBI + K.P_IC + K.P_EC + P.P_oh) * dt;
  s.Nn = o.s.Nn + Nn * dt;
  if (c.fuel === 'DT') { s.NTburn = o.s.NTburn + Rfus * dt; s.NTfuel = o.s.NTfuel + Sf * (1 - wA) * dt; }
  // NTM islands (modified Rutherford equation, explicit substeps)
  evolveIslands(ctx, dt, o, v);
  writeDiagnostics(ctx, t + dt, v, { ...P, W, dWdt, tauE, tauScal, P_loss, nbar, P_bound: ctx.Pbound });
}
