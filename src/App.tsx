import React, { Suspense, lazy, useCallback, useEffect, useMemo } from 'react';
import { METHOD_LABELS, ReactorConfig } from './physics/types';
import { LOCALES, LOCALE_NAMES, Locale, MessageKey } from './i18n';
import { useSim } from './ui/useSim';
import { FrameScheduler, WorkerFactory, completedShotKey } from './ui/state/sim';
import { useApp, useAppStore, useT } from './ui/state/store';
import { SimStatus, Tab } from './ui/state/types';
import { Wizard } from './ui/wizard/Wizard';
import { RunScreen } from './ui/run/RunScreen';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { fmtTime } from './ui/format';

// Setup and Run are the first screens; the others are separate chunks, prefetched after start-up.
const loadReport = () => import('./ui/report/Report');
const loadCompare = () => import('./ui/report/Compare');
const loadValidation = () => import('./ui/report/Validation');
const Report = lazy(() => loadReport().then((m) => ({ default: m.Report })));
const Compare = lazy(() => loadCompare().then((m) => ({ default: m.Compare })));
const Validation = lazy(() => loadValidation().then((m) => ({ default: m.Validation })));

const TABS: { id: Tab; label: MessageKey }[] = [
  { id: 'setup', label: 'app.tab.setup' },
  { id: 'run', label: 'app.tab.run' },
  { id: 'report', label: 'app.tab.report' },
  { id: 'compare', label: 'app.tab.compare' },
  { id: 'validate', label: 'app.tab.validate' },
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
  const { actions } = useAppStore();
  const sim = useSim(createWorker, schedule);
  const tab = useApp((s) => s.tab);
  const cfg = useApp((s) => s.cfg);
  const cfgName = useApp((s) => s.cfgName);
  const shots = useApp((s) => s.shots);
  const locale = useApp((s) => s.locale);

  const { state } = sim;

  // Canlı atış bitince arşive ekle (rapor + karşılaştırma). The key includes the timeline branch,
  // so a run that is rewound and completed again is archived as a new shot, and each branch only once.
  const doneKey = completedShotKey(state);
  useEffect(() => {
    if (!doneKey || !state.cfg || !state.meta || !state.report) return;
    actions.archiveShot(doneKey, { cfg: state.cfg, meta: state.meta, report: state.report, frames: state.frames, events: state.events });
  }, [doneKey]); // state is read at the moment the key appears; archiveShot ignores repeats

  useEffect(() => {
    const id = setTimeout(() => { void loadReport(); void loadCompare(); void loadValidation(); }, 1500);
    return () => clearTimeout(id);
  }, []);

  const run = useCallback((c: ReactorConfig) => {
    actions.setCfg(c);
    sim.load(c, true);
    actions.setTab('run');
  }, [sim.load, actions]);

  const latest = shots.length ? shots[shots.length - 1] : null;

  const pill = useMemo(() => {
    const s = state.status;
    const cls = s === 'running' ? 'running' : s === 'done' ? 'done' : s === 'error' ? 'error' : '';
    const time = state.meta ? ` · t = ${fmtTime(state.t, state.meta.timeUnit)}` : '';
    return <span className={`status-pill ${cls}`}>{t(STATUS_LABEL[s], { speed: state.speed })}{time}</span>;
  }, [state.status, state.speed, state.t, state.meta, t]);

  return (
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
        <span className="muted small">{state.cfg ? METHOD_LABELS[state.cfg.method] : METHOD_LABELS[cfg.method]} · {cfgName}</span>
        {pill}
        <select value={locale} onChange={(e) => void actions.setLocale(e.target.value as Locale)} title={t('app.lang')} aria-label={t('app.lang')}
          style={{ width: 'auto', padding: '3px 6px' }}>
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
        </select>
      </header>
      <main className="main">
        {/* a drawing error (or a failed chunk load) replaces the screen, not the app with its shot archive */}
        <ErrorBoundary resetKeys={[tab, state.runId, state.branchId]}>
        <Suspense fallback={<div className="panel muted">{t('app.st.loading')}</div>}>
        {tab === 'setup' && <Wizard cfg={cfg} setCfg={actions.setCfg} name={cfgName} setName={actions.setCfgName} onRun={run} />}
        {tab === 'run' && <RunScreen sim={sim} onReport={() => actions.setTab('report')} onSetup={() => actions.setTab('setup')} />}
        {tab === 'report' && (
          <Report
            shot={state.report && state.meta && state.cfg ? { id: -1, name: cfgName, cfg: state.cfg, meta: state.meta, report: state.report, frames: state.frames, events: state.events } : latest}
            onRerun={() => run(state.cfg ?? cfg)}
            onEdit={() => { actions.setCfg(state.cfg ?? cfg); actions.setTab('setup'); }}
          />
        )}
        {tab === 'compare' && <Compare shots={shots} onRemove={actions.removeShot} onLoad={actions.editShot} />}
        {tab === 'validate' && <Validation runAll={sim.runAll} />}
        </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
