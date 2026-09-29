/**
 * JSON with the numbers JSON cannot hold.
 *
 * JSON.stringify writes NaN and ±Infinity as null and -0 as 0. A share link or a run file that goes through
 * it would come back as a different configuration (or a different report), and a run fingerprint is a hash
 * of every bit of the inputs. The two functions here write those four numbers as the one-key object
 * {"$num": "NaN" | "Infinity" | "-Infinity" | "-0"} and read them back, so that
 * parseJson(stringifyJson(x)) is bitwise x for every number a run can contain. Every other value is plain
 * JSON: a file without such numbers is ordinary JSON that any reader can use.
 */

const TAG = '$num';
const SPECIAL = new Set(['NaN', 'Infinity', '-Infinity', '-0']);

/** The tagged form of a number JSON cannot write, or the number itself. */
function tag(v: unknown): unknown {
  if (typeof v !== 'number') return v;
  if (Number.isNaN(v)) return { [TAG]: 'NaN' };
  if (v === Infinity) return { [TAG]: 'Infinity' };
  if (v === -Infinity) return { [TAG]: '-Infinity' };
  if (Object.is(v, -0)) return { [TAG]: '-0' };
  return v;
}

/** The number a tagged object stands for, or undefined when `v` is not a valid tag. */
function untag(v: unknown): number | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const keys = Object.keys(v);
  if (keys.length !== 1 || keys[0] !== TAG) return undefined;
  const s = (v as Record<string, unknown>)[TAG];
  if (typeof s !== 'string' || !SPECIAL.has(s)) return undefined;
  return s === 'NaN' ? NaN : s === 'Infinity' ? Infinity : s === '-Infinity' ? -Infinity : -0;
}

/** JSON text of `value`; NaN, ±Infinity and -0 survive parseJson. `space` as in JSON.stringify. */
export function stringifyJson(value: unknown, space?: number): string {
  return JSON.stringify(value, (_k, v) => tag(v), space);
}

/** Inverse of stringifyJson (throws SyntaxError on malformed text, like JSON.parse). */
export function parseJson(text: string): unknown {
  return JSON.parse(text, (_k, v) => {
    const n = untag(v);
    return n === undefined ? v : n;
  });
}
