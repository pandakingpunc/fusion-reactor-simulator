import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { METHOD_LABELS, ReactorConfig } from './physics/types';
import { LOCALES, LOCALE_NAMES, Locale, MessageKey } from './i18n';
import { createSimWorker, useSim } from './ui/useSim';
import { FrameScheduler, WorkerFactory, completedShotKey } from './ui/state/sim';
import { useApp, useAppStore, useT } from './ui/state/store';
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
  const store = useAppStore();
  const { actions } = store;
  const sim = useSim(createWorker, schedule);
  const tab = useApp((s) => s.tab);
  const cfg = useApp((s) => s.cfg);
  const cfgName = useApp((s) => s.cfgName);
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
    actions.archiveShot(doneKey, { cfg: state.cfg, meta: state.meta, report: state.report, frames: state.frames, events: state.events, prov: { interventions: state.interventions } });
  }, [doneKey]); // state is read at the moment the key appears; archiveShot ignores repeats

  useEffect(() => {
    const run = setTimeout(() => { void RunScreen.preload(); }, 200); // most visits start a run: fetch its screen first
    const id = setTimeout(() => { void loadReport(); void loadCompare(); void loadValidation(); }, 1500); // the Learn chunk is loaded when its tab is opened
    return () => { clearTimeout(run); clearTimeout(id); };
  }, []);

  const run = useCallback((c: ReactorConfig) => {
    actions.setCfg(c);
    sim.load(c, true);
    actions.setTab('run');
  }, [sim.load, actions]);

  const latest = shots.length ? shots[shots.length - 1] : null;
  // the shot the user opened (archive, file), else the live run, else the latest
  const opened = viewId !== null ? shots.find((x) => x.id === viewId) ?? null : null;
  const liveShot: SavedShot | null = state.report && state.meta && state.cfg
    ? { id: -1, name: cfgName, cfg: state.cfg, meta: state.meta, report: state.report, frames: state.frames, events: state.events, prov: { interventions: state.interventions } } : null;
  const reportShot = opened ?? liveShot ?? latest;

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
        <div className="brand"><span className="dot" />{t('app.brand')}</div>
        <nav className="tabs">
          {TABS.map((tb) => (
            <button key={tb.id} className={`tab ${tab === tb.id ? 'active' : ''}`} onClick={() => actions.setTab(tb.id)}
              disabled={(tb.id === 'run' && state.status === 'idle') || (tb.id === 'report' && !latest && !state.report)}>
              {t(tb.label)}{tb.id === 'compare' && shots.length ? ` (${shots.length})` : ''}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <span ref={setSlot} />
        <span className="muted small">{state.cfg ? METHOD_LABELS[state.cfg.method] : METHOD_LABELS[cfg.method]} · {cfgName}</span>
        {pill}
        <select value={locale} onChange={(e) => void actions.setLocale(e.target.value as Locale)} title={t('app.lang')} aria-label={t('app.lang')}
          style={{ width: 'auto', padding: '3px 6px' }}>
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
        </select>
      </header>
      <main className="main">
        <Suspense fallback={null}><PersistHost slot={slot} router={router} route={route} /></Suspense>
        {/* a drawing error (or a failed chunk load) replaces the screen, not the app with its shot archive */}
        <ErrorBoundary resetKeys={[tab, state.runId, state.branchId]}>
        <Suspense fallback={<div className="panel muted">{t('app.st.loading')}</div>}>
        {tab === 'setup' && <Wizard cfg={cfg} setCfg={actions.setCfg} name={cfgName} setName={actions.setCfgName} onRun={run} />}
        {tab === 'run' && <RunScreen sim={sim} onReport={() => actions.setTab('report')} onSetup={() => actions.setTab('setup')} />}
        {tab === 'report' && opened && <ShotBanner shot={opened} />}
        {tab === 'report' && (
          <Report
            shot={reportShot}
            onRerun={() => run(state.cfg ?? cfg)}
            onEdit={() => { actions.setCfg(state.cfg ?? cfg); actions.setTab('setup'); }}
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
