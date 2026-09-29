/**
 * Probability distributions for the priors of a UQ study: a JSON-able description ({@link DistSpec}) with its
 * quantile function (the inverse CDF that maps a unit-cube sample to a parameter value), its CDF, and the standard
 * normal functions they are built from.
 *
 * Standard normal CDF. Φ(z) = erfc(−z/√2)/2. erf is summed from the series
 *   erf(x) = 2/√π · exp(−x²) · Σ_n 2^n x^(2n+1) / (1·3·5···(2n+1))
 * (all terms positive, no cancellation; Abramowitz & Stegun 7.1.6) for
 * x < 2.5 (erf) or x < 1 (erfc), and erfc from the continued fraction
 *   erfc(x) = exp(−x²)/√π · 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + 2/(x + …)))))      (A&S 7.1.14)
 * for larger x, evaluated backwards to a fixed depth; both are accurate to about 1e-15 (relative to erfc in the
 * tail, absolute in the bulk). The quantile function starts from the rational approximation of Abramowitz & Stegun
 * 26.2.23 (error < 4.5e-4) and refines it with Halley iterations on Φ, which converge to full double precision.
 *
 * Supported laws: uniform, loguniform, normal (optionally truncated), lognormal (median and log-standard deviation,
 * optionally truncated), triangular and a fixed point. Truncation limits must leave probability mass above 1e-12.
 *
 * Pure TypeScript, no DOM or Node API.
 */

export type DistSpec =
  | { type: 'uniform'; lo: number; hi: number }
  | { type: 'loguniform'; lo: number; hi: number }
  | { type: 'normal'; mean: number; sd: number; lo?: number; hi?: number }
  | { type: 'lognormal'; median: number; sigmaLog: number; lo?: number; hi?: number }
  | { type: 'triangular'; lo: number; mode: number; hi: number }
  | { type: 'point'; value: number };

const SQRT2 = Math.SQRT2;
const SQRT_PI = Math.sqrt(Math.PI);
const SQRT_2PI = Math.sqrt(2 * Math.PI);
/** unit-interval clamp: the quantile of exactly 0 or 1 would be infinite */
const U_MIN = 2 ** -54;
const U_MAX = 1 - 2 ** -53;

function erfSeries(x: number): number {
  const x2 = x * x;
  let term = x, sum = x;
  for (let n = 1; n < 400; n++) {
    term *= (2 * x2) / (2 * n + 1);
    sum += term;
    if (term < 1e-17 * sum) break;
  }
  return (2 / SQRT_PI) * Math.exp(-x2) * sum;
}

/** the continued fraction needs 300 terms to reach 1e-16 at x = 1 and 120 from x = 2 on */
function erfcFraction(x: number): number {
  let f = x;
  for (let k = x < 2 ? 300 : 120; k >= 1; k--) f = x + (k / 2) / f;
  return Math.exp(-x * x) / (SQRT_PI * f);
}

/** Error function erf(x), accurate to about 1e-15. */
export function erf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const a = Math.abs(x);
  const v = a < 2.5 ? erfSeries(a) : 1 - erfcFraction(a);
  return x < 0 ? -v : v;
}

/** Complementary error function erfc(x) = 1 − erf(x), accurate in the far tail as well (relative error about 1e-14). */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x < 0) return 2 - erfc(-x);
  return x < 1 ? 1 - erfSeries(x) : erfcFraction(x);
}

/** Standard normal CDF Φ(z). */
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / SQRT2);
}

/** Standard normal density φ(z). */
export function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / SQRT_2PI;
}

/** Standard normal quantile Φ⁻¹(p) for p in (0, 1); ±Infinity at 0 and 1, NaN outside [0, 1]. */
export function normalQuantile(p: number): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  if (p === 0.5) return 0;
  const q = Math.min(p, 1 - p);
  // A&S 26.2.23: x = −(t − (c0 + c1 t + c2 t²)/(1 + d1 t + d2 t² + d3 t³)), t = √(−2 ln q), for the lower tail
  const t = Math.sqrt(-2 * Math.log(q));
  let x = -(t - (2.515517 + t * (0.802853 + t * 0.010328)) / (1 + t * (1.432788 + t * (0.189269 + t * 0.001308))));
  for (let i = 0; i < 6; i++) {
    const e = normalCdf(x) - q;
    const u = (e * SQRT_2PI) * Math.exp(0.5 * x * x);
    const dx = u / (1 + 0.5 * x * u);
    x -= dx;
    if (Math.abs(dx) <= 1e-15 * Math.abs(x)) break;
  }
  return p < 0.5 ? x : -x;
}

/** Clamps a unit-interval sample away from 0 and 1 (which map to infinite quantiles of the unbounded laws). */
export function clampUnit(u: number): number {
  return u < U_MIN ? U_MIN : u > U_MAX ? U_MAX : u;
}

/** Throws RangeError unless the description is a valid distribution. */
export function validateDist(d: DistSpec): void {
  const fin = (x: unknown, what: string) => {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new RangeError(`${d.type}: ${what} must be a finite number, got ${String(x)}`);
  };
  switch (d.type) {
    case 'uniform':
      fin(d.lo, 'lo'); fin(d.hi, 'hi');
      if (!(d.hi > d.lo)) throw new RangeError(`uniform: hi (${d.hi}) must exceed lo (${d.lo})`);
      return;
    case 'loguniform':
      fin(d.lo, 'lo'); fin(d.hi, 'hi');
      if (!(d.lo > 0 && d.hi > d.lo)) throw new RangeError(`loguniform: needs 0 < lo < hi, got lo = ${d.lo}, hi = ${d.hi}`);
      return;
    case 'normal':
      fin(d.mean, 'mean'); fin(d.sd, 'sd');
      if (!(d.sd > 0)) throw new RangeError(`normal: sd must be positive, got ${d.sd}`);
      checkTruncation(d, (x) => (x - d.mean) / d.sd);
      return;
    case 'lognormal':
      fin(d.median, 'median'); fin(d.sigmaLog, 'sigmaLog');
      if (!(d.median > 0)) throw new RangeError(`lognormal: median must be positive, got ${d.median}`);
      if (!(d.sigmaLog > 0)) throw new RangeError(`lognormal: sigmaLog must be positive, got ${d.sigmaLog}`);
      if (d.lo !== undefined && !(d.lo > 0)) throw new RangeError(`lognormal: lo must be positive, got ${d.lo}`);
      checkTruncation(d, (x) => (Math.log(x / d.median)) / d.sigmaLog);
      return;
    case 'triangular':
      fin(d.lo, 'lo'); fin(d.mode, 'mode'); fin(d.hi, 'hi');
      if (!(d.hi > d.lo && d.mode >= d.lo && d.mode <= d.hi)) throw new RangeError(`triangular: needs lo <= mode <= hi and lo < hi, got ${d.lo}, ${d.mode}, ${d.hi}`);
      return;
    case 'point':
      fin(d.value, 'value');
      return;
    default:
      throw new RangeError(`unknown distribution type '${String((d as { type?: unknown }).type)}'`);
  }
}

function checkTruncation(d: { type: string; lo?: number; hi?: number }, toZ: (x: number) => number): void {
  for (const [k, v] of [['lo', d.lo], ['hi', d.hi]] as const) {
    if (v !== undefined && !Number.isFinite(v)) throw new RangeError(`${d.type}: ${k} must be finite when given, got ${v}`);
  }
  if (d.lo !== undefined && d.hi !== undefined && !(d.hi > d.lo)) throw new RangeError(`${d.type}: hi (${d.hi}) must exceed lo (${d.lo})`);
  const [a, b] = zBounds(d, toZ);
  if (!(normalCdf(b) - normalCdf(a) > 1e-12)) throw new RangeError(`${d.type}: the truncation limits leave no probability mass`);
}

/** truncation limits in units of the underlying standard normal variable */
function zBounds(d: { lo?: number; hi?: number }, toZ: (x: number) => number): [number, number] {
  return [d.lo === undefined ? -Infinity : toZ(d.lo), d.hi === undefined ? Infinity : toZ(d.hi)];
}

/**
 * Quantile function: the value of the distribution at cumulative probability u in [0, 1] (u is clamped to the open
 * interval; the bounded laws are exact at 0 and 1).
 */
export function quantile(d: DistSpec, u: number): number {
  switch (d.type) {
    case 'point': return d.value;
    case 'uniform': return d.lo + Math.min(Math.max(u, 0), 1) * (d.hi - d.lo);
    case 'loguniform': return d.lo * Math.pow(d.hi / d.lo, Math.min(Math.max(u, 0), 1));
    case 'triangular': {
      const uu = Math.min(Math.max(u, 0), 1);
      const { lo, mode, hi } = d;
      const fc = (mode - lo) / (hi - lo);
      return uu < fc ? lo + Math.sqrt(uu * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - uu) * (hi - lo) * (hi - mode));
    }
    case 'normal': return d.mean + d.sd * truncatedZ(d, (x) => (x - d.mean) / d.sd, u);
    case 'lognormal': {
      const z = truncatedZ(d, (x) => Math.log(x / d.median) / d.sigmaLog, u);
      const x = d.median * Math.exp(d.sigmaLog * z);
      return clampTo(x, d.lo, d.hi);
    }
    default: throw new RangeError(`unknown distribution type '${String((d as { type?: unknown }).type)}'`);
  }
}

function clampTo(x: number, lo?: number, hi?: number): number {
  return Math.min(Math.max(x, lo ?? -Infinity), hi ?? Infinity);
}

/** standard normal variate of the (possibly truncated) law at cumulative probability u */
function truncatedZ(d: { lo?: number; hi?: number }, toZ: (x: number) => number, u: number): number {
  if (d.lo === undefined && d.hi === undefined) return normalQuantile(clampUnit(u));
  const [a, b] = zBounds(d, toZ);
  const Fa = normalCdf(a), Fb = normalCdf(b);
  const z = normalQuantile(clampUnit(Fa + Math.min(Math.max(u, 0), 1) * (Fb - Fa)));
  return Math.min(Math.max(z, a), b);
}

/** Cumulative distribution function. */
export function cdf(d: DistSpec, x: number): number {
  switch (d.type) {
    case 'point': return x < d.value ? 0 : 1;
    case 'uniform': return x <= d.lo ? 0 : x >= d.hi ? 1 : (x - d.lo) / (d.hi - d.lo);
    case 'loguniform': return x <= d.lo ? 0 : x >= d.hi ? 1 : Math.log(x / d.lo) / Math.log(d.hi / d.lo);
    case 'triangular': {
      const { lo, mode, hi } = d;
      if (x <= lo) return 0;
      if (x >= hi) return 1;
      return x <= mode ? ((x - lo) * (x - lo)) / ((hi - lo) * (mode - lo)) : 1 - ((hi - x) * (hi - x)) / ((hi - lo) * (hi - mode));
    }
    case 'normal': return truncatedCdf(d, (v) => (v - d.mean) / d.sd, x);
    case 'lognormal': return x <= 0 ? 0 : truncatedCdf(d, (v) => Math.log(v / d.median) / d.sigmaLog, x);
  }
}

function truncatedCdf(d: { lo?: number; hi?: number }, toZ: (x: number) => number, x: number): number {
  const [a, b] = zBounds(d, toZ);
  const z = toZ(x);
  if (z <= a) return 0;
  if (z >= b) return 1;
  const Fa = normalCdf(a);
  return (normalCdf(z) - Fa) / (normalCdf(b) - Fa);
}

/** Median and the central 90 % interval of a distribution (what the reports print as its "prior"). */
export function summarizeDist(d: DistSpec): { median: number; p05: number; p95: number } {
  return { median: quantile(d, 0.5), p05: quantile(d, 0.05), p95: quantile(d, 0.95) };
}

/**
 * Parses the compact command-line form NAME:ARG:ARG… (colon separated, so that a comma can separate several
 * parameters):
 *   uniform:lo:hi   loguniform:lo:hi   normal:mean:sd[:lo:hi]   lognormal:median:sigmaLog[:lo:hi]
 *   triangular:lo:mode:hi   point:value
 * A truncation limit of '-' leaves that side open (normal:1:0.1:-:1.5). Throws RangeError on malformed input.
 */
export function parseDist(text: string): DistSpec {
  const parts = text.trim().split(':');
  const name = parts[0];
  const args = parts.slice(1);
  const num = (s: string, what: string): number => {
    const v = Number(s);
    if (s.trim() === '' || !Number.isFinite(v)) throw new RangeError(`distribution '${text}': ${what} '${s}' is not a finite number`);
    return v;
  };
  const opt = (s: string | undefined, what: string): number | undefined => (s === undefined || s === '-' ? undefined : num(s, what));
  const arity = (min: number, max: number) => {
    if (args.length < min || args.length > max) throw new RangeError(`distribution '${text}': ${name} takes ${min === max ? min : `${min} to ${max}`} arguments, got ${args.length}`);
  };
  let d: DistSpec;
  switch (name) {
    case 'uniform': arity(2, 2); d = { type: 'uniform', lo: num(args[0], 'lo'), hi: num(args[1], 'hi') }; break;
    case 'loguniform': arity(2, 2); d = { type: 'loguniform', lo: num(args[0], 'lo'), hi: num(args[1], 'hi') }; break;
    case 'triangular': arity(3, 3); d = { type: 'triangular', lo: num(args[0], 'lo'), mode: num(args[1], 'mode'), hi: num(args[2], 'hi') }; break;
    case 'point': arity(1, 1); d = { type: 'point', value: num(args[0], 'value') }; break;
    case 'normal': {
      arity(2, 4);
      const lo = opt(args[2], 'lo'), hi = opt(args[3], 'hi');
      d = { type: 'normal', mean: num(args[0], 'mean'), sd: num(args[1], 'sd'), ...(lo !== undefined ? { lo } : {}), ...(hi !== undefined ? { hi } : {}) };
      break;
    }
    case 'lognormal': {
      arity(2, 4);
      const lo = opt(args[2], 'lo'), hi = opt(args[3], 'hi');
      d = { type: 'lognormal', median: num(args[0], 'median'), sigmaLog: num(args[1], 'sigmaLog'), ...(lo !== undefined ? { lo } : {}), ...(hi !== undefined ? { hi } : {}) };
      break;
    }
    default: throw new RangeError(`distribution '${text}': unknown name '${name}' (uniform, loguniform, normal, lognormal, triangular, point)`);
  }
  validateDist(d);
  return d;
}
