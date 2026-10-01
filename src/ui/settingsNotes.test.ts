import { beforeAll, describe, expect, it } from 'vitest';
import { loadLocale, translator } from '../i18n';
import { ITER, ITER_15D } from '../physics/presets';
import type { ReactorConfig, SimEvent } from '../physics/types';
import { localizeWarning, stepControlNotes, withStepNotes } from './settingsNotes';

const withProfiles = (profiles: Record<string, unknown>): ReactorConfig => ({ ...ITER_15D, profiles: { ...(ITER_15D as { profiles?: object }).profiles, ...profiles } }) as ReactorConfig;
const bad = withProfiles({ rtol: -1, dtMax: 1e-9, atol: -5 });

const en = translator('en');
let tr = en; // the Turkish translator is made once its dictionary is loaded (a translator reads the dictionary it is made with)
beforeAll(async () => { await loadLocale('tr'); tr = translator('tr'); });

/** the warnings the 1.5D model raises for `bad` at t = 0 (checked against a real run: ProfileContext.warnOnce, seen through Simulation.advance) */
const MODEL_WARNINGS = [
  'ProfileSettings.rtol = -1 is not a positive number: 0.01 is used.',
  'ProfileSettings.atol = -5 is not a non-negative number: 0.0001 is used.',
  'ProfileSettings.dtMax = 1e-9 is below the shortest step of 0.000001 s: 0.000001 s is used.',
];

describe('step-control notes', () => {
  it('lists the replacements the model makes, with the model\'s own wording as the English text', () => {
    const notes = stepControlNotes(bad);
    expect(notes.map((n) => n.key)).toEqual(['rtol', 'atol', 'dtMax']);
    expect(notes.map((n) => n.english)).toEqual(MODEL_WARNINGS);
    expect(notes.map((n) => en('note.step', { key: n.key, given: String(n.given), why: en(`note.step.${n.reason}`, { min: 1e-6 }), used: n.used, unit: n.key === 'dtMax' ? ' s' : '' })))
      .toEqual(MODEL_WARNINGS);
  });

  it('says a step limit that is not a time differently from one that is only too small', () => {
    expect(stepControlNotes(withProfiles({ dtMax: 0 }))[0].reason).toBe('time');
    expect(stepControlNotes(withProfiles({ dtMax: 1e-9 }))[0].reason).toBe('floor');
  });

  it('has none for sound or blank settings, or without the 1.5D model', () => {
    expect(stepControlNotes(ITER_15D)).toEqual([]);
    expect(stepControlNotes(withProfiles({ rtol: undefined, atol: null, dtMax: 0.2 }))).toEqual([]);
    expect(stepControlNotes({ ...bad, fidelity: '0D' } as ReactorConfig)).toEqual([]);
    expect(stepControlNotes(ITER)).toEqual([]);
  });

  it('translates a warning of the model and leaves any other as it is', () => {
    expect(localizeWarning(MODEL_WARNINGS[0], bad, en)).toBe(MODEL_WARNINGS[0]);
    expect(localizeWarning(MODEL_WARNINGS[0], bad, tr)).toBe('ProfileSettings.rtol = -1 pozitif bir sayı değil: bunun yerine 0,01 kullanılıyor.');
    expect(localizeWarning(MODEL_WARNINGS[2], bad, tr)).toBe('ProfileSettings.dtMax = 1e-9 en kısa adım olan 0,000001 s değerinin altında: bunun yerine 0,000001 s kullanılıyor.');
    expect(localizeWarning('TF coil stress 900 MPa > 800 MPa limit.', bad, tr)).toBe('TF coil stress 900 MPa > 800 MPa limit.');
  });

  it('shows the notes in the log even after a rewind to before the first step dropped their events', () => {
    const later: SimEvent = { t: 2.5, kind: 'ELM', msg: 'ELM' };
    // the run is back at its start: no events, the notes are still there
    const rewound = withStepNotes([], bad, tr);
    expect(rewound).toHaveLength(3);
    expect(rewound.every((e) => e.t === 0 && e.kind === 'warning')).toBe(true);
    expect(rewound[0].msg).toContain('pozitif bir sayı değil');
    // a log that has the model's event keeps it once, translated, in its place
    const events: SimEvent[] = [{ t: 0, kind: 'warning', msg: MODEL_WARNINGS[0] }, later];
    const out = withStepNotes(events, bad, tr);
    expect(out.filter((e) => e.msg.includes('pozitif bir sayı değil'))).toHaveLength(1);
    expect(out.at(-1)).toBe(later);
    expect(out).toHaveLength(4); // the two notes the log lacked, then its own two events
    // nothing to add: the same array
    expect(withStepNotes(events, ITER_15D, tr)).toBe(events);
  });
});
