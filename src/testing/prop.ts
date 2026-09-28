/**
 * Minimal property-based testing, dependency free (in the spirit of QuickCheck: K. Claessen and
 * J. Hughes, "QuickCheck: a lightweight tool for random testing of Haskell programs", ICFP 2000).
 *
 *   forAll(gen.float(0, 1), (x) => { expect(f(x)).toBeGreaterThan(0); }, { runs: 200 });
 *
 * - Every case has its own 32-bit seed; case 0 uses the run seed itself, so a failure report
 *   "case seed 0x…" is replayed exactly with `{ seed: 0x…, runs: 1 }`.
 * - Random numbers come from mulberry32 (the generator of src/physics/rng.ts), so runs are
 *   deterministic for a given seed. PROP_SEED / PROP_RUNS environment variables override the
 *   defaults of every forAll call (for exploratory soak runs; CI uses the fixed defaults).
 * - A failing case is shrunk greedily: each generator proposes strictly "simpler" candidates
 *   (numbers move toward a target value and toward fewer significant digits, booleans toward
 *   false, choices toward the first option, optional values toward "absent", arrays toward
 *   fewer elements); the first candidate that still fails is kept, until no candidate fails or
 *   the evaluation budget is spent. The error message shows the seed, the original case, the
 *   shrunk case and the property's own error.
 * A property fails when it throws (e.g. a vitest expect) or returns false.
 */

/** Uniform random numbers in [0, 1). */
export type Rand = () => number;

/**
 * mulberry32 (T. Ettinger, public domain, 2017): 32-bit state, period 2^32. Identical to
 * RNG.next() in src/physics/rng.ts; a zero seed is replaced by 0x9e3779b9 the same way.
 */
export function mulberry32(seed: number): Rand {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    let t = (s = (s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value generator with a shrinker. */
export interface Arbitrary<T> {
  generate(rand: Rand): T;
  /**
   * Candidates strictly simpler than `value`, most aggressive first. Must be finite; strict
   * simplicity guarantees that greedy shrinking terminates.
   */
  shrink(value: T): Iterable<T>;
}

export interface NumberOptions {
  /** simplest value, shrink target (default: 0 clamped into [lo, hi]; logFloat: lo) */
  target?: number;
  /** probability of emitting lo, hi or the target instead of a random draw (default 0.1) */
  edgeProb?: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/** x truncated toward `toward` to `digits` significant digits (in the scale of |x − toward|). */
function truncateToward(x: number, toward: number, digits: number): number {
  const d = x - toward;
  if (d === 0 || !Number.isFinite(d)) return x;
  const scale = Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - digits + 1);
  if (!Number.isFinite(scale) || scale === 0) return x;
  const q = x / scale;
  const qr = Math.round(q);
  // x/scale carries rounding noise (0.7 / 0.01 = 69.999…): snap before truncating
  const r = Math.abs(q - qr) <= 1e-9 * Math.max(1, Math.abs(q)) ? qr : d > 0 ? Math.floor(q) : Math.ceil(q);
  return parseFloat((r * scale).toPrecision(15));
}

/** Candidates strictly closer to `t` than v (and inside [lo, hi]); integers only if `int`. */
function* shrinkNumber(v: number, t: number, lo: number, hi: number, int: boolean): Generator<number> {
  if (v === t || !Number.isFinite(v)) return;
  const dist = Math.abs(v - t);
  const seen = new Set<number>();
  const ok = (c: number) => {
    if (!Number.isFinite(c) || c < lo || c > hi || seen.has(c)) return false;
    if (int && !Number.isInteger(c)) return false;
    if (!(Math.abs(c - t) < dist)) return false;
    seen.add(c);
    return true;
  };
  if (ok(t)) yield t;
  // "rounder" values: fewer significant digits, truncated toward the target
  for (let k = 1; k <= 12; k++) {
    const c = truncateToward(v, t, k);
    if (ok(c)) yield c;
  }
  const iv = v > t ? Math.floor(v) : Math.ceil(v);
  if (ok(iv)) yield iv;
  // bisection toward the failing value: t + d/2, t + 3d/4, …
  const d = v - t;
  for (let k = 1; k <= 30; k++) {
    let c = v - d / Math.pow(2, k);
    if (int) c = d > 0 ? Math.floor(c) : Math.ceil(c);
    if (ok(c)) yield c;
  }
}

function numberArb(lo: number, hi: number, draw: (r: Rand) => number, target: number, edgeProb: number, int: boolean): Arbitrary<number> {
  if (!(lo <= hi)) throw new Error(`prop: empty range [${lo}, ${hi}]`);
  return {
    generate(rand) {
      const u = rand();
      if (u < edgeProb) {
        const e = [lo, hi, target][Math.min(2, Math.floor((u / edgeProb) * 3))];
        return e;
      }
      return clamp(draw(rand), lo, hi);
    },
    shrink: (v) => shrinkNumber(v, target, lo, hi, int),
  };
}

export const gen = {
  /** always `value`; never shrinks */
  constant<T>(value: T): Arbitrary<T> {
    return { generate: () => value, shrink: () => [] };
  },
  /** uniform in [lo, hi] */
  float(lo: number, hi: number, o: NumberOptions = {}): Arbitrary<number> {
    const target = clamp(o.target ?? 0, lo, hi);
    return numberArb(lo, hi, (r) => lo + (hi - lo) * r(), target, o.edgeProb ?? 0.1, false);
  },
  /** log-uniform in [lo, hi], 0 < lo ≤ hi (quantities spanning decades) */
  logFloat(lo: number, hi: number, o: NumberOptions = {}): Arbitrary<number> {
    if (!(lo > 0)) throw new Error('prop: logFloat needs lo > 0');
    const target = clamp(o.target ?? lo, lo, hi);
    const a = Math.log(lo), b = Math.log(hi);
    return numberArb(lo, hi, (r) => Math.exp(a + (b - a) * r()), target, o.edgeProb ?? 0.1, false);
  },
  /** uniform integer in [lo, hi] */
  int(lo: number, hi: number, o: NumberOptions = {}): Arbitrary<number> {
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error('prop: int bounds must be integers');
    const target = clamp(Math.round(o.target ?? 0), lo, hi);
    return numberArb(lo, hi, (r) => lo + Math.floor((hi - lo + 1) * r()), target, o.edgeProb ?? 0.1, true);
  },
  /** true/false with equal probability; shrinks toward false */
  bool(): Arbitrary<boolean> {
    return { generate: (r) => r() < 0.5, shrink: (v) => (v ? [false] : []) };
  },
  /** one of the given values; shrinks toward earlier entries */
  oneOf<T>(values: readonly T[]): Arbitrary<T> {
    if (values.length === 0) throw new Error('prop: oneOf needs at least one value');
    return {
      generate: (r) => values[Math.min(values.length - 1, Math.floor(r() * values.length))],
      shrink: (v) => values.slice(0, Math.max(0, values.indexOf(v))),
    };
  },
  /** `undefined` with probability 1 − pPresent; shrinks toward undefined, then the inner value */
  optional<T>(inner: Arbitrary<T>, pPresent = 0.5): Arbitrary<T | undefined> {
    return {
      generate: (r) => (r() < pPresent ? inner.generate(r) : undefined),
      *shrink(v) {
        if (v === undefined) return;
        yield undefined;
        yield* inner.shrink(v);
      },
    };
  },
  /** fixed-length tuple */
  tuple<T extends unknown[]>(...items: { [K in keyof T]: Arbitrary<T[K]> }): Arbitrary<T> {
    return {
      generate: (r) => items.map((g) => g.generate(r)) as T,
      *shrink(v) {
        for (let i = 0; i < items.length; i++) {
          for (const c of items[i].shrink(v[i])) {
            const next = v.slice() as T;
            next[i] = c;
            yield next;
          }
        }
      },
    };
  },
  /** object with independently generated fields (in key order) */
  record<R extends Record<string, unknown>>(shape: { [K in keyof R]: Arbitrary<R[K]> }): Arbitrary<R> {
    const keys = Object.keys(shape) as (keyof R)[];
    return {
      generate(r) {
        const out = {} as R;
        for (const k of keys) out[k] = shape[k].generate(r);
        return out;
      },
      *shrink(v) {
        for (const k of keys) {
          for (const c of shape[k].shrink(v[k])) yield { ...v, [k]: c };
        }
      },
    };
  },
  /** array of length in [minLen, maxLen]; shrinks by dropping elements, then element-wise */
  array<T>(item: Arbitrary<T>, minLen = 0, maxLen = 10): Arbitrary<T[]> {
    return {
      generate(r) {
        const n = minLen + Math.floor(r() * (maxLen - minLen + 1));
        return Array.from({ length: n }, () => item.generate(r));
      },
      *shrink(v) {
        if (v.length > minLen) {
          if (minLen === 0 && v.length > 1) yield [];
          const half = Math.max(minLen, v.length >> 1);
          if (half < v.length) yield v.slice(0, half);
          for (let i = 0; i < v.length; i++) yield [...v.slice(0, i), ...v.slice(i + 1)];
        }
        for (let i = 0; i < v.length; i++) {
          for (const c of item.shrink(v[i])) { const next = v.slice(); next[i] = c; yield next; }
        }
      },
    };
  },
};

export interface ForAllOptions {
  /** number of random cases (default 100; PROP_RUNS overrides) */
  runs?: number;
  /** run seed (default 0x5eed2a; PROP_SEED overrides) */
  seed?: number;
  /** maximum number of property evaluations spent on shrinking (default 400) */
  maxShrinks?: number;
  /** name shown in the failure message */
  label?: string;
  /** formats a case for the failure message (default: JSON with non-finite numbers spelled out) */
  show?: (value: unknown) => string;
}

export const DEFAULT_SEED = 0x5eed2a;
export const DEFAULT_RUNS = 100;

function envNumber(name: string): number | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const raw = env?.[name];
  if (raw === undefined || raw === '') return undefined;
  const v = Number(raw);
  return Number.isFinite(v) ? v : undefined;
}

/** seed of case i: case 0 is the run seed itself (direct replay), the others are hashed from it */
export function caseSeed(runSeed: number, i: number): number {
  if (i === 0) return runSeed >>> 0;
  let h = (runSeed ^ Math.imul(i, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function showValue(v: unknown): string {
  return JSON.stringify(v, (_k, x) => {
    if (typeof x === 'number' && !Number.isFinite(x)) return String(x);
    if (x === undefined) return '<undefined>';
    return x;
  }) ?? String(v);
}

type Outcome = { ok: true } | { ok: false; error: string };

function evaluate<T>(prop: (v: T) => boolean | void, v: T): Outcome {
  try {
    const r = prop(v);
    return r === false ? { ok: false, error: 'property returned false' } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Thrown by forAll; carries the machine-readable failure for tests of the harness itself. */
export class PropertyFailure<T = unknown> extends Error {
  constructor(message: string, readonly original: T, readonly shrunk: T, readonly caseSeed: number, readonly caseIndex: number) {
    super(message);
    this.name = 'PropertyFailure';
  }
}

/** Runs `prop` on `runs` generated cases; on the first failure shrinks it and throws PropertyFailure. */
export function forAll<T>(arb: Arbitrary<T>, prop: (value: T) => boolean | void, opts: ForAllOptions = {}): void {
  const runs = Math.max(1, Math.floor(envNumber('PROP_RUNS') ?? opts.runs ?? DEFAULT_RUNS));
  const seed = (envNumber('PROP_SEED') ?? opts.seed ?? DEFAULT_SEED) >>> 0;
  const maxShrinks = opts.maxShrinks ?? 400;
  const show = opts.show ?? showValue;
  for (let i = 0; i < runs; i++) {
    const cs = caseSeed(seed, i);
    const original = arb.generate(mulberry32(cs));
    const first = evaluate(prop, original);
    if (first.ok) continue;
    let cur = original;
    let err = first.error;
    let steps = 0, evals = 0;
    outer: while (evals < maxShrinks) {
      for (const cand of arb.shrink(cur)) {
        if (++evals > maxShrinks) break outer;
        const r = evaluate(prop, cand);
        if (!r.ok) { cur = cand; err = r.error; steps++; continue outer; }
      }
      break;
    }
    const hex = (x: number) => '0x' + x.toString(16);
    const msg = [
      `Property${opts.label ? ` "${opts.label}"` : ''} failed on case ${i + 1}/${runs} (run seed ${hex(seed)}, case seed ${hex(cs)}).`,
      `  original: ${show(original)}`,
      `  shrunk (${steps} step${steps === 1 ? '' : 's'}, ${evals} evaluation${evals === 1 ? '' : 's'}): ${show(cur)}`,
      `  error: ${err}`,
      `  replay: forAll(arb, prop, { seed: ${hex(cs)}, runs: 1 })`,
    ].join('\n');
    throw new PropertyFailure(msg, original, cur, cs, i);
  }
}
