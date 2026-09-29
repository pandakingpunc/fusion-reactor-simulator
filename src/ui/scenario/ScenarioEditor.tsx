/**
 * The scenario editor: waveform lanes (one per control, draggable points), templates, triggers, the ramp step, the problems of the
 * scenario against the model, and its text form (JSON, load and save). It is a controlled component: the scenario lives in the
 * application state, every edit calls onChange with the new scenario (null when it is blank), and every operation is a pure
 * function of model.ts.
 *
 * `ctx` (the controls, diagnostics and end time of the model) is null while the model is being read; then nothing can be added and the
 * text form is checked for its structure only.
 */
import React, { useEffect, useState } from 'react';
import { ScenarioError } from '../../physics/kernel/errors';
import type { ScenarioSpec, WaveformKind } from '../../physics/scenario';
import { fmtNum } from '../format';
import './scenario.css';
import { NumberBox } from './NumberBox';
import { TemplatePanel } from './TemplatePanel';
import { TriggerEditor } from './TriggerEditor';
import { WaveformLane } from './WaveformLane';
import {
  addLane, addTrigger, applyTemplate, controlInfo, emptyScenario, fromText, insertPoint, isBlank, issuesAt, laneKeys, minRampStep, movePoint, problems, removeLane, removePoint,
  removeTrigger, setKind, setName, setRampStep, suggestRampStep, toText, updateTrigger, type EditorContext,
} from './model';
import { useScenarioT } from './useScenarioT';

interface Props {
  scenario: ScenarioSpec | null;
  ctx: EditorContext | null;
  onChange(s: ScenarioSpec | null): void;
  /** the model could not be read (its error): shown in place of the editor's lanes */
  modelError?: string;
  /** the text form's contact with the outside: copy to the clipboard, offer a file (tests replace them) */
  copy?(text: string): Promise<void>;
  download?(name: string, text: string): void;
}

const defaultCopy = async (text: string): Promise<void> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('no clipboard');
  await navigator.clipboard.writeText(text);
};
const defaultDownload = (name: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
};

export default function ScenarioEditor({ scenario, ctx, onChange, modelError, copy = defaultCopy, download = defaultDownload }: Props) {
  const t = useScenarioT();
  const spec = scenario ?? emptyScenario();
  const commit = (next: ScenarioSpec) => onChange(isBlank(next) && !next.name && next.rampStep === undefined ? null : next);
  const issues = problems(spec, ctx);
  const keys = ctx ? laneKeys(ctx) : [];
  const lanes = Object.keys(spec.waveforms ?? {}).sort((a, b) => keys.indexOf(a) - keys.indexOf(b) || (a < b ? -1 : 1));
  const free = keys.filter((k) => !(k in (spec.waveforms ?? {})));
  const [adding, setAdding] = useState('');
  const [selected, setSelected] = useState<{ key: string; i: number } | null>(null);
  const addKey = free.includes(adding) ? adding : free[0] ?? '';

  return (
    <div className="scn" data-testid="scenario-editor">
      <p className="muted small">{t('scn.intro')}</p>
      {!ctx && !modelError && <p className="muted" role="status">{t('scn.readingModel')}</p>}
      {modelError && <p className="warn small" role="alert">{t('scn.modelFailed', { reason: modelError })}</p>}

      <div className="row" style={{ marginBottom: 8 }}>
        <label className="field" style={{ flex: '1 1 220px' }}><span className="lbl">{t('scn.name')}</span>
          <input type="text" value={spec.name ?? ''} maxLength={120} aria-label={t('scn.name')} onChange={(e) => commit(setName(spec, e.target.value))} />
        </label>
        <button type="button" className="btn sm" disabled={!scenario} onClick={() => onChange(null)}>{t('scn.clear')}</button>
      </div>

      {ctx && (
        <>
          <h3>{t('scn.lanes')}</h3>
          <p className="hint">{t('scn.lanesHint')}</p>
          {lanes.length === 0 && <p className="muted small">{t('scn.noLanes')}</p>}
          {lanes.map((key) => {
            const w = spec.waveforms![key];
            const info = controlInfo(key);
            const base = ctx.controls[key] ?? 0;
            const bad = issuesAt(issues, `waveforms.${key}`);
            const sel = selected?.key === key ? selected.i : null;
            return (
              <div key={key} className={`scn-card${bad.length ? ' invalid' : ''}`} data-testid={`lane-${key}`}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>{info.label === key ? key : `${info.label} (${key})`}{info.unit && <span className="muted"> [{info.unit}]</span>}</b>
                  <span className="row" style={{ gap: 6 }}>
                    <select value={w.kind} aria-label={t('scn.kind')} onChange={(e) => commit(setKind(spec, key, e.target.value as WaveformKind, ctx.tEnd))} style={{ width: 'auto' }}>
                      <option value="pwl">{t('scn.kind.pwl')}</option>
                      <option value="step">{t('scn.kind.step')}</option>
                    </select>
                    <button type="button" className="btn sm" aria-label={t('scn.removeLane')} title={t('scn.removeLane')} onClick={() => commit(removeLane(spec, key))}>×</button>
                  </span>
                </div>
                <WaveformLane ctlKey={key} label={info.label} unit={info.unit} wf={w} base={base} tEnd={ctx.tEnd} timeUnit={ctx.timeUnit} editable invalid={bad.length > 0}
                  selected={sel} onSelect={(i) => setSelected(i === null ? null : { key, i })}
                  onMovePoint={(i, tt, v) => commit(movePoint(spec, key, i, tt, v, ctx.tEnd))}
                  onInsertPoint={(tt, v) => { const r = insertPoint(spec, key, tt, v, ctx.tEnd); commit(r.spec); if (r.index >= 0) setSelected({ key, i: r.index }); }}
                  onRemovePoint={(i) => { commit(removePoint(spec, key, i)); setSelected(null); }} />
                <div className="muted small">{t('scn.configured', { value: `${fmtNum(base, 4)}${info.unit ? ` ${info.unit}` : ''}` })}</div>
                <details>
                  <summary>{t('scn.points')} ({w.points.length})</summary>
                  <table className="scn-points">
                    <tbody>
                      {w.points.map((p, i) => (
                        <tr key={i} className={sel === i ? 'sel' : undefined}>
                          <td className="muted">{i + 1}</td>
                          <td><NumberBox value={p[0]} aria-label={`${t('scn.time', { unit: ctx.timeUnit })} ${i + 1}`} onCommit={(x) => x !== null && commit(movePoint(spec, key, i, x, p[1], ctx.tEnd))} /></td>
                          <td><NumberBox value={p[1]} allowEmpty placeholder={t('scn.valueEmpty')} aria-label={`${t('scn.value')} ${i + 1}`}
                            onCommit={(x) => commit(movePoint(spec, key, i, p[0], x, ctx.tEnd))} /></td>
                          <td><button type="button" className="btn sm" aria-label={t('scn.removePoint', { n: i + 1 })} onClick={() => commit(removePoint(spec, key, i))}>×</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button type="button" className="btn sm" onClick={() => {
                    const last = w.points[w.points.length - 1];
                    const r = insertPoint(spec, key, Math.min(ctx.tEnd, (last ? last[0] : 0) + ctx.tEnd / 20), last ? last[1] : null, ctx.tEnd);
                    commit(r.spec);
                  }}>{t('scn.addPoint')}</button>
                </details>
                {bad.map((b, k) => <div key={k} className="warn small">{b.path}: {b.message}</div>)}
              </div>
            );
          })}
          <div className="row" style={{ marginBottom: 10 }}>
            <label className="row small" style={{ gap: 6 }}>{t('scn.addLane')}
              <select value={addKey} aria-label={t('scn.addLane')} onChange={(e) => setAdding(e.target.value)} style={{ width: 'auto' }} disabled={!free.length}>
                {free.map((k) => <option key={k} value={k}>{controlInfo(k).label === k ? k : `${controlInfo(k).label} (${k})`}</option>)}
              </select>
            </label>
            <button type="button" className="btn sm" disabled={!addKey} onClick={() => commit(addLane(spec, addKey, ctx))}>{t('scn.addLaneBtn')}</button>
          </div>

          <h3>{t('scn.templates')}</h3>
          <TemplatePanel ctx={ctx} onAdd={(p) => commit(applyTemplate(spec, p, ctx))} />

          <h3 style={{ marginTop: 14 }}>{t('scn.triggers')}</h3>
          <p className="hint">{t('scn.triggersHint')}</p>
          <TriggerEditor ctx={ctx} triggers={spec.triggers ?? []} issues={issues}
            onUpdate={(i, patch) => commit(updateTrigger(spec, i, patch))} onRemove={(i) => commit(removeTrigger(spec, i))} onAdd={() => commit(addTrigger(spec, ctx))} />

          <h3 style={{ marginTop: 14 }}>{t('scn.rampStep')}</h3>
          <div className="row">
            <NumberBox value={spec.rampStep} allowEmpty placeholder={t('scn.rampStepNone')} aria-label={t('scn.rampStep')} invalid={issuesAt(issues, 'rampStep').length > 0}
              onCommit={(x) => commit(setRampStep(spec, x === null ? undefined : x))} />
            <span className="muted small">{ctx.timeUnit}</span>
            <button type="button" className="btn sm" onClick={() => commit(setRampStep(spec, suggestRampStep(ctx.tEnd)))}>{t('scn.rampStepAuto')}</button>
          </div>
          <p className="hint">{t('scn.rampStepHint', { min: `${fmtNum(minRampStep(ctx.tEnd), 3)} ${ctx.timeUnit}` })}</p>
        </>
      )}

      <div role={issues.length ? 'alert' : 'status'} className={`diag-box ${issues.length ? '' : 'ok'}`} style={{ margin: '12px 0 8px' }}>
        {issues.length === 0
          ? <span className="ok small">{ctx ? t('scn.ok') : t('scn.noModel')}</span>
          : <>
            <b className="warn">{t('scn.problems')}</b>
            <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{issues.map((i, k) => <li key={k}>{i.path ? <code>{i.path}</code> : null}{i.path ? ': ' : ''}{i.message}</li>)}</ul>
          </>}
      </div>

      <TextForm spec={spec} scenario={scenario} ctx={ctx} valid={issues.length === 0} onChange={onChange} copy={copy} download={download} />
    </div>
  );
}

/** The text form: the canonical JSON of a valid scenario, and a box to paste or load one (checked against the model before it is applied). */
function TextForm({ spec, scenario, ctx, valid, onChange, copy, download }: {
  spec: ScenarioSpec; scenario: ScenarioSpec | null; ctx: EditorContext | null; valid: boolean;
  onChange(s: ScenarioSpec | null): void; copy(text: string): Promise<void>; download(name: string, text: string): void;
}) {
  const t = useScenarioT();
  // the canonical JSON of a valid scenario (pretty printed); one that is not valid yet is shown as it is, so that the text does not vanish while it is edited
  const canonical = scenario && valid ? JSON.stringify(JSON.parse(toText(spec)), null, 2) : '';
  const shown = scenario ? canonical || JSON.stringify(spec, null, 2) : '';
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setText(shown); setError(null); }, [shown]);

  const apply = (source: string) => {
    if (!source.trim()) { onChange(null); setError(null); return; }
    try {
      onChange(fromText(source, ctx));
      setError(null);
    } catch (e) {
      setError(e instanceof ScenarioError ? e.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)) : [e instanceof Error ? e.message : String(e)]);
    }
  };

  return (
    <details className="scn-text">
      <summary>{t('scn.json')}</summary>
      <textarea className="persist-code" rows={8} value={text} spellCheck={false} aria-label={t('scn.json')} onChange={(e) => setText(e.target.value)} />
      <div className="row" style={{ marginTop: 4 }}>
        <button type="button" className="btn sm primary" onClick={() => apply(text)}>{t('scn.jsonApply')}</button>
        <button type="button" className="btn sm" disabled={!canonical} onClick={() => { void copy(canonical).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? t('scn.jsonCopied') : t('scn.jsonCopy')}</button>
        <button type="button" className="btn sm" disabled={!canonical} onClick={() => download(`${(spec.name ?? 'scenario').replace(/[^\w.-]+/g, '_')}.scenario.json`, canonical + '\n')}>{t('scn.jsonDownload')}</button>
        <label className="btn sm" style={{ cursor: 'pointer' }}>{t('scn.jsonLoad')}
          <input type="file" accept="application/json,.json" hidden aria-label={t('scn.jsonLoad')}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((s) => { setText(s); apply(s); }); e.target.value = ''; }} />
        </label>
      </div>
      {error && (
        <div role="alert" className="diag-box" style={{ marginTop: 6 }}>
          <b className="warn">{t('scn.jsonInvalid')}</b>
          <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{error.slice(0, 12).map((m, k) => <li key={k}>{m}</li>)}</ul>
        </div>
      )}
    </details>
  );
}
