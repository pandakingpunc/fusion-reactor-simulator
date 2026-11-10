/**
 * Automatic second y-axis for a time chart whose series differ by orders of magnitude (n_e ≈ 1 next to a fueling rate
 * of 154 on one linear axis flattens the density curves into a line at the bottom). DOM-free.
 *
 * The decision works on one number per series, its magnitude over the whole run (max(|min|, |max|), see
 * `FrameColumns.magnitude`): sort them, find the biggest jump between neighbours, and split the series there when
 * the jump is a decade or more. The series on the side of the first one in the legend order stay on the left axis, so
 * the axis a reader already knows keeps its curves. A run in progress would flicker around the threshold, so the
 * decision has hysteresis: once split it stays split until the jump falls below `KEEP_RATIO`.
 */

/** the biggest gap between two neighbouring magnitudes must reach this to split a single-axis chart */
export const SPLIT_RATIO = 10;
/** … and must fall below this to merge a split chart again */
export const KEEP_RATIO = 7;

/** a series with no finite non-zero value takes part in no decision and stays on the left axis */
const neutral = (m: number) => !Number.isFinite(m) || m === 0;

/**
 * @param magnitudes one per visible series, in legend order (0, NaN or ±Infinity: neutral)
 * @param wasSplit the previous decision (hysteresis)
 * @returns `right[i]`: series i goes on the right axis (always false unless `split`)
 */
export function splitAxes(magnitudes: readonly number[], wasSplit: boolean): { split: boolean; right: boolean[] } {
  const none = { split: false, right: magnitudes.map(() => false) };
  const mags = magnitudes.map(Math.abs);
  const sorted = mags.filter((m) => !neutral(m)).sort((a, b) => a - b);
  if (sorted.length < 2) return none;
  let ratio = 1, cut = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i] / sorted[i - 1];
    if (r > ratio) { ratio = r; cut = sorted[i - 1]; } // `cut`: the largest magnitude of the small group
  }
  if (ratio < (wasSplit ? KEEP_RATIO : SPLIT_RATIO)) return none;
  const first = mags.findIndex((m) => !neutral(m));
  const firstLarge = mags[first] > cut;
  return { split: true, right: mags.map((m) => !neutral(m) && (m > cut) !== firstLarge) };
}
