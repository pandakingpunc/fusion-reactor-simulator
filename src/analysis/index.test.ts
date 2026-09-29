import { describe, expect, it } from 'vitest';
import * as analysis from './index';

describe('src/analysis barrel', () => {
  it('exports the public API of every module (a missing or clashing export fails here)', () => {
    const names = [
      // distributions, samplers, statistics
      'quantile', 'normalQuantile', 'parseDist', 'sobolPoints', 'Sobol', 'unitSample', 'mixSeed', 'wilsonInterval', 'bootstrap', 'spearman',
      // sensitivity, priors, metrics, ensembles, scans
      'saltelliDesign', 'sobolIndices', 'sobolIndicesOfFunction', 'defaultPriors', 'transformUnit', 'logScalingSigma', 'runMetrics', 'METRIC_KEYS',
      'planEnsemble', 'summarizeEnsemble', 'runEnsemble', 'toJson', 'toCsv', 'CAVEAT', 'serialRunner', 'simulateMetrics', 'planScan', 'summarizeScan',
      // steady state, design, optimisers
      'steadyState', 'solveDesign', 'solvePareto', 'designReport', 'paretoReport', 'OPTIMIZATION_CAVEAT', 'nelderMead', 'augmentedLagrangian', 'cmaes', 'nsga2', 'hypervolume2D',
    ];
    for (const n of names) expect((analysis as Record<string, unknown>)[n], n).toBeDefined();
    // the node-only pool runner is deliberately not part of the barrel
    expect((analysis as Record<string, unknown>).poolRunner).toBeUndefined();
  });

  it('both caveats state that the results are educational', () => {
    expect(analysis.CAVEAT).toMatch(/^EDUCATIONAL/);
    expect(analysis.OPTIMIZATION_CAVEAT).toMatch(/^EDUCATIONAL/);
  });
});
