/**
 * The validation figure's shaded bands. The legend and the caption say '±30%' and '×2'; the bands drawn must be exactly those:
 * within 30 % of the reference is the ratio 0.7 to 1.3 (it was drawn from 1/1.3 = 0.77, so that JET T_i(0) of the 0D model, 24 % below
 * the published value and inside ±30 %, lay outside the band that carries the label).
 */
import { describe, expect, it } from 'vitest';
import { nodeFontSet } from '../fontsNode';
import { BAND_30PCT, BAND_FACTOR2, ValidationRow, figValidation } from './validation';

interface Span { k: string; a: number; b: number; label?: string }
const spans = (rows: ValidationRow[]): Span[] =>
  figValidation(rows).axes.flatMap((ax) => ax.artists as unknown as Span[]).filter((a) => a.k === 'vspan');

const rows: ValidationRow[] = [{ label: 'JET  $T_i(0)$', ref: 10, refText: '≈10 keV', v0D: 7.6, v15D: 10.2 }];

describe("validation figure bands", () => {
  it("the '±30%' band spans the ratios 0.7 to 1.3 and the '×2' band 0.5 to 2", () => {
    const s = spans(rows);
    const b30 = s.find((x) => x.label === '±30%')!, b2 = s.find((x) => x.label === '×2')!;
    expect([b30.a, b30.b]).toEqual([0.7, 1.3]);
    expect([b2.a, b2.b]).toEqual([0.5, 2]);
    expect([...BAND_30PCT]).toEqual([0.7, 1.3]);
    expect([...BAND_FACTOR2]).toEqual([0.5, 2]);
  });

  it('a value 24 % below the reference (ratio 0.76) is inside the band labelled ±30%, one 31 % below is outside it', () => {
    const b30 = spans(rows).find((x) => x.label === '±30%')!;
    const inside = (ratio: number) => ratio >= Math.min(b30.a, b30.b) && ratio <= Math.max(b30.a, b30.b);
    expect(inside(7.6 / 10)).toBe(true);
    expect(inside(6.9 / 10)).toBe(false);
    expect(inside(13 / 10)).toBe(true);
    expect(inside(13.1 / 10)).toBe(false);
  });

  it('the figure still renders with both bands in the legend', () => {
    const svg = figValidation(rows).toSVG({ fonts: nodeFontSet() });
    expect(svg).toContain('±30%');
    expect(svg).toContain('×2');
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
});
