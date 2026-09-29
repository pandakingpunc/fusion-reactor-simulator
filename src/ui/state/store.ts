/**
 * Tiny external store + React binding through useSyncExternalStore, and the app-level store
 * (tab, wizard configuration, shot archive, locale). The live simulation has its own store
 * inside SimController (state/sim.ts).
 */
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { ReactorConfig } from '../../physics/types';
import { ITER } from '../../physics/presets';
import { Locale, Translate, isLocale, loadLocale, setActiveLocale, translator } from '../../i18n';
import { AppState, SavedShot, Tab } from './types';

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

const LOCALE_KEY = 'fusion-sim.locale';

export function initialAppState(): AppState {
  return { tab: 'setup', cfg: ITER, cfgName: 'ITER', shots: [], archivedKey: null, viewId: null, locale: 'en' };
}

export interface AppActions {
  setTab(tab: Tab): void;
  setCfg(cfg: ReactorConfig): void;
  setCfgName(name: string): void;
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
    editShot: (shot) => set({ cfg: shot.cfg, cfgName: shot.name.replace(/ #\d+$/, ''), tab: 'setup' }),
    async setLocale(locale) {
      await loadLocale(locale);
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
