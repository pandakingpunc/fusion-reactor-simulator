import { DragEvent, useEffect, useRef, useState } from 'react';
import { METHOD_LABELS } from '../../physics/types';
import { useAppStore } from '../state/store';
import { useWizText } from '../wizard/wizText';
import { errorText, usePersistDeps } from './deps';
import { ParsedRecord, parseRunRecord, RunRecordError } from './runRecord';
import { importedShot, shotToNewRun } from './shots';
import { usePersistT } from './usePersistT';
import { verifyRecord, Verified } from './verify';
import { VerifyBadge } from './VerifyBadge';
import { APP_VERSION } from './version';

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking'; name: string; pct: number }
  | { kind: 'failed'; reason: string }
  | { kind: 'done'; rec: ParsedRecord; v: Verified };

export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('cannot read the file'));
    r.readAsText(file);
  });
}

const short = (fp?: string) => (fp ? `${fp.slice(0, 12)}…` : '–');

/**
 * Import of a run file: read it, re-run its inputs in a worker, compare with the numbers in the file, and say plainly
 * what came out (VerifyBadge); the run can then be opened in the Report, saved to the archive or its configuration loaded.
 */
export function ImportPanel({ onDone }: { onDone(): void }) {
  const p = usePersistT();
  const deps = usePersistDeps();
  const { actions } = useAppStore();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [saved, setSaved] = useState(false);
  const [over, setOver] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const start = async (file: File) => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setSaved(false);
    setPhase({ kind: 'checking', name: file.name, pct: 0 });
    try {
      const rec = parseRunRecord(await readFileText(file));
      const v = await verifyRecord(rec, deps.replay, {
        signal: ac.signal, onProgress: ({ t, tEnd }) => setPhase({ kind: 'checking', name: file.name, pct: Math.min(100, Math.round((100 * t) / tEnd)) }),
      });
      setPhase({ kind: 'done', rec, v });
    } catch (e) {
      if (ac.signal.aborted) { setPhase({ kind: 'idle' }); return; }
      setPhase({ kind: 'failed', reason: e instanceof RunRecordError ? e.message : errorText(e) });
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) void start(f);
  };

  const openReport = () => {
    if (phase.kind !== 'done') return;
    const { rec, v } = phase;
    actions.openShot(importedShot(rec, v.result, v.verify.status, `import:${rec.fingerprint ?? v.verify.fingerprint.computed}`));
    onDone();
  };

  const save = async () => {
    if (phase.kind !== 'done') return;
    const { rec, v } = phase;
    try {
      const shot = { ...importedShot(rec, v.result, v.verify.status, ''), name: rec.name };
      const archive = await deps.archive();
      await archive.put(shotToNewRun(shot, { origin: 'import', appVersion: rec.appVersion ?? APP_VERSION, fingerprint: v.verify.status === 'unsigned' ? null : v.result.fingerprint }));
      setSaved(true);
    } catch (e) {
      setPhase({ kind: 'failed', reason: p('persist.lib.failed', { reason: errorText(e) }) });
    }
  };

  const loadConfig = () => {
    if (phase.kind !== 'done') return;
    actions.setCfg(phase.rec.cfg);
    actions.setCfgName(phase.rec.name);
    actions.setTab('setup');
    onDone();
  };

  return (
    <section className="persist-import" aria-label={p('persist.imp.heading')}>
      <h3>{p('persist.imp.heading')}</h3>
      <p className="muted small">{p('persist.imp.help')}</p>
      <div className={`persist-drop${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        {/* a real button (a tab stop) opens the file chooser; the input itself is out of the tab order and hidden from assistive technology, but not display:none */}
        <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>{p('persist.imp.pick')}</button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="import-file"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void start(f); }} />
        <span className="muted small">{p('persist.imp.drop')}</span>
      </div>

      {phase.kind === 'checking' && (
        <div className="persist-result" role="status">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{p('persist.imp.checking', { pct: phase.pct })}</span>
            <button className="btn sm" onClick={() => abort.current?.abort()}>{p('persist.imp.cancel')}</button>
          </div>
          <div className="bar" style={{ marginTop: 6 }}><div style={{ width: `${phase.pct}%` }} /></div>
        </div>
      )}

      {phase.kind === 'failed' && <p className="bad persist-result" role="alert">{p('persist.imp.failed', { reason: phase.reason })}</p>}

      {phase.kind === 'done' && <Result phase={phase} saved={saved} onOpen={openReport} onSave={() => void save()} onLoad={loadConfig} />}
    </section>
  );
}

function Result({ phase, saved, onOpen, onSave, onLoad }: { phase: Extract<Phase, { kind: 'done' }>; saved: boolean; onOpen(): void; onSave(): void; onLoad(): void }) {
  const p = usePersistT();
  const wt = useWizText();
  const { rec, v } = phase;
  const { verify } = v;
  const s = verify.status;
  const tail = s === 'other-version' ? (verify.reportMatch ? 'persist.verify.same' : 'persist.verify.differs')
    : s === 'unsigned' ? (verify.reportMatch ? 'persist.verify.unsigned.same' : 'persist.verify.unsigned.differs') : null;
  const text = s === 'other-version'
    ? p('persist.verify.other-version.text', { file: verify.versions.file ?? '?', current: verify.versions.current })
    : p(`persist.verify.${s}.text` as 'persist.verify.verified.text');
  return (
    <div className="persist-result" role="status" data-verify={s}>
      <div className="muted small">{p('persist.imp.file', { name: rec.name, method: wt(METHOD_LABELS[rec.cfg.method]), version: rec.appVersion ?? p('persist.imp.noVersion') })}</div>
      <div className="row" style={{ margin: '6px 0' }}>
        <VerifyBadge status={s} fileVersion={verify.versions.file} currentVersion={verify.versions.current} />
      </div>
      <p style={{ margin: '4px 0' }}>{text}{tail ? ` ${p(tail)}` : ''}</p>
      <table className="kv">
        <tbody>
          <tr><td>{p('persist.imp.fingerprint')} ({p('persist.imp.claimed')})</td><td className="num" title={verify.fingerprint.claimed}>{short(verify.fingerprint.claimed)}</td></tr>
          <tr><td>{p('persist.imp.fingerprint')} ({p('persist.imp.computed')})</td><td className="num" title={verify.fingerprint.computed}>{short(verify.fingerprint.computed)}</td></tr>
        </tbody>
      </table>
      {verify.differences.length > 0 && <p className="warn small">{p('persist.imp.fields', { fields: verify.differences.join(', ') })}</p>}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={onOpen}>{p('persist.imp.report')}</button>
        <button className="btn" onClick={onSave} disabled={saved}>{saved ? p('persist.imp.saved') : p('persist.imp.save')}</button>
        <button className="btn" onClick={onLoad}>{p('persist.imp.wizard')}</button>
      </div>
    </div>
  );
}
