/// <reference types="node" />
/**
 * The public API surface: which names the barrel exports (a lock: changing the list is a deliberate act),
 * that every export carries a stability tag, and that everything the barrel reaches is environment-free
 * source (only src/physics files, no Node module, no browser global).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as api from './index';
import { PRESETS } from './presets';
import { Simulation } from './simulation';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The runtime exports of the library. Add a name here when you add it to index.ts. */
const EXPECTED = [
  'CONFIG_SCHEMA_ID', 'CONFINEMENT_SCALINGS', 'CONSTANTS', 'ConfigPathError', 'ConfigValidationError', 'DEFAULT_PROFILE_SETTINGS', 'DEMO', 'DEMO_15D', 'DIIID',
  'DIRECT_DRIVE', 'FINGERPRINT_SCHEMA', 'FLAT_TOP_START', 'FUEL_CHANNELS', 'GF_PISTON', 'IMPURITIES', 'ITER', 'ITER_15D', 'JET', 'JET_15D', 'JT60SA',
  'MAGNETIC_DIAGS', 'MASTU', 'METHODS', 'METHOD_FAMILY', 'METHOD_LABELS', 'MIRROR', 'MTF_LINER', 'MUON', 'ModelContractError', 'NIF', 'NonFiniteStateError',
  'PRESETS', 'PROFILE_DIAGS', 'ProfileModel', 'REFERENCE_CHECKS', 'SPARC', 'SPARC_15D', 'SYNC_INTERVALS', 'Simulation', 'SimulationError', 'TAE',
  'UnknownMethodError', 'W7X', 'ZAP', 'ZMACHINE', 'applyAssignments', 'aspectRatio', 'assertValidConfig', 'betaNormalized', 'burnAverages', 'canonicalString',
  'configJsonSchema', 'createModel', 'crossSection', 'defaultMagnetic', 'evaluateCheck', 'fieldInfo', 'flatTopAverages', 'flatTopMean', 'formatIssue', 'getPath',
  'getPreset', 'greenwaldDensity', 'leafPaths', 'mergeConfig', 'pLH_Martin', 'parseAssignment', 'parseSettingValue', 'plasmaSurface', 'plasmaVolume',
  'presetIds', 'presets', 'q95', 'readMetric', 'requirePreset', 'runDigest', 'runFingerprint', 'runShot', 'setPath', 'sha256Hex', 'sigmav', 'summarizeRun',
  'supportsProfiles', 'tauIPB98y2', 'tauISS04', 'tauITER89P', 'tauITPA20', 'tauITPA20IL', 'tauSTValovic', 'validateConfig',
];

describe('the public barrel', () => {
  it('exports exactly the locked list of runtime names', () => {
    expect(Object.keys(api).sort()).toEqual([...EXPECTED].sort());
  });
  it('every export statement is preceded by a doc comment tagged @public or @experimental', () => {
    const text = readFileSync(resolve(HERE, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
    // strip the file header (first doc block) and split into statements starting with "export"
    const lines = text.split('\n');
    const problems: string[] = [];
    let n = 0;
    lines.forEach((line, i) => {
      if (!/^export\b/.test(line)) return;
      n++;
      // walk back over blank lines to the end of a doc comment
      let j = i - 1;
      while (j >= 0 && lines[j].trim() === '') j--;
      if (j < 0 || !lines[j].trim().endsWith('*/')) { problems.push(`line ${i + 1}: no doc comment before: ${line.slice(0, 60)}`); return; }
      let k = j;
      while (k >= 0 && !lines[k].includes('/**')) k--;
      const doc = lines.slice(k, j + 1).join('\n');
      if (!/@(public|experimental)\b/.test(doc)) problems.push(`line ${i + 1}: doc comment without @public or @experimental before: ${line.slice(0, 60)}`);
    });
    expect(n).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });
  it('presets is the catalogue under the name of the task; both names are the same array', () => {
    expect(api.presets).toBe(api.PRESETS);
    expect(api.PRESETS).toBe(PRESETS);
    expect(api.presets.find((p) => p.id === 'ITER')?.cfg).toBe(api.ITER);
  });
  it('a program can configure, validate and run a shot through the barrel alone', () => {
    const cfg = { ...api.JET, t_end: 0.5 };
    expect(api.validateConfig(cfg).ok).toBe(true);
    const sim = new api.Simulation(cfg);
    const rep = sim.runAll();
    expect(rep.method).toBe('tokamak');
    expect(new Simulation(cfg).runAll().Q_sci_max).toBe(rep.Q_sci_max);
    expect(api.runFingerprint(cfg, cfg.seed, [], '4.0.0')).toBe(sim.fingerprint('4.0.0'));
    expect(api.runShot(cfg).report.Q_sci_max).toBe(rep.Q_sci_max);
    expect(api.sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('what the barrel reaches is environment-free', () => {
  /** relative import specifiers of a source file: `from '…'`, `import '…'`, `import('…')` */
  const specifiers = (source: string): string[] => {
    let text = source;
    const out: string[] = [];
    text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
    return out;
  };
  const resolveTs = (from: string, spec: string): string => {
    const base = resolve(dirname(from), spec);
    for (const cand of [`${base}.ts`, `${base}/index.ts`]) {
      try { readFileSync(cand); return cand; } catch { /* next */ }
    }
    throw new Error(`cannot resolve '${spec}' from ${from}`);
  };
  it('imports only src/physics files: no package, no node: module, nothing from ui, cli, plot, worker or io', () => {
    const seen = new Set<string>();
    const stack = [resolve(HERE, 'index.ts')];
    const bad: string[] = [];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const text = readFileSync(f, 'utf8');
      for (const s of specifiers(text)) {
        if (!s.startsWith('.')) { bad.push(`${f}: imports '${s}'`); continue; }
        const target = resolveTs(f, s);
        if (!target.startsWith(HERE)) bad.push(`${f}: reaches outside src/physics: '${s}'`);
        else stack.push(target);
      }
      if (/\/\/\/\s*<reference\s+types="node"/.test(text)) bad.push(`${f}: references the Node typings`);
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
      for (const g of ['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'process', 'Buffer', 'require', '__dirname']) {
        if (new RegExp(`(?<![.\\w$])${g}(?![\\w$])`).test(code)) bad.push(`${f}: uses ${g}`);
      }
    }
    expect(seen.size).toBeGreaterThan(60);
    expect(bad).toEqual([]);
  });
});
