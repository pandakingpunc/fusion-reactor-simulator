/**
 * Engineering constraints: magnets, divertor, neutron wall load, TBR, economics.
 * Facade over `systems/` (v4.0, lane ws7b, "systems-lite"): the TF coil stress (PROCESS-style winding pack and Tresca
 * analysis), the CS flux budget, the cryoplant, the radial build and the TBR fit live in `src/physics/systems/`; this module
 * keeps the API and the exports of v3 (`MAGNET_TECH`, `MagnetCheck`, `checkMagnet`, `tritiumBreedingRatio`, `economics`) and the
 * divertor heat flux and the neutron wall load, which stay here (SOL and edge physics: WS7a).
 * Most relations are simplified to the level of a systems code (PROCESS, Sheffield 1986/2016); APPROXIMATION marks them.
 */
import { Geometry, plasmaSurface, poloidalField } from './geometry';

export { MAGNET_TECH, checkMagnet } from './systems/magnets';
export type { MagnetCheck } from './systems/magnets';
export { tritiumBreedingRatio } from './systems/breeding';
export { economics } from './systems/economics';

/**
 * Divertör ısı akısı — Eich et al., Nucl. Fusion 53 (2013) 093031 (regresyon #14):
 *  λ_q [mm] = 0.63 · B_pol^-1.19   (H-mode, ELM arası)
 * Islanan alan: A_wet = 2π R_strike · λ_q · f_x (akı genişlemesi) ; dış hedef payı ~ 2/3.
 * Divertör radyasyonu f_rad_div P_SOL'u azaltır (safsızlık tohumlama / detachment).
 */
export function divertorHeatFlux(g: Geometry, Ip_A: number, P_SOL_W: number, f_rad_div: number, fluxExpansion: number): { lambda_q_mm: number; q_div_MWm2: number; A_wet_m2: number } {
  const Bp = poloidalField(g, Ip_A);
  const lambda_q = 0.63 * Math.pow(Math.max(Bp, 0.05), -1.19); // mm
  // Divertör yayılması: λ_int = λ_q + 1.64 S (Makowski 2012), S/λ_q ≈ 1 alındı (APPROXIMATION)
  const lambda_int = lambda_q * (1 + 1.64);
  const Rstrike = g.R - 0.3 * g.a; // APPROXIMATION: dış strike noktası
  const tilt = 3; // hedef plaka eğimi ~20° → 1/sin ≈ 3 (ITER dikey hedef)
  const A_wet = 2 * Math.PI * Rstrike * (lambda_int * 1e-3) * fluxExpansion * tilt;
  const q = (P_SOL_W * (1 - f_rad_div) * (2 / 3)) / A_wet / 1e6;
  return { lambda_q_mm: lambda_q, q_div_MWm2: q, A_wet_m2: A_wet };
}

/** Stellarator/ST için q_div yerine basit ada divertörü: aynı formül, B_pol ≈ ι B a/R */
export function divertorHeatFluxStellarator(g: Geometry, B0: number, iota: number, P_SOL_W: number, f_rad_div: number): number {
  const Bp = (iota * B0 * g.a) / g.R;
  const lambda_q = 0.63 * Math.pow(Math.max(Bp, 0.05), -1.19) * 3; // ada divertörü daha geniş (APPROXIMATION ×3)
  const A_wet = 2 * Math.PI * g.R * (lambda_q * 1e-3) * 10;
  return (P_SOL_W * (1 - f_rad_div)) / A_wet / 1e6;
}

/**
 * Nötron duvar yükü ve hasar: Γ_n = P_n / S_duvar [MW/m²]; dpa/yıl ≈ 10 · Γ_n · (availability)
 * (14 MeV nötronlar için çelikte ~10 dpa per MW·yr/m²; Zinkle & Möslang 2013)
 */
export function neutronWallLoad(g: Geometry, P_neutron_W: number, availability: number): { load_MWm2: number; dpa_per_year: number; S_wall: number } {
  const S = plasmaSurface(g) * 1.15; // duvar plazmadan ~%15 büyük
  const load = P_neutron_W / S / 1e6;
  return { load_MWm2: load, dpa_per_year: 10 * load * availability, S_wall: S };
}
