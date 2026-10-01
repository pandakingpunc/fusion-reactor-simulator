/**
 * contourLabel: where an inline contour label goes when there are points to avoid (the trajectory, the legend, the labels placed before).
 * The distance to those points is measured in label sizes (LABEL_SPAN), not as a plain distance in axis fractions: a label is wider than it is
 * tall, so 0.065 of the x span to a neighbouring label is half a label width, an overlap, while 0.06 of the y span is more than a label height.
 * In the first POPCON figure of v4 the 'Q = 10' label sat on top of '100 MW' because the plain distance (0.03 of the y span) was the best on
 * offer on that contour and counted as clear.
 */
import { describe, expect, it } from 'vitest';
import { Figure } from '../figure';
import { LABEL_SPAN, contourLabel } from './common';

/** a figure with one axes, and the horizontal contour y = 15 on x = 0 … 1.45, y = 0 … 30 (the POPCON axes' proportions) */
function setup() {
  const fig = new Figure(3, 3, { fontSize: 8, title: 'test' });
  const [ax] = fig.subplots(1, 1, { left: 0.5, right: 0.5, top: 0.2, bottom: 0.4 });
  const nx = 146, ny = 31;
  const x = Array.from({ length: nx }, (_, i) => i * 0.01), y = Array.from({ length: ny }, (_, j) => j);
  const Z = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) Z[j * nx + i] = y[j];
  return { ax, x, y, Z, sx: 1.45, sy: 30 };
}

/** distance of (px, py) to the nearest avoid point in label sizes */
const labelDistance = (p: [number, number], avoid: [number, number][], sx: number, sy: number) =>
  Math.min(...avoid.map(([ax_, ay]) => Math.hypot((p[0] - ax_) / (sx * LABEL_SPAN[0]), (p[1] - ay) / (sy * LABEL_SPAN[1]))));

describe('contourLabel with points to avoid', () => {
  it('without points to avoid the label sits at the requested fraction of the contour', () => {
    const { ax, x, y, Z } = setup();
    const at = contourLabel(ax, x, y, Z, 15, '15', { pos: 0.25 })!;
    expect(at[1]).toBeCloseTo(15, 9);
    expect(at[0]).toBeGreaterThan(0.3);
    expect(at[0]).toBeLessThan(0.45);
  });

  it('a contour that does not exist gets no label', () => {
    const { ax, x, y, Z } = setup();
    expect(contourLabel(ax, x, y, Z, 99, 'none')).toBeNull();
  });

  it('prefers the place that is clear in label sizes over the one that is merely far in axis fractions', () => {
    const { ax, x, y, Z, sx, sy } = setup();
    // block the contour with a dense row of points on it, leaving two gaps:
    //  gap 1 around x = 0.30: neighbours at ±0.065 of the x span (0.094 in x) on the contour: 0.065 plain, 0.65 label sizes (overlap);
    //  gap 2 around x = 1.10: nothing within ±0.15 of the x span on the contour, and a row of points 0.06 of the y span above it:
    //  0.06 plain (smaller than gap 1), 1.33 label sizes (clear).
    const avoid: [number, number][] = [];
    for (let xv = 0; xv <= 1.45 + 1e-9; xv += 0.005) {
      const inGap1 = xv > 0.3 - 0.094 + 1e-9 && xv < 0.3 + 0.094 - 1e-9;
      const inGap2 = xv > 1.1 - 0.15 * sx && xv < 1.1 + 0.15 * sx;
      if (!inGap1 && !inGap2) avoid.push([xv, 15]);
      if (xv >= 0.9 && xv <= 1.3) avoid.push([xv, 15 + 0.06 * sy]);
    }
    const at = contourLabel(ax, x, y, Z, 15, 'L', { avoid })!;
    expect(at[1]).toBeCloseTo(15, 9);
    expect(at[0]).toBeGreaterThan(0.88);
    expect(at[0]).toBeLessThan(1.32);
    expect(labelDistance(at, avoid, sx, sy)).toBeGreaterThanOrEqual(1);
  });

  it('two labels placed one after the other do not overlap when the contours leave room for it', () => {
    const { ax, x, y, Z, sx, sy } = setup();
    // y = 15 and y = 15.4: 0.013 of the y span apart, a third of a label height
    const avoid: [number, number][] = [];
    const a = contourLabel(ax, x, y, Z, 15, 'A', { avoid })!;
    avoid.push(a);
    const b = contourLabel(ax, x, y, Z, 15.4, 'B', { avoid })!;
    expect(labelDistance(b, [a], sx, sy)).toBeGreaterThanOrEqual(1);
  });
});
