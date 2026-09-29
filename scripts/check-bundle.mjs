#!/usr/bin/env node
// Bundle budget check: node scripts/check-bundle.mjs [--dist dist] [--max-kb 250] [--max-gzip-kb 85]
//
// Reads the built page (dist/index.html), finds the entry script it loads (the main chunk) and fails when the chunk is
// larger than the budget. Sizes are in kB = 1000 bytes, like the `vite build` report; the gzip size is what the browser
// downloads. The budget exists because the main chunk is what a first visit waits for: a screen that is not on the first
// paint (run, report, compare, learn, 3D) is a chunk of its own, loaded after start-up, and a lane that adds UI to the setup
// screen re-measures against this number.
//
// Build first (`npm run -s build`); the budget is a ratchet (lower it when the chunk gets smaller).
// Exit codes: 0 within budget; 1 over budget; 2 usage error or no build to check.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

/** budget of the main chunk in kB: v3.0 262.5, the v4.0 lazy run screen brought it to about 214 */
export const DEFAULT_MAX_KB = 250;
/** budget of its gzip size in kB (measured 70.9 at 214 kB) */
export const DEFAULT_MAX_GZIP_KB = 85;

/** The entry script of a Vite-built index.html: `<script type="module" ... src="./assets/index-<hash>.js">`. */
export function entryScript(html) {
  const tags = html.match(/<script\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (src) return src[1].replace(/^\.\//, '').replace(/^\//, '');
  }
  return null;
}

/** Size of the main chunk of the build in `dist`: bytes, gzip bytes, and the file. Throws an Error with a message when there is no build. */
export function measureMain(dist) {
  const index = join(dist, 'index.html');
  if (!existsSync(index)) throw new Error(`no ${index}: run "npm run build" first`);
  const src = entryScript(readFileSync(index, 'utf8'));
  if (!src) throw new Error(`${index} has no module script: is it a Vite build?`);
  const file = join(dist, src);
  if (!existsSync(file)) throw new Error(`the entry script ${file} named by ${index} does not exist`);
  const buf = readFileSync(file);
  return { file: src, bytes: buf.length, gzipBytes: gzipSync(buf).length };
}

/** The chunks of `dist/assets` by size, largest first (for the report of an over-budget build). */
export function largestChunks(dist, n = 8) {
  const dir = join(dist, 'assets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => ({ file: f, bytes: statSync(join(dir, f)).size }))
    .sort((a, b) => b.bytes - a.bytes).slice(0, n);
}

const kb = (b) => (b / 1000).toFixed(2);

function main(argv) {
  let dist = fileURLToPath(new URL('../dist', import.meta.url));
  let maxKb = DEFAULT_MAX_KB, maxGzipKb = DEFAULT_MAX_GZIP_KB;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = () => { if (i + 1 >= argv.length) { console.error(`check-bundle: ${a} needs a value`); process.exit(2); } return argv[++i]; };
    if (a === '--help' || a === '-h') {
      console.log('usage: node scripts/check-bundle.mjs [--dist <dir>] [--max-kb <n>] [--max-gzip-kb <n>]\n  fails (exit 1) when the main chunk of the build in <dir> (default dist) is over the budget (default '
        + `${DEFAULT_MAX_KB} kB, ${DEFAULT_MAX_GZIP_KB} kB gzip)`);
      process.exit(0);
    } else if (a === '--dist') dist = resolve(need());
    else if (a === '--max-kb') maxKb = Number(need());
    else if (a === '--max-gzip-kb') maxGzipKb = Number(need());
    else { console.error(`check-bundle: unknown argument '${a}'`); process.exit(2); }
  }
  if (!Number.isFinite(maxKb) || maxKb <= 0 || !Number.isFinite(maxGzipKb) || maxGzipKb <= 0) { console.error('check-bundle: a budget must be a positive number of kB'); process.exit(2); }
  let m;
  try { m = measureMain(dist); } catch (e) { console.error(`check-bundle: ${e.message}`); process.exit(2); }
  const over = m.bytes > maxKb * 1000, overGz = m.gzipBytes > maxGzipKb * 1000;
  console.log(`main chunk ${m.file}: ${kb(m.bytes)} kB (budget ${maxKb}), gzip ${kb(m.gzipBytes)} kB (budget ${maxGzipKb})`);
  if (over || overGz) {
    console.error(`check-bundle: the main chunk is over its budget${over ? ` by ${kb(m.bytes - maxKb * 1000)} kB` : ''}${overGz ? ` (gzip by ${kb(m.gzipBytes - maxGzipKb * 1000)} kB)` : ''}. Lazy-load what the setup screen does not need; the largest chunks:`);
    for (const c of largestChunks(dist)) console.error(`  ${kb(c.bytes).padStart(9)} kB  ${c.file}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
