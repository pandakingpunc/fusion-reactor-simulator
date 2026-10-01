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
 * is a fit to the D-T neutronics of the EU DEMO HCPB blanket (its PROCESS unit test has x_b = 2.34 and x_s = 4.06 tonne m^-2), so
 * P_fus stands for the neutron power of a D-T plasma: `tfNuclearHeatingFromNeutrons_W` takes the neutron power and divides it
 * by the neutron share of the D-T fusion energy (0.80), which reproduces the fit for D-T and lets the D-D, D-He3 and p-B11 fuels
 * (a fraction to none of the neutron power per unit of fusion power) heat the coil accordingly (Wave 2A had P_fus in every fuel).
 * The coefficient a belongs to the breeding blanket (Li ceramic, Be multiplier, Eurofer) and b to the steel-water shield and the
 * vessel; a build without a breeding blanket has no layer that a describes, so all its layers (armour, first wall, shield,
 * vessel) count with b (`radialBuild` with a blanket type 'none'), and every build outside the HCPB range of the fit is reported
 * as an extrapolation (`nuclearHeatingFitNote`).
 */
import type { BlanketType } from '../types';
import { FUEL_CHANNELS } from '../reactivity';
import { SHIMWELL_OUT_IN, depthInFittedRange } from './breeding';

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

/** neutron share of the D-T fusion energy: 14.03 / 17.59 MeV (the D-T channel of reactivity.ts) */
export const DT_NEUTRON_FRACTION = FUEL_CHANNELS.DT[0].Eneutron_MeV / FUEL_CHANNELS.DT[0].Etot_MeV;

const FIXED = { fw: 0.018, armour: 0.003, gapBlSh: 0.02, gapShVv: 0.02, thermal: 0.05, gapTf: 0.05 } as const;
/** share of the space behind the first wall taken by the blanket inboard */
const BLANKET_SHARE = 0.56;
/** outboard shield thickness relative to the inboard one (PROCESS DEMO build 1.1 / 0.6 m) */
const SHIELD_OUT_IN = 1.83;

/** the layer roles of the two line densities of the nuclear-heating fit: [armour-wall-blanket, shield-vessel]; without a blanket all of them are shield */
function fitRoles(hasBlanket: boolean): [BuildRole[], BuildRole[]] {
  return hasBlanket ? [['armour', 'wall', 'blanket'], ['shield']] : [[], ['armour', 'wall', 'shield']];
}

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
  // without a breeding blanket there is nothing for the blanket coefficient a to describe: armour and first wall attenuate like the shield
  const [rolesB, rolesS] = fitRoles(hasBlanket);
  const xb = 0.5 * (line(inboard, rolesB) + line(outboard, rolesB));
  const xs = 0.5 * (line(inboard, rolesS) + line(outboard, rolesS));
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

/** Nuclear heating of the TF coil [W]: e exp(-a x_b) exp(-b x_s) M_TF [kg] P_fus [GW], the fit as published (P_fus of a D-T plasma). */
export function tfNuclearHeating_W(xBlanket: number, xShield: number, tfMass_kg: number, Pfus_MW: number): number {
  return NUC_HEATING.e * tfHeatingAttenuation(xBlanket, xShield) * tfMass_kg * (Pfus_MW / 1000);
}

/**
 * Nuclear heating of the TF coil [W] of any fuel: the fit of `tfNuclearHeating_W` with the fusion power of the D-T plasma that
 * has the same neutron power, P_fus = P_neutron / 0.80. Identical to the fit for D-T (P_neutron = 0.80 P_fus); D-D and D-He3
 * plasmas give a fraction and p-B11 none (APPROXIMATION: the 2.45 MeV neutrons of D-D are attenuated faster than the 14 MeV ones the
 * fit was made for, so the D-D heating is an upper bound).
 */
export function tfNuclearHeatingFromNeutrons_W(xBlanket: number, xShield: number, tfMass_kg: number, Pneutron_MW: number): number {
  return tfNuclearHeating_W(xBlanket, xShield, tfMass_kg, Pneutron_MW / DT_NEUTRON_FRACTION);
}

/**
 * Where the fit does not apply: a note for the report, or undefined inside its range. The fit was made for the D-T neutronics of the EU
 * DEMO HCPB blanket, so an HCPB blanket whose mean depth is in the depth range of the DEMO HCPB study behind the TBR fit
 * (`depthInFittedRange`, 0.72 to 1.025 m) is inside; another blanket type (its smeared density and its neutron multiplication differ), a
 * depth outside that range, or no blanket at all is an extrapolation of the exponential attenuation.
 */
export function nuclearHeatingFitNote(type: BlanketType, blanketMean_m: number): string | undefined {
  if (type === 'none') {
    return 'TF nuclear heating: no breeding blanket, so the PROCESS DEMO HCPB fit is extrapolated: armour, first wall, shield and vessel all attenuate with the shield coefficient (0.583 m^2/tonne); an APPROXIMATION, and for a pulsed machine a load during the burn only';
  }
  if (type !== 'HCPB') return `TF nuclear heating: the PROCESS fit is for an HCPB blanket, ${type} is an extrapolation`;
  if (!depthInFittedRange(blanketMean_m)) return `TF nuclear heating: the mean blanket depth ${blanketMean_m.toFixed(2)} m is outside the 0.72 to 1.025 m of the DEMO HCPB study behind the PROCESS fit (extrapolated)`;
  return undefined;
}

/** cumulative attenuation of the TF heating through the layers from the plasma outwards (1 at the plasma) for plots and tests */
export function attenuationProfile(build: BuildLayer[]): { name: string; x_m: number; attenuation: number }[] {
  const out: { name: string; x_m: number; attenuation: number }[] = [];
  const [rolesB] = fitRoles(build.some((l) => l.role === 'blanket'));
  let x = 0, xb = 0, xs = 0;
  for (const l of build) {
    x += l.thickness_m;
    const m = (l.thickness_m * l.density) / 1000;
    if (rolesB.includes(l.role)) xb += m;
    else if (l.role === 'armour' || l.role === 'wall' || l.role === 'shield') xs += m;
    out.push({ name: l.name, x_m: x, attenuation: tfHeatingAttenuation(xb, xs) });
  }
  return out;
}
