/**
 * Tiny external store + React binding through useSyncExternalStore, and the app-level store
 * (tab, wizard configuration, shot archive, locale). The live simulation has its own store
 * inside SimController (state/sim.ts).
 */
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { ReactorConfig } from '../../physics/types';
import { ITER } from '../../physics/presets';
import { Locale, Translate, isLocale, loadLocale, setActiveLocale, translator } from '../../i18n';
import type { ScenarioSpec } from '../../physics/scenario';
import { AppState, SavedShot, Tab } from './types';
import { loadWizardText } from '../wizard/wizTextLoader';

export interface Store<T> {
  getState(): T;
  /** replace the state (or derive it from the previous one); listeners run only on change */
  setState(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState(next) {
      const n = typeof next === 'function' ? (next as (prev: T) => T)(state) : next;
      if (Object.is(n, state)) return;
      state = n;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/**
 * Subscribe a component to a slice of a store. The selector must return a stable value
 * (a primitive or an object already held by the state), never a freshly built object.
 */
export function useStore<T extends object, S>(store: Store<T>, selector: (s: T) => S): S {
  const get = () => selector(store.getState());
  return useSyncExternalStore(store.subscribe, get, get);
}

// ── app store ────────────────────────────────────────────────────────────────

/** the key the language is saved under; the inline script of index.html reads the same key to set <html lang> early (firstPaint.test.tsx ties the two) */
export const LOCALE_KEY = 'fusion-sim.locale';

/**
 * The dictionaries of the screens that are chunks of their own (sharing, the scenario editor, education, the validation and compare views)
 * are fetched together with the main one, so that none of them paints in English before its Turkish text arrives (the sharing buttons are
 * on the first screen, the others open within seconds). A load that fails is not an error here: the screen asks again when it is opened.
 */
function loadScreenDictionaries(locale: Locale): Promise<void> {
  if (locale === 'en') return Promise.resolve(); // English is bundled
  return Promise.all([
    import('../persist/usePersistT').then((m) => m.loadPersistTr()),
    import('../scenario/useScenarioT').then((m) => m.loadScenarioTr()),
    import('../../edu/i18n').then((m) => m.loadEduLocale(locale)),
  ]).then(() => undefined, () => undefined);
}

export function initialAppState(): AppState {
  return { tab: 'setup', cfg: ITER, cfgName: 'ITER', scenario: null, shots: [], archivedKey: null, viewId: null, locale: 'en' };
}

export interface AppActions {
  setTab(tab: Tab): void;
  setCfg(cfg: ReactorConfig): void;
  setCfgName(name: string): void;
  /** set (or, with null, clear) the scenario of the next run */
  setScenario(scenario: ScenarioSpec | null): void;
  /** archive a completed run once per `key` (`${runId}:${branchId}`); later calls with the same key are ignored */
  archiveShot(key: string, shot: Omit<SavedShot, 'id' | 'name'>): void;
  removeShot(id: number): void;
  /** show a shot (or, with null, the live or latest run) in the Report */
  viewShot(id: number | null): void;
  /**
   * Add a shot that did not come from a live run (opened from the archive, imported from a file) and show it in the
   * Report. A shot with the same `sourceKey` that is already in the list is shown instead of adding another.
   */
  openShot(shot: Omit<SavedShot, 'id'>): void;
  /** load an archived shot's configuration into the wizard */
  editShot(shot: SavedShot): void;
  /** switch the interface language (loads the dictionary first, then updates <html lang>) */
  setLocale(locale: Locale): Promise<void>;
  /** apply the language saved by a previous visit, if any */
  restoreLocale(): Promise<void>;
}

export type AppStore = Store<AppState> & { actions: AppActions };

export function createAppStore(init: Partial<AppState> = {}): AppStore {
  const store = createStore<AppState>({ ...initialAppState(), ...init });
  const set = (patch: Partial<AppState>) => store.setState((s) => ({ ...s, ...patch }));
  const actions: AppActions = {
    setTab: (tab) => set({ tab }),
    setCfg: (cfg) => set({ cfg }),
    setCfgName: (cfgName) => set({ cfgName }),
    setScenario: (scenario) => set({ scenario }),
    archiveShot(key, shot) {
      store.setState((s) => {
        if (s.archivedKey === key) return s;
        const id = s.shots.reduce((m, x) => Math.max(m, x.id), 0) + 1;
        return { ...s, archivedKey: key, viewId: null, shots: [...s.shots, { ...shot, id, name: `${s.cfgName} #${s.shots.length + 1}` }] };
      });
    },
    removeShot: (id) => store.setState((s) => ({ ...s, shots: s.shots.filter((x) => x.id !== id), viewId: s.viewId === id ? null : s.viewId })),
    viewShot: (viewId) => set({ viewId }),
    openShot(shot) {
      store.setState((s) => {
        const same = shot.sourceKey ? s.shots.find((x) => x.sourceKey === shot.sourceKey) : undefined;
        if (same) return { ...s, viewId: same.id, tab: 'report' };
        const id = s.shots.reduce((m, x) => Math.max(m, x.id), 0) + 1;
        return { ...s, shots: [...s.shots, { ...shot, id }], viewId: id, tab: 'report' };
      });
    },
    editShot: (shot) => set({ cfg: shot.cfg, cfgName: shot.name.replace(/ #\d+$/, ''), scenario: (shot.prov?.scenario as ScenarioSpec | undefined) ?? null, tab: 'setup' }),
    async setLocale(locale) {
      // the wizard's own texts come with the dictionary (a failed load leaves them in English; the wizard asks again)
      await Promise.all([loadLocale(locale), loadWizardText(locale).catch(() => undefined), loadScreenDictionaries(locale)]);
      setActiveLocale(locale);
      set({ locale });
      try { localStorage.setItem(LOCALE_KEY, locale); } catch { /* storage unavailable: keep for this session only */ }
    },
    async restoreLocale() {
      let saved: string | null = null;
      try { saved = localStorage.getItem(LOCALE_KEY); } catch { /* storage unavailable */ }
      if (isLocale(saved) && saved !== store.getState().locale) await actions.setLocale(saved);
    },
  };
  return Object.assign(store, { actions });
}

/** the application's store; tests render with their own via AppStoreContext */
export const appStore = createAppStore();
export const AppStoreContext = createContext<AppStore>(appStore);

export function useAppStore(): AppStore { return useContext(AppStoreContext); }

export function useApp<S>(selector: (s: AppState) => S): S {
  return useStore(useAppStore(), selector);
}

/** Translator for the current locale; re-renders the component when the locale changes. */
export function useT(): Translate {
  const locale = useApp((s) => s.locale);
  return useMemo(() => translator(locale), [locale]);
}
