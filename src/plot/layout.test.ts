/**
 * Edge cases of ticks, mathtext and figure layout helpers (legend overflow, event-mark aggregation,
 * min/max decimation, NaN-safe colour limits).
 */
import { describe, expect, it } from 'vitest';
import { aggregateMarks, colorLimits, decimateMinMax, Figure, legendLayout } from './figure';
import { nodeFontSet } from './fontsNode';
import { parseMath, runsWidth } from './mathtext';
import { formatTick, linearTicks, logTicks, sciLabel } from './ticks';

const fonts = nodeFontSet();

describe('ticks', () => {
  it('scientific labels keep the mantissa precision and carry rounding into the exponent', () => {
    expect(formatTick(1.25e5, 0)).toBe('$1.25\\times10^{5}$');
    expect(formatTick(-2.5e-4, 0)).toBe('$−2.5\\times10^{-4}$');
    expect(formatTick(1e6, 0)).toBe('$10^{6}$');
    expect(sciLabel(9.9996e5)).toBe('$10^{6}$'); // 9.9996 → 10.0 → carried
    expect(sciLabel(3e-4)).toBe('$3\\times10^{-4}$'); // no 2.9999999 residue
    expect(formatTick(-0.0001 + 1e-4, 2)).toBe('0');
    expect(formatTick(-1e-4 * 0.4, 2)).toBe('$−4\\times10^{-5}$');
    expect(formatTick(NaN, 1)).toBe('');
  });

  it('negative zero never prints as "−0.00"', () => {
    const t = linearTicks(-1, 1, 5);
    expect(t.labels).not.toContain('−0.0');
    expect(t.labels[t.major.indexOf(0)]).toBe('0');
  });

  it('large values share one multiplier printed at the axis end', () => {
    const t = linearTicks(0, 3e5, 4);
    expect(t.offset).toBe('$\\times10^{5}$');
    expect(t.labels).toEqual(['0', '1', '2', '3']);
    const s = linearTicks(0, 5e-4, 5);
    expect(s.offset).toBe('$\\times10^{-4}$');
    expect(s.labels.at(-1)).toBe('5');
  });

  it('offset notation when the span is tiny compared with the values', () => {
    const t = linearTicks(1000.01, 1000.05, 4);
    expect(t.offset).toBe('+1000');
    expect(t.labels).toEqual(['0.01', '0.02', '0.03', '0.04', '0.05']);
    const p = linearTicks(101325, 101327, 4);
    expect(p.offset).toMatch(/^\+/);
    expect(p.labels.every((l) => l.length <= 3)).toBe(true);
    // ordinary ranges are unaffected
    expect(linearTicks(0, 1, 5).offset).toBeUndefined();
    expect(linearTicks(2020, 2025, 5).offset).toBeUndefined();
  });

  it('non-finite and degenerate ranges do not throw or produce NaN labels', () => {
    expect(linearTicks(NaN, 1).major).toEqual([]);
    expect(linearTicks(Infinity, -Infinity).major).toEqual([]);
    expect(linearTicks(2, 2).labels).toEqual(['2.00']);
    expect(logTicks(0, 10).major).toEqual([]);
    expect(logTicks(-1, 10).major).toEqual([]);
  });

  it('log axes spanning less than two decades get sub-decade ticks', () => {
    const a = logTicks(2, 8);
    expect(a.major).toEqual([2, 5]);
    expect(a.labels).toEqual(['2', '5']);
    expect(a.minor).toEqual(expect.arrayContaining([3, 4, 6, 7]));
    const b = logTicks(0.3, 3);
    expect(b.major).toEqual([0.5, 1, 2]);
    expect(b.labels).toEqual(['0.5', '1', '2']);
    const c = logTicks(2.1, 2.9); // no {1,2,5} or 1…9 tick inside → linear positions
    expect(c.major.length).toBeGreaterThanOrEqual(2);
    expect(c.major.every((v) => v >= 2.1 && v <= 2.9)).toBe(true);
    const d = logTicks(3e-5, 8e-5);
    expect(d.labels.every((l) => l.startsWith('$'))).toBe(true); // 5×10^-5 style
    // two decades or more: decade labels as before
    expect(logTicks(1e-3, 10).labels).toEqual(['$10^{-3}$', '$10^{-2}$', '$10^{-1}$', '1', '10']);
  });

  it('wide log axes label every 2nd/3rd decade starting at the first visible one', () => {
    const t = logTicks(3e-26, 1e-12);
    expect(t.major[0]).toBeCloseTo(1e-25, 40);
    expect(t.major.length).toBeGreaterThanOrEqual(5);
  });
});

describe('mathtext', () => {
  const w = (s: string) => runsWidth(parseMath(s, fonts), 1, fonts);

  it('\\frac: scaled numerator above and denominator below a rule on the math axis; pen ends at the fraction end', () => {
    const r = parseMath('$\\frac{dq}{d\\rho}$', fonts);
    const rule = r.find((x) => x.rule)!;
    expect(rule.rise).toBeCloseTo(0.25, 6);
    const num = r.filter((x) => !x.rule && x.rise > 0), den = r.filter((x) => !x.rule && x.rise < 0);
    expect(num.map((x) => x.text).join('')).toBe('dq');
    expect(den.map((x) => x.text).join('')).toBe('dρ');
    for (const x of [...num, ...den]) expect(x.scale).toBeCloseTo(0.72, 6);
    // advance: side bearing + rule + side bearing, before following text and at the end of the label
    expect(w('$\\frac{dq}{d\\rho}x$')).toBeCloseTo(0.05 + rule.rule!.w + 0.05 + fonts.width('x', 'italic'), 6);
    expect(w('$\\frac{dq}{d\\rho}$')).toBeCloseTo(0.05 + rule.rule!.w + 0.05, 6);
    expect(r.at(-1)).toMatchObject({ text: '', dx: expect.any(Number) }); // kept as a pen-only run
    expect(r.at(-1)!.rule).toBeUndefined();
    // nested and in a superscript
    expect(() => parseMath('$x^{\\frac{1}{\\frac{a}{b}}}$', fonts)).not.toThrow();
  });

  it('\\bar / \\overline draw a rule above the base, \\hat a centred accent; the pen ends after the base', () => {
    const bar = parseMath('$\\bar{n}_e$', fonts);
    expect(bar[0].rule).toBeDefined();
    expect(bar[0].rise).toBeGreaterThan(0.5); // above the x-height
    expect(bar[1]).toMatchObject({ text: 'n', font: 'italic' });
    expect(w('$\\bar{n}$')).toBeCloseTo(fonts.width('n', 'italic'), 6);
    expect(w('$\\overline{AB}$')).toBeCloseTo(fonts.width('AB', 'italic'), 6);
    const hat = parseMath('$\\hat{T}$', fonts);
    expect(hat[0].text).toBe('ˆ');
    expect(hat[0].rise).toBeGreaterThan(0.1); // raised over a capital
    expect(w('$\\hat{T}$')).toBeCloseTo(fonts.width('T', 'italic'), 6);
    expect(parseMath('$\\hat{x}$', fonts)[0].rise).toBeCloseTo(0, 1);
  });

  it('spacing commands move the pen (TeX mu widths) instead of inserting spaces', () => {
    const r = parseMath('$a\\,b\\;c\\!d\\quad e$', fonts);
    expect(r.map((x) => x.text).join('')).toBe('abcde');
    expect(r.map((x) => +(x.dx ?? 0).toFixed(4))).toEqual([0, 0.1667, 0.2778, -0.1667, 1]);
    expect(w('$x\\,$')).toBeCloseTo(fonts.width('x', 'italic') + 3 / 18, 6); // a trailing space counts
  });

  it('binary operators and relations get medium / thick spaces, unary minus none', () => {
    const r = parseMath('$a = -b \\times c$', fonts);
    expect(r.find((x) => x.text === '=')!.dx).toBeCloseTo(5 / 18, 6);
    expect(r.find((x) => x.text === '−')!.dx).toBeCloseTo(5 / 18, 6); // only the space after '='
    expect(r.find((x) => x.text === '×')!.dx).toBeCloseTo(4 / 18, 6);
    expect(parseMath('$-1$', fonts)[0]).toMatchObject({ text: '−1' });
  });

  it('never hangs or throws on malformed input', () => {
    for (const s of ['$\\frac', '$\\frac{a}', '{{{', '}}}', '$x^', '$_', '\\', '$\\hat$', '$\\bar{}$', '$\\left( x \\right.$', '$\\unknowncmd{x}$', '$$$']) {
      expect(() => parseMath(s, fonts), s).not.toThrow();
    }
    expect(parseMath('$\\unknowncmd$')[0].text).toBe('unknowncmd');
    expect(parseMath('50\\% of \\$').map((r) => r.text).join('')).toBe('50% of $');
  });

  it('Greek: lower case italic in math, upper case and text mode upright, \\mathrm upright', () => {
    expect(parseMath('$\\alpha\\Delta$')).toMatchObject([{ text: 'α', font: 'italic' }, { text: 'Δ', font: 'roman' }]);
    expect(parseMath('\\alpha')[0].font).toBe('roman');
    expect(parseMath('$\\mathrm{\\tau}$')[0].font).toBe('roman');
    expect(parseMath('$ρ$')[0].font).toBe('italic'); // literal Greek letter in math
  });
});

describe('figure layout helpers', () => {
  it('legend overflow: fewer columns, then smaller text, never wider than the axes', () => {
    const labels = [3, 3, 3, 3, 3, 3]; // em
    const L = legendLayout(labels, 6, 7.5, 300, 200);
    expect(L.W).toBeLessThanOrEqual(300);
    expect(L.ncol).toBeLessThan(6);
    const long = legendLayout([12], 1, 8, 100, 100); // a long label: the text shrinks until it fits
    expect(long.W).toBeLessThanOrEqual(100);
    expect(long.fs).toBeLessThan(8);
    expect(legendLayout([40], 1, 8, 100, 100).fs).toBe(4.5); // never below 4.5 pt
    const fits = legendLayout([1, 1], 2, 8, 300, 200);
    expect(fits).toMatchObject({ ncol: 2, fs: 8 });
  });

  it('dense event marks aggregate into bands; isolated ones stay ticks', () => {
    const px = [10, 50, 50.3, 50.6, 50.9, 51.2, 90, 90.5];
    const a = aggregateMarks(px, 0.8);
    expect(a.bands).toEqual([[50, 51.2]]);
    expect(a.ticks).toEqual([10, 90, 90.5]);
    expect(aggregateMarks([NaN, 5], 1).ticks).toEqual([5]);
  });

  it('min/max decimation keeps each column\'s extremes and the end points', () => {
    const n = 20000;
    const xs = Float64Array.from({ length: n }, (_, i) => (100 * i) / (n - 1));
    const ys = Float64Array.from(xs, (x, i) => Math.sin(x) + (i % 97 === 0 ? 5 : 0));
    const [dx, dy] = decimateMinMax(xs, ys, 0.25);
    expect(dx.length).toBeLessThan(n / 10);
    expect(Math.max(...Array.from(dy))).toBe(Math.max(...ys));
    expect(Math.min(...Array.from(dy))).toBe(Math.min(...ys));
    expect(dx[0]).toBe(0);
    expect(dx[dx.length - 1]).toBe(100);
    for (let i = 1; i < dx.length; i++) expect(dx[i]).toBeGreaterThanOrEqual(dx[i - 1]);
    // non-monotone x (e.g. a closed contour) is left alone
    const circ = Array.from({ length: 200 }, (_, i) => Math.cos(i / 10));
    expect(decimateMinMax(circ, circ)[0]).toBe(circ);
  });

  it('colour limits are finite for all-NaN, constant, reversed and log data', () => {
    expect(colorLimits([NaN, NaN])).toEqual([0, 1]);
    expect(colorLimits([NaN], undefined, undefined, true)).toEqual([1, 10]);
    expect(colorLimits([2, 2])).toEqual([1.8, 2.2]);
    expect(colorLimits([0, -1, 5], 3, 1)).toEqual([1, 3]);
    expect(colorLimits([-1, 0, 10, 100], undefined, undefined, true)).toEqual([10, 100]);
    expect(colorLimits([1, 2], NaN, Infinity)).toEqual([1, 2]);
  });

  it('an all-NaN heat map with a colour bar renders without NaN', () => {
    const fig = new Figure(3, 2.5);
    const [ax] = fig.subplots(1, 1, { right: 0.8 });
    const m = ax.image(new Float64Array(12).fill(NaN), 4, 3, [0, 1, 0, 1], { log: true });
    fig.colorbar(m, ax, { label: 'Q' });
    const svg = fig.toSVG({ fonts });
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it('unusable axis limits (from all-NaN series) fall back to the data range', () => {
    const fig = new Figure(3, 2);
    const [ax] = fig.subplots(1, 1);
    ax.plot([0, 1], [NaN, NaN]).set({ xlim: [0, 1], ylim: [0, Math.max(...[NaN].filter(Number.isFinite)) * 1.2] });
    const [bx] = new Figure(3, 2).subplots(1, 1);
    bx.plot([1, 10], [1, 10]).set({ xscale: 'log', xlim: [0, 10], ylim: [2, 2] });
    expect(fig.toSVG({ fonts })).not.toMatch(/NaN|Infinity/);
    expect(bx.fig.toSVG({ fonts })).not.toMatch(/NaN|Infinity/);
  });
});
