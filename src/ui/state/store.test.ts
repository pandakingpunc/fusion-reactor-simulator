// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MIRROR, TAE } from '../../physics/presets';
import { ReactorConfig } from '../../physics/types';
import { SavedShot } from './types';
import { AppStoreContext, createAppStore, createStore, useApp, useStore } from './store';

afterEach(cleanup);

describe('createStore', () => {
  it('notifies subscribers on change only, and stops after unsubscribe', () => {
    const s = createStore({ n: 0 });
    let calls = 0;
    const off = s.subscribe(() => { calls++; });
    s.setState((x) => ({ n: x.n + 1 }));
    s.setState((x) => x); // same object: no notification
    expect([s.getState().n, calls]).toEqual([1, 1]);
    off();
    s.setState({ n: 5 });
    expect(calls).toBe(1);
  });

  it('re-renders a component only when its selected slice changes', () => {
    const s = createStore({ a: 1, b: 1 });
    let renders = 0;
    const View = () => { renders++; return React.createElement('span', null, useStore(s, (x) => x.a)); };
    const { container } = render(React.createElement(View));
    act(() => s.setState((x) => ({ ...x, b: 2 })));
    expect(renders).toBe(1);
    act(() => s.setState((x) => ({ ...x, a: 7 })));
    expect([renders, container.textContent]).toEqual([2, '7']);
  });
});

const shot = (cfg: ReactorConfig = TAE): Omit<SavedShot, 'id' | 'name'> => ({ cfg, meta: {} as never, report: {} as never, frames: [], events: [] });

describe('app store actions', () => {
  it('archives each completion key once, numbering shots after the configuration name', () => {
    const store = createAppStore({ cfgName: 'TAE' });
    const { actions } = store;
    actions.archiveShot('1:0', shot());
    actions.archiveShot('1:0', shot());
    actions.archiveShot('1:1', shot());
    actions.setCfgName('Mirror');
    actions.archiveShot('2:0', shot(MIRROR));
    expect(store.getState().shots.map((s) => [s.id, s.name])).toEqual([[1, 'TAE #1'], [2, 'TAE #2'], [3, 'Mirror #3']]);
    actions.removeShot(2);
    actions.archiveShot('3:0', shot());
    expect(store.getState().shots.map((s) => s.id)).toEqual([1, 3, 4]);
  });

  it('opens a shot that did not come from a live run: it is added once per source and shown in the Report', () => {
    const store = createAppStore({ cfgName: 'TAE' });
    const { actions } = store;
    actions.archiveShot('1:0', shot());
    actions.openShot({ ...shot(MIRROR), name: 'From the archive', sourceKey: 'archive:abc', archiveId: 'abc' });
    expect(store.getState()).toMatchObject({ tab: 'report', viewId: 2 });
    expect(store.getState().shots.map((s) => [s.id, s.name])).toEqual([[1, 'TAE #1'], [2, 'From the archive']]);
    actions.setTab('compare');
    actions.openShot({ ...shot(MIRROR), name: 'From the archive again', sourceKey: 'archive:abc' });
    expect(store.getState().shots).toHaveLength(2);
    expect(store.getState()).toMatchObject({ tab: 'report', viewId: 2 });
    // a shot without a source key is always new
    actions.openShot({ ...shot(), name: 'No source' });
    actions.openShot({ ...shot(), name: 'No source' });
    expect(store.getState().shots.map((s) => s.id)).toEqual([1, 2, 3, 4]);
    expect(store.getState().viewId).toBe(4);
  });

  it('a new completion, or removing the shown shot, returns the Report to the live or latest run', () => {
    const store = createAppStore({ cfgName: 'TAE' });
    const { actions } = store;
    actions.openShot({ ...shot(), name: 'Opened', sourceKey: 'import:x' });
    expect(store.getState().viewId).toBe(1);
    actions.archiveShot('5:0', shot());
    expect(store.getState().viewId).toBeNull();
    actions.viewShot(1);
    expect(store.getState().viewId).toBe(1);
    actions.removeShot(2); // another shot: the view stays
    expect(store.getState().viewId).toBe(1);
    actions.removeShot(1);
    expect(store.getState().viewId).toBeNull();
    actions.viewShot(null);
    expect(store.getState().viewId).toBeNull();
  });

  it('loads an archived shot back into the wizard', () => {
    const store = createAppStore({ tab: 'compare' });
    store.actions.editShot({ ...shot(MIRROR), id: 9, name: 'Tandem mirror #12' });
    expect(store.getState()).toMatchObject({ tab: 'setup', cfg: MIRROR, cfgName: 'Tandem mirror' });
  });

  it('remembers the interface language across visits', async () => {
    const first = createAppStore();
    await first.actions.setLocale('tr');
    const second = createAppStore();
    expect(second.getState().locale).toBe('en');
    await second.actions.restoreLocale();
    expect(second.getState().locale).toBe('tr');
    expect(document.documentElement.lang).toBe('tr');
    await second.actions.setLocale('en');
  });

  it('components read the store given by the context', () => {
    const store = createAppStore({ cfgName: 'from context' });
    const View = () => React.createElement('b', null, useApp((s) => s.cfgName));
    const { container } = render(React.createElement(AppStoreContext.Provider, { value: store }, React.createElement(View)));
    expect(container.textContent).toBe('from context');
    act(() => store.actions.setCfgName('renamed'));
    expect(container.textContent).toBe('renamed');
  });
});
