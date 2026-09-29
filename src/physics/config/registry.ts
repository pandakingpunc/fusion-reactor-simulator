/**
 * Preset lookup for the library and the command line: by id, with a suggestion for a misspelt id.
 */
import { PRESETS, type Preset } from '../presets';
import { closest } from './dsl';

/** The ids of all built-in presets, in catalogue order. */
export function presetIds(): string[] {
  return PRESETS.map((p) => p.id);
}

/** The preset with this id (exact match), if any. */
export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** The preset with this id; throws an Error listing the valid ids (and the closest one) otherwise. */
export function requirePreset(id: string): Preset {
  const p = getPreset(id);
  if (p) return p;
  const c = closest(id, presetIds());
  throw new Error(`unknown preset '${id}'${c !== undefined ? ` (did you mean '${c}'?)` : ''}. Valid presets: ${presetIds().join(', ')}`);
}
