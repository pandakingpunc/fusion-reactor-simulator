/**
 * The step-control settings of the 1.5D model (rtol, atol, dtMax) that the model replaces because they are outside their domain
 * (physics/profiles/settings.ts). The model says so once, in English, as a warning event at t = 0 of the first step; the interface
 * says it in its own language and from the configuration, so that it does not depend on that event still being in the log: a rewind
 * to before the first step drops the event with everything after it, and the settings are replaced all the same.
 */
import type { ReactorConfig, SimEvent } from '../physics/types';
import type { Translate } from '../i18n';
import type { MessageKey } from '../i18n';
import { DEFAULT_PROFILE_SETTINGS } from '../physics/profiles/defaults';
import { checkProfileSettings, STEP_DT_MIN, type SettingNote } from '../physics/profiles/settings';

/** why a setting was replaced (the model's own wording is in SettingNote.message) */
export type NoteReason = 'pos' | 'nonneg' | 'time' | 'floor';
export interface StepNote { key: 'rtol' | 'atol' | 'dtMax'; given: unknown; used: number; reason: NoteReason; /** the model's warning, as its event carries it */ english: string }

/**
 * The replacements the 1.5D model makes for `cfg`, in the order it reports them (empty for a configuration without the 1.5D
 * profile model or with sound settings). The same domain check the model runs, on the same merge of defaults and user values
 * (blank values, undefined or null, are not user values).
 */
export function stepControlNotes(cfg: ReactorConfig): StepNote[] {
  const m = cfg as { method: string; fidelity?: string; profiles?: Record<string, unknown> };
  if ((m.method !== 'tokamak' && m.method !== 'spherical_tokamak') || m.fidelity !== '1.5D') return [];
  const user: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m.profiles ?? {})) if (v !== undefined && v !== null) user[k] = v;
  const { notes } = checkProfileSettings({ ...DEFAULT_PROFILE_SETTINGS, ...user });
  return notes.filter((n): n is SettingNote & { key: StepNote['key'] } => n.key === 'rtol' || n.key === 'atol' || n.key === 'dtMax').map((n) => ({
    key: n.key, given: n.given, used: n.used, english: `${n.message}.`,
    reason: n.key === 'rtol' ? 'pos' : n.key === 'atol' ? 'nonneg' : typeof n.given === 'number' && Number.isFinite(n.given) && n.given > 0 ? 'floor' : 'time',
  }));
}

const REASON: Record<NoteReason, MessageKey> = { pos: 'note.step.pos', nonneg: 'note.step.nonneg', time: 'note.step.time', floor: 'note.step.floor' };

/** The note in the interface language (in English it is the text of the model's own warning, word for word). */
export function stepNoteText(n: StepNote, t: Translate): string {
  return t('note.step', { key: n.key, given: typeof n.given === 'number' ? n.given : String(n.given), why: t(REASON[n.reason], { min: STEP_DT_MIN }), used: n.used, unit: n.key === 'dtMax' ? ' s' : '' });
}

/** A warning of a report or a run log: the step-control notes of `cfg` in the interface language, any other warning as it is. */
export function localizeWarning(msg: string, cfg: ReactorConfig, t: Translate): string {
  const n = stepControlNotes(cfg).find((x) => x.english === msg);
  return n ? stepNoteText(n, t) : msg;
}

/**
 * The events of a run for its log: the step-control notes translated, and each note present even when the event was lost (a rewind
 * to before the first step): the missing ones come first, at t = 0. Returns `events` itself when the configuration has none.
 */
export function withStepNotes(events: SimEvent[], cfg: ReactorConfig, t: Translate): SimEvent[] {
  const notes = stepControlNotes(cfg);
  if (!notes.length) return events;
  const have = new Set<string>();
  const out = events.map((e) => {
    const n = notes.find((x) => x.english === e.msg);
    if (!n) return e;
    have.add(n.english);
    return { ...e, msg: stepNoteText(n, t) };
  });
  const missing = notes.filter((n) => !have.has(n.english)).map((n): SimEvent => ({ t: 0, kind: 'warning', msg: stepNoteText(n, t) }));
  return missing.length ? [...missing, ...out] : out;
}
