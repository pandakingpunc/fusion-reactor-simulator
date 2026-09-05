import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { HistoryFrame, METHOD_LABELS, ReactorConfig, ShotReport, SimEvent } from './physics/types';
import { ITER } from './physics/presets';
import { SimMeta } from './worker/protocol';
import { useSim } from './ui/useSim';
import { Wizard } from './ui/wizard/Wizard';
import { RunScreen } from './ui/run/RunScreen';
import { Report } from './ui/report/Report';
import { Compare } from './ui/report/Compare';
import { Validation } from './ui/report/Validation';
import { fmtTime } from './ui/format';

export type Tab = 'setup' | 'run' | 'report' | 'compare' | 'validate';

/** Rapor ekranı + karşılaştırma için saklanan tamamlanmış atış */
export interface SavedShot {
  id: number;
  name: string;
  cfg: ReactorConfig;
  meta: SimMeta;
  report: ShotReport;
  frames: HistoryFrame[];
  events: SimEvent[];
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'setup', label: 'Setup' },
  { id: 'run', label: 'Run' },
  { id: 'report', label: 'Report' },
  { id: 'compare', label: 'Compare' },
  { id: 'validate', label: 'Validation' },
];

export default function App() {
  const sim = useSim();
  const [tab, setTab] = useState<Tab>('setup');
  const [cfg, setCfg] = useState<ReactorConfig>(ITER);
  const [cfgName, setCfgName] = useState('ITER');
  const [shots, setShots] = useState<SavedShot[]>([]);
  const [savedRunId, setSavedRunId] = useState(-1);

  const { state } = sim;

  // Canlı atış bitince otomatik olarak arşive ekle (rapor + karşılaştırma)
  useEffect(() => {
    if (state.status === 'done' && state.report && state.meta && state.cfg && state.runId !== savedRunId) {
      setSavedRunId(state.runId);
      setShots((list) => [
        ...list,
        { id: Date.now(), name: `${cfgName} #${list.length + 1}`, cfg: state.cfg!, meta: state.meta!, report: state.report!, frames: state.frames, events: state.events },
      ]);
    }
  }, [state.status, state.report, state.meta, state.cfg, state.runId, state.frames, state.events, savedRunId, cfgName]);

  const run = useCallback((c: ReactorConfig) => {
    setCfg(c);
    sim.load(c, true);
    setTab('run');
  }, [sim]);

  const latest = shots.length ? shots[shots.length - 1] : null;

  const pill = useMemo(() => {
    const s = state.status;
    const cls = s === 'running' ? 'running' : s === 'done' ? 'done' : s === 'error' ? 'error' : '';
    const label = s === 'idle' ? 'Not ready' : s === 'loading' ? 'Loading…' : s === 'ready' ? 'Ready' : s === 'running' ? `Running · ${state.speed}×` : s === 'paused' ? 'Paused' : s === 'done' ? 'Completed' : 'ERROR';
    const t = state.meta ? ` · t = ${fmtTime(state.t, state.meta.timeUnit)}` : '';
    return <span className={`status-pill ${cls}`}>{label}{t}</span>;
  }, [state.status, state.speed, state.t, state.meta]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="dot" />FUSION REACTOR SIMULATOR</div>
        <nav className="tabs">
          {TABS.map((tb) => (
            <button key={tb.id} className={`tab ${tab === tb.id ? 'active' : ''}`} onClick={() => setTab(tb.id)}
              disabled={(tb.id === 'run' && state.status === 'idle') || (tb.id === 'report' && !latest && !state.report)}>
              {tb.label}{tb.id === 'compare' && shots.length ? ` (${shots.length})` : ''}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <span className="muted small">{state.cfg ? METHOD_LABELS[state.cfg.method] : METHOD_LABELS[cfg.method]} · {cfgName}</span>
        {pill}
      </header>
      <main className="main">
        {tab === 'setup' && <Wizard cfg={cfg} setCfg={setCfg} name={cfgName} setName={setCfgName} onRun={run} />}
        {tab === 'run' && <RunScreen sim={sim} onReport={() => setTab('report')} onSetup={() => setTab('setup')} />}
        {tab === 'report' && (
          <Report
            shot={state.report && state.meta && state.cfg ? { id: -1, name: cfgName, cfg: state.cfg, meta: state.meta, report: state.report, frames: state.frames, events: state.events } : latest}
            onRerun={() => run(state.cfg ?? cfg)}
            onEdit={() => { setCfg(state.cfg ?? cfg); setTab('setup'); }}
          />
        )}
        {tab === 'compare' && <Compare shots={shots} onRemove={(id) => setShots((l) => l.filter((s) => s.id !== id))} onLoad={(s) => { setCfg(s.cfg); setCfgName(s.name.replace(/ #\d+$/, '')); setTab('setup'); }} />}
        {tab === 'validate' && <Validation runAll={sim.runAll} />}
      </main>
    </div>
  );
}
