/**
 * Species of the profile-resolved impurity module: which densities n_He(rho), n_Z(rho) the 1.5D state carries besides the
 * default scalar inventories (state.ts NHe, cZ).
 *
 * `ProfileSettings.impurityTransport`:
 *   'legacy'     (default) the scalar model: the He ash is one inventory N_He with the confinement time tau_He* = (tau_He* over tau_E) tau_E and
 *                the impurity a uniform concentration c_Z that relaxes to its set-point; both fill the plasma with a profile proportional to n_e.
 *   'anomalous'  n_He(rho) and the impurity densities are evolved on the finite-volume particle solver with the anomalous D and v of the
 *                electrons scaled by `impurityDoverDe` and `impurityPinchOverPe`.
 *   'facit'      the same with the neoclassical D, K, H of FACIT added (facit.ts).
 *
 * The state extras (state.ts, after the scalars) hold one block of N cell values per species, in the order of `impuritySpecies`:
 * the He ash first, then the intrinsic impurity (`impurity.species`), the seeded species (`impurity.seedSpecies`, when it has a
 * concentration) and one optional third species (`impurityExtraSpecies`). At most three impurities besides helium.
 * This file has no dependency on the model (the state layout is built before the module exists).
 */
import type { ImpuritySpecies } from '../../constants';
import { IMPURITIES } from '../../constants';
import type { MagneticConfig, ProfileSettings } from '../../types';

export type ImpurityTransportMode = NonNullable<ProfileSettings['impurityTransport']>;
export type ImpurityRole = 'he' | 'intrinsic' | 'seed' | 'extra';

/** Helium ash: charge and mass number (He-4) */
export const HELIUM = { Z: 2, A: 4.0026 } as const;

export interface ImpuritySpeciesSpec {
  role: ImpurityRole;
  species: ImpuritySpecies | 'He';
  /** nuclear charge and mass number */
  Znuc: number;
  A: number;
  /** position of the species' block in the state extras (He is 0) */
  index: number;
}

/** The mode of a shot ('legacy' when the setting is absent) */
export function impurityMode(ps: Pick<ProfileSettings, 'impurityTransport'>): ImpurityTransportMode {
  return ps.impurityTransport === 'anomalous' || ps.impurityTransport === 'facit' ? ps.impurityTransport : 'legacy';
}

/** Seeded impurity of the configuration, if one has a concentration (the same test as composition.ts seedSpecies) */
export function seedOf(cfg: Pick<MagneticConfig, 'impurity'>): ImpuritySpecies | null {
  const im = cfg.impurity;
  return im.seedSpecies && im.seedConcentration ? im.seedSpecies : null;
}

/** The species the state carries, in block order; empty for the legacy mode */
export function impuritySpecies(cfg: Pick<MagneticConfig, 'impurity'>, ps: Pick<ProfileSettings, 'impurityTransport' | 'impurityExtraSpecies'>): ImpuritySpeciesSpec[] {
  if (impurityMode(ps) === 'legacy') return [];
  const out: ImpuritySpeciesSpec[] = [{ role: 'he', species: 'He', Znuc: HELIUM.Z, A: HELIUM.A, index: 0 }];
  const add = (role: ImpurityRole, species: ImpuritySpecies) => out.push({ role, species, Znuc: IMPURITIES[species].Z, A: IMPURITIES[species].A, index: out.length });
  add('intrinsic', cfg.impurity.species);
  const seed = seedOf(cfg);
  if (seed) add('seed', seed);
  if (ps.impurityExtraSpecies && ps.impurityExtraSpecies in IMPURITIES) add('extra', ps.impurityExtraSpecies);
  return out;
}

/** Number of state values the module adds to y for N cells (0 in the legacy mode) */
export function impurityStateSize(cfg: Pick<MagneticConfig, 'impurity'>, ps: Pick<ProfileSettings, 'impurityTransport' | 'impurityExtraSpecies'>, N: number): number {
  return impuritySpecies(cfg, ps).length * N;
}
