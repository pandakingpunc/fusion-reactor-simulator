/**
 * Beam-target fusion from the fast-ion energy fields (fastIonModel = 'profile'): the density of the beam ions of each energy component is
 * the content of its field over the mean energy of the slowing-down distribution,
 *
 *   n_f,k = w_k τ_th,k / (E_k τ_W,k),
 *
 * which is the steady-state n_f = S τ_th of the scalar model when the field has reached its steady content w = S E_k τ_W (heating.ts: τ_th the
 * thermalisation time, τ_W the energy time of the slowing-down distribution), and follows the build-up, the decay and the orbit smoothing of
 * the field otherwise. The reaction rate of a channel is n_f,k n_target ⟨σv⟩_bt(E_c, T_i) as in sources/nbi.ts (beamtarget.ts tables).
 */
import { FUEL_CHANNELS, FUEL_SPECIES, beamTargetDensity } from '../../reactivity';
import { criticalEnergy, fastIonEnergyTime, slowingDownTime } from '../../heating';
import { BeamTargetTable } from '../beamtarget';
import { KEV, type ProfileContext, type StepConstants } from '../context';
import type { ProfileState } from '../state';
import { TAU_MIN } from './pool';

/** J per MeV */
const MEV = 1e3 * KEV;

/**
 * Adds the beam-target rates of the fields (with the temperatures and density of the old state `st`) to K.btR (per channel and cell), the beam-ion density to w.nfast and the beam-target power to w.Pbt.
 * `comps`: [energy, power fraction] of the beam components; `tables`: the reactivity tables by energy (created here when missing).
 */
export function poolBeamTarget(ctx: ProfileContext, st: ProfileState, K: StepConstants, comps: readonly (readonly [number, number])[], tables: Map<number, BeamTargetTable>): void {
  const f = ctx.fast, w = ctx.w, N = ctx.N, c = ctx.cfg;
  if (!f || c.fuel === 'pB11') return;
  const fs = FUEL_SPECIES[c.fuel];
  const chans = FUEL_CHANNELS[c.fuel];
  const svBuf: number[] = chans.map(() => 0);
  const { Te, Ti, ne } = st;
  comps.forEach(([Ek], k) => {
    const W = f.beam[k].W;
    let wMax = 0;
    for (let i = 0; i < N; i++) wMax = Math.max(wMax, W[i]);
    if (!(wMax > 0)) return;
    let tab = tables.get(Ek);
    if (!tab) { tab = new BeamTargetTable(c.fuel, Ek); tables.set(Ek, tab); }
    for (let i = 0; i < N; i++) {
      if (!(W[i] > 1e-3 * wMax)) continue;
      const Tev = Math.max(Te[i], 0.01), Ec = criticalEnergy(Tev, fs.a.A, w.ionSum[i]);
      const tauW = Math.max(fastIonEnergyTime(Tev, ne[i], fs.a.A, fs.a.Z, Ek, Ec), TAU_MIN);
      const tsd = slowingDownTime(Tev, ne[i], fs.a.A, fs.a.Z, Ek, Ec);
      const nf = (W[i] * tsd) / (Ek * KEV * tauW);
      w.nfast[i] += nf;
      const sv = tab.eval(Ec, Math.max(Ti[i], 0.01), svBuf);
      for (let j = 0; j < chans.length; j++) {
        const R = nf * beamTargetDensity(c.fuel, chans[j], w.na[i], w.nb[i]) * sv[j];
        K.btR[j][i] += R;
        w.Pbt[i] += R * chans[j].Etot_MeV * MEV;
      }
    }
  });
}
