/**
 * The router in the application: the hash and the app store's tab follow each other.
 *
 * A change of the tab (a click) pushes its route, so the back button returns to the previous tab; a change
 * of the hash (back, forward, an edited or pasted address) selects the tab, unless the tab cannot be entered
 * yet (Run before a run was loaded, Report before there is a result), in which case the hash is rewritten
 * to the tab that is showing. The share and embed routes are not tabs: this binding leaves them alone, the
 * persistence host (PersistHost.tsx) acts on them.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { AppStore } from '../state/store';
import type { Tab } from '../state/types';
import { createRouter, Route, Router, routeOfTab, tabOfRoute } from './router';

/** Follow router and store until the returned function is called. `canEnter` is read at every decision. */
export function bindTabs(store: AppStore, router: Router, canEnter: (tab: Tab) => boolean): () => void {
  const fromRoute = (): void => {
    const r = router.getState();
    if (r.name === 'share' || r.name === 'embed') return;
    const current = store.getState().tab;
    const tab = tabOfRoute(r);
    if (tab === null) { router.navigate(routeOfTab(current), { replace: true }); return; }
    if (tab === current) return;
    if (canEnter(tab)) store.actions.setTab(tab);
    else router.navigate(routeOfTab(current), { replace: true });
  };
  const fromStore = (): void => {
    const r = router.getState();
    if (r.name === 'share' || r.name === 'embed') return;
    const tab = store.getState().tab;
    if (tabOfRoute(r) !== tab) router.navigate(routeOfTab(tab));
  };
  fromRoute(); // the address the page was opened with
  const offRouter = router.subscribe(fromRoute);
  const offStore = store.subscribe(fromStore);
  return () => { offRouter(); offStore(); };
}

/** The router of this application instance (one per <App>, so that tests and embedded instances do not share a hash). */
export const RouterContext = createContext<Router | null>(null);

export function useRouter(): Router {
  const r = useContext(RouterContext);
  if (!r) throw new Error('useRouter: no router (render inside <App>)');
  return r;
}

/** The current route, re-rendering on change. */
export function useRoute(router: Router): Route {
  return useSyncExternalStore(router.subscribe, router.getState, router.getState);
}

/**
 * Create the application's router and bind it to the store. `canEnter` says whether a tab can be shown right
 * now (it may close over changing state; the latest one is used).
 */
export function useRouting(store: AppStore, canEnter: (tab: Tab) => boolean): Router {
  const router = useMemo(() => createRouter(), []);
  const latest = useRef(canEnter);
  latest.current = canEnter;
  useEffect(() => {
    const off = bindTabs(store, router, (t) => latest.current(t));
    return () => { off(); };
  }, [store, router]);
  return router;
}
