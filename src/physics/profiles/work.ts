/**
 * Work arrays of the 1.5D profile model: radial quantities evaluated from the state during a step
 * (composition, sources, transport coefficients, current profiles). They depend only on N, are
 * allocated once per model and overwritten in place; after an equilibrium swap they are
 * re-evaluated on the new geometry before anything reads them.
 *
 * Units: densities m⁻³, power densities W m⁻³, reaction rates m⁻³ s⁻¹, energy densities J m⁻³,
 * ⟨j·B⟩ A T m⁻², diffusivities m² s⁻¹, T keV. "Cell" arrays have N entries at the cell centres, "face" arrays
 * N + 1 entries at the cell faces ρ_f = f/N.
 */

/** Cell-centred work arrays (length N) */
export const CELL_ARRAYS = [
  // composition (composition.ts)
  'ni', 'ni0', 'na', 'nb', 'nHe', 'nZ', 'ns', 'Zeff', 'ZeffMain', 'ionSum', 'Zimp', 'Zseed',
  // fusion (sources/fusion.ts), beam-target and alpha heating; ash production; fast-ion energy content
  'Pfus', 'Pchg', 'Pneut', 'Rfus', 'Nfus', 'burnA', 'burnB', 'ash', 'Pbt', 'PaE', 'PaI', 'Walpha',
  // auxiliary heating (sources/nbi.ts, sources/rf.ts); NBI fast-ion energy content
  'PnbiE', 'PnbiI', 'PicE', 'PicI', 'PecE', 'nbiDep', 'nbiTmp', 'nbiPart', 'nfast', 'Wbeam',
  // ohmic heating, radiation, e–i exchange
  'Poh', 'Pbr', 'Pline', 'Psync', 'Prad', 'dPrad', 'nuEq',
  // heat and particle equation inputs
  'Qe', 'Qi', 'Le', 'Li', 'Sn',
  // current (qprofile.ts, sources/current.ts)
  'sigma', 'jB', 'jbsB', 'jcdB', 'jniB', 'q',
  // Picard iterate copies
  'TeIt', 'TiIt', 'neIt',
  // neoclassical closure, pressure
  'chiNeo', 'p', 'nuE', 'nuI',
] as const;

/** Face work arrays (length N + 1) */
export const FACE_ARRAYS = [
  // transport coefficients (transport/): χ_e, χ_i (current and previous Picard iterate), D, v
  'chiE', 'chiI', 'chiEp', 'chiIp', 'D', 'v',
  // anomalous (turbulent) χ_e, χ_i of the transport model, before barrier, islands and floor
  'chiTurbE', 'chiTurbI',
  // current profiles: q, ψ', enclosed current
  'qF', 'dpsiF', 'IencF',
  // MHD stability: normalised pressure gradient α, Mercier and ballooning margins
  'alphaF', 'mercF', 'ballF',
] as const;

export type CellArray = (typeof CELL_ARRAYS)[number];
export type FaceArray = (typeof FACE_ARRAYS)[number];
export type WorkArrays = Readonly<Record<CellArray | FaceArray, Float64Array>>;

export function allocateWorkArrays(N: number): WorkArrays {
  const w = {} as Record<CellArray | FaceArray, Float64Array>;
  for (const k of CELL_ARRAYS) w[k] = new Float64Array(N);
  for (const k of FACE_ARRAYS) w[k] = new Float64Array(N + 1);
  return w;
}
