#!/usr/bin/env node
// Builds the library: ESM and CommonJS bundles of the public API (src/physics/index.ts) and of the data-format
// writers (src/io/formats.ts), the compiled worker of the preset runner, the fusion-sim command line and the
// type declarations. No dependency beyond what the repository already has: Vite (Rollup + esbuild) and tsc.
//
//   node scripts/build-lib.mjs [--out DIR] [--no-types] [--quiet]
//
// Output (default dist/lib):
//   index.js  index.cjs  index.d.ts    the physics API (import { Simulation, presets } from '...')
//   io.js     io.cjs     io.d.ts       the browser-safe writers and readers (CSV, NDJSON, NetCDF-3, IMAS-like JSON)
//   presetRunner.worker.js / .cjs      the worker thread that runs one configuration (no tsx loader needed)
//   fusion-sim.js                      the command line (ESM, shebang)
//   chunks/                            code shared by index and io
//   types/                             declarations, with the file extensions Node's ESM resolver wants
//   .fusion-sim-lib                    marker: this directory is a build output and may be cleaned
// The core bundles (index, io and their chunks) must contain no reference to window, document or a node: module;
// the script checks that after the build and exits 1 if they do (the CLI and the worker use node: modules).
// package.json is not touched: the exports/bin/files patch is in the lane report (docs of the WS8 lane).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MARKER = '.fusion-sim-lib';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
for (const [i, a] of args.entries()) {
  if (!['--out', '--no-types', '--quiet'].includes(a) && !(i > 0 && args[i - 1] === '--out')) {
    process.stderr.write(`build-lib: unknown argument '${a}'\nusage: node scripts/build-lib.mjs [--out DIR] [--no-types] [--quiet]\n`);
    process.exit(2);
  }
}
if (flag('--out') && !value('--out')) { process.stderr.write('build-lib: --out needs a directory\n'); process.exit(2); }
const OUT = resolve(value('--out') ?? join(ROOT, 'dist', 'lib'));
const say = (s) => { if (!flag('--quiet')) console.log(s); };

/** Empties the output directory, but only one this script made (or an empty or new one). */
function prepare(dir) {
  if (existsSync(dir)) {
    const entries = readdirSync(dir);
    if (entries.length && !entries.includes(MARKER)) {
      throw new Error(`${dir} exists, is not empty and is not a build-lib output (no ${MARKER} file): refusing to clean it`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MARKER), 'Written by scripts/build-lib.mjs; the directory may be cleaned by the next build.\n');
}

const { build, createLogger } = await import('vite');
// Vite cannot resolve `new URL('../../', import.meta.url)` of src/cli/provenance.ts at build time and says so; it is
// resolved at run time on purpose (the package root next to the bundle), so that one message is dropped
const logger = createLogger('warn');
const warn = logger.warn.bind(logger);
const warnOnce = logger.warnOnce.bind(logger);
const known = (msg) => /doesn't exist at build time, it will remain unchanged/.test(msg);
logger.warn = (msg, opts) => { if (!known(msg)) warn(msg, opts); };
logger.warnOnce = (msg, opts) => { if (!known(msg)) warnOnce(msg, opts); };

/** One Vite library build of the given entries in one format. */
async function bundle(entries, format, { inline = false, external = [/^node:/] } = {}) {
  const ext = format === 'es' ? 'js' : 'cjs';
  await build({
    root: ROOT,
    configFile: false,
    logLevel: 'warn',
    customLogger: logger,
    publicDir: false,
    build: {
      outDir: OUT,
      emptyOutDir: false,
      target: 'es2022',
      minify: false,
      sourcemap: false,
      reportCompressedSize: false,
      lib: { entry: entries, formats: [format], fileName: (_f, name) => `${name}.${ext}` },
      rollupOptions: {
        external,
        output: { chunkFileNames: `chunks/[name]-[hash].${ext}`, ...(inline ? { inlineDynamicImports: true } : {}), ...(format === 'cjs' ? { exports: 'named' } : {}) },
      },
    },
  });
}

const t0 = Date.now();
prepare(OUT);
const core = { index: join(ROOT, 'src/physics/index.ts'), io: join(ROOT, 'src/io/formats.ts') };
for (const format of ['es', 'cjs']) {
  await bundle(core, format);
  await bundle({ 'presetRunner.worker': join(ROOT, 'src/cli/presetRunner.worker.ts') }, format, { inline: true });
}
await bundle({ 'fusion-sim': join(ROOT, 'src/cli/fusion-sim.ts') }, 'es', { inline: true });
say(`bundles written to ${relative(process.cwd(), OUT) || '.'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

// the command line needs its shebang and, on POSIX, the executable bit
const cliPath = join(OUT, 'fusion-sim.js');
let cli = readFileSync(cliPath, 'utf8');
if (!cli.startsWith('#!')) { cli = `#!/usr/bin/env node\n${cli}`; writeFileSync(cliPath, cli); }
try { chmodSync(cliPath, 0o755); } catch { /* not supported (Windows) */ }

// ── declarations ────────────────────────────────────────────────────────────────────────────────────
if (!flag('--no-types')) {
  const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  const typesDir = join(OUT, 'types');
  const r = spawnSync(process.execPath, [tsc, '-p', join(ROOT, 'tsconfig.lib.json'), '--outDir', typesDir], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    process.stderr.write(`build-lib: tsc -p tsconfig.lib.json failed (exit ${r.status})\n${r.stdout}${r.stderr}`);
    process.exit(1);
  }
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(join(d, e.name)) : /\.d\.ts$/.test(e.name) && files.push(join(d, e.name))); };
  walk(typesDir);
  // Node's ESM resolver wants extensions: './types' -> './types.js', './kernel' -> './kernel/index.js'
  const fix = (from, spec) => {
    if (!spec.startsWith('.') || /\.(js|cjs|mjs|json)$/.test(spec)) return spec;
    const base = resolve(dirname(from), spec);
    if (existsSync(`${base}.d.ts`)) return `${spec}.js`;
    if (existsSync(join(base, 'index.d.ts'))) return `${spec}/index.js`;
    return spec;
  };
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const out = text
      .replace(/(\bfrom\s*)(['"])(\.{1,2}(?:\/[^'"]*)?)\2/g, (_m, a, q, s) => `${a}${q}${fix(f, s)}${q}`)
      .replace(/(\bimport\s*\(\s*)(['"])(\.{1,2}(?:\/[^'"]*)?)\2/g, (_m, a, q, s) => `${a}${q}${fix(f, s)}${q}`);
    if (out !== text) writeFileSync(f, out);
  }
  writeFileSync(join(OUT, 'index.d.ts'), "export * from './types/physics/index.js';\n");
  writeFileSync(join(OUT, 'io.d.ts'), "export * from './types/io/formats.js';\n");
  say(`declarations: ${files.length} files`);
}

// ── the core must be free of window, document and node: ─────────────────────────────────────────────
const FORBIDDEN = [
  [/\b(?:window|document|navigator|localStorage|sessionStorage)\s*[.[]/, 'a browser global'],
  [/typeof\s+(?:window|document)\b/, 'a browser-global probe'],
  [/\bfrom\s*['"]node:/, 'a node: import'],
  [/\brequire\s*\(\s*['"](?:node:|fs['"]|path['"]|os['"]|child_process['"]|worker_threads['"]|crypto['"]|url['"]|util['"])/, 'a Node require'],
  [/\bprocess\s*\.\s*(?:env|argv|exit|stdout|stderr|versions|platform|cwd)\b/, 'process'],
  [/\bBuffer\s*[.(]/, 'Buffer'],
  [/\b__dirname\b|\b__filename\b/, 'a CommonJS path global'],
  [/\bimport\.meta\b/, 'import.meta'],
];
const coreFiles = [];
for (const f of readdirSync(OUT)) if (/^(index|io)\.c?js$/.test(f)) coreFiles.push(join(OUT, f));
if (existsSync(join(OUT, 'chunks'))) for (const f of readdirSync(join(OUT, 'chunks'))) coreFiles.push(join(OUT, 'chunks', f));
const bad = [];
for (const f of coreFiles) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
    for (const [re, what] of FORBIDDEN) if (re.test(code)) bad.push(`${relative(OUT, f)}:${i + 1}: ${what}: ${line.trim().slice(0, 100)}`);
  });
}
if (bad.length) {
  process.stderr.write(`build-lib: the core bundles must not reference the DOM or Node:\n  ${bad.join('\n  ')}\n`);
  process.exit(1);
}

const kb = (f) => `${(statSync(f).size / 1024).toFixed(1)} kB`;
for (const f of ['index.js', 'index.cjs', 'io.js', 'io.cjs', 'presetRunner.worker.js', 'presetRunner.worker.cjs', 'fusion-sim.js']) say(`  ${f.padEnd(26)} ${kb(join(OUT, f))}`);
say(`core bundles (${coreFiles.length} files): no window, document, node: or process`);
