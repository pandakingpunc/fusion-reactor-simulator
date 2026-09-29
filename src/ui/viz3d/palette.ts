/**
 * Colours and event effects of the 3D view as pure functions: the temperature colour scale (the same stops as the 2D poloidal
 * cross-section, so the two views agree), the temperature of a flux surface, the ELM flash and the disruption look.
 */

export type Rgb = [number, number, number];

const STOPS: readonly Rgb[] = ([[10, 20, 60], [60, 20, 140], [190, 40, 110], [255, 120, 40], [255, 235, 160]] as Rgb[]).map(
  (c) => [c[0] / 255, c[1] / 255, c[2] / 255] as Rgb,
);

/** Plasma colour for u in [0, 1] (dark blue, purple, red-orange, yellow-white); NaN maps to the cold end. */
export function tempColor(u: number): Rgb {
  const x = (Number.isNaN(u) ? 0 : Math.min(1, Math.max(0, u))) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x)), f = x - i;
  return [0, 1, 2].map((k) => STOPS[i][k] + (STOPS[i + 1][k] - STOPS[i][k]) * f) as Rgb;
}

export function mixRgb(a: Rgb, b: Rgb, f: number): Rgb {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** the same colour with its saturation replaced by grey (f = 1: fully grey, at the same luminance) */
export function greyOut(c: Rgb, f: number): Rgb {
  const y = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  return mixRgb(c, [y, y, y], f);
}

export interface TempModel {
  /** central temperature [keV] when there is no measured profile */
  T0_keV: number;
  /** exponent of the model profile T0 (1 - rho^2 + 0.02)^alphaT (0D) */
  alphaT: number;
  /** measured electron temperature profile (1.5D) */
  prof?: { rho: number[]; Te: number[] } | null;
}

function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((x - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1]);
  return ys[ys.length - 1];
}

/** central temperature of the colour scale [keV] (never zero) */
export function centralTemperature(m: TempModel): number {
  return Math.max(m.prof?.Te?.length ? m.prof.Te[0] : m.T0_keV, 1e-3);
}

/** upper end of the colour scale [keV]: the central temperature, at least 5 keV so that cold plasmas stay visible */
export function scaleTemperature(m: TempModel): number {
  return Math.max(centralTemperature(m), 5);
}

/** temperature [keV] at the normalised radius rho */
export function temperatureAt(m: TempModel, rho: number): number {
  if (m.prof?.rho?.length && m.prof.Te.length === m.prof.rho.length) return interp(m.prof.rho, m.prof.Te, rho);
  return centralTemperature(m) * Math.pow(Math.max(1 - rho * rho, 0) + 0.02, m.alphaT);
}

/** colour-scale position u in [0, 1] of the temperature at rho */
export function scalePosition(m: TempModel, rho: number): number {
  return Math.pow(temperatureAt(m, rho) / scaleTemperature(m), 0.6);
}

/** colour of the plasma at rho */
export function plasmaColor(m: TempModel, rho: number): Rgb {
  return tempColor(scalePosition(m, rho));
}

/** minimal shape of an event for the ELM flash */
export interface TimedEvent { t: number; kind: string }

/**
 * ELM flash in [0, 1] at simulated time t: 1 at the last ELM, decaying linearly over 1 % of the shot (plus 0.05 in time units),
 * the same law as the 2D cross-section. 0 when there was no ELM before t.
 */
export function elmFlashAt(events: readonly TimedEvent[], t: number, tEnd: number): number {
  let last: TimedEvent | undefined;
  for (let i = events.length - 1; i >= 0 && !last; i--) if (events[i].kind === 'ELM' && events[i].t <= t) last = events[i];
  if (!last) return 0;
  return Math.max(0, Math.min(1, 1 - (t - last.t) / (tEnd * 0.01 + 0.05)));
}

/** how long the disruption animation lasts in wall-clock time [ms] */
export const DISRUPTION_MS = 1800;

export interface DisruptionLook {
  /** white flash of the thermal quench, 0..1 */
  flash: number;
  /** size of the plasma cross-section relative to the equilibrium (1 = unchanged) */
  squash: number;
  /** displacement of the plasma in R and Z, in units of the minor radius (the 2D view shifts by -0.15 a) */
  dR: number;
  dZ: number;
  /** loss of colour, 0..1 */
  grey: number;
  /** red rim at the edge, 0..1 */
  rim: number;
}

export const NO_DISRUPTION: DisruptionLook = { flash: 0, squash: 1, dR: 0, dZ: 0, grey: 0, rim: 0 };

const smooth = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };

/**
 * Look of a disrupted plasma `elapsedMs` after the disruption: a white flash (thermal quench, 0 to 0.35 s), then the plasma
 * loses its colour, contracts and drops towards the inboard-bottom side (the current quench), and settles by DISRUPTION_MS.
 * `null` means no disruption; `Infinity` the settled end state (no animation, e.g. reduced motion or a shot that is already over).
 */
export function disruptionLook(elapsedMs: number | null): DisruptionLook {
  if (elapsedMs === null) return NO_DISRUPTION;
  const e = Math.max(0, elapsedMs);
  const flash = e < 120 ? e / 120 : Math.max(0, 1 - (e - 120) / 380);
  const k = smooth((e - 200) / (DISRUPTION_MS - 200));
  return { flash, squash: 1 - 0.4 * k, dR: -0.15 * k, dZ: -0.12 * k, grey: smooth((e - 150) / 900), rim: 0.6 + 0.4 * k };
}
