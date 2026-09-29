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
    // 30 s per test instead of the 5 s default: about ten agents share 12 cores, and a CLI test that starts a child process
    // or a UI test that first imports a lazy chunk (run screen, compare, validation) took longer than 5 s under that load
    // while passing alone (Wave-2A report section 9, Wave-2B ws10r). A test that really hangs still fails, only later.
    testTimeout: 30_000,
    // the same for the hooks (default 10 s): a beforeAll that runs a whole 0D shot (src/physics/edge/integration.test.ts) timed out once
    hookTimeout: 30_000,
    // waits a few real milliseconds before each test (and turns the event loop after it) so that no worker-to-main
    // RPC call is pending while a long synchronous test runs: a call unanswered for 60 s is 'Timeout calling
    // "onTaskUpdate"', an unhandled error that fails `npm run coverage` with every test green. Root cause and
    // reproduction in the header of the setup file.
    setupFiles: ['src/vitest.setup.ts'],
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
      // Ratchet: the levels measured on 2026-09-29 (v4/integration with ws5 ... ws5b and ws1c merged: 86 files,
      // 854 tests), rounded down after 0.25 points of margin so that the run-to-run noise of timing-dependent
      // paths (the pool's) cannot fail the gate. Raise these when the numbers go up; a drop below them fails
      // `npm run coverage`. Each glob is measured over all files it matches (src/physics/** includes numerics
      // and validation). Measured: numerics 98.0/98.0/90.7/92.1, physics 98.7/98.7/94.4/92.5, validation
      // 99.6/99.6/100/92.6, regression 99.1/99.1/100/92.1, plot 71.1/71.1/73.2/85.3, cli 95.8/95.8/90.2/94.1
      // (lines/statements/functions/branches), identical to the last digit in this checkout (a path with a space
      // and a non-ASCII letter) and in a plain path (see TYPE_ONLY_MODULES). Re-measure after every lane merge
      // that adds code or tests to a globbed directory (`npm run coverage -- --maxWorkers=4`, 4-5 min).
      thresholds: {
        'src/physics/numerics/**': { lines: 97, statements: 97, functions: 90, branches: 91 },
        'src/physics/validation/**': { lines: 99, statements: 99, functions: 99, branches: 92 },
        'src/physics/**': { lines: 98, statements: 98, functions: 94, branches: 92 },
        'src/regression/**': { lines: 98, statements: 98, functions: 99, branches: 91 },
        'src/plot/**': { lines: 70, statements: 70, functions: 72, branches: 85 },
        // src/cli: args.ts, pool.ts and provenance.ts; the *.cli.ts entry points run in child processes and are excluded
        'src/cli/**': { lines: 95, statements: 95, functions: 89, branches: 93 },
      },
    },
  },
} as any);
