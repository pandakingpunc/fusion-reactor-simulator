import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Modules that contain only types (interfaces, type aliases): they compile to an empty file, so there is nothing to
// cover. They are excluded from coverage BY NAME because V8 coverage counts them differently depending on the
// checkout path: in a path with a space or a non-ASCII letter (this repository's own checkout is one) the
// untested-file pass reads each of them as 28 to 63 uncovered lines, in a plain path as an empty file at 100 %.
// A ratchet measured in the first environment sat about 2.6 points below what a clean path (CI) measures, and the
// levels would have failed the gate the other way round. src/coverageConfig.test.ts keeps the list exact.
export const TYPE_ONLY_MODULES = [
  'src/physics/profiles/events/EventModel.ts',
  'src/physics/profiles/sources/SourceModel.ts',
  'src/physics/profiles/transport/TransportModel.ts',
  'src/ui/state/types.ts',
];

export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'bench/**/*.test.ts'],
    // waits a few real milliseconds before each test (and turns the event loop after it) so that no worker-to-main
    // RPC call is pending while a long synchronous test runs: a call unanswered for 60 s is 'Timeout calling
    // "onTaskUpdate"', an unhandled error that fails `npm run coverage` with every test green. Root cause and
    // reproduction in the header of the setup file.
    setupFiles: ['src/vitest.setup.ts'],
    // A global ceiling of 30 s per test (vitest's default is 5 s). The 1.5D model with TR-BDF2 error control is 2 to 3 times
    // slower than the fixed-step scheme it replaced, and ten agents on one 12-core machine stretch a run further: tests
    // that need more than 30 s carry their own explicit timeout (kernel/simulation, lossPower, lib, the CLI suites).
    testTimeout: 30_000,
    // beforeAll/afterAll hooks run a whole shot in some suites (edge/integration.test.ts): vitest's 10 s default failed the suite on a loaded machine
    hookTimeout: 120_000,
    // `npm run coverage` (vitest run --coverage). Code that runs only in child processes or worker
    // threads (the CLI entry points *.cli.ts, *.worker.ts) is not seen by V8 coverage of the test
    // process, so it is excluded: counted, it read as 0 % however well the end-to-end tests
    // (cli.test.ts) exercise it, and every line added to a CLI lowered the src/cli ratchet.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        'src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/testdata/**',
        'src/main.tsx', 'src/App.tsx', 'src/**/*.d.ts', 'src/vitest.setup.ts',
        'src/**/*.cli.ts', 'src/**/*.worker.ts',
        ...TYPE_ONLY_MODULES,
      ],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      // Ratchet: the levels measured on 2026-09-30 (v4/integration at the Wave-2A merge, 228 test files, 3061 tests, 11 of them
      // skipped by a failed hook of edge/integration.test.ts under a machine loaded by ten agents), rounded down after 0.25 points
      // of margin so that the run-to-run noise of timing-dependent paths (the pool's) cannot fail the gate. Raise these when the
      // numbers go up; a drop below them fails `npm run coverage`. Each glob is measured over all files it matches (src/physics/**
      // includes numerics and validation). Measured (lines/statements/functions/branches): numerics 99.0/99.0/98.4/95.8, validation
      // 99.6/99.6/100/92.6, physics 99.4/99.4/97.0/94.2, regression 99.1/99.1/100/92.3, plot 97.5/97.5/96.3/91.6, cli
      // 98.0/98.0/94.3/96.9, io 99.9/99.9/100/93.8, analysis 97.2/97.2/98.9/96.6, edu 99.8/99.8/96.3/92.9. The numbers are identical
      // in this checkout (a path with a space and a non-ASCII letter) and in a plain path (see TYPE_ONLY_MODULES). Re-measure after
      // every lane merge that adds code or tests to a globbed directory: `npm run coverage -- --maxWorkers=4` (25 to 40 min on a
      // shared machine; add --coverage.reportOnFailure=true to get the numbers of a run with a red test), then
      // `npm run coverage:levels` prints the measurement of every glob and the threshold that holds it.
      thresholds: {
        'src/physics/numerics/**': { lines: 98, statements: 98, functions: 98, branches: 95 },
        'src/physics/validation/**': { lines: 99, statements: 99, functions: 99, branches: 92 },
        'src/physics/**': { lines: 99, statements: 99, functions: 96, branches: 93 },
        'src/regression/**': { lines: 98, statements: 98, functions: 99, branches: 92 },
        'src/plot/**': { lines: 97, statements: 97, functions: 96, branches: 91 },
        // src/cli: args.ts, pool.ts and provenance.ts; the *.cli.ts entry points run in child processes and are excluded
        'src/cli/**': { lines: 97, statements: 97, functions: 94, branches: 96 },
        // the data-format writers and readers, the analysis layer (scans, sampling, Sobol, optimisation), the mission engine and glossary
        'src/io/**': { lines: 99, statements: 99, functions: 99, branches: 93 },
        'src/analysis/**': { lines: 96, statements: 96, functions: 98, branches: 96 },
        'src/edu/**': { lines: 99, statements: 99, functions: 96, branches: 92 },
      },
    },
  },
} as any);
