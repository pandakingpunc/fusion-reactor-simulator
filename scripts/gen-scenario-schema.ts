/// <reference types="node" />
/**
 * Writes schema/scenario.schema.json, the JSON Schema (draft 2020-12) of a scenario, from
 * the schema in src/cli/scenarioSchema.ts.
 *
 *   npx tsx scripts/gen-scenario-schema.ts            write schema/scenario.schema.json
 *   npx tsx scripts/gen-scenario-schema.ts --check    exit 1 if the file on disk differs from what the emitter writes
 *   npx tsx scripts/gen-scenario-schema.ts --out FILE write to FILE instead
 *
 * The file is LF-terminated JSON with two-space indentation. A checkout with core.autocrlf may turn it
 * into CRLF; --check and the test in src/cli/scenarioSchema.test.ts compare with line endings normalised.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarioJsonSchema } from '../src/cli/scenarioSchema';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const check = args.includes('--check');
const outIdx = args.indexOf('--out');
const out = resolve(outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : `${root}schema/scenario.schema.json`);
const unknown = args.filter((a, i) => a !== '--check' && a !== '--out' && !(outIdx >= 0 && i === outIdx + 1));
if (unknown.length || (outIdx >= 0 && !args[outIdx + 1])) {
  process.stderr.write('usage: gen-scenario-schema.ts [--check] [--out FILE]\n');
  process.exit(2);
}

const text = JSON.stringify(scenarioJsonSchema(), null, 2) + '\n';
if (check) {
  const disk = existsSync(out) ? readFileSync(out, 'utf8').replace(/\r\n/g, '\n') : null;
  if (disk === text) { console.log(`${out}: up to date`); process.exit(0); }
  process.stderr.write(`${out}: ${disk === null ? 'missing' : 'out of date'}; run: npx tsx scripts/gen-scenario-schema.ts\n`);
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);
console.log(`wrote ${out} (${text.length} bytes)`);
