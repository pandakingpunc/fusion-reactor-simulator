/** Which missions the player has solved: kept in this browser only (localStorage), never sent anywhere. */
import { MISSIONS } from '../../edu/missions';

export const PROGRESS_KEY = 'fusion-sim.missions';

const KNOWN = new Set<string>(MISSIONS.map((m) => m.id));

export function loadSolved(): string[] {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && KNOWN.has(x)) : [];
  } catch { return []; /* storage unavailable or damaged: start over */ }
}

export function saveSolved(ids: readonly string[]): void {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(ids)); } catch { /* storage unavailable: kept for this session only */ }
}
