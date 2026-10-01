/**
 * The charged fusion products of a fuel as a fast-ion species: the birth-power-weighted ion-heating fraction G and slowing-down
 * time τ_W of the products at a cell (the per-product Stix critical energy, as sources/fusion.ts and the 0D model's fastPoolMix do), and
 * the birth energies the orbit width is taken from.
 */
import { FUEL_CHANNELS, pairDensity, type FuelType } from '../../reactivity';
import { criticalEnergy, ionHeatingFraction, spitzerSlowingDownTime } from '../../heating';
import type { BirthEnergy } from './orbit';

/** J per MeV */
const MEV = 1e3 * 1.602176634e-16;
/** floor of the time constant of a pool [s], as in the 0D model (fastIons.ts TAU_W_MIN) */
const TAU_MIN = 1e-3;

/** Ion-heating fraction and energy time of the products at a cell, and the power they are born with [W m⁻³] */
export interface ProductProps { P: number; G: number; tauW: number }

/**
 * Charged products of the reactions at a cell of temperatures T_e, T_i [keV], electron density n_e, species densities n_a, n_b and
 * Σ n_j Z_j²/(n_e A_j) = `ionSum`: rate of a channel = pairDensity ⟨σv⟩(T_i) + `btRate(j)` (the beam-target rate of channel j). G and τ_W are weighted
 * by the birth power of the products; without reactions the products have equal weights (heating.fastPoolMix).
 */
export function chargedProductProps(fuel: FuelType, Te: number, Ti: number, ne: number, na: number, nb: number, ionSum: number, btRate: (j: number) => number): ProductProps {
  const chans = FUEL_CHANNELS[fuel];
  const Tev = Math.max(Te, 0.01), Tiv = Math.max(Ti, 0.01);
  let Pp = 0, Gp = 0, Wa = 0, Gsum = 0, tauSum = 0, nProd = 0;
  for (let j = 0; j < chans.length; j++) {
    const ch = chans[j];
    const r = pairDensity(fuel, ch, na, nb) * ch.sigmav(Tiv) + btRate(j);
    for (const pr of ch.products) {
      const pk = r * pr.E_MeV * MEV;
      const G = ionHeatingFraction(pr.E_MeV * 1e3, criticalEnergy(Tev, pr.A, ionSum));
      const tauW = Math.max(0.5 * spitzerSlowingDownTime(Tev, ne, pr.A, pr.Z) * (1 - G), TAU_MIN);
      Gsum += G; tauSum += tauW; nProd++;
      if (!(pk > 0)) continue;
      Pp += pk; Gp += pk * G; Wa += pk * tauW;
    }
  }
  return Pp > 0 ? { P: Pp, G: Gp / Pp, tauW: Wa / Pp } : { P: 0, G: Gsum / Math.max(nProd, 1), tauW: tauSum / Math.max(nProd, 1) };
}

/** The birth energies of the charged products of a fuel (equal weights over the products of all channels) */
export function productBirthEnergies(fuel: FuelType): BirthEnergy[] {
  const out: BirthEnergy[] = [];
  for (const ch of FUEL_CHANNELS[fuel]) for (const pr of ch.products) out.push({ E_keV: pr.E_MeV * 1e3, A: pr.A, Z: pr.Z, weight: 1 });
  return out;
}
