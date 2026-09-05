import React, { useMemo, useState } from 'react';
import { Method, ReactorConfig } from '../../physics/types';
import { Field } from './Field';
import { METHOD_DEFAULT, METHOD_INFO, PRESETS, STEP_IDS, STEP_TITLES, StepId, fieldVisible, getPath, setPath, stepsFor } from './schema';
import { fmtNum } from '../format';

interface Props {
  cfg: ReactorConfig;
  setCfg: (c: ReactorConfig) => void;
  name: string;
  setName: (n: string) => void;
  onRun: (cfg: ReactorConfig) => void;
}

const METHODS = Object.keys(METHOD_INFO) as Method[];

export function Wizard({ cfg, setCfg, name, setName, onRun }: Props) {
  const [stepIdx, setStepIdx] = useState(0);
  const stepId = STEP_IDS[stepIdx];
  const steps = useMemo(() => stepsFor(cfg.method), [cfg.method]);
  const activePreset = PRESETS.find((p) => p.cfg === cfg)?.id;

  const pickMethod = (m: Method) => {
    if (m === cfg.method) return;
    const base = METHOD_DEFAULT[m];
    const preset = PRESETS.find((p) => p.cfg === base);
    setCfg(base);
    setName(preset ? preset.name : METHOD_INFO[m].name);
  };
  const pickPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setCfg(p.cfg);
    setName(p.name);
  };
  const update = (path: string, v: unknown) => {
    setCfg(setPath(cfg, path, v));
    if (activePreset) setName(`${name.replace(/ \(değiştirildi\)$/, '')} (modified)`);
  };

  const groups = useMemo(() => {
    const g = new Map<string, Method[]>();
    for (const m of METHODS) { const k = METHOD_INFO[m].group; g.set(k, [...(g.get(k) ?? []), m]); }
    return [...g.entries()];
  }, []);

  const renderStep = (id: StepId) => {
    if (id === 'method') {
      return (
        <>
          <h2>1 · Confinement method</h2>
          <p className="muted small">Each method runs its own physics module. Changing the method loads its reference preset.</p>
          {groups.map(([grp, ms]) => (
            <div key={grp} style={{ marginBottom: 12 }}>
              <h3>{grp}</h3>
              <div className="method-grid">
                {ms.map((m) => (
                  <div key={m} className={`method-card ${cfg.method === m ? 'active' : ''}`} onClick={() => pickMethod(m)}>
                    <div className="name">{METHOD_INFO[m].name}</div>
                    <div className="desc">{METHOD_INFO[m].desc}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      );
    }
    if (id === 'run') return <RunSummary cfg={cfg} name={name} onRun={onRun} />;
    const def = steps.find((s) => s.id === id);
    if (!def) return <p className="muted">No settings for this method at this step.</p>;
    const fields = def.fields.filter((f) => fieldVisible(cfg.method, f.path));
    return (
      <>
        <h2>{stepIdx + 1} · {def.title}</h2>
        {def.note && <p className="muted small">{def.note}</p>}
        {fields.length === 0 && !def.note && <p className="muted">No settings at this step.</p>}
        <div className="fields">
          {fields.map((f) => <Field key={f.path} def={f} value={getPath(cfg, f.path)} onChange={(v) => update(f.path, v)} />)}
        </div>
      </>
    );
  };

  return (
    <div className="wizard">
      <aside className="panel">
        <h3>Setup steps</h3>
        <div className="steps">
          {STEP_IDS.map((id, i) => (
            <div key={id} className={`step ${i === stepIdx ? 'active' : ''} ${i < stepIdx ? 'done' : ''}`} onClick={() => setStepIdx(i)}>
              <span className="idx">{i + 1}</span><span>{STEP_TITLES[id]}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <label className="field">
            <span className="lbl"><span>Configuration name</span></span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <button className="btn sm" disabled={stepIdx === 0} onClick={() => setStepIdx(stepIdx - 1)}>◀ Back</button>
          {stepIdx < STEP_IDS.length - 1
            ? <button className="btn sm" onClick={() => setStepIdx(stepIdx + 1)}>Next ▶</button>
            : <button className="btn sm primary" onClick={() => onRun(cfg)}>RUN ▶</button>}
        </div>
      </aside>
      <section className="panel" style={{ overflow: 'auto' }}>{renderStep(stepId)}</section>
      <aside className="panel" style={{ overflow: 'auto' }}>
        <div className="panel-title"><h3>Presets</h3><span className="muted small">{PRESETS.length}  devices</span></div>
        <div className="preset-list">
          {PRESETS.map((p) => (
            <div key={p.id} className={`preset ${activePreset === p.id ? 'active' : ''}`} onClick={() => pickPreset(p.id)}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="name">{p.name}</span>
                <span className="row" style={{ gap: 6 }}>
                  <span className="muted small">{METHOD_INFO[p.cfg.method].name}</span>
                  <button className="btn sm primary" title="Run this preset directly"
                    onClick={(e) => { e.stopPropagation(); pickPreset(p.id); onRun(p.cfg); }}>▶</button>
                </span>
              </div>
              <div className="desc">{p.desc}</div>
              {p.validation && <div className="val">✓ {p.validation}</div>}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

/** Son adım: özet + ÇALIŞTIR */
function RunSummary({ cfg, name, onRun }: { cfg: ReactorConfig; name: string; onRun: (c: ReactorConfig) => void }) {
  const steps = stepsFor(cfg.method);
  return (
    <>
      <h2>6 · Run</h2>
      <p className="muted small">
        <b>{name}</b> — {METHOD_INFO[cfg.method].name}. The simulation runs in a web worker; live charts, cross-section, and POPCON update simultaneously.
        You can adjust heating/fueling/density sliders while it runs.
      </p>
      <button className="btn primary" style={{ fontSize: 15, padding: '10px 26px', margin: '8px 0 16px' }} onClick={() => onRun(cfg)}>▶ START SHOT</button>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {steps.map((s) => {
          const fields = s.fields.filter((f) => fieldVisible(cfg.method, f.path));
          if (!fields.length) return null;
          return (
            <div key={s.id} className="panel tight" style={{ background: 'var(--bg2)' }}>
              <h3>{s.title}</h3>
              <table className="kv">
                <tbody>
                  {fields.map((f) => {
                    const v = getPath(cfg, f.path);
                    const shown = typeof v === 'number' ? fmtNum(v / (f.scale ?? 1)) : typeof v === 'boolean' ? (v ? 'on' : 'off') : v === undefined || v === '' ? '—' : String(v);
                    return <tr key={f.path}><td>{f.label}</td><td className="num">{shown} <span className="muted small">{f.unit ?? ''}</span></td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </>
  );
}
