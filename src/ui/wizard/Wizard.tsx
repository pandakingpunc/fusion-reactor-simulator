import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Method, ReactorConfig } from '../../physics/types';
import type { Preset, ValidationStatus } from '../../physics/presets';
import { Field } from './Field';
import type { AdvancedStep, CrossIssue } from './schema';
import { ADVANCED_STEPS, METHOD_DEFAULT, METHOD_INFO, PRESETS, STEP_IDS, STEP_TITLES, StepId, advancedApplies, advancedOverrides, crossFieldIssues, fieldLabel, fieldVisible, getPath, missingRequired, setPath, stepsFor } from './schema';
import { useWizText } from './wizText';
import { fmtNum } from '../format';
import { useT } from '../state/store';

// The Advanced section (systems pulse length, edge model options, 1.5D solver settings) is a chunk of its own, fetched when the section is opened
const loadAdvanced = () => import('./AdvancedFields');
const AdvancedFields = lazy(loadAdvanced);
const AdvancedSummary = lazy(() => loadAdvanced().then((m) => ({ default: m.AdvancedSummary })));
const isAdvancedStep = (id: string): id is AdvancedStep => (ADVANCED_STEPS as readonly string[]).includes(id);

interface Props {
  cfg: ReactorConfig;
  setCfg: (c: ReactorConfig) => void;
  name: string;
  setName: (n: string) => void;
  onRun: (cfg: ReactorConfig) => void;
  /** the body of the Scenario step (a lazily loaded editor, see App) and its one-line summary for the last step */
  scenarioStep?: React.ReactNode;
  scenarioSummary?: React.ReactNode;
}

const METHODS = Object.keys(METHOD_INFO) as Method[];

/** the "modified" suffix of either language, stripped before the current one is appended */
const MODIFIED_SUFFIX = / \((modified|değiştirildi)\)$/;

export function Wizard({ cfg, setCfg, name, setName, onRun, scenarioStep, scenarioSummary }: Props) {
  const t = useT();
  const wt = useWizText();
  const [stepIdx, setStepIdx] = useState(0);
  // which steps have their Advanced section open (kept while the wizard is on the page)
  const [advOpen, setAdvOpen] = useState<Readonly<Record<string, boolean>>>({});
  const stepId = STEP_IDS[stepIdx];
  const steps = useMemo(() => stepsFor(cfg.method), [cfg.method]);
  const activePreset = PRESETS.find((p) => p.cfg === cfg)?.id;
  // required fields left blank: the model has no default for them, so RUN stays blocked
  const missing = useMemo(() => missingRequired(cfg), [cfg]);
  // values that are legal one by one but not together (a ≥ R): the run is blocked as well
  const issues = useMemo(() => crossFieldIssues(cfg), [cfg]);
  const blocked = missing.length > 0 ? t('wiz.missingBlocked', { fields: missing.map((m) => fieldLabel(m.field, t, wt)).join(', ') })
    : issues.length > 0 ? t('wiz.crossBlocked', { issues: issues.map((i) => t(i.key, i.params)).join(' ') })
    : undefined;
  // a step change moves the focus to the title of the new step (the keyboard and the screen reader land where the page changed); not on the first draw
  const body = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const h = body.current?.querySelector<HTMLElement>('h2');
    if (!h) return;
    h.tabIndex = -1;
    h.focus();
  }, [stepIdx]);
  const goToStep = (id: string) => { const i = STEP_IDS.indexOf(id as StepId); if (i >= 0) setStepIdx(i); };

  const pickMethod = (m: Method) => {
    if (m === cfg.method) return;
    const base = METHOD_DEFAULT[m];
    const preset = PRESETS.find((p) => p.cfg === base);
    setCfg(base);
    setName(wt(preset ? preset.name : METHOD_INFO[m].name));
  };
  const pickPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setCfg(p.cfg);
    setName(wt(p.name));
  };
  const update = (path: string, v: unknown) => {
    setCfg(setPath(cfg, path, v));
    if (activePreset) setName(`${name.replace(MODIFIED_SUFFIX, '')} ${t('wiz.modified')}`);
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
          <h2>1 · {t('wiz.methodTitle')}</h2>
          <p className="muted small">{t('wiz.methodNote')}</p>
          {groups.map(([grp, ms]) => (
            <div key={grp} style={{ marginBottom: 12 }}>
              <h3>{wt(grp)}</h3>
              <div className="method-grid">
                {ms.map((m) => (
                  <button type="button" key={m} className={`method-card ${cfg.method === m ? 'active' : ''}`} aria-pressed={cfg.method === m} onClick={() => pickMethod(m)}>
                    <span className="name">{wt(METHOD_INFO[m].name)}</span>
                    <span className="desc">{wt(METHOD_INFO[m].desc)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      );
    }
    if (id === 'scenario') return <><h2>{stepIdx + 1} · {wt(STEP_TITLES.scenario)}</h2>{scenarioStep}</>;
    if (id === 'run') return <RunSummary cfg={cfg} name={name} onRun={onRun} missing={missing} issues={issues} blocked={blocked} goToStep={goToStep} scenarioSummary={scenarioSummary} />;
    const advanced = isAdvancedStep(id) && advancedApplies(id, cfg.method, cfg) ? id : null;
    const def = steps.find((s) => s.id === id);
    if (!def) return <p className="muted">{t('wiz.noSettingsMethod')}</p>;
    const fields = def.fields.filter((f) => fieldVisible(cfg.method, f.path, cfg));
    return (
      <>
        <h2>{stepIdx + 1} · {wt(def.title)}</h2>
        {def.note && <p className="muted small">{wt(def.note)}</p>}
        <CrossIssues issues={issues.filter((i) => i.step === id)} />
        {fields.length === 0 && !def.note && <p className="muted">{t('wiz.noSettings')}</p>}
        <div className="fields">
          {fields.map((f) => <Field key={f.path} def={f} value={getPath(cfg, f.path) ?? f.def} onChange={(v) => update(f.path, v)} />)}
        </div>
        {advanced && (
          <details className="advanced" open={!!advOpen[advanced]} style={{ marginTop: 14 }}>
            <summary style={{ cursor: 'pointer' }} onClick={(e) => { e.preventDefault(); setAdvOpen((o) => ({ ...o, [advanced]: !o[advanced] })); }}
              onPointerEnter={() => { void loadAdvanced(); }} onFocus={() => { void loadAdvanced(); }}><b>{t('wiz.advanced')}</b></summary>
            {advOpen[advanced] && (
              <>
                <p className="muted small">{t('wiz.advancedHint')}</p>
                <Suspense fallback={<div className="muted small">{t('wiz.advancedLoading')}</div>}><AdvancedFields step={advanced} cfg={cfg} update={update} /></Suspense>
              </>
            )}
          </details>
        )}
      </>
    );
  };

  return (
    <div className="wizard">
      <aside className="panel">
        <h3>{t('wiz.steps')}</h3>
        <div className="steps">
          {STEP_IDS.map((id, i) => {
            const empty = missing.filter((m) => m.step.id === id);
            const inconsistent = issues.filter((i) => i.step === id);
            const why = empty.length > 0 ? t('wiz.missingBlocked', { fields: empty.map((m) => fieldLabel(m.field, t, wt)).join(', ') })
              : inconsistent.length > 0 ? t('wiz.crossBlocked', { issues: inconsistent.map((i) => t(i.key, i.params)).join(' ') }) : undefined;
            return (
              <button type="button" key={id} className={`step ${i === stepIdx ? 'active' : ''} ${i < stepIdx ? 'done' : ''}`} aria-current={i === stepIdx ? 'step' : undefined} onClick={() => setStepIdx(i)}>
                <span className="idx">{i + 1}</span><span>{wt(STEP_TITLES[id])}</span>
                {why && <span className="badge warn" role="img" aria-label={why} title={why}>!</span>}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 14 }}>
          <label className="field">
            <span className="lbl"><span>{t('wiz.cfgName')}</span></span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <button className="btn sm" disabled={stepIdx === 0} onClick={() => setStepIdx(stepIdx - 1)}>{t('wiz.back')}</button>
          {stepIdx < STEP_IDS.length - 1
            ? <button className="btn sm" onClick={() => setStepIdx(stepIdx + 1)}>{t('wiz.next')}</button>
            : <button className="btn sm primary" disabled={!!blocked} title={blocked} onClick={() => onRun(cfg)}>{t('wiz.run')}</button>}
        </div>
      </aside>
      <section className="panel" style={{ overflow: 'auto' }} ref={body}>{renderStep(stepId)}</section>
      <aside className="panel" style={{ overflow: 'auto' }}>
        <div className="panel-title"><h3>{t('wiz.presets')}</h3><span className="muted small">{t('wiz.devices', { n: PRESETS.length })}</span></div>
        <div className="preset-list">
          {PRESETS.map((p) => (
            <div key={p.id} className={`preset ${activePreset === p.id ? 'active' : ''}`}>
              <button type="button" className="preset-pick" aria-pressed={activePreset === p.id} onClick={() => pickPreset(p.id)}>
                <span className="name">{wt(p.name)}</span>
                <span className="muted small">{wt(METHOD_INFO[p.cfg.method].name)}</span>
                <span className="desc">{wt(p.desc)}</span>
                {p.validation && <PresetValidation preset={p} text={wt(p.validation)} />}
              </button>
              <button type="button" className="btn sm primary preset-run" title={t('wiz.runPreset')} aria-label={`${t('wiz.runPreset')}: ${wt(p.name)}`}
                onClick={() => { pickPreset(p.id); onRun(p.cfg); }}>▶</button>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

/** glyph of each validation status; the tick is for a plain pass only (the label says the rest in words, for the screen reader and the tooltip) */
export const VALIDATION_GLYPH: Record<ValidationStatus, string> = { ok: '✓', benchmarked: '≈', calibration: '◎', miss: '✗' };

/** The validation line of a preset card, with the glyph and the accessible label of its status (npm run validate is the source of the status). */
function PresetValidation({ preset, text }: { preset: Preset; text: string }) {
  const t = useT();
  const status = preset.validationStatus ?? 'ok';
  const label = t(`wiz.val.${status}`);
  return (
    <span className={`val ${status}`}>
      <span role="img" aria-label={label} title={label}>{VALIDATION_GLYPH[status]}</span> {text}
    </span>
  );
}

/** Inconsistent value combinations, with a link to the step that holds them when shown on the run summary. */
function CrossIssues({ issues, goToStep }: { issues: CrossIssue[]; goToStep?: (id: string) => void }) {
  const t = useT();
  if (issues.length === 0) return null;
  return (
    <div className="diag-box" role="alert" style={{ margin: '8px 0' }}>
      <b className="warn">{t('wiz.crossTitle')}</b> <span className="small muted">{t('wiz.crossHint')}</span>
      <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {issues.map((i) => (
          <li key={i.key}>
            {goToStep ? <a href="#" onClick={(e) => { e.preventDefault(); goToStep(i.step); }}>{t(i.key, i.params)}</a> : t(i.key, i.params)}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface RunSummaryProps {
  cfg: ReactorConfig;
  name: string;
  onRun: (c: ReactorConfig) => void;
  /** required fields left blank (RUN is blocked while there are any) */
  missing: ReturnType<typeof missingRequired>;
  /** inconsistent combinations of values (RUN is blocked while there are any) */
  issues: CrossIssue[];
  /** why RUN is disabled (undefined when it is not) */
  blocked: string | undefined;
  goToStep: (id: string) => void;
  scenarioSummary?: React.ReactNode;
}

/** Son adım: özet + ÇALIŞTIR */
function RunSummary({ cfg, name, onRun, missing, issues, blocked, goToStep, scenarioSummary }: RunSummaryProps) {
  const t = useT();
  const wt = useWizText();
  const steps = stepsFor(cfg.method);
  return (
    <>
      <h2>{STEP_IDS.length} · {t('wiz.runTitle')}</h2>
      <p className="muted small">
        <b>{name}</b> — {wt(METHOD_INFO[cfg.method].name)}. {t('wiz.runIntro')}
      </p>
      {missing.length > 0 && (
        <div className="diag-box" role="alert" style={{ margin: '8px 0' }}>
          <b className="warn">{t('wiz.missingTitle')}</b> <span className="small muted">{t('wiz.missingHint')}</span>
          <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {missing.map(({ step, field }) => (
              <li key={field.path}>
                <a href="#" onClick={(e) => { e.preventDefault(); goToStep(step.id); }}>{fieldLabel(field, t, wt)}</a>
                <span className="muted"> · {wt(step.title)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <CrossIssues issues={issues} goToStep={goToStep} />
      {scenarioSummary}
      <button className="btn primary" style={{ fontSize: 15, padding: '10px 26px', margin: '8px 0 16px' }} disabled={!!blocked} title={blocked}
        onClick={() => onRun(cfg)}>{t('wiz.start')}</button>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {steps.map((s) => {
          const fields = s.fields.filter((f) => fieldVisible(cfg.method, f.path, cfg));
          if (!fields.length) return null;
          return (
            <div key={s.id} className="panel tight" style={{ background: 'var(--bg2)' }}>
              <h3>{wt(s.title)}</h3>
              <table className="kv">
                <tbody>
                  {fields.map((f) => {
                    const v = getPath(cfg, f.path) ?? f.def;
                    const shown = typeof v === 'number' ? fmtNum(v / (f.scale ?? 1)) : typeof v === 'boolean' ? (v ? t('field.on') : t('field.off')) : v === undefined || v === '' ? '—' : wt(f.options?.find((o) => o.value === v)?.label ?? String(v));
                    return <tr key={f.path}><td>{fieldLabel(f, t, wt)}</td><td className="num">{shown} <span className="muted small">{f.unit ? wt(f.unit) : ''}</span></td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      {advancedOverrides(cfg).length > 0 && <Suspense fallback={null}><AdvancedSummary cfg={cfg} /></Suspense>}
    </>
  );
}
