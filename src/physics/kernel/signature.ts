/**
 * Comparison of the plain number records a model reports (saveInternal(), getControls()): equal
 * keys and bitwise equal values. The kernel uses it to see whether the state a model's rhs() reads
 * has changed between two steps.
 */

/** True if both records have the same keys and Object.is-equal values (NaN equals NaN, +0 differs from −0). */
export function sameRecord(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  let n = 0;
  for (const k in a) {
    if (!Object.prototype.hasOwnProperty.call(a, k)) continue;
    if (!Object.prototype.hasOwnProperty.call(b, k) || !Object.is(a[k], b[k])) return false;
    n++;
  }
  for (const k in b) if (Object.prototype.hasOwnProperty.call(b, k)) n--;
  return n === 0;
}
