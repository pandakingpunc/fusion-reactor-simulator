/**
 * Energy components of a neutral beam: positive-ion sources (E_b < 250 keV; the JET and DIII-D PINIs) inject the full, half and third
 * energy with the power fractions 0.75 / 0.15 / 0.10 (a D⁺, D₂⁺, D₃⁺ ion mix); negative-ion sources (ITER, DEMO, ≥ 250 keV) a single
 * component. APPROXIMATION: a fixed species mix. sources/nbi.ts and the fast-ion module use the same list.
 */
export interface BeamComponent {
  /** energy per atom [keV] */
  E_keV: number;
  /** fraction of the beam power */
  f: number;
}

/** The energy components of a beam of full energy E_b [keV] */
export function beamComponents(E_b_keV: number): BeamComponent[] {
  return E_b_keV < 250
    ? [{ E_keV: E_b_keV, f: 0.75 }, { E_keV: E_b_keV / 2, f: 0.15 }, { E_keV: E_b_keV / 3, f: 0.1 }]
    : [{ E_keV: E_b_keV, f: 1 }];
}
