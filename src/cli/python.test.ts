/// <reference types="node" />
/**
 * Runs the unittest suite of the Python wrapper (python/tests) against the sources: FUSION_SIM_CLI points at
 * `node --import tsx src/cli/fusion-sim.ts`. Skipped when no Python interpreter is on the PATH.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function findPython(): string | undefined {
  for (const cmd of ['python', 'python3', 'py']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0 && /^Python 3\.(9|\d\d)/.test(r.stdout || r.stderr)) return cmd;
  }
  return undefined;
}
const PYTHON = findPython();

describe.skipIf(!PYTHON)('python wrapper (fusion_sim)', { timeout: 240_000 }, () => {
  it('its unittest suite passes against the sources', () => {
    const cli = `node --import tsx "${ROOT}src/cli/fusion-sim.ts"`;
    const r = spawnSync(PYTHON!, ['-m', 'unittest', 'discover', '-s', 'python/tests', '-v'], {
      cwd: ROOT, encoding: 'utf8', timeout: 220_000, env: { ...process.env, FUSION_SIM_CLI: cli, PYTHONDONTWRITEBYTECODE: '1' },
    });
    if (r.error) throw r.error;
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/Ran \d+ tests? in/);
    expect(out).not.toMatch(/skipped/);
    expect(out).toMatch(/\nOK\s*$/);
    expect(r.status).toBe(0);
  });
});
