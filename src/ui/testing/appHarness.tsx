/**
 * The whole application in jsdom with a fake simulation worker, for the tests that walk the screens (the pseudo-locale sweep, the number
 * format sweep, the accessibility sweep). It does not depend on any text of the interface: tabs are opened through the store and the run is
 * started with the primary button of the last wizard step, so the same walk works in every language. Not imported by the application bundle.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import App from '../../App';
import type { Locale } from '../../i18n';
import { FakeWorker, fakeWorkerFactory } from '../../worker/fakeWorker';
import { AppStore, AppStoreContext, createAppStore } from '../state/store';
import type { Tab } from '../state/types';

export interface Harness {
  store: AppStore;
  factory: ReturnType<typeof fakeWorkerFactory>;
  /** the live simulation's worker */
  w(): FakeWorker;
  /** let the worker answer the pending messages (the load of a run) */
  roundTrip(): void;
  /** run the live simulation on by `simDt` (model time units) */
  advance(simDt: number): void;
}

/** Mount <App> with a store of its own in `locale` (the dictionaries are loaded before the first render, as at start-up). */
export async function mountApp(init: Partial<Parameters<typeof createAppStore>[0]> = {}, locale: Locale = 'en'): Promise<Harness> {
  const store: AppStore = createAppStore(init);
  await store.actions.setLocale(locale);
  const factory = fakeWorkerFactory();
  render(React.createElement(AppStoreContext.Provider, { value: store },
    React.createElement(App, { createWorker: factory.create, schedule: (flush: () => void) => flush() })));
  const w = (): FakeWorker => factory.workers[0];
  return {
    store, factory, w,
    roundTrip: () => act(() => { w().process(); w().deliver(); }),
    advance: (simDt) => act(() => { w().advance(simDt); w().deliver(); }),
  };
}

/** Go to the last wizard step and press its start button. */
export function startRun(): void {
  const steps = document.querySelectorAll('.steps .step');
  fireEvent.click(steps[steps.length - 1]);
  fireEvent.click(document.querySelector('.wizard section .btn.primary') as HTMLElement);
}

/** Open a tab. */
export function goTab(store: AppStore, tab: Tab): void {
  act(() => store.actions.setTab(tab));
}

/**
 * What the physics model writes as sentences, English whatever the interface language is (src/physics has no message codes yet): the notes and
 * warnings of the reports, the reason a run ended and the events of the logs, collected from the shots in the store. The sweeps do not hold
 * these against the interface; nothing else is excused by them.
 */
export function modelTexts(store: AppStore): Set<string> {
  const out = new Set<string>();
  const add = (x: unknown) => { if (typeof x === 'string' && x) out.add(x.trim()); };
  for (const shot of store.getState().shots) {
    const r = shot.report;
    add(r.Q_eng_note); add(r.lawsonNote); add(r.stableDefinition);
    r.warnings.forEach(add);
    for (const v of Object.values(r.termination)) add(v);
    for (const v of Object.values(r.termination.disruption ?? {})) add(v);
    shot.events.forEach((e) => add(e.msg));
  }
  return out;
}
