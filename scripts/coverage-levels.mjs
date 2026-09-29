#!/usr/bin/env node
// Measured coverage per gated glob, and the ratchet that follows from it.
//
//   node scripts/coverage-levels.mjs [--summary coverage/coverage-summary.json] [--config vite.config.ts] [--margin 0.25]
//
// Reads the json-summary that `npm run coverage` writes, aggregates it over the files of every glob that the thresholds of
// vite.config.ts name (covered / total counts summed over the files, which is how vitest measures a glob), prints lines,
// statements, functions and branches, and the thresholds that hold the measured level: the measurement less the margin
// (default 0.25 points, for the run-to-run noise of timing-dependent paths), rounded down to a whole percent. With --check
// it exits 1 when a threshold of the config is above the measurement (the gate itself does that too: this names the glob).
// Exit codes: 0 ok; 1 a threshold above the measurement (--check); 2 usage error or no summary.
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const KEYS = ['lines', 'statements', 'functions', 'branches'];

/** The globs of the `thresholds` block of a vitest config text, with the numbers of each: { glob: { lines, ... } }. */
export function thresholdsOf(configText) {
  const out = {};
  const block = /thresholds:\s*\{([\s\S]*?)\n\s{6}\},?\s*\n/.exec(configText);
  if (!block) return out;
  const re = /'([^']+\*\*)':\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(block[1]))) {
    const t = {};
    for (const k of KEYS) { const v = new RegExp(`${k}:\\s*([0-9.]+)`).exec(m[2]); if (v) t[k] = Number(v[1]); }
    out[m[1]] = t;
  }
  return out;
}

/** Whether a repository-relative path (forward slashes) is inside the directory glob `dir/**`. */
const inGlob = (rel, glob) => rel.startsWith(glob.replace(/\*\*$/, ''));

/** Covered / total sums of every key over the files of a glob: { lines: { covered, total, pct }, ... } */
export function aggregate(summary, glob, base = root) {
  const acc = Object.fromEntries(KEYS.map((k) => [k, { covered: 0, total: 0 }]));
  let files = 0;
  for (const [file, s] of Object.entries(summary)) {
    if (file === 'total') continue;
    const rel = relative(base, file).split('\\').join('/');
    if (!inGlob(rel, glob)) continue;
    files++;
    for (const k of KEYS) { acc[k].covered += s[k].covered; acc[k].total += s[k].total; }
  }
  const out = { files };
  for (const k of KEYS) out[k] = { ...acc[k], pct: acc[k].total === 0 ? 100 : (100 * acc[k].covered) / acc[k].total };
  return out;
}

/** The threshold that holds a measured percentage: less the margin, rounded down to a whole percent (never above 100). */
export const ratchet = (pct, margin) => Math.min(100, Math.floor(pct - margin + 1e-9));

function main() {
  const argv = process.argv.slice(2);
  const opt = { summary: 'coverage/coverage-summary.json', config: 'vite.config.ts', margin: 0.25, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opt.check = true;
    else if (a === '--summary' || a === '--config' || a === '--margin') {
      const v = argv[++i];
      if (v === undefined) { console.error(`${a} needs a value`); process.exit(2); }
      opt[a.slice(2)] = a === '--margin' ? Number(v) : v;
    } else { console.error(`unknown argument ${a}`); process.exit(2); }
  }
  if (!Number.isFinite(opt.margin) || opt.margin < 0) { console.error('--margin needs a number >= 0'); process.exit(2); }
  const summaryPath = resolve(root, opt.summary), configPath = resolve(root, opt.config);
  if (!existsSync(summaryPath)) { console.error(`no ${relative(process.cwd(), summaryPath)}: run "npm run coverage" first`); process.exit(2); }
  if (!existsSync(configPath)) { console.error(`no ${relative(process.cwd(), configPath)}`); process.exit(2); }
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const gated = thresholdsOf(readFileSync(configPath, 'utf8'));
  const globs = Object.keys(gated);
  if (globs.length === 0) { console.error(`no thresholds found in ${opt.config}`); process.exit(2); }
  let below = 0;
  console.log('glob'.padEnd(28) + 'files  measured lines/statements/functions/branches      config           suggested');
  for (const g of globs) {
    const a = aggregate(summary, g);
    const meas = KEYS.map((k) => a[k].pct.toFixed(1)).join(' / ');
    const cfg = KEYS.map((k) => gated[g][k] ?? '-').join('/');
    const sug = KEYS.map((k) => ratchet(a[k].pct, opt.margin)).join('/');
    const flag = KEYS.some((k) => gated[g][k] !== undefined && a[k].pct < gated[g][k]);
    if (flag) below++;
    console.log(`${g.padEnd(28)}${String(a.files).padStart(5)}  ${meas.padEnd(46)}${cfg.padEnd(17)}${sug}${flag ? '  <- below the config' : ''}`);
  }
  if (opt.check && below) { console.error(`\n✗ ${below} glob(s) measure below their threshold`); process.exit(1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
