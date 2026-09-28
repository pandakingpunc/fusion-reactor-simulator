#!/usr/bin/env node
// Release consistency check: npm run release:check [-- --root DIR] [--no-allow-unreleased]
//
// Verifies what must agree before a version is tagged (docs/RELEASING.md):
//   version         package.json, CITATION.cff (version), .zenodo.json (version) and the top released
//                   CHANGELOG section "## [x.y.z]" name the same version
//   unreleased      an "## [Unreleased]" section above it is allowed with --allow-unreleased (the
//                   default for now); --no-allow-unreleased makes it an error
//   date-released   CITATION.cff date-released is an ISO 8601 calendar date (YYYY-MM-DD) and matches
//                   the date of that CHANGELOG section when it has one
//   citation-doi    the concept DOI is CITATION.cff's doi or appears in its identifiers
//   no-todo         no "TODO" left in CITATION.cff or .zenodo.json
//   readme-presets  every "<N> presets" in README.md equals the number of presets in
//                   src/physics/presets.ts (imported through tsx)
//   engines-node    package.json declares engines.node
//   license         a LICENSE file exists
// Prints one line per check; exit 0 when all pass, 1 when any fails, 2 on a usage error.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Zenodo concept DOI: resolves to the latest version of the archived software */
export const CONCEPT_DOI = '10.5281/zenodo.22259861';

const USAGE = `usage: npm run release:check -- [--root DIR] [--allow-unreleased | --no-allow-unreleased]
  --root DIR               repository to check (default: the current directory)
  --allow-unreleased       accept an [Unreleased] CHANGELOG section above the released one (default)
  --no-allow-unreleased    fail if there is one (use when cutting the release)`;

function parseArgs(argv) {
  const opts = { root: process.cwd(), allowUnreleased: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    else if (a === '--allow-unreleased') opts.allowUnreleased = true;
    else if (a === '--no-allow-unreleased') opts.allowUnreleased = false;
    else if (a === '--root' || a.startsWith('--root=')) {
      const v = a.includes('=') ? a.slice(7) : argv[++i];
      if (!v) usage('--root needs a directory');
      opts.root = resolve(v);
    } else usage(`unknown argument '${a}'`);
  }
  return opts;
}

function usage(msg) {
  console.error(`release-check: ${msg}\n${USAGE}`);
  process.exit(2);
}

const read = (root, f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : undefined);
const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');

/** Top-level scalar of a CITATION.cff (YAML subset): `key: value`, quotes and trailing comments removed. */
export function cffScalar(text, key) {
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(text);
  if (!m) return undefined;
  return unquote(m[1].replace(/\s+#.*$/, ''));
}

/** `value:` entries of the top-level `identifiers:` list of a CITATION.cff. */
export function cffIdentifiers(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^identifiers:\s*$/.test(l));
  if (start < 0) return [];
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\S/.test(l)) break; // next top-level key
    const m = /^\s*(?:-\s*)?value:\s*(.+)$/.exec(l);
    if (m) out.push(unquote(m[1].replace(/\s+#.*$/, '')));
  }
  return out;
}

/** "## [name] — date" headings of a Keep-a-Changelog file, in order. */
export function changelogSections(text) {
  const out = [];
  for (const m of text.matchAll(/^##\s+\[([^\]]+)\](?:[^\S\r\n]*[—–-][^\S\r\n]*(\d{4}-\d{2}-\d{2}))?/gm)) out.push({ name: m[1], date: m[2] });
  return out;
}

export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Every "<N> presets" (also "<N> machine presets") in a README. */
export function readmePresetCounts(text) {
  return [...text.matchAll(/\b(\d+)\s+(?:[A-Za-z-]+\s+)?presets\b/g)].map((m) => Number(m[1]));
}

async function countPresets(root) {
  const file = join(root, 'src', 'physics', 'presets.ts');
  if (!existsSync(file)) throw new Error(`${relative(root, file)} not found`);
  const { tsImport } = await import('tsx/esm/api');
  const mod = await tsImport(pathToFileURL(file).href, import.meta.url);
  if (!Array.isArray(mod.PRESETS)) throw new Error('src/physics/presets.ts does not export a PRESETS array');
  return mod.PRESETS.length;
}

/** Runs every check; returns [{ name, ok, detail }]. */
export async function releaseChecks({ root, allowUnreleased = true }) {
  const results = [];
  const add = (name, ok, detail) => results.push({ name, ok, detail });
  const pkgText = read(root, 'package.json');
  const cff = read(root, 'CITATION.cff');
  const zenText = read(root, '.zenodo.json');
  const changelog = read(root, 'CHANGELOG.md');
  const readme = read(root, 'README.md');

  let pkg, zen;
  const parseErrors = [];
  try { pkg = pkgText === undefined ? undefined : JSON.parse(pkgText); } catch (e) { parseErrors.push(`package.json: ${e.message}`); }
  try { zen = zenText === undefined ? undefined : JSON.parse(zenText); } catch (e) { parseErrors.push(`.zenodo.json: ${e.message}`); }

  // version
  const sections = changelog === undefined ? [] : changelogSections(changelog);
  const released = sections.find((s) => s.name.toLowerCase() !== 'unreleased');
  const versions = {
    'package.json': pkg?.version,
    'CITATION.cff': cff === undefined ? undefined : cffScalar(cff, 'version'),
    '.zenodo.json': zen?.version,
    'CHANGELOG.md': released?.name,
  };
  const missing = Object.entries(versions).filter(([, v]) => !v).map(([f]) => f);
  const distinct = [...new Set(Object.values(versions).filter(Boolean))];
  if (parseErrors.length) add('version', false, `cannot parse ${parseErrors.join('; ')}`);
  else if (missing.length) add('version', false, `no version found in ${missing.join(', ')} (${Object.entries(versions).map(([f, v]) => `${f}: ${v ?? '—'}`).join(', ')})`);
  else if (distinct.length !== 1) add('version', false, `versions differ: ${Object.entries(versions).map(([f, v]) => `${f} ${v}`).join(', ')}`);
  else add('version', true, `${distinct[0]} in package.json, CITATION.cff, .zenodo.json and CHANGELOG [${released.name}]`);

  // unreleased section above the released one
  const unrelIdx = sections.findIndex((s) => s.name.toLowerCase() === 'unreleased');
  const relIdx = released ? sections.indexOf(released) : -1;
  if (changelog === undefined) add('unreleased', false, 'CHANGELOG.md not found');
  else if (unrelIdx < 0) add('unreleased', true, 'no [Unreleased] section');
  else if (relIdx >= 0 && unrelIdx > relIdx) add('unreleased', false, `[Unreleased] must be above [${released.name}]`);
  else if (allowUnreleased) add('unreleased', true, `[Unreleased] section above [${released?.name ?? '—'}] (allowed: --allow-unreleased, the default for now)`);
  else add('unreleased', false, `[Unreleased] section above [${released?.name ?? '—'}]: rename it to the new version before tagging (--no-allow-unreleased)`);

  // date-released
  const date = cff === undefined ? undefined : cffScalar(cff, 'date-released');
  if (date === undefined) add('date-released', false, 'CITATION.cff has no date-released');
  else if (!isIsoDate(date)) add('date-released', false, `'${date}' is not an ISO 8601 date (YYYY-MM-DD)`);
  else if (released?.date && released.date !== date) add('date-released', false, `${date} differs from the CHANGELOG date of [${released.name}] (${released.date})`);
  else add('date-released', true, `${date} (ISO 8601${released?.date ? `, same as CHANGELOG [${released.name}]` : ''})`);

  // concept DOI
  if (cff === undefined) add('citation-doi', false, 'CITATION.cff not found');
  else {
    const doi = cffScalar(cff, 'doi');
    const ids = cffIdentifiers(cff);
    if (doi === CONCEPT_DOI) add('citation-doi', true, `doi is the concept DOI ${CONCEPT_DOI}`);
    else if (ids.includes(CONCEPT_DOI)) add('citation-doi', true, `concept DOI ${CONCEPT_DOI} listed in identifiers (doi: ${doi ?? '—'})`);
    else add('citation-doi', false, `concept DOI ${CONCEPT_DOI} is neither the doi (${doi ?? '—'}) nor in identifiers (${ids.join(', ') || 'none'})`);
  }

  // no TODO
  const todos = [];
  for (const [f, t] of [['CITATION.cff', cff], ['.zenodo.json', zenText]]) {
    if (t === undefined) continue;
    t.split(/\r?\n/).forEach((l, i) => { if (/\bTODO\b/.test(l)) todos.push(`${f}:${i + 1}: ${l.trim()}`); });
  }
  add('no-todo', todos.length === 0, todos.length ? todos.join(' | ') : 'none in CITATION.cff and .zenodo.json');

  // README preset count
  try {
    const n = await countPresets(root);
    const counts = readme === undefined ? [] : readmePresetCounts(readme);
    if (readme === undefined) add('readme-presets', false, 'README.md not found');
    else if (!counts.length) add('readme-presets', false, `README.md never states "<N> presets" (src/physics/presets.ts has ${n})`);
    else if (counts.some((c) => c !== n)) add('readme-presets', false, `README.md says ${counts.join(', ')} presets; src/physics/presets.ts has ${n}`);
    else add('readme-presets', true, `README.md says ${n} presets; src/physics/presets.ts has ${n}`);
  } catch (e) {
    add('readme-presets', false, `cannot count presets: ${e.message.split('\n')[0]}`);
  }

  // engines.node
  const engines = pkg?.engines?.node;
  add('engines-node', typeof engines === 'string' && engines.trim() !== '', engines ? `package.json engines.node "${engines}"` : 'package.json has no engines.node');

  // license
  const lic = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].find((f) => existsSync(join(root, f)));
  add('license', lic !== undefined, lic ?? 'no LICENSE file');
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`Release check: ${relative(process.cwd(), opts.root) || '.'}`);
  const results = await releaseChecks(opts);
  const w = Math.max(...results.map((r) => r.name.length));
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(w)}  ${r.detail}`);
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length
    ? `\n✗ release check: ${failed.length} of ${results.length} checks failed (${failed.map((r) => r.name).join(', ')})`
    : `\n✓ release check: all ${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
