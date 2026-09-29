/**
 * Start-up order: the interface language saved by a previous visit is applied before the first
 * render. Without it a saved Turkish locale would first paint in English and switch a moment later,
 * when the dictionary chunk arrives (the English dictionary is bundled, Turkish is loaded on demand).
 */
import type { AppStore } from './state/store';

/**
 * Restore the saved locale, then call `render` exactly once. A locale that cannot be restored (storage
 * blocked, dictionary chunk failed to load) must not keep the page blank: the app then starts in English.
 */
export async function restoreLocaleThenRender(store: Pick<AppStore, 'actions'>, render: () => void): Promise<void> {
  try {
    await store.actions.restoreLocale();
  } catch (err) {
    console.warn('Could not restore the saved interface language; starting in English.', err);
  } finally {
    render();
  }
}
