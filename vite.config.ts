import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
      ],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      // Ratchet: the levels measured on 2026-09-29 (v4/ws1c on top of v4/integration fca4643: 83 files, 812
      // tests, all files 88.7 % lines), rounded down after 0.25 points of margin so that the run-to-run noise
      // of timing-dependent paths (the pool's) cannot fail the gate. Raise these when the numbers go up; a drop
      // below them fails `npm run coverage`. Each glob is measured over all files it matches (src/physics/**
      // includes numerics and validation). Measured: numerics 98.0/98.0/90.7/92.1, physics 96.9/96.9/93.8/92.3,
      // validation 99.6/99.6/100/92.6, regression 99.1/99.1/100/92.1, plot 71.1/71.1/73.2/85.3, cli
      // 95.8/95.8/90.2/94.1 (lines/statements/functions/branches).
      thresholds: {
        'src/physics/numerics/**': { lines: 97, statements: 97, functions: 90, branches: 91 },
        'src/physics/validation/**': { lines: 99, statements: 99, functions: 99, branches: 92 },
        'src/physics/**': { lines: 96, statements: 96, functions: 93, branches: 92 },
        'src/regression/**': { lines: 98, statements: 98, functions: 99, branches: 91 },
        'src/plot/**': { lines: 70, statements: 70, functions: 72, branches: 85 },
        // src/cli: args.ts, pool.ts and provenance.ts; the *.cli.ts entry points run in child processes and are excluded
        'src/cli/**': { lines: 95, statements: 95, functions: 89, branches: 93 },
      },
    },
  },
} as any);
