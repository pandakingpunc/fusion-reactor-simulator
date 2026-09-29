/// <reference types="node" />
/**
 * package.json scripts that run a TypeScript entry point ("tsx src/cli/x.cli.ts") point at a file that exists,
 * and the UQ / scan / optimisation CLIs are reachable as npm scripts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')) as { scripts: Record<string, string> };

describe('package.json scripts', () => {
  it('every "tsx <file>" script names an existing file', () => {
    const entries = Object.entries(pkg.scripts).filter(([, cmd]) => /^tsx\s+\S+/.test(cmd));
    expect(entries.length).toBeGreaterThan(5);
    for (const [name, cmd] of entries) {
      const file = cmd.split(/\s+/)[1];
      expect(existsSync(`${ROOT}${file}`), `script "${name}" -> ${file}`).toBe(true);
    }
  });

  it('uq, scan and optimize run their CLI modules', () => {
    expect(pkg.scripts.uq).toBe('tsx src/cli/uq.cli.ts');
    expect(pkg.scripts.scan).toBe('tsx src/cli/scan.cli.ts');
    expect(pkg.scripts.optimize).toBe('tsx src/cli/optimize.cli.ts');
  });
});
