import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'bench/**/*.test.ts'],
    // `npm run coverage` (vitest run --coverage). Code that runs only in child processes or worker
    // threads (the CLI entry points *.cli.ts, *.worker.ts) is not seen by V8 coverage of the test
    // process, so it is excluded: counted, it read as 0 % however well the end-to-end tests
    // (cli.test.ts) exercise it, and every line added to a CLI lowered the src/cli ratchet.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        'src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/testdata/**',
        'src/main.tsx', 'src/App.tsx', 'src/**/*.d.ts',
        'src/**/*.cli.ts', 'src/**/*.worker.ts',
      ],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      // Ratchet: the level measured when coverage was introduced (v4.0 development, 2026-09-28), rounded
      // down to whole percent. Raise these when the numbers go up; a drop below them fails
      // `npm run coverage`. Each glob is measured over all files it matches (src/physics/** includes
      // numerics).
      thresholds: {
        'src/physics/numerics/**': { lines: 96, statements: 96, functions: 88, branches: 85 },
        'src/physics/**': { lines: 89, statements: 89, functions: 78, branches: 80 },
        'src/plot/**': { lines: 41, statements: 41, functions: 58, branches: 66 },
        // src/cli: args.ts and pool.ts; pool's timing-dependent paths move branches by about ±0.5 % between runs
        'src/cli/**': { lines: 93, statements: 93, functions: 86, branches: 91 },
      },
    },
  },
} as any);
