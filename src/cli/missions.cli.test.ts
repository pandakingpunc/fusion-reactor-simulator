/// <reference types="node" />
/**
 * The missions CLI (src/cli/missions.cli.ts) in a child process: the exit code, the JSON form and the usage error.
 * Only the missions that run in milliseconds are played.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function missions(...args: string[]) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/missions.cli.ts', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('missions CLI', () => {
  it('plays the selected missions and exits 0 when each is solvable and not trivial', () => {
    const r = missions('--only', 'nif,kink');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('2/2 missions solvable and not trivial');
    expect(r.stdout).toMatch(/ok\s+nif\s+start fail\s+control fail\s+solution pass/);
  }, 120_000);

  it('prints machine-readable results with --json', () => {
    const r = missions('--only', 'nif', '--json');
    expect(r.code, r.stderr).toBe(0);
    const rows = JSON.parse(r.stdout) as { id: string; start: boolean; control: boolean; solution: boolean; ok: boolean; edits: Record<string, number> }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'nif', start: false, control: false, solution: true, ok: true, edits: { asymmetry: 3 } });
  }, 120_000);

  it('exits 2 on an unknown mission id', () => {
    const r = missions('--only', 'nope');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown value 'nope'");
  }, 60_000);
});
