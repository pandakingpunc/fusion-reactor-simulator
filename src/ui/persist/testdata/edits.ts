/**
 * Test data for the persistence tests: seeded random edits of a configuration, the way a user (or a
 * hostile sender) can change one. Not imported by the application bundle.
 */
import { ActuatorEntry, ReactorConfig } from '../../../physics/types';
import { RNG } from '../../../physics/rng';
import { stepsFor } from '../../wizard/schema';
import { SharePayload } from '../codec';

type Obj = Record<string, unknown>;

/** Paths of the number, flag and text leaves of a configuration. */
export function leafPaths(v: unknown, prefix = ''): string[] {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return prefix ? [prefix] : [];
  return Object.entries(v as Obj).flatMap(([k, x]) => leafPaths(x, prefix ? `${prefix}.${k}` : k));
}

function get(o: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Obj)[k] : undefined), o);
}

function set<T>(o: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const root: Obj = { ...(o as Obj) };
  let cur = root;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = { ...((cur[keys[i]] as Obj | undefined) ?? {}) };
    cur = cur[keys[i]] as Obj;
  }
  cur[keys[keys.length - 1]] = value;
  return root as T;
}

/** A number that stresses the codec: full-precision doubles of every magnitude, and the ones JSON cannot write. */
export function nastyNumber(rng: RNG): number {
  const k = Math.floor(rng.next() * 14);
  switch (k) {
    case 0: return NaN;
    case 1: return Infinity;
    case 2: return -Infinity;
    case 3: return -0;
    case 4: return 0;
    case 5: return Number.MAX_VALUE;
    case 6: return Number.MIN_VALUE;
    case 7: return 0.1 + 0.2;
    case 8: return Math.floor(rng.next() * 1e6);
    case 9: return -rng.next() * 100;
    default: return (rng.next() * 2 - 1) * 10 ** (rng.next() * 40 - 20);
  }
}

/** Options of the wizard's choice fields, by path: an edit of such a field stays a value the wizard could hold. */
function choiceOptions(cfg: ReactorConfig): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const s of stepsFor(cfg.method)) for (const f of s.fields) if (f.type === 'select' && f.options) m.set(f.path, f.options.map((o) => o.value));
  return m;
}

/**
 * One random edit of one leaf of `cfg`: a number (any double, or blank), a flag, or another option of a choice
 * field. The kind of a leaf is the one it has in `base` (the configuration the edits started from), so a leaf
 * that an earlier edit blanked stays a leaf of its kind.
 */
export function editOnce(cfg: ReactorConfig, rng: RNG, base: ReactorConfig = cfg): ReactorConfig {
  const choices = choiceOptions(base);
  const paths = leafPaths(base).filter((p) => p !== 'method');
  const path = paths[Math.floor(rng.next() * paths.length)];
  const cur = get(base, path);
  if (typeof cur === 'boolean') return set(cfg, path, rng.next() < 0.2 ? undefined : !cur);
  if (typeof cur === 'string') {
    const opts = choices.get(path);
    return opts ? set(cfg, path, opts[Math.floor(rng.next() * opts.length)]) : cfg;
  }
  return set(cfg, path, rng.next() < 0.15 ? undefined : nastyNumber(rng));
}

/** A configuration with 1 to 5 random edits. */
export function editConfig(cfg: ReactorConfig, rng: RNG): ReactorConfig {
  let c = cfg;
  const n = 1 + Math.floor(rng.next() * 5);
  for (let i = 0; i < n; i++) c = editOnce(c, rng, cfg);
  return c;
}

const NAMES = ['ITER', 'DT plasma #3', 'Füzyon tokamağı — deneme', '核融合 ⚛️ 🔥', 'a "quoted" \\ name', ''];

/** A random actuator log with full-precision doubles. */
export function randomLog(rng: RNG, n = 1 + Math.floor(rng.next() * 6)): ActuatorEntry[] {
  const keys = ['P_NBI_MW', 'P_ICRH_MW', 'n_target_1e20', 'H98', 'I_p_MA'];
  const out: ActuatorEntry[] = [];
  let step = 0;
  for (let i = 0; i < n; i++) {
    step += 1 + Math.floor(rng.next() * 400);
    out.push({ t: rng.next() * 100, step, patch: { [keys[Math.floor(rng.next() * keys.length)]]: (rng.next() - 0.3) * 50 } });
  }
  return out;
}

/** A payload for a round-trip test: an edited configuration, sometimes with a name, breakpoints, an actuator log and a scenario. */
export function editPayload(cfg: ReactorConfig, rng: RNG, i: number): SharePayload {
  const payload: SharePayload = { cfg: editConfig(cfg, rng) };
  if (i % 2 === 0) payload.name = NAMES[i % NAMES.length];
  if (i % 4 === 0) payload.actuatorLog = randomLog(rng);
  if (i % 5 === 0) payload.breakpoints = [rng.next(), rng.next() * 2, 3];
  if (i % 7 === 0) {
    payload.scenario = { schema: 1, waveforms: { P_NBI_MW: { kind: 'pwl', points: [[0, 0], [rng.next() * 10, null], [20, rng.next() * 40]] } }, triggers: [] };
  }
  if (i % 9 === 0) payload.appVersion = '4.0.0';
  return payload;
}
