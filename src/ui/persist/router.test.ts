// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RNG } from '../../physics/rng';
import { createAppStore } from '../state/store';
import { Tab } from '../state/types';
import { createRouter, formatRoute, HashHost, parseHash, Route, routeOfTab, sameRoute, tabOfRoute, TAB_ROUTES, windowHashHost } from './router';
import { bindTabs } from './routing';

/** A hash host with a history stack, like a browser's: setHash pushes or replaces; back() and edit() fire the listener. */
class FakeHost implements HashHost {
  stack: string[];
  index = 0;
  private listeners = new Set<() => void>();
  constructor(initial = '') { this.stack = [initial]; }
  getHash() { return this.stack[this.index]; }
  setHash(hash: string, replace: boolean) {
    if (replace) this.stack[this.index] = hash;
    else { this.stack = [...this.stack.slice(0, this.index + 1), hash]; this.index++; }
  }
  listen(cb: () => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  get listening() { return this.listeners.size; }
  /** the browser changed the hash: back, forward, an edited address */
  back() { this.index--; this.fire(); }
  edit(hash: string) { this.stack[this.index] = hash; this.fire(); }
  private fire() { for (const l of [...this.listeners]) l(); }
}

describe('parseHash and formatRoute', () => {
  it('reads the tab routes, with or without the # and the slash', () => {
    for (const name of TAB_ROUTES) {
      expect(parseHash(`#/${name}`)).toEqual({ name });
      expect(parseHash(`/${name}`)).toEqual({ name });
      expect(parseHash(name)).toEqual({ name });
      expect(parseHash(`#/${name}/`)).toEqual({ name });
    }
    for (const h of ['', '#', '#/', '/']) expect(parseHash(h)).toEqual({ name: 'wizard' });
  });

  it('reads share links, keeping a code that has slashes or escapes', () => {
    expect(parseHash('#/share/AQAB-_x')).toEqual({ name: 'share', code: 'AQAB-_x' });
    expect(parseHash('#/share/a/b+c')).toEqual({ name: 'share', code: 'a/b+c' });
    expect(parseHash('#/share/a%2Bb')).toEqual({ name: 'share', code: 'a+b' });
    expect(parseHash('#/share/%E0%A4%A')).toEqual({ name: 'share', code: '%E0%A4%A' }); // a bad escape is kept as written
    expect(parseHash('#/share')).toMatchObject({ name: 'unknown' });
    expect(parseHash(`#/share/${'x'.repeat(400_001)}`)).toMatchObject({ name: 'unknown' });
  });

  it('reads embed routes and their options; unknown options and values are dropped', () => {
    expect(parseHash('#/embed/run/CODE')).toEqual({ name: 'embed', view: 'run', code: 'CODE' });
    expect(parseHash('#/embed/report/CODE?lang=tr&autoplay=0')).toEqual({ name: 'embed', view: 'report', code: 'CODE', lang: 'tr', autoplay: false });
    expect(parseHash('#/embed/run/CODE?autoplay=1&lang=xx&other=1')).toEqual({ name: 'embed', view: 'run', code: 'CODE', autoplay: true });
    expect(parseHash('#/embed/run/CODE?autoplay=maybe')).toEqual({ name: 'embed', view: 'run', code: 'CODE' });
    expect(parseHash('#/embed/3d/CODE')).toMatchObject({ name: 'unknown' });
    expect(parseHash('#/embed/run')).toMatchObject({ name: 'unknown' });
  });

  it('an unknown hash is the route unknown, never an exception', () => {
    expect(parseHash('#/nonsense')).toEqual({ name: 'unknown', path: 'nonsense' });
    expect(parseHash('#/run/extra')).toMatchObject({ name: 'unknown' });
    expect(parseHash('#/' + 'y'.repeat(500))).toMatchObject({ name: 'unknown', path: 'y'.repeat(80) });
    expect(formatRoute({ name: 'unknown', path: 'nonsense' })).toBe('#/nonsense');
  });

  it('formatRoute is the inverse of parseHash', () => {
    const rng = new RNG(4);
    const code = () => Array.from({ length: 1 + Math.floor(rng.next() * 60) }, () => 'ABCxyz019-_'[Math.floor(rng.next() * 11)]).join('');
    const routes: Route[] = [];
    for (const name of TAB_ROUTES) routes.push({ name });
    for (let i = 0; i < 100; i++) {
      routes.push({ name: 'share', code: code() });
      const e: Route = { name: 'embed', view: rng.next() < 0.5 ? 'run' : 'report', code: code() };
      if (rng.next() < 0.5) e.lang = rng.next() < 0.5 ? 'en' : 'tr';
      if (rng.next() < 0.5) e.autoplay = rng.next() < 0.5;
      routes.push(e);
    }
    for (const r of routes) expect(parseHash(formatRoute(r)), formatRoute(r)).toEqual(r);
    expect(sameRoute({ name: 'run' }, parseHash('run'))).toBe(true);
    expect(sameRoute({ name: 'run' }, { name: 'report' })).toBe(false);
  });

  it('maps tabs to routes and back; share and embed are no tab', () => {
    const tabs: Tab[] = ['setup', 'run', 'report', 'compare', 'validate'];
    for (const t of tabs) expect(tabOfRoute(routeOfTab(t))).toBe(t);
    expect(routeOfTab('setup')).toEqual({ name: 'wizard' });
    expect(tabOfRoute({ name: 'share', code: 'x' })).toBeNull();
    expect(tabOfRoute({ name: 'unknown', path: 'x' })).toBeNull();
  });
});

describe('createRouter', () => {
  it('pushes and replaces history entries and does not repeat itself', () => {
    const host = new FakeHost();
    const router = createRouter(host);
    const seen: string[] = [];
    router.subscribe(() => seen.push(formatRoute(router.getState())));
    expect(router.getState()).toEqual({ name: 'wizard' });

    router.navigate({ name: 'wizard' }); // the empty hash already is the wizard
    expect(host.stack).toEqual(['']);
    router.navigate({ name: 'run' });
    router.navigate({ name: 'run' });
    router.navigate({ name: 'report' }, { replace: true });
    expect(host.stack).toEqual(['', '#/report']);
    router.navigate({ name: 'compare' });
    expect(seen).toEqual(['#/run', '#/report', '#/compare']);
    expect(router.getState()).toEqual({ name: 'compare' });
  });

  it('follows the browser: back and an edited address notify once each', () => {
    const host = new FakeHost();
    const router = createRouter(host);
    const fn = vi.fn();
    router.subscribe(fn);
    router.navigate({ name: 'run' });
    router.navigate({ name: 'report' });
    fn.mockClear();
    host.back();
    expect(router.getState()).toEqual({ name: 'run' });
    expect(fn).toHaveBeenCalledTimes(1);
    host.edit('#/share/AQAA');
    expect(router.getState()).toEqual({ name: 'share', code: 'AQAA' });
    expect(fn).toHaveBeenCalledTimes(2);
    host.edit('#/share/AQAA'); // same again: nothing changed
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('listens to the host only while somebody is subscribed, and still reads a fresh hash without listeners', () => {
    const host = new FakeHost('#/compare');
    const router = createRouter(host);
    expect(host.listening).toBe(0);
    expect(router.getState()).toEqual({ name: 'compare' });
    const off1 = router.subscribe(() => undefined);
    const off2 = router.subscribe(() => undefined);
    expect(host.listening).toBe(1);
    off1();
    expect(host.listening).toBe(1);
    off2();
    expect(host.listening).toBe(0);
    host.edit('#/validate');
    expect(router.getState()).toEqual({ name: 'validate' });
    router.subscribe(() => undefined);
    router.dispose();
    expect(host.listening).toBe(0);
  });

  it('getState is a stable object until the hash changes', () => {
    const host = new FakeHost('#/run');
    const router = createRouter(host);
    const a = router.getState();
    expect(router.getState()).toBe(a);
    host.edit('#/report');
    expect(router.getState()).not.toBe(a);
  });
});

describe('bindTabs: the tab and the hash follow each other', () => {
  const setup = (initial: string, allowed: Tab[] = ['setup', 'run', 'report', 'compare', 'validate']) => {
    const host = new FakeHost(initial);
    const router = createRouter(host);
    const store = createAppStore();
    let can: Tab[] = allowed;
    const off = bindTabs(store, router, (t) => can.includes(t));
    return { host, router, store, off, allow: (a: Tab[]) => { can = a; } };
  };

  it('a click on a tab pushes its route, and back returns to the previous tab', () => {
    const h = setup('');
    h.store.actions.setTab('compare');
    expect(h.host.stack).toEqual(['', '#/compare']);
    h.store.actions.setTab('validate');
    expect(h.host.stack).toEqual(['', '#/compare', '#/validate']);
    h.host.back();
    expect(h.store.getState().tab).toBe('compare');
    expect(h.host.stack).toEqual(['', '#/compare', '#/validate']); // back changed nothing but the position
    h.host.back();
    expect(h.store.getState().tab).toBe('setup');
    h.off();
  });

  it('an address that opens the page on an enterable tab selects it', () => {
    const h = setup('#/compare');
    expect(h.store.getState().tab).toBe('compare');
    expect(h.host.stack).toEqual(['#/compare']);
    h.host.edit('#/validate');
    expect(h.store.getState().tab).toBe('validate');
    h.off();
  });

  it('a tab that cannot be entered yet is replaced by the one that is showing', () => {
    const h = setup('#/run', ['setup', 'compare', 'validate']);
    expect(h.store.getState().tab).toBe('setup');
    expect(h.host.stack).toEqual(['#/wizard']);
    h.store.actions.setTab('compare');
    h.host.edit('#/report');
    expect(h.store.getState().tab).toBe('compare');
    expect(h.host.getHash()).toBe('#/compare');
    h.allow(['setup', 'run', 'report', 'compare', 'validate']);
    h.host.edit('#/report');
    expect(h.store.getState().tab).toBe('report');
    h.off();
  });

  it('an unknown hash goes back to the current tab', () => {
    const h = setup('#/nonsense');
    expect(h.store.getState().tab).toBe('setup');
    expect(h.host.getHash()).toBe('#/wizard');
    h.off();
  });

  it('share and embed routes are left to the persistence host', () => {
    const h = setup('#/share/AQAA');
    expect(h.store.getState().tab).toBe('setup');
    expect(h.host.getHash()).toBe('#/share/AQAA');
    h.store.actions.setTab('compare');
    expect(h.host.getHash()).toBe('#/share/AQAA');
    h.off();
    const e = setup('#/embed/run/AQAA?autoplay=0');
    e.store.actions.setTab('run');
    expect(e.host.getHash()).toBe('#/embed/run/AQAA?autoplay=0');
    e.off();
  });

  it('after off() neither side follows the other', () => {
    const h = setup('');
    h.off();
    h.store.actions.setTab('compare');
    expect(h.host.getHash()).toBe('');
    h.host.edit('#/validate');
    expect(h.store.getState().tab).toBe('compare');
  });
});

describe('windowHashHost (jsdom)', () => {
  afterEach(() => { window.history.replaceState(null, '', '/'); });

  it('reads and writes the real hash, fires on hashchange, and replace adds no history entry', async () => {
    window.history.replaceState(null, '', '/#/compare');
    const router = createRouter(windowHashHost());
    expect(router.getState()).toEqual({ name: 'compare' });
    const seen: string[] = [];
    const off = router.subscribe(() => seen.push(formatRoute(router.getState())));

    const before = window.history.length;
    router.navigate({ name: 'validate' });
    expect(window.location.hash).toBe('#/validate');
    expect(window.history.length).toBe(before + 1);
    router.navigate({ name: 'run' }, { replace: true });
    expect(window.location.hash).toBe('#/run');
    expect(window.history.length).toBe(before + 1);

    // an edit from outside (the address bar) comes through hashchange
    window.location.hash = '#/share/AQAA';
    await new Promise((r) => setTimeout(r, 20));
    expect(router.getState()).toEqual({ name: 'share', code: 'AQAA' });
    expect(seen).toEqual(['#/validate', '#/run', '#/share/AQAA']);
    off();
  });
});
