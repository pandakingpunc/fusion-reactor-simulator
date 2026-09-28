import { describe, expect, it } from 'vitest';
import { Figure } from './figure';
import { contourLines } from './contour';
import { linearTicks, logTicks } from './ticks';
import { parseMath } from './mathtext';
import { nodeFontSet } from './fontsNode';
import { texify } from './figures/generic';
import { computePopcon } from '../physics/popcon';
import { ITER } from '../physics/presets';

describe('plot engine', () => {
  it('marching squares traces a circle to grid accuracy', () => {
    const n = 81, x = Array.from({ length: n }, (_, i) => -1 + (2 * i) / (n - 1));
    const Z = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) Z[j * n + i] = Math.hypot(x[i], x[j]);
    const lines = contourLines(x, x, Z, 0.5);
    expect(lines.length).toBe(1); // tek kapalı eğriye birleşir
    for (let k = 0; k < lines[0].x.length; k++) expect(Math.hypot(lines[0].x[k], lines[0].y[k])).toBeCloseTo(0.5, 2);
  });

  it('ticks: nice linear steps and decade log ticks', () => {
    expect(linearTicks(0, 1, 5).major).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    const lg = logTicks(1e-3, 10);
    expect(lg.major).toEqual([1e-3, 1e-2, 1e-1, 1, 10]);
    expect(lg.labels[0]).toBe('$10^{-3}$');
  });

  it('mathtext: italic variables, roman subscripts, Greek and STIX Two Math fallbacks', () => {
    const runs = parseMath('$T_{\\mathrm{e}}$ (keV)');
    expect(runs[0]).toMatchObject({ text: 'T', font: 'italic', scale: 1 });
    expect(runs[1].scale).toBeLessThan(1);
    expect(runs[1].rise).toBeLessThan(0);
    expect(parseMath('$\\beta_N$')[0]).toMatchObject({ text: 'β', font: 'italic' }); // TeX: lower-case Greek italic in math
    const fonts = nodeFontSet();
    expect(fonts.glyph('ℓ', 'roman').face).toBe('roman'); // STIX Two Text has ℓ
    expect(fonts.glyph('α', 'italic').face).toBe('italic');
    expect(fonts.glyph('≈', 'roman').face).toBe('math'); // only in STIX Two Math
  });

  it('texify converts UI labels to mathtext', () => {
    expect(texify('n_e [1e20 m⁻³]')).toBe('$n_{\\mathrm{e}}$ [$10^{20}$ m$^{-3}$]');
    expect(texify('P_fusion')).toBe('$P_{\\mathrm{fusion}}$');
  });

  it('figure renders to well-formed SVG and PDF', () => {
    const fig = new Figure(3.37, 2.4, { title: 'test' });
    const [ax] = fig.subplots(1, 1);
    const t = Array.from({ length: 50 }, (_, i) => i / 49);
    ax.plot(t, t.map((v) => Math.sin(6 * v)), { label: '$\\sin 6x$' }).set({ xlabel: '$x$', ylabel: '$y$' }).legend();
    const fonts = nodeFontSet();
    const svg = fig.toSVG({ fonts });
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('viewBox="0 0 242.64 172.8"');
    expect(svg).not.toContain('NaN');
    const pdf = new TextDecoder('latin1').decode(fig.toPDF({ fonts }));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+STIXTwoText-Regular/);
    expect(pdf).not.toContain('/Times-Roman');
    // xref ofsetleri gerçek nesne konumlarını göstermeli
    const xref = pdf.slice(pdf.lastIndexOf('xref'));
    const offs = [...xref.matchAll(/^(\d{10}) 00000 n/gm)].map((m) => parseInt(m[1], 10));
    for (const [k, o] of offs.entries()) expect(pdf.slice(o, o + 12)).toMatch(new RegExp(`^${k + 1} 0 obj`));
  });
});

describe('POPCON (steady-state 0D power balance)', () => {
  const g = computePopcon(ITER, { nx: 40, ny: 40, Tmax: 30, uniformT: true });
  const at = (n20: number, T: number) => {
    const i = Math.round((n20 * 1e20) / (g.n[1] - g.n[0]) - 0.5), j = Math.round(T / (g.T[1] - g.T[0]) - 0.5);
    return i * g.ny + j;
  };
  it('ITER baseline point needs tens of MW and gives Q ≈ 10 (not ignited)', () => {
    const k = at(0.85, 8.5);
    expect(g.Paux[k] / 1e6).toBeGreaterThan(20);
    expect(g.Paux[k] / 1e6).toBeLessThan(120);
    expect(g.Q[k]).toBeGreaterThan(5);
    expect(g.Q[k]).toBeLessThan(25);
    expect(g.fHe[k]).toBeGreaterThan(0.01);
    expect(g.fHe[k]).toBeLessThan(0.1);
  });
  it('required power rises steeply at high temperature (power-degraded confinement)', () => {
    expect(g.Paux[at(0.85, 20)]).toBeGreaterThan(3 * g.Paux[at(0.85, 8.5)]);
  });
});
