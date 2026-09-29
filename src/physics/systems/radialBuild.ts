/**
 * Radial build (systems-lite, lane ws7b): the layers between the plasma and the TF coil at the inboard and outboard
 * midplane, the line densities of the blanket and the shield, the neutron attenuation towards the TF coil and the nuclear
 * heating of the coil.
 *
 * The inboard build fills exactly the plasma-to-coil gap `gap_m` of the configuration (the distance from the plasma boundary
 * to the outer surface of the TF winding pack). The fixed layers follow the radial build of the PROCESS documentation
 * (UKAEA, machine build page; DEMO-like build): plasma-to-first-wall gap 0.225 m for a = 3.265 m (here 0.07 a), first wall
 * 0.018 m, blanket-to-shield gap 0.02 m, shield-to-vessel gap 0.02 m, thermal shield 0.05 m, TF-to-shield gap 0.05 m; a
 * tungsten armour of 3 mm (Shimwell et al., Fusion Eng. Des. 104 (2016) 34) and the 5 % plasma-side TF case. What is
 * left is shared between the breeding blanket and the shield with the vacuum vessel: the blanket takes 56 % (PROCESS DEMO
 * build: 0.755 m blanket of 1.355 m blanket plus vessel-shield). Without a blanket the whole remainder is shield. A design
 * may override the inboard blanket depth. The outboard blanket is 1.73 times as deep as the inboard one (the ratio of the
 * fitted TBR geometries of Shimwell 2016: 0.91 / 0.53, 1.11 / 0.64, 1.30 / 0.75 m) and the outboard shield 1.83 times
 * (PROCESS DEMO build: 1.1 / 0.6 m). If the fixed layers do not fit in the gap they are compressed proportionally
 * (`compressed`), which is the case of compact devices without a blanket.
 *
 * Nuclear heating of the TF coil: the PROCESS fit of Kovari et al., Fusion Eng. Des. 104 (2016) 9-20, eq. (51), in the
 * implementation of the PROCESS `nuclear_heating_magnets` (CCFE HCPB model; the pre-factor is the value of PROCESS issue
 * #272, which corrected the paper): P_TF = e exp(-a x_b) exp(-b x_s) M_TF P_fus, with e = 9.062 W kg^-1 GW^-1, a = 2.830 and
 * b = 0.583 m^2 tonne^-1, x_b and x_s the line densities [tonne m^-2] of the armour-first wall-blanket and of the
 * shield-vessel (the mean of the inboard and the outboard build), M_TF the coil mass and P_fus the fusion power. The fit
 * is for the EU DEMO HCPB neutronics; it is applied unchanged to other builds (APPROXIMATION, and outside its range when there
 * is no blanket).
 */
import type { BlanketType } from '../types';
import { SHIMWELL_OUT_IN } from './breeding';

export type BuildRole = 'void' | 'armour' | 'wall' | 'blanket' | 'shield' | 'thermal' | 'tf';

export interface BuildLayer {
  name: string;
  role: BuildRole;
  /** thickness [m] */
  thickness_m: number;
  /** smeared density [kg/m^3] */
  density: number;
}

/** smeared density of the breeding zone including its structure and coolant [kg/m^3]: design-typical values (APPROXIMATION); HCPB from the composition of Shimwell et al. 2016 (Eurofer 9.705 % of 7800, pebbles 53.55 % of about 2300) */
export const BLANKET_DENSITY: Record<BlanketType, number> = { HCPB: 2000, HCLL: 6500, WCLL: 6500, DCLL: 6500, FLiBe: 2500, none: 0 };
/** smeared density of the shield with the vacuum vessel (steel with water or helium) [kg/m^3] */
export const SHIELD_DENSITY = 5500;
/** first wall (Eurofer with 30 % coolant channels) and tungsten armour */
export const WALL_DENSITY = 5460;
export const ARMOUR_DENSITY = 19300;
/** thermal shield panels (thin, cooled steel panels; not counted in the line densities) */
const THERMAL_DENSITY = 1000;

/** PROCESS nuclear-heating fit (Kovari 2016 eq. 51 with the pre-factor of PROCESS issue #272) */
export const NUC_HEATING = { e: 9.062, a: 2.83, b: 0.583 } as const;

export interface RadialBuildInput {
  a: number;
  gap_m: number;
  blanketType: BlanketType;
  /** override of the inboard blanket depth [m] */
  blanketInboard_m?: number;
  /** thickness of the TF plasma-side case as a share of the leg thickness that is inside the gap; default 0.05 of 0.9 m */
  tfPlasmaCase_m?: number;
}

export interface RadialBuild {
  inboard: BuildLayer[];
  outboard: BuildLayer[];
  inboardTotal_m: number;
  outboardTotal_m: number;
  blanketInboard_m: number;
  blanketOutboard_m: number;
  /** mean of the inboard and outboard blanket depth [m] (the variable of the TBR fit) */
  blanketMean_m: number;
  shieldInboard_m: number;
  shieldOutboard_m: number;
  /** line densities [tonne/m^2] of armour + first wall + blanket, and of the shield + vessel (means of the inboard and outboard build) */
  xBlanket: number;
  xShield: number;
  /** the fixed layers were compressed to fit the gap */
  compressed: boolean;
  /** the inboard blanket depth was set by the design */
  blanketOverridden: boolean;
}

const FIXED = { fw: 0.018, armour: 0.003, gapBlSh: 0.02, gapShVv: 0.02, thermal: 0.05, gapTf: 0.05 } as const;
/** share of the space behind the first wall taken by the blanket inboard */
const BLANKET_SHARE = 0.56;
/** outboard shield thickness relative to the inboard one (PROCESS DEMO build 1.1 / 0.6 m) */
const SHIELD_OUT_IN = 1.83;

/** Radial build of the inboard and outboard midplane. */
export function radialBuild(inp: RadialBuildInput): RadialBuild {
  const hasBlanket = inp.blanketType !== 'none';
  const gap = Math.max(inp.gap_m, 0.01);
  const sol = Math.max(0.02, 0.07 * inp.a);
  const tfCase = inp.tfPlasmaCase_m ?? 0.05;
  const fixedIn = sol + FIXED.armour + FIXED.fw + FIXED.thermal + FIXED.gapTf + tfCase + (hasBlanket ? FIXED.gapBlSh : 0) + FIXED.gapShVv;
  let scale = 1, compressed = false;
  if (fixedIn > 0.9 * gap) { scale = (0.9 * gap) / fixedIn; compressed = true; }
  const rem = gap - fixedIn * scale;
  let blIn = 0, shIn = rem;
  let overridden = false;
  if (hasBlanket) {
    blIn = BLANKET_SHARE * rem;
    if (inp.blanketInboard_m !== undefined) {
      blIn = Math.min(Math.max(inp.blanketInboard_m, 0), Math.max(rem, 0));
      overridden = true;
    }
    shIn = rem - blIn;
  }
  const s = scale;
  const layers = (blanket: number, shield: number): BuildLayer[] => {
    const L: BuildLayer[] = [
      { name: 'plasma-wall gap', role: 'void', thickness_m: sol * s, density: 0 },
      { name: 'armour', role: 'armour', thickness_m: FIXED.armour * s, density: ARMOUR_DENSITY },
      { name: 'first wall', role: 'wall', thickness_m: FIXED.fw * s, density: WALL_DENSITY },
    ];
    if (hasBlanket) {
      L.push({ name: 'breeding blanket', role: 'blanket', thickness_m: blanket, density: BLANKET_DENSITY[inp.blanketType] });
      L.push({ name: 'blanket-shield gap', role: 'void', thickness_m: FIXED.gapBlSh * s, density: 0 });
    }
    L.push({ name: 'shield and vacuum vessel', role: 'shield', thickness_m: shield, density: SHIELD_DENSITY });
    L.push({ name: 'shield-vessel gap', role: 'void', thickness_m: FIXED.gapShVv * s, density: 0 });
    L.push({ name: 'thermal shield', role: 'thermal', thickness_m: FIXED.thermal * s, density: THERMAL_DENSITY });
    L.push({ name: 'TF-shield gap', role: 'void', thickness_m: FIXED.gapTf * s, density: 0 });
    L.push({ name: 'TF case (plasma side)', role: 'tf', thickness_m: tfCase * s, density: 7930 });
    return L;
  };
  const inboard = layers(blIn, shIn);
  const blOut = blIn * SHIMWELL_OUT_IN;
  const shOut = shIn * SHIELD_OUT_IN;
  const outboard = layers(blOut, shOut);
  const total = (L: BuildLayer[]) => L.reduce((sum, l) => sum + l.thickness_m, 0);
  // line densities [tonne/m^2]: armour + first wall + blanket, shield + vessel; mean of the inboard and outboard build (PROCESS)
  const line = (L: BuildLayer[], roles: BuildRole[]) => L.filter((l) => roles.includes(l.role)).reduce((sum, l) => sum + l.thickness_m * l.density, 0) / 1000;
  const xb = 0.5 * (line(inboard, ['armour', 'wall', 'blanket']) + line(outboard, ['armour', 'wall', 'blanket']));
  const xs = 0.5 * (line(inboard, ['shield']) + line(outboard, ['shield']));
  return {
    inboard, outboard, inboardTotal_m: total(inboard), outboardTotal_m: total(outboard),
    blanketInboard_m: blIn, blanketOutboard_m: blOut, blanketMean_m: 0.5 * (blIn + blOut),
    shieldInboard_m: shIn, shieldOutboard_m: shOut, xBlanket: xb, xShield: xs, compressed, blanketOverridden: overridden,
  };
}

/** attenuation factor of the nuclear heating of the TF coil behind the build: exp(-a x_b - b x_s) */
export function tfHeatingAttenuation(xBlanket: number, xShield: number): number {
  return Math.exp(-NUC_HEATING.a * xBlanket - NUC_HEATING.b * xShield);
}

/** Nuclear heating of the TF coil [W]: e exp(-a x_b) exp(-b x_s) M_TF [kg] P_fus [GW]. */
export function tfNuclearHeating_W(xBlanket: number, xShield: number, tfMass_kg: number, Pfus_MW: number): number {
  return NUC_HEATING.e * tfHeatingAttenuation(xBlanket, xShield) * tfMass_kg * (Pfus_MW / 1000);
}

/** cumulative attenuation of the TF heating through the layers from the plasma outwards (1 at the plasma) for plots and tests */
export function attenuationProfile(build: BuildLayer[]): { name: string; x_m: number; attenuation: number }[] {
  const out: { name: string; x_m: number; attenuation: number }[] = [];
  let x = 0, xb = 0, xs = 0;
  for (const l of build) {
    x += l.thickness_m;
    const m = (l.thickness_m * l.density) / 1000;
    if (l.role === 'armour' || l.role === 'wall' || l.role === 'blanket') xb += m;
    else if (l.role === 'shield') xs += m;
    out.push({ name: l.name, x_m: x, attenuation: tfHeatingAttenuation(xb, xs) });
  }
  return out;
}
