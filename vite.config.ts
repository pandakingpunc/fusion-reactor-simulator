import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
} as any);
