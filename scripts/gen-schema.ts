/// <reference types="node" />
/**
 * Writes schema/fusion-sim.schema.json, the JSON Schema (draft 2020-12) of a reactor configuration, from
 * the schema in src/physics/config/schema.ts.
 *
 *   npx tsx scripts/gen-schema.ts            write schema/fusion-sim.schema.json
 *   npx tsx scripts/gen-schema.ts --check    exit 1 if the file on disk differs from what the emitter writes
 *   npx tsx scripts/gen-schema.ts --out FILE write to FILE instead
 *
 * The file is LF-terminated JSON with two-space indentation. A checkout with core.autocrlf may turn it
 * into CRLF; --check and the test in src/physics/config/schema.test.ts compare with line endings normalised.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configJsonSchema } from '../src/physics/config/schema';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const check = args.includes('--check');
const outIdx = args.indexOf('--out');
const out = resolve(outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : `${root}schema/fusion-sim.schema.json`);
const unknown = args.filter((a, i) => a !== '--check' && a !== '--out' && !(outIdx >= 0 && i === outIdx + 1));
if (unknown.length || (outIdx >= 0 && !args[outIdx + 1])) {
  process.stderr.write('usage: gen-schema.ts [--check] [--out FILE]\n');
  process.exit(2);
}

const text = JSON.stringify(configJsonSchema(), null, 2) + '\n';
if (check) {
  const disk = existsSync(out) ? readFileSync(out, 'utf8').replace(/\r\n/g, '\n') : null;
  if (disk === text) { console.log(`${out}: up to date`); process.exit(0); }
  process.stderr.write(`${out}: ${disk === null ? 'missing' : 'out of date'}; run: npx tsx scripts/gen-schema.ts\n`);
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);
console.log(`wrote ${out} (${text.length} bytes)`);
