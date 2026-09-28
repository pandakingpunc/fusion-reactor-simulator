/**
 * The text of the golden change log: the reason given to golden:update and the per-case description of a
 * re-record (src/regression/changes.ts). The regression these tests pin: an entry once listed keys that had
 * only moved (equilibrium.last.*, alphabetically first) right behind "16 keys added (history 10, scalars 4, …)",
 * so a reader took them for the added keys — which were P_bound and tauE_scal — and never saw those.
 */
import { describe, expect, it } from 'vitest';
import { LIST_KEYS, changesEntry, describeChange, parseReason } from './changes';
import { summarizeChange } from './golden';

const snapshot = (over: Record<string, Record<string, unknown>> = {}) => ({
  meta: { schema: 2, node: 'v24.0.0' },
  scalars: { Q: 10 },
  history: { P_cond: { min: 1, max: 2 } },
  equilibrium: { frames: 4, last: { Raxis: 6.2, q95: 3.1, surfaces: { RatZmax: [6.1, 6.0, 5.9] } } },
  ...over,
});

describe('parseReason', () => {
  it('a one-paragraph text is the title, whitespace and line breaks collapsed', () => {
    expect(parseReason('  switch  ELM\nmodel   to X \n')).toEqual({ title: 'switch ELM model to X', body: [] });
  });

  it('blank lines separate paragraphs: the first is the title, the others the body (CRLF files too)', () => {
    expect(parseReason('Title line\r\ncontinued\r\n\r\n(A) first cause,\r\nwrapped\r\n  \r\n(B) second\r\n')).toEqual({
      title: 'Title line continued', body: ['(A) first cause, wrapped', '(B) second'],
    });
  });

  it('a text without a word is no reason', () => {
    for (const t of ['', '   ', '\n\n \t\n', '\r\n']) expect(parseReason(t)).toBeUndefined();
  });
});

describe('describeChange', () => {
  it('lists moved keys (largest change first), added keys and removed keys under their own labels', () => {
    const old = snapshot();
    const now = snapshot({
      scalars: { Q: 12, tauE_scal: 3.1 }, // Q moved by 20 %, tauE_scal is new
      history: { P_cond: { min: 1, max: 4 }, P_bound: { min: 0, max: 5 } }, // max moved by 50 %, P_bound is new
    });
    delete (now.equilibrium.last as Record<string, unknown>).q95; // removed
    const lines = describeChange({ id: 'ITER15', change: summarizeChange(old, now) });
    expect(lines).toEqual([
      '  - ITER15: 2 keys moved; max rel. diff 5.00e-1; 3 keys added (history 2, scalars 1); 1 key removed (equilibrium 1)',
      '    - moved, largest change first: history.P_cond.max, scalars.Q',
      '    - added: history.P_bound.max, history.P_bound.min, scalars.tauE_scal',
      '    - removed: equilibrium.last.q95',
    ]);
  });

  it('keys that only moved are never listed as added (the equilibrium keys of the golden log)', () => {
    const old = snapshot();
    const now = snapshot({
      equilibrium: { frames: 4, last: { Raxis: 6.3, q95: 3.2, surfaces: { RatZmax: [6.2, 6.1, 6.0] } } },
      scalars: { Q: 10, tauE_scal: 3.1 },
    });
    const [head, ...lists] = describeChange({ id: 'X', change: summarizeChange(old, now) });
    expect(head).toBe('  - X: 5 keys moved; max rel. diff 3.13e-2; 1 key added (scalars 1)');
    expect(lists).toHaveLength(2);
    expect(lists[0]).toBe('    - moved, largest change first: equilibrium.last.q95, equilibrium.last.surfaces.RatZmax[2], ' +
      'equilibrium.last.surfaces.RatZmax[1], equilibrium.last.surfaces.RatZmax[0], equilibrium.last.Raxis');
    expect(lists[1]).toBe('    - added: scalars.tauE_scal');
    expect(lists[1]).not.toContain('equilibrium');
  });

  it(`cuts each list at ${LIST_KEYS} keys and says how many are left`, () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${String(i).padStart(2, '0')}`, i + 1]));
    const moved = Object.fromEntries(Object.entries(many).map(([k, v]) => [k, v * 2]));
    const lines = describeChange({ id: 'M', change: summarizeChange(snapshot({ scalars: many }), snapshot({ scalars: moved })) });
    expect(lines[0]).toMatch(/^ {2}- M: 30 keys moved; max rel\. diff 5\.00e-1$/);
    expect(lines).toHaveLength(2);
    // all of them changed by the same 50 %: ties are ordered by key
    expect(lines[1]).toBe(`    - moved, largest change first: ${Array.from({ length: LIST_KEYS }, (_, i) => `scalars.k${String(i).padStart(2, '0')}`).join(', ')}, … (+${30 - LIST_KEYS} more)`);
    const added = describeChange({ id: 'A', change: summarizeChange(snapshot(), snapshot({ scalars: { Q: 10, ...many } })) });
    expect(added[0]).toBe('  - A: 0 keys moved; 30 keys added (scalars 30)');
    expect(added[1]).toMatch(/^ {4}- added: scalars\.k00, .*, … \(\+18 more\)$/);
  });

  it('a change of type or of a label counts as the largest move; a schema change and a note are kept in the head', () => {
    const old = snapshot();
    old.meta.schema = 1;
    const now = snapshot({ scalars: { Q: 10.5 }, labels: { method: 'tokamak' } });
    (old as Record<string, unknown>).labels = { method: 'other' };
    const [head, moved] = describeChange({ id: 'S', change: summarizeChange(old, now), meta: 'Node v22.0.0 → v24.0.0' });
    expect(head).toBe('  - S: schema 1 → 2; 2 keys moved; max rel. diff 4.76e-2; Node v22.0.0 → v24.0.0');
    expect(moved).toBe('    - moved, largest change first: labels.method, scalars.Q');
  });

  it('a case whose old file could not be read has only the note', () => {
    expect(describeChange({ id: 'B', meta: 'replaced unreadable file (Unexpected token)' })).toEqual(['  - B: replaced unreadable file (Unexpected token)']);
  });
});

describe('changesEntry', () => {
  const now = new Date('2026-09-29T10:07:42Z');
  const base = { added: [], changed: [], unchanged: ['A', 'B'], failed: [], only: undefined };

  it('title, body paragraphs, run line and case lists', () => {
    const text = changesEntry({
      ...base,
      reason: { title: 'headline', body: ['(A) cause one', '(B) cause two'] },
      added: ['N'], only: ['N', 'A'],
      changed: [{ id: 'C', change: summarizeChange(snapshot(), snapshot({ scalars: { Q: 11 } })) }],
      failed: ['F'],
    }, now, 'v24.19.0');
    expect(text).toBe([
      '',
      '## 2026-09-29 10:07 UTC — headline',
      '',
      '(A) cause one',
      '',
      '(B) cause two',
      '',
      'Node v24.19.0 · `npm run golden:update` · --only N,A',
      '',
      '- Added (1): N',
      '- Changed (1):',
      '  - C: 1 key moved; max rel. diff 9.09e-2',
      '    - moved, largest change first: scalars.Q',
      '- Unchanged (2): A, B',
      '- Failed to run, not written (1): F',
      '',
    ].join('\n'));
  });

  it('a one-line reason gives the entry of the old format', () => {
    expect(changesEntry({ ...base, reason: { title: 'first record', body: [] }, added: ['NIF'], unchanged: [] }, now, 'v24.19.0')).toBe(
      '\n## 2026-09-29 10:07 UTC — first record\n\nNode v24.19.0 · `npm run golden:update` · all cases\n\n- Added (1): NIF\n');
  });
});
