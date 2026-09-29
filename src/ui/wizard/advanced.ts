/**
 * The fields of the wizard's Advanced section: the systems pulse length, the edge (divertor) model's remaining options and the
 * settings of the 1.5D transport solver. They are safe at their defaults (each shows the default the model uses; a value is written to
 * the configuration only when it is edited) and few runs change them, so they live in a chunk of their own that the section loads when it is
 * opened. `ADVANCED_PATHS` in schema.ts lists the same paths (a test keeps the two equal).
 *
 * The defaults are the model's own (DEFAULT_EDGE_PARAMS, DEFAULT_PROFILE_SETTINGS, DEFAULT_PULSE_LENGTH_S): the wizard cannot drift from them.
 * Sources of the physics of the edge options are in src/physics/edge/params.ts and losses.ts.
 */
import { DEFAULT_PROFILE_SETTINGS as PS } from '../../physics/profiles/defaults';
import { DEFAULT_EDGE_PARAMS as EP } from '../../physics/edge/params';
import { DEFAULT_PULSE_LENGTH_S } from '../../physics/systems/cryo';
import type { AdvancedStep, FieldDef } from './schema';

export const ADVANCED_FIELDS: Record<AdvancedStep, FieldDef[]> = {
  driver: [
    { path: 'systems.pulseLength_s', label: 'Plant pulse length', unit: 's', min: 10, max: 20000, step: 10, optional: true, noSlider: true,
      hint: 'Blank = 1055 s (the PROCESS default). Design length of the plasma pulse of the plant (ramp-up, flat top and ramp-down): it sets the pulsed-field load of the cryoplant in the report, not the length of the simulated shot' },
    { path: 'divertor.edge.outerShare', label: 'Outer-leg power share', min: 0.1, max: 1, step: 0.01, def: EP.outerShare,
      hint: 'Share of P_sep carried by the outer target leg (H-mode: about two thirds)' },
    { path: 'divertor.edge.spreadingRatio', label: 'Divertor spreading S/λ_q', min: 0.1, max: 5, step: 0.01, def: EP.spreadingRatio,
      hint: 'λ_int = (1 + 1.64 S/λ_q) λ_q; 1.22 gives λ_int = 3 λ_q (Kallenbach et al. 2016). Overridden by an absolute S below' },
    { path: 'divertor.edge.S_mm', label: 'Divertor spreading S', unit: 'mm', min: 0.05, max: 10, step: 0.05, optional: true,
      hint: 'Blank = the ratio S/λ_q above. An absolute S overrides it' },
    { path: 'divertor.edge.divertorLengthFraction', label: 'Divertor leg length / connection length', min: 0.05, max: 0.9, step: 0.01, def: EP.divertorLengthFraction,
      hint: 'X-point to target over π q₉₅ R (ITER outer leg: 20 m of about 58 m)' },
    { path: 'divertor.edge.kappa0e', label: 'Parallel electron conductivity κ₀ₑ', unit: 'W m⁻¹ eV⁻³·⁵', min: 1000, max: 3000, step: 10, def: EP.kappa0e, noSlider: true,
      hint: 'Spitzer–Härm coefficient: about 2000 for Z_eff ≈ 1 (2390 for ln Λ = 13)' },
    { path: 'divertor.edge.sheathGamma', label: 'Sheath heat transmission γ', min: 4, max: 12, step: 0.1, def: EP.sheathGamma,
      hint: 'About 7 (Stangeby 2000); the SOLPS-ITER runs of Moulton et al. (2021) use 8.6' },
    { path: 'divertor.edge.lossFit', label: 'Momentum and power loss fit', type: 'select', def: 'stangeby1',
      options: [{ value: 'stangeby1', label: 'Stangeby 2018, fit 1 (default)' }, { value: 'stangeby2', label: 'Stangeby 2018, fit 2' }, { value: 'body2025', label: 'Body, Kallenbach and Eich 2025 (convective region)' }],
      hint: 'Losses of the divertor leg as functions of the target temperature (src/physics/edge/losses.ts)' },
    { path: 'divertor.edge.seedEnrichment', label: 'Seed enrichment of the scrape-off layer', min: 0.1, max: 10, step: 0.1, def: EP.seedEnrichment,
      hint: 'Seed concentration in the scrape-off layer relative to the seed c_s of the core (Lengyel radiation)' },
    { path: 'divertor.edge.detachTt_eV', label: 'Detachment onset T_t', unit: 'eV', min: 1, max: 20, step: 0.5, def: EP.detachTt_eV,
      hint: 'Target electron temperature that defines the onset of detachment in the c_z requirement' },
    { path: 'divertor.edge.targetTilt', label: 'Target tilt 1/sin β', min: 1, max: 20, step: 0.5, def: EP.targetTilt,
      hint: 'Wetted area over the perpendicular area of the target plate (ITER vertical target: about 3)' },
    { path: 'divertor.edge.strikeRadiusFraction', label: 'Strike-point offset f (R − f·a)', min: -0.9, max: 1, step: 0.05, def: EP.strikeRadiusFraction,
      hint: 'Radius of the outer strike point as a fraction of a inside R' },
  ],
  heating: [
    { path: 'profiles.rtol', label: '1.5D solver · relative tolerance', min: 1e-5, max: 0.1, def: PS.rtol, noSlider: true,
      hint: 'The local error of a transport step must stay below atol · max|y| + rtol · |y|; smaller is more accurate and slower' },
    { path: 'profiles.atol', label: '1.5D solver · absolute tolerance', min: 0, max: 0.1, def: PS.atol, noSlider: true,
      hint: 'As a fraction of the profile maximum; 0 is a purely relative tolerance' },
    { path: 'profiles.dtMax', label: '1.5D solver · longest transport step', unit: 's', min: 1e-3, max: 10, def: PS.dtMax, noSlider: true,
      hint: 'The step control never proposes a longer step' },
    { path: 'profiles.gridPacking', label: '1.5D solver · edge cell packing', min: 0, max: 20, step: 0.5, def: PS.gridPacking,
      hint: 'The cells at the pedestal and the separatrix are (1 + packing) times narrower than the core cells; 0 is a uniform grid' },
    { path: 'profiles.nonlinearSolver', label: '1.5D solver · nonlinear solver', type: 'select', def: 'auto',
      options: [{ value: 'auto', label: 'Automatic (Newton for the critical-gradient model, Picard for the scaling)' }, { value: 'picard', label: 'Picard iteration with Anderson mixing' },
        { value: 'newton', label: 'Newton–Raphson (Picard fallback)' }, { value: 'pc', label: 'Pereverzev–Corrigan stabilised Picard' }],
      hint: 'How the nonlinear system of a transport stage is solved; the default is right for both transport models' },
  ],
};

/** the default plant pulse length the hint of `systems.pulseLength_s` names (a test compares it with the model's) */
export const HINTED_PULSE_LENGTH_S = 1055;
export { DEFAULT_PULSE_LENGTH_S };
