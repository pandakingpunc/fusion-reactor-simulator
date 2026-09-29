/** Per-viewer preferences of the persistence UI, in localStorage (which may be unavailable: then the defaults hold). */

const AUTO_KEY = 'fusion-sim.archive.auto';

/** Whether completed runs are saved to the archive automatically (default: yes). */
export function autoSaveEnabled(): boolean {
  try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; }
}

export function setAutoSave(on: boolean): void {
  try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* storage unavailable: the choice lasts for this page view only */ }
}
