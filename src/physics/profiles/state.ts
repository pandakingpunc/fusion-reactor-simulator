/**
 * State vector layout of the 1.5D profile model.
 *
 *   y = [ T_e(ρ) | T_i(ρ) | n_e(ρ) | ψ(ρ) | scalars ]
 *
 * with N cell-centred values per profile (T in keV, n_e in m⁻³, ψ in Wb/rad) followed by the
 * global scalars below. The simulation kernel only sees the flat Float64Array; model code reads
 * and writes it through a ProfileState view, and the scalars by name through a ScalarView.
 */

/** Global scalars stored after the profiles, in this order (the order is the storage layout). */
export const SCALAR_NAMES = [
  /** He ash inventory ∫n_He dV [particles] */
  'NHe',
  /** impurity concentration n_Z/n_e */
  'cZ',
  /** fuel fraction of species a, n_a/(n_a + n_b) */
  'fA',
  /** cumulative fusion energy [J] */
  'Efus',
  /** cumulative injected (auxiliary + ohmic) energy [J] */
  'Ein',
  /** cumulative neutron count */
  'Nn',
  /** cumulative tritium burned / fuelled [particles] (D-T only) */
  'NTburn',
  'NTfuel',
  /** transport multiplier C_χ [m²/s] */
  'Cchi',
  /** fueling rate after the actuator lag [1/s, before the fueling efficiency] */
  'Sfuel',
  /** plasma current [A] */
  'Ip',
  /** NTM island widths, 3/2 and 2/1 [m] */
  'w32',
  'w21',
  /** ELM power, exponential average with τ = 1 s [W] */
  'Pelm',
  /** integral term of the C_χ controller [m²/s] */
  'CI',
] as const;

export type ScalarName = (typeof SCALAR_NAMES)[number];

/** Number of scalars after the profiles */
export const N_SCALARS = SCALAR_NAMES.length;

/** Named read/write access to the scalar block of a state vector (a view: writes go into y). */
export interface ScalarView extends Record<ScalarName, number> {}
export class ScalarView {
  constructor(readonly raw: Float64Array) {}
}
SCALAR_NAMES.forEach((name, k) => {
  Object.defineProperty(ScalarView.prototype, name, {
    get(this: ScalarView) { return this.raw[k]; },
    set(this: ScalarView, v: number) { this.raw[k] = v; },
  });
});

/** Views of one state vector: the four profiles and the scalars (all share y's buffer). */
export interface ProfileState {
  Te: Float64Array;
  Ti: Float64Array;
  ne: Float64Array;
  psi: Float64Array;
  s: ScalarView;
}

/** Layout of the state vector for N radial cells */
export class StateLayout {
  /** length of the state vector */
  readonly size: number;
  constructor(readonly N: number) {
    this.size = 4 * N + N_SCALARS;
  }
  /** Views into y (no copy) */
  view(y: Float64Array): ProfileState {
    const N = this.N;
    return { Te: y.subarray(0, N), Ti: y.subarray(N, 2 * N), ne: y.subarray(2 * N, 3 * N), psi: y.subarray(3 * N, 4 * N), s: new ScalarView(y.subarray(4 * N)) };
  }
}
