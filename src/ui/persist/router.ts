/**
 * Hash router without dependencies.
 *
 *   #/wizard  #/run  #/report  #/compare  #/validate        the tabs of the application
 *   #/share/<code>                                          a share link (codec.ts)
 *   #/embed/<run|report>/<code>[?lang=tr&autoplay=0]        a chrome-less view for an <iframe>
 *
 * The page is a static file (GitHub Pages, a USB stick, file://), so the route lives in the fragment: it
 * needs no server rewrite and is never sent anywhere. parseHash never throws: a hash it does not know is the
 * route 'unknown', which the tab binding turns back into the current tab. formatRoute is its inverse.
 *
 * The router is a small store (getState/subscribe) over a HashHost, the window in the browser and a fake in
 * tests. navigate() pushes a history entry (the back button returns to the previous tab) or, with
 * `replace`, rewrites the current one; a change made by the browser (back, forward, an edited address)
 * arrives through the host's listener. Either way subscribers see one notification per real change.
 */
import { isLocale, Locale } from '../../i18n';
import type { Tab } from '../state/types';

export type TabRouteName = 'wizard' | 'run' | 'report' | 'compare' | 'validate';
export type EmbedView = 'run' | 'report';

export type Route =
  | { name: TabRouteName }
  | { name: 'share'; code: string }
  | { name: 'embed'; view: EmbedView; code: string; lang?: Locale; autoplay?: boolean }
  | { name: 'unknown'; path: string };

export const TAB_ROUTES: readonly TabRouteName[] = ['wizard', 'run', 'report', 'compare', 'validate'];
const TAB_OF: Record<TabRouteName, Tab> = { wizard: 'setup', run: 'run', report: 'report', compare: 'compare', validate: 'validate' };
const ROUTE_OF: Record<Tab, TabRouteName> = { setup: 'wizard', run: 'run', report: 'report', compare: 'compare', validate: 'validate' };

/** The route of an application tab. */
export const routeOfTab = (tab: Tab): Route => ({ name: ROUTE_OF[tab] });
/** The tab a route shows, or null for the routes that are not a tab (share, embed, unknown). */
export function tabOfRoute(r: Route): Tab | null {
  return (TAB_ROUTES as readonly string[]).includes(r.name) ? TAB_OF[r.name as TabRouteName] : null;
}

/** Longest share code the router carries (see MAX_CODE_CHARS in codec.ts, which is the decoder's own limit). */
const MAX_CODE = 400_000;

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** The route of a location hash ('#/run', '/run', 'run', '' ...). */
export function parseHash(hash: string): Route {
  let h = hash.startsWith('#') ? hash.slice(1) : hash;
  const q = h.indexOf('?');
  const query = q >= 0 ? h.slice(q + 1) : '';
  if (q >= 0) h = h.slice(0, q);
  const parts = h.split('/').filter((p) => p !== '');
  if (!parts.length) return { name: 'wizard' };
  const head = parts[0];
  if ((TAB_ROUTES as readonly string[]).includes(head) && parts.length === 1) return { name: head as TabRouteName };
  if (head === 'share' && parts.length >= 2) {
    const code = decode(parts.slice(1).join('/'));
    return code.length <= MAX_CODE ? { name: 'share', code } : { name: 'unknown', path: 'share/…' };
  }
  if (head === 'embed' && parts.length >= 3 && (parts[1] === 'run' || parts[1] === 'report')) {
    const code = decode(parts.slice(2).join('/'));
    if (code.length > MAX_CODE) return { name: 'unknown', path: 'embed/…' };
    const r: Extract<Route, { name: 'embed' }> = { name: 'embed', view: parts[1], code };
    const params = new URLSearchParams(query);
    const lang = params.get('lang');
    if (isLocale(lang)) r.lang = lang;
    const auto = params.get('autoplay');
    if (auto === '0' || auto === '1') r.autoplay = auto === '1';
    return r;
  }
  return { name: 'unknown', path: parts.join('/').slice(0, 80) };
}

/** The location hash of a route ('#/run'); the inverse of parseHash for every route it returns except 'unknown'. */
export function formatRoute(r: Route): string {
  switch (r.name) {
    case 'share': return `#/share/${r.code}`;
    case 'embed': {
      const params: string[] = [];
      if (r.lang) params.push(`lang=${r.lang}`);
      if (r.autoplay !== undefined) params.push(`autoplay=${r.autoplay ? 1 : 0}`);
      return `#/embed/${r.view}/${r.code}${params.length ? `?${params.join('&')}` : ''}`;
    }
    case 'unknown': return `#/${r.path}`;
    default: return `#/${r.name}`;
  }
}

/** Two routes that show the same thing. */
export function sameRoute(a: Route, b: Route): boolean {
  return formatRoute(a) === formatRoute(b);
}

// ── the router ───────────────────────────────────────────────────────────────

/** Where the hash lives: the window in the browser, a fake in tests. */
export interface HashHost {
  getHash(): string;
  /** write the hash; `replace` rewrites the current history entry instead of adding one */
  setHash(hash: string, replace: boolean): void;
  /** call back when the hash changed without the router (back, forward, an edited address); returns the unsubscribe */
  listen(cb: () => void): () => void;
}

export function windowHashHost(win: Window = window): HashHost {
  return {
    getHash: () => win.location.hash,
    setHash(hash, replace) {
      if (replace) win.history.replaceState(win.history.state, '', `${win.location.pathname}${win.location.search}${hash}`);
      else win.location.hash = hash;
    },
    listen(cb) {
      win.addEventListener('hashchange', cb);
      win.addEventListener('popstate', cb);
      return () => { win.removeEventListener('hashchange', cb); win.removeEventListener('popstate', cb); };
    },
  };
}

export interface Router {
  /** the current route (a new object only when the hash changed) */
  getState(): Route;
  subscribe(listener: () => void): () => void;
  /** go to a route; a route equal to the current one does nothing */
  navigate(route: Route, opts?: { replace?: boolean }): void;
  dispose(): void;
}

export function createRouter(host: HashHost = windowHashHost()): Router {
  let hash = host.getHash();
  let route = parseHash(hash);
  const listeners = new Set<() => void>();
  let off: (() => void) | null = null;
  /** re-read the hash; true when it changed */
  const sync = (): boolean => {
    const h = host.getHash();
    if (h === hash) return false;
    hash = h;
    route = parseHash(h);
    return true;
  };
  const refresh = () => { if (sync()) for (const l of [...listeners]) l(); };
  const detach = () => { off?.(); off = null; };
  return {
    getState() { sync(); return route; },
    subscribe(l) {
      // the host is listened to only while somebody is subscribed
      if (!listeners.size) off = host.listen(refresh);
      listeners.add(l);
      return () => { listeners.delete(l); if (!listeners.size) detach(); };
    },
    navigate(r, opts = {}) {
      sync();
      const next = formatRoute(r);
      if (next === hash || (next === '#/wizard' && (hash === '' || hash === '#'))) return;
      host.setHash(next, !!opts.replace);
      refresh();
    },
    dispose() {
      listeners.clear();
      detach();
    },
  };
}
