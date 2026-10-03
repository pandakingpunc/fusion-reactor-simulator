import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { METHOD_LABELS, ReactorConfig } from './physics/types';
import type { ScenarioSpec } from './physics/scenario';
import { LOCALES, LOCALE_NAMES, Locale, MessageKey } from './i18n';
import { createSimWorker, useSim } from './ui/useSim';
import { FrameScheduler, WorkerFactory, completedShotKey } from './ui/state/sim';
import { shotSetup, useApp, useAppStore, useT } from './ui/state/store';
import { useWizText } from './ui/wizard/wizText';
import { SavedShot, SimStatus, Tab } from './ui/state/types';
import { Wizard } from './ui/wizard/Wizard';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { lazyChunk } from './ui/lazyChunk';
import { fmtTime } from './ui/format';
import { RouterContext, useRoute, useRouting } from './ui/persist/routing';
import type { LearnLocation } from './ui/edu/LearnView';

// Setup is the first screen; the run screen (charts, cross-section, POPCON, 3D) and the others are separate chunks, prefetched after start-up.
const RunScreen = lazyChunk(() => import('./ui/run/RunScreen'), (m) => m.RunScreen);
/** fetch the run screen's chunk (tests await it, so that a run starts on a screen that renders synchronously) */
export const preloadRunScreen = RunScreen.preload;
const loadReport = () => import('./ui/report/Report');
const loadCompare = () => import('./ui/compare/Compare');
const loadValidation = () => import('./ui/pool/Validation');
const loadLearn = () => import('./ui/edu/LearnView');
const Report = lazy(() => loadReport().then((m) => ({ default: m.Report })));
const Compare = lazy(() => loadCompare().then((m) => ({ default: m.Compare })));
const Validation = lazy(() => loadValidation().then((m) => ({ default: m.Validation })));
// Sharing, the run archive and the embed views: one chunk each, loaded after start-up or when their route is opened.
const PersistHost = lazy(() => import('./ui/persist/PersistHost'));
const EmbedView = lazy(() => import('./ui/persist/EmbedView'));
const ShotBanner = lazy(() => import('./ui/persist/ShotBanner'));
const Learn = lazy(() => loadLearn().then((m) => ({ default: m.LearnView })));
// The wizard's Scenario step (the editor) and its one-line summary: one chunk, loaded when the step is opened.
const ScenarioStep = lazy(() => import('./ui/scenario/ScenarioStep'));
const ScenarioSummary = lazy(() => import('./ui/scenario/ScenarioSummary'));

const TABS: { id: Tab; label: MessageKey }[] = [
  { id: 'setup', label: 'app.tab.setup' },
  { id: 'run', label: 'app.tab.run' },
  { id: 'report', label: 'app.tab.report' },
  { id: 'compare', label: 'app.tab.compare' },
  { id: 'validate', label: 'app.tab.validate' },
  { id: 'learn', label: 'app.tab.learn' },
];

const STATUS_LABEL: Record<SimStatus, MessageKey> = {
  idle: 'app.st.idle', loading: 'app.st.loading', ready: 'app.st.ready', running: 'app.st.running',
  paused: 'app.st.paused', done: 'app.st.done', error: 'app.st.error',
};

interface Props {
  /** simulation worker factory (tests inject a fake worker) */
  createWorker?: WorkerFactory;
  /** when incoming worker messages are applied (default: once per animation frame) */
  schedule?: FrameScheduler;
}

export default function App({ createWorker, schedule }: Props) {
  const t = useT();
  const wt = useWizText();
  const store = useAppStore();
  const { actions } = store;
  const sim = useSim(createWorker, schedule);
  const tab = useApp((s) => s.tab);
  const cfg = useApp((s) => s.cfg);
  const cfgName = useApp((s) => s.cfgName);
  const scenario = useApp((s) => s.scenario);
  const shots = useApp((s) => s.shots);
  const locale = useApp((s) => s.locale);
  const viewId = useApp((s) => s.viewId);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const { state } = sim;

  // #/wizard, #/run, ... follow the tab; a tab that cannot be shown yet (Run before a run, Report before a result) is not entered
  const canEnter = (tb: Tab) => !((tb === 'run' && state.status === 'idle') || (tb === 'report' && !shots.length && !state.report));
  const router = useRouting(store, canEnter);
  const route = useRoute(router);
  // the Learn tab lives in the address (#/learn/missions/<id>, #/learn/glossary/<term>): the route is where it is, and moving writes it back
  const learnAt = useMemo<LearnLocation | undefined>(
    () => (route.name === 'learn' ? { section: route.section ?? 'missions', id: route.id } : undefined),
    [route]);
  const learnGo = useCallback((to: LearnLocation, opts?: { replace?: boolean }) => router.navigate({ name: 'learn', section: to.section, id: to.id }, opts), [router]);

  // Canlı atış bitince arşive ekle (rapor + karşılaştırma). The key includes the timeline branch,
  // so a run that is rewound and completed again is archived as a new shot, and each branch only once.
  const doneKey = completedShotKey(state);
  useEffect(() => {
    if (!doneKey || !state.cfg || !state.meta || !state.report) return;
    actions.archiveShot(doneKey, { cfg: state.cfg, meta: state.meta, report: state.report, frames: state.frames, events: state.events, prov: state.provenance ?? { interventions: state.interventions } });
  }, [doneKey]); // state is read at the moment the key appears; archiveShot ignores repeats

  useEffect(() => {
    const run = setTimeout(() => { void RunScreen.preload(); }, 200); // most visits start a run: fetch its screen first
    const id = setTimeout(() => { void loadReport(); void loadCompare(); void loadValidation(); }, 1500); // the Learn chunk is loaded when its tab is opened
    return () => { clearTimeout(run); clearTimeout(id); };
  }, []);

  // the scenario of the wizard drives the run, unless the caller names one (a re-run of the run on screen uses its own)
  const run = useCallback((c: ReactorConfig, sc?: ScenarioSpec | null) => {
    const scen = sc === undefined ? store.getState().scenario : sc;
    actions.setCfg(c);
    actions.setScenario(scen);
    sim.load(c, true, scen);
    actions.setTab('run');
  }, [sim.load, actions, store]);

  const latest = shots.length ? shots[shots.length - 1] : null;
  // the shot the user opened (archive, file), else the live run, else the latest
  const opened = viewId !== null ? shots.find((x) => x.id === viewId) ?? null : null;
  const liveShot: SavedShot | null = state.report && state.meta && state.cfg
    ? { id: -1, name: cfgName, cfg: state.cfg, meta: state.meta, report: state.report, frames: state.frames, events: state.events, prov: state.provenance ?? { interventions: state.interventions } } : null;
  const reportShot = opened ?? liveShot ?? latest;
  // Run again and Edit act on the shot the Report shows: the live run as it was loaded, any other shot (opened from the archive or a file,
  // or the latest while another run is loading) with its own configuration, name and scenario
  const shownShot = reportShot !== liveShot ? reportShot : null;

  const pill = useMemo(() => {
    const s = state.status;
    const cls = s === 'running' ? 'running' : s === 'done' ? 'done' : s === 'error' ? 'error' : '';
    const time = state.meta ? ` · t = ${fmtTime(state.t, state.meta.timeUnit)}` : '';
    return <span className={`status-pill ${cls}`}>{t(STATUS_LABEL[s], { speed: state.speed })}{time}</span>;
  }, [state.status, state.speed, state.t, state.meta, t]);

  // a chrome-less view for an <iframe>: no top bar, no archive
  if (route.name === 'embed') {
    return (
      <RouterContext.Provider value={router}>
        <div className="app embed"><main className="main"><Suspense fallback={<div className="panel muted">{t('app.st.loading')}</div>}><EmbedView route={route} sim={sim} /></Suspense></main></div>
      </RouterContext.Provider>
    );
  }

  return (
    <RouterContext.Provider value={router}>
    <div className="app">
      <header className="topbar">
        <h1 className="brand"><span className="dot" aria-hidden="true" />{t('app.brand')}</h1>
        <nav className="tabs" aria-label={t('app.nav')}>
          {TABS.map((tb) => (
            <button key={tb.id} type="button" className={`tab ${tab === tb.id ? 'active' : ''}`} aria-current={tab === tb.id ? 'page' : undefined} onClick={() => actions.setTab(tb.id)}
              disabled={(tb.id === 'run' && state.status === 'idle') || (tb.id === 'report' && !latest && !state.report)}>
              {t(tb.label)}{tb.id === 'compare' && shots.length ? ` (${shots.length})` : ''}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <span ref={setSlot} />
        <span className="muted small">{wt(METHOD_LABELS[(state.cfg ?? cfg).method])} · {cfgName}</span>
        {pill}
        <select value={locale} onChange={(e) => void actions.setLocale(e.target.value as Locale)} title={t('app.lang')} aria-label={t('app.lang')}
          style={{ width: 'auto', padding: '3px 6px' }}>
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
        </select>
      </header>
      <main className="main">
        <Suspense fallback={null}><PersistHost slot={slot} router={router} route={route} createWorker={sim.createWorker} exactRun={state.status === 'done' && state.cfg && state.provenance ? { cfg: state.cfg, provenance: state.provenance } : null} /></Suspense>
        {/* a drawing error (or a failed chunk load) replaces the screen, not the app with its shot archive */}
        <ErrorBoundary resetKeys={[tab, state.runId, state.branchId]}>
        <Suspense fallback={<div className="panel muted">{t('app.st.loading')}</div>}>
        {tab === 'setup' && (
          <Wizard cfg={cfg} setCfg={actions.setCfg} name={cfgName} setName={actions.setCfgName} onRun={run}
            scenarioStep={<Suspense fallback={null}><ScenarioStep createWorker={sim.createWorker} /></Suspense>}
            scenarioSummary={scenario ? <Suspense fallback={null}><ScenarioSummary /></Suspense> : undefined} />
        )}
        {tab === 'run' && <RunScreen sim={sim} onReport={() => actions.setTab('report')} onSetup={() => actions.setTab('setup')} />}
        {tab === 'report' && opened && <ShotBanner shot={opened} />}
        {tab === 'report' && (
          <Report
            shot={reportShot}
            onRerun={() => {
              if (!shownShot) return run(state.cfg ?? cfg, state.cfg ? state.scenario : undefined);
              const s = shotSetup(shownShot);
              actions.setCfgName(s.cfgName);
              run(s.cfg, s.scenario);
            }}
            onEdit={() => {
              if (shownShot) return actions.editShot(shownShot);
              actions.setCfg(state.cfg ?? cfg);
              actions.setTab('setup');
            }}
          />
        )}
        {tab === 'compare' && <Compare shots={shots} onRemove={actions.removeShot} onLoad={actions.editShot} />}
        {tab === 'validate' && <Validation createWorker={createWorker ?? createSimWorker} />}
        {tab === 'learn' && <Learn createWorker={createWorker ?? createSimWorker} location={learnAt} onNavigate={learnGo} />}
        </Suspense>
        </ErrorBoundary>
      </main>
    </div>
    </RouterContext.Provider>
  );
}
