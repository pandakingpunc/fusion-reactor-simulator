/**
 * The paper's figure registry on a synthetic context: every spec builds a figure and a caption without a
 * simulation, and the solver counters of the 1.5D run (accepted / retried / rejected Grad-Shafranov
 * updates, forced transport steps) are in the caption of the equilibrium figure.
 */
import { describe, expect, it } from 'vitest';
import { nodeFontSet } from '../fontsNode';
import { captionBlock } from '../registry';
import { PAPER_FIGURES, plainLabel, solverCounters, solverCountersLine, solverCountersText } from './paper';
import { syntheticMainRun, syntheticPaperCtx } from './testdata/synthetic';

const fonts = nodeFontSet();

describe('solver counters', () => {
  it('the caption sentence names every counter, with singular and plural forms', () => {
    expect(solverCountersText({ eqUpdates: 25, eqRetried: 3, eqRejected: 0, forcedSteps: 0 })).toBe(
      'The equilibrium was re-solved 25 times after the initial solve (accepted Grad–Shafranov updates; 3 of them only after a retry stage) and 0 updates were rejected; no transport step had to be forced.');
    expect(solverCountersText({ eqUpdates: 1, eqRetried: 0, eqRejected: 1, forcedSteps: 1 })).toBe(
      'The equilibrium was re-solved once after the initial solve (accepted Grad–Shafranov updates; 0 of them only after a retry stage) and 1 update was rejected; 1 transport step was forced at the smallest time step without Picard convergence.');
    expect(solverCountersText({ eqUpdates: 0, eqRetried: 0, eqRejected: 4, forcedSteps: 7 })).toContain('4 updates were rejected; 7 transport steps were forced');
  });

  it('the log line and the copy carry the same four numbers', () => {
    const c = solverCounters({ eqUpdates: 25, eqRetried: 3, eqRejected: 1, forcedSteps: 2, ...{ extra: 9 } } as never);
    expect(c).toEqual({ eqUpdates: 25, eqRetried: 3, eqRejected: 1, forcedSteps: 2 });
    expect(solverCountersLine(c)).toBe('25 GS updates accepted (3 after a retry), 1 rejected, 2 forced transport steps');
  });
});

describe('the paper registry builds from a synthetic context', () => {
  const ctx = syntheticPaperCtx(3);

  for (const spec of PAPER_FIGURES) {
    it(`Fig. ${spec.number} ${spec.id}: figure and caption`, () => {
      const { fig, caption } = spec.build(ctx);
      const svg = fig.toSVG({ fonts });
      expect(svg).not.toMatch(/NaN|Infinity/);
      expect(caption.length).toBeGreaterThan(100);
      expect(caption).not.toMatch(/NaN|undefined|Infinity/);
      const block = captionBlock(spec.number, spec.file, caption);
      expect(block.text.startsWith(`**Fig. ${spec.number} (${spec.file}).**`)).toBe(true);
      expect(spec.inputs(ctx.params).seeds).toBeTypeOf('object');
    });
  }

  it('the equilibrium caption ends with the counters of the run; changing them changes the caption', () => {
    const eq = PAPER_FIGURES.find((s) => s.id === 'equilibrium')!;
    const a = eq.build(ctx).caption;
    expect(a.endsWith(solverCountersText({ eqUpdates: 25, eqRetried: 3, eqRejected: 1, forcedSteps: 0 }))).toBe(true);
    const b = eq.build({ ...ctx, iter: syntheticMainRun({ eqUpdates: 30, eqRetried: 0, eqRejected: 0, forcedSteps: 2 }) }).caption;
    expect(b).toContain('30 times');
    expect(b).toContain('2 transport steps were forced');
    expect(b).not.toBe(a);
  });

  it('a failed discharge of the scan leaves its cell blank and is counted in the caption', () => {
    const scan = PAPER_FIGURES.find((s) => s.id === 'scan')!;
    expect(scan.build(ctx).caption).toContain('1 discharges that ended early');
  });

  it('a figure that needs the ITER run refuses to build without it', () => {
    expect(() => PAPER_FIGURES[0].build({ ...ctx, iter: null })).toThrow(/ITER 1.5D run is required/);
  });

  it('plainLabel turns mathtext into table text', () => {
    expect(plainLabel('ITER  $q_{95}$')).toBe('ITER  q_95');
    expect(plainLabel('$\\beta_N$ and $\\ell_i(3)$')).toBe('β_N and ℓ_i(3)');
    expect(plainLabel('$P_{\\mathrm{fus}}$')).toBe('P_fus');
  });
});
