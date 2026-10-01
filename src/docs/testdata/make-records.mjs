#!/usr/bin/env node
// Writes the two records that src/docs/readme.test.ts reads, from the full outputs of the commands that produce them.
//
//   npm run -s validate -- --json --threads 2 > scratch/v.json            (about 4 minutes)
//   node src/docs/testdata/make-records.mjs validate scratch/v.json
//
//   npm run bench:convergence -- --threads 2 --out scratch/c.json          (about 10 minutes)
//   node src/docs/testdata/make-records.mjs convergence scratch/c.json
//
// Both keep only what the README prints: the full outputs also carry source strings (those live in
// src/physics/validation/references.ts), wall times and CPU names (those change from run to run). The records are NOT a
// second source of truth for the physics: readme.test.ts ties every number in them that the golden suite also holds back to
// test/golden/*.json, so a record that no longer matches the physics fails that test and has to be made again here.
// Optional: --tree SHA names the commit the output was measured on (default: git rev-parse --short HEAD).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [kind, file, ...rest] = process.argv.slice(2);
if (!['validate', 'convergence'].includes(kind) || !file) {
  console.error('usage: node make-records.mjs validate|convergence FILE [--tree SHA]');
  process.exit(2);
}
const ti = rest.indexOf('--tree');
const tree = ti >= 0 ? rest[ti + 1] : execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const src = JSON.parse(readFileSync(file, 'utf8'));
const date = new Date().toISOString().slice(0, 10);

let out;
if (kind === 'validate') {
  if (src.schema !== 3) throw new Error(`validate --json schema ${src.schema}, expected 3`);
  out = {
    record: 'npm run -s validate -- --json (schema 3), trimmed to what README.md and README.tr.md print; made by src/docs/testdata/make-records.mjs',
    tree, date, node: process.version,
    checksExecuted: src.checksExecuted, failures: src.failures, knownFailures: src.knownFailures,
    unexpectedPasses: src.unexpectedPasses, wordings: src.wordings, passed: src.passed,
    checks: src.checks.map((c) => ({
      id: c.id, value: c.value, status: c.status, wording: c.wording, ratio: c.ratio, deviationPct: c.deviationPct,
    })),
  };
} else {
  if (src.schema !== 1) throw new Error(`bench:convergence record schema ${src.schema}, expected 1`);
  out = {
    record: 'npm run bench:convergence (schema 1), trimmed to what README.md and README.tr.md print; made by src/docs/testdata/make-records.mjs',
    tree, date, node: src.node,
    preset: src.preset, t_end_s: src.t_end_s, baseGrid: src.baseGrid, baseRtol: src.baseRtol, gridPacking: src.gridPacking,
    series: src.series.map((s) => ({
      parameter: s.parameter, values: s.values,
      runs: s.runs.map((r) => ({
        value: r.value, steps: r.steps, nElm: r.nElm,
        ...(r.cellsAcrossPedestal !== undefined ? { cellsAcrossPedestal: r.cellsAcrossPedestal } : {}),
        metrics: r.metrics,
      })),
    })),
  };
}
const dest = join(here, `${kind}-record.json`);
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${dest} (tree ${tree})`);
