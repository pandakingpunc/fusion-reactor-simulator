/**
 * Fusion source of the 1.5D model against independent evaluations of the reaction physics: the
 * thermal rate of every channel (D-D with any split of the two fuel slots, D-³He with its D-D side
 * channels), the fuel burn-up and ash production per channel, the beam-target rate per channel, and
 * the heating by every charged product with its own Stix critical energy. The 1.5D counterparts of
 * the 0D fixes of ws2b (magnetic.ts); the reference values are computed here from the channel
 * table (reactivity.ts) and the slowing-down functions (heating.ts), not from the source.
 */
import { describe, expect, it } from 'vitest';
import { JET_15D } from '../../presets';
import { criticalEnergy, fastIonEnergyTime, ionHeatingFraction } from '../../heating';
import { FUEL_CHANNELS, FuelType, beamTargetReactivity, burnPerReaction, isSingleSpecies, pairDensity } from '../../reactivity';
import type { MagneticConfig } from '../../types';
import { KEV } from '../context';
import { ProfileModel } from '../model';

const MEV = 1e3 * KEV;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
const NO_HEATING = { ...JET_15D.heating, P_NBI_MW: 0, P_ICRH_MW: 0, P_ECRH_MW: 0 };

/**
 * A 1.5D model of `over` with uniform profiles T_e = T_i = T [keV] and n_e [m⁻³], its work arrays
 * evaluated on that state (t = 100 s: the heating is on its full ramp).
 */
function uniform(over: Partial<MagneticConfig>, T: number, ne = 5e19) {
  const m = new ProfileModel({ ...JET_15D, ...over });
  const y = m.initialState();
  const st = m.ctx.view(y);
  st.Te.fill(T); st.Ti.fill(T); st.ne.fill(ne);
  const K = m.physics.evaluateWorkArrays(100, st);
  return { m, ctx: m.ctx, w: m.ctx.w, K, st };
}

describe('thermal reaction rate', () => {
  it.each([0.2, 0.5, 0.8, 1])('D-D with fuelFracA = %s: ½ (n_a + n_b)² ⟨σv⟩ per channel, whatever the split of the two slots', (fA) => {
    const T = 10;
    const { w, ctx } = uniform({ fuel: 'DD', fuelFracA: fA, heating: NO_HEATING }, T);
    const ch = FUEL_CHANNELS.DD;
    const nD = w.na[0] + w.nb[0];
    expect(nD).toBeGreaterThan(1e19);
    const Rref = 0.5 * nD * nD * (ch[0].sigmav(T) + ch[1].sigmav(T));
    for (let i = 0; i < ctx.N; i++) expect(rel(w.Rfus[i], Rref)).toBeLessThan(1e-12);
    // neutrons come from the D(d,n)³He branch only
    expect(rel(w.Nfus[3], 0.5 * nD * nD * ch[1].sigmav(T))).toBeLessThan(1e-12);
    // the fuel is one species: the same rate at every split (the old ½ n_a² was too low by fA²)
    const ref = uniform({ fuel: 'DD', fuelFracA: 1, heating: NO_HEATING }, T);
    expect(rel(w.Rfus[0], ref.w.Rfus[0])).toBeLessThan(1e-12);
    expect(rel(w.Pfus[0], ref.w.Pfus[0])).toBeLessThan(1e-12);
  });

  it('D-T: n_a n_b ⟨σv⟩ (unchanged), and the charged and neutron powers of the channel', () => {
    const T = 12;
    const { w } = uniform({ heating: NO_HEATING }, T);
    const ch = FUEL_CHANNELS.DT[0];
    const R = w.na[5] * w.nb[5] * ch.sigmav(T);
    expect(rel(w.Rfus[5], R)).toBeLessThan(1e-12);
    expect(rel(w.Pchg[5], R * ch.Echarged_MeV * MEV)).toBeLessThan(1e-12);
    expect(rel(w.Pneut[5], R * ch.Eneutron_MeV * MEV)).toBeLessThan(1e-12);
    expect(rel(w.Pfus[5], R * ch.Etot_MeV * MEV)).toBeLessThan(1e-12);
  });
});

describe('fuel burn-up and ash production per channel', () => {
  it('D-³He: the D-D side channels consume two D each (species a), the main channel one D and one ³He', () => {
    const T = 40, fA = 0.4;
    const { w } = uniform({ fuel: 'DHe3', fuelFracA: fA, heating: NO_HEATING }, T, 8e19);
    const [main, pT, nHe3] = FUEL_CHANNELS.DHe3;
    const na = w.na[2], nb = w.nb[2];
    const Rm = na * nb * main.sigmav(T), Rd = 0.5 * na * na * (pT.sigmav(T) + nHe3.sigmav(T));
    expect(Rd).toBeGreaterThan(0);
    expect(rel(w.Rfus[2], Rm + Rd)).toBeLessThan(1e-12);
    expect(rel(w.burnA[2], Rm + 2 * Rd)).toBeLessThan(1e-12);
    expect(rel(w.burnB[2], Rm)).toBeLessThan(1e-12);
    // ash: 1 ⁴He per D-³He reaction, ½ per D-D branch
    expect(rel(w.ash[2], Rm + 0.5 * Rd)).toBeLessThan(1e-12);
    // the old bookkeeping (one D and one ³He per reaction of any channel) lost 2 R_dd of D
    expect(w.burnA[2]).toBeGreaterThan(Rm + Rd);
    // neutrons only from the D(d,n)³He branch
    expect(rel(w.Nfus[2], 0.5 * na * na * nHe3.sigmav(T))).toBeLessThan(1e-12);
  });

  it.each([0.3, 1])('D-D (fuelFracA = %s): 2 R ions burnt, shared between the slots in proportion; ash ½ per reaction', (fA) => {
    const { w } = uniform({ fuel: 'DD', fuelFracA: fA, heating: NO_HEATING }, 10);
    const R = w.Rfus[1];
    expect(rel(w.burnA[1] + w.burnB[1], 2 * R)).toBeLessThan(1e-12);
    if (fA < 1) expect(rel(w.burnA[1] / w.burnB[1], w.na[1] / w.nb[1])).toBeLessThan(1e-9);
    else expect(w.burnB[1]).toBe(0);
    expect(rel(w.ash[1], 0.5 * R)).toBeLessThan(1e-12);
  });

  it.each([['DT', 1], ['pB11', 3]] as [FuelType, number][])('%s: one of each ion per reaction, %s ash particle(s) per reaction', (fuel, ashPer) => {
    const { w } = uniform({ fuel, fuelFracA: fuel === 'DT' ? 0.5 : 0.85, heating: NO_HEATING }, fuel === 'DT' ? 10 : 150);
    const R = w.Rfus[4];
    expect(R).toBeGreaterThan(0);
    expect(rel(w.burnA[4], R)).toBeLessThan(1e-12);
    expect(rel(w.burnB[4], R)).toBeLessThan(1e-12);
    expect(rel(w.ash[4], ashPer * R)).toBeLessThan(1e-12);
  });

  it('the burn-up of a channel is what burnPerReaction says (the function the 0D model uses)', () => {
    for (const fuel of ['DT', 'DD', 'DHe3', 'pB11'] as FuelType[]) {
      const { w } = uniform({ fuel, fuelFracA: 0.35, heating: NO_HEATING }, fuel === 'pB11' ? 150 : 30);
      const na = w.na[7], nb = w.nb[7];
      let bA = 0, bB = 0;
      for (const ch of FUEL_CHANNELS[fuel]) {
        const R = (ch.sameSpecies ? 0.5 * (isSingleSpecies(fuel) ? na + nb : na) ** 2 : na * nb) * ch.sigmav(fuel === 'pB11' ? 150 : 30);
        const [a, b] = burnPerReaction(fuel, ch, na, nb);
        bA += R * a; bB += R * b;
      }
      expect(rel(w.burnA[7], bA)).toBeLessThan(1e-12);
      expect(rel(w.burnB[7], bB)).toBeLessThan(1e-12);
    }
  });
});

describe('beam-target fusion per channel', () => {
  // a single-component beam (E ≥ 250 keV): n_f is the same for every channel of a cell
  const beam = { ...JET_15D.heating, P_NBI_MW: 30, P_ICRH_MW: 0, P_ECRH_MW: 0, E_NBI_keV: 800 };

  it('D-D: the beam burns on both branches, so beam-target neutrons exist (they were counted on the D(d,p)T branch, which has none)', () => {
    const T = 8;
    const { w, K, ctx } = uniform({ fuel: 'DD', fuelFracA: 0.6, heating: beam }, T, 4e19);
    const nD = w.na[0] + w.nb[0];
    let i = 0;
    while (i < ctx.N && !(K.btR[0][i] > 0)) i++;
    expect(i).toBeLessThan(ctx.N);
    // both branches: the target is the whole D population, the ratio is that of the beam-target reactivities
    expect(K.btR[0][i]).toBeGreaterThan(0);
    expect(K.btR[1][i]).toBeGreaterThan(0);
    const Ec = criticalEnergy(T, 2.014, w.ionSum[i]);
    const sv = beamTargetReactivity('DD', 800, Ec, T);
    expect(rel(K.btR[1][i] / K.btR[0][i], sv[1] / sv[0])).toBeLessThan(0.03);
    // power and neutron bookkeeping by channel
    const ch = FUEL_CHANNELS.DD;
    const Pbt = (K.btR[0][i] * ch[0].Etot_MeV + K.btR[1][i] * ch[1].Etot_MeV) * MEV;
    expect(rel(w.Pbt[i], Pbt)).toBeLessThan(1e-12);
    const thermalN = 0.5 * nD * nD * ch[1].sigmav(T);
    expect(rel(w.Nfus[i], thermalN + K.btR[1][i])).toBeLessThan(1e-12);
    // and the reactions of the beam show in the total rate and the burn-up
    expect(rel(w.Rfus[i], 0.5 * nD * nD * (ch[0].sigmav(T) + ch[1].sigmav(T)) + K.btR[0][i] + K.btR[1][i])).toBeLessThan(1e-12);
    expect(rel(w.burnA[i] + w.burnB[i], 2 * w.Rfus[i])).toBeLessThan(1e-12);
  });

  it('D-³He: the target of the D-D side channels is D, that of the main channel ³He', () => {
    const T = 30, fA = 0.3;
    const { w, K, ctx } = uniform({ fuel: 'DHe3', fuelFracA: fA, heating: beam }, T, 6e19);
    let i = 0;
    while (i < ctx.N && !(K.btR[2][i] > 0)) i++;
    expect(i).toBeLessThan(ctx.N);
    const Ec = criticalEnergy(T, 2.014, w.ionSum[i]);
    const sv = beamTargetReactivity('DHe3', 800, Ec, T);
    // R_j / (target_j ⟨σv⟩_bt,j) is the fast-ion density: the same for every channel of the cell
    const nf = [0, 1, 2].map((j) => K.btR[j][i] / ((j === 0 ? w.nb[i] : w.na[i]) * sv[j]));
    expect(rel(nf[1], nf[0])).toBeLessThan(0.03);
    expect(rel(nf[2], nf[0])).toBeLessThan(0.03);
    const ch = FUEL_CHANNELS.DHe3;
    expect(rel(w.Pbt[i], (K.btR[0][i] * ch[0].Etot_MeV + K.btR[1][i] * ch[1].Etot_MeV + K.btR[2][i] * ch[2].Etot_MeV) * MEV)).toBeLessThan(1e-12);
  });

  it('D-T: one channel, the target is the tritium (unchanged), and the beam-target neutrons are counted', () => {
    const { w, K, ctx } = uniform({ heating: beam }, 10, 6e19);
    let i = 0;
    while (i < ctx.N && !(K.btR[0][i] > 0)) i++;
    expect(K.btR).toHaveLength(1);
    const thermal = w.na[i] * w.nb[i] * FUEL_CHANNELS.DT[0].sigmav(10);
    expect(rel(w.Nfus[i], thermal + K.btR[0][i])).toBeLessThan(1e-12);
  });
});

describe('heating by the charged products', () => {
  /** ion share of the charged power of a cell from the products of every channel, evaluated independently */
  function ionShare(fuel: FuelType, rates: number[], Te: number, ionSum: number): number {
    let pi = 0, p = 0;
    FUEL_CHANNELS[fuel].forEach((ch, j) => ch.products.forEach((pr) => {
      const pk = rates[j] * pr.E_MeV;
      pi += pk * ionHeatingFraction(pr.E_MeV * 1e3, criticalEnergy(Te, pr.A, ionSum));
      p += pk;
    }));
    return pi / p;
  }

  it('D-³He: the α (3.67 MeV) and the p (14.68 MeV) of the main channel and the p, T, ³He of the D-D branches each slow down on their own E_c', () => {
    const T = 100, fA = 0.5;
    const { w } = uniform({ fuel: 'DHe3', fuelFracA: fA, heating: NO_HEATING }, T, 8e19);
    const ch = FUEL_CHANNELS.DHe3;
    const na = w.na[3], nb = w.nb[3];
    const rates = [na * nb * ch[0].sigmav(T), 0.5 * na * na * ch[1].sigmav(T), 0.5 * na * na * ch[2].sigmav(T)];
    const f = ionShare('DHe3', rates, T, w.ionSum[3]);
    expect(rel(w.PaI[3] / w.Pchg[3], f)).toBeLessThan(1e-9);
    // energy is conserved between ions and electrons
    expect(rel(w.PaE[3] + w.PaI[3], w.Pchg[3])).toBeLessThan(1e-12);
    // the old single-product rule (E_ch = 18.35 MeV of a mass-4 ion) gives a different split
    const old = ionHeatingFraction(ch[0].Echarged_MeV * 1e3, criticalEnergy(T, 4, w.ionSum[3]));
    expect(Math.abs(f - old) / old).toBeGreaterThan(0.05);
    // the protons (A = 1) reach their critical energy far earlier than the α: they heat electrons more
    const alpha = ch[0].products[0], proton = ch[0].products[1];
    expect(ionHeatingFraction(proton.E_MeV * 1e3, criticalEnergy(T, proton.A, w.ionSum[3])))
      .toBeLessThan(ionHeatingFraction(alpha.E_MeV * 1e3, criticalEnergy(T, alpha.A, w.ionSum[3])));
  });

  it('D-T: the α gives the Stix fraction of its 3.5 MeV to the ions; the rest of the power goes to the electrons', () => {
    const T = 20;
    const { w } = uniform({ heating: NO_HEATING }, T);
    const G = ionHeatingFraction(3500, criticalEnergy(T, 4.001506, w.ionSum[0]));
    expect(G).toBeGreaterThan(0.2);
    expect(G).toBeLessThan(0.7);
    expect(rel(w.PaI[0], G * w.Pchg[0])).toBeLessThan(1e-9);
    expect(rel(w.PaE[0], (1 - G) * w.Pchg[0])).toBeLessThan(1e-9);
  });

  it('p-¹¹B: the three α share the 8.68 MeV equally', () => {
    const T = 150;
    const { w } = uniform({ fuel: 'pB11', fuelFracA: 0.85, heating: NO_HEATING }, T, 6e19);
    const G = ionHeatingFraction((8.68 / 3) * 1e3, criticalEnergy(T, 4.001506, w.ionSum[0]));
    expect(rel(w.PaI[0], G * w.Pchg[0])).toBeLessThan(1e-9);
    expect(rel(w.PaE[0] + w.PaI[0], w.Pchg[0])).toBeLessThan(1e-12);
  });

  it('D-D: the protons and tritons of the D(d,p)T branch and the ³He of the D(d,n)³He branch are distinguished', () => {
    const T = 15;
    const { w } = uniform({ fuel: 'DD', fuelFracA: 1, heating: NO_HEATING }, T);
    const ch = FUEL_CHANNELS.DD;
    const nD = w.na[0] + w.nb[0];
    const rates = ch.map((c) => 0.5 * nD * nD * c.sigmav(T));
    expect(rel(w.PaI[0] / w.Pchg[0], ionShare('DD', rates, T, w.ionSum[0]))).toBeLessThan(1e-9);
  });

  it('energy content of the fast products: W_α = Σ P_k τ_W,k of the slowing-down distributions (the steady pool of the 0D model)', () => {
    const T = 20, ne = 8e19;
    const { w } = uniform({ heating: NO_HEATING }, T, ne);
    const pr = FUEL_CHANNELS.DT[0].products[0];
    const tau = fastIonEnergyTime(T, ne, pr.A, pr.Z, pr.E_MeV * 1e3, criticalEnergy(T, pr.A, w.ionSum[0]));
    expect(tau).toBeGreaterThan(0.01);
    expect(rel(w.Walpha[0], w.Pchg[0] * tau)).toBeLessThan(1e-9);
    // the time constant of the pool of the cell is τ_W of the only product
    expect(rel(w.tauWa[0], tau)).toBeLessThan(1e-9);
  });

  it('D-³He: the pool time constant is the birth-power-weighted mean τ_W of the protons, α, T and ³He of all channels', () => {
    const T = 40, ne = 6e19;
    const { w } = uniform({ fuel: 'DHe3', fuelFracA: 0.5, heating: NO_HEATING }, T, ne);
    let wt = 0, wSum = 0;
    for (const ch of FUEL_CHANNELS.DHe3) {
      const r = pairDensity('DHe3', ch, w.na[0], w.nb[0]) * ch.sigmav(T);
      for (const pr of ch.products) {
        const pk = r * pr.E_MeV;
        wt += pk * fastIonEnergyTime(T, ne, pr.A, pr.Z, pr.E_MeV * 1e3, criticalEnergy(T, pr.A, w.ionSum[0]));
        wSum += pk;
      }
    }
    expect(FUEL_CHANNELS.DHe3.length).toBeGreaterThan(1);
    expect(rel(w.tauWa[0], wt / wSum)).toBeLessThan(1e-9);
    expect(rel(w.Walpha[0], (wt / wSum) * w.Pchg[0])).toBeLessThan(1e-9);
  });

  it('without any reaction (a pure ³He plasma) the time constant is the mean over all the products (equal weights, as fastPoolMix), so that a pool still decays', () => {
    const T = 40, ne = 6e19;
    const { w } = uniform({ fuel: 'DHe3', fuelFracA: 0, heating: NO_HEATING }, T, ne);
    expect(w.na[0]).toBe(0);
    expect(w.Pchg[0]).toBe(0);
    expect(w.Walpha[0]).toBe(0);
    let sum = 0, n = 0;
    for (const ch of FUEL_CHANNELS.DHe3) for (const pr of ch.products) {
      sum += Math.max(fastIonEnergyTime(T, ne, pr.A, pr.Z, pr.E_MeV * 1e3, criticalEnergy(T, pr.A, w.ionSum[0])), 1e-3);
      n++;
    }
    expect(n).toBeGreaterThan(3);
    expect(rel(w.tauWa[0], sum / n)).toBeLessThan(1e-9);
  });
});


