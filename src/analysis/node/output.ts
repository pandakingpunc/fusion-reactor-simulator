/// <reference types="node" />
/**
 * Output plumbing of the UQ command-line tools: files or stdout, a throttled progress line on stderr.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { EnsembleProgress } from '../ensemble';

/** Writes text to a file (creating its folder) or, for '-', to stdout. */
export function writeOutput(target: string, text: string): void {
  if (target === '-') {
    process.stdout.write(text);
    return;
  }
  const file = resolve(target);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

/** A progress callback that prints "label: done/total runs (failed)" to stderr at most once per `everyMs` and at the end. */
export function progressPrinter(label: string, everyMs = 1000): (p: EnsembleProgress) => void {
  const t0 = performance.now();
  let last = -Infinity;
  return (p) => {
    const now = performance.now();
    if (p.done < p.total && now - last < everyMs) return;
    last = now;
    const failed = p.failed ? ` (${p.failed} failed)` : '';
    process.stderr.write(`${label}: ${p.done}/${p.total} runs${failed}, ${((now - t0) / 1000).toFixed(1)} s\n`);
  };
}
