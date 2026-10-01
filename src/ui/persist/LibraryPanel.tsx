import { useCallback, useEffect, useState } from 'react';
import { METHOD_LABELS } from '../../physics/types';
import { useAppStore } from '../state/store';
import { useWizText } from '../wizard/wizText';
import { fmtNum } from '../format';
import { activeLocale, localizeDecimals } from '../../i18n';
import { ArchiveError, RunArchive, RunSummary } from './archive';
import { errorText, usePersistDeps } from './deps';
import { ImportPanel } from './ImportPanel';
import { Modal } from './Modal';
import { autoSaveEnabled, setAutoSave } from './prefs';
import { runToRecord, } from './shots';
import { runToShot } from './shots';
import { serializeRunRecord } from './runRecord';
import { isVerifyStatus } from './types';
import { usePersistT } from './usePersistT';
import { VerifyBadge } from './VerifyBadge';

const safeName = (s: string) => s.replace(/[^\w-]+/g, '_').slice(0, 60) || 'run';

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} kB`;
  return localizeDecimals(`${(b / (1024 * 1024)).toFixed(1)} MB`);
}

/** The archive of completed runs in this browser, and the import of run files. */
export default function LibraryPanel({ onClose }: { onClose(): void }) {
  const p = usePersistT();
  const wt = useWizText();
  const deps = usePersistDeps();
  const { actions } = useAppStore();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(autoSaveEnabled);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const withArchive = useCallback(async <T,>(f: (a: RunArchive) => Promise<T>): Promise<T | undefined> => {
    try {
      const a = await deps.archive();
      setError(null);
      return await f(a);
    } catch (e) {
      if (e instanceof ArchiveError && e.code === 'unavailable') setUnavailable(true);
      else setError(errorText(e));
      return undefined;
    }
  }, [deps]);

  const refresh = useCallback(async () => {
    const list = await withArchive((a) => a.list());
    if (list) setRuns(list);
    else setRuns((r) => r ?? []);
  }, [withArchive]);

  useEffect(() => { void refresh(); }, [refresh]);

  const open = async (id: string) => {
    const run = await withArchive((a) => a.get(id));
    if (!run) { await refresh(); return; }
    actions.openShot(runToShot(run));
    onClose();
  };

  const exportRun = async (id: string) => {
    const run = await withArchive((a) => a.get(id));
    if (run) deps.download(`${safeName(run.name)}_run.json`, serializeRunRecord(runToRecord(run)), 'application/json');
  };

  const remove = async (id: string) => { await withArchive((a) => a.delete(id)); await refresh(); };

  const commitRename = async () => {
    if (!renaming) return;
    const { id, name } = renaming;
    setRenaming(null);
    await withArchive((a) => a.rename(id, name));
    await refresh();
  };

  const clear = async () => { setConfirmClear(false); await withArchive((a) => a.clear()); await refresh(); };

  const total = (runs ?? []).reduce((a, r) => a + r.bytes, 0);
  const when = (ms: number) => new Date(ms).toLocaleString(activeLocale() === 'tr' ? 'tr-TR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Modal title={p('persist.lib.heading')} onClose={onClose} wide>
      <div className="panel-title"><h3>{p('persist.lib.heading')}</h3><button className="btn sm" onClick={onClose}>{p('persist.close')}</button></div>

      <ImportPanel onDone={onClose} />

      <hr className="persist-rule" />
      {unavailable && <p className="warn" role="alert">{p('persist.lib.unavailable')}</p>}
      {error && <p className="bad" role="alert">{p('persist.lib.failed', { reason: error })}</p>}
      {!unavailable && (
        <>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <label className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); setAutoSave(e.target.checked); }} />
              {p('persist.lib.auto')}
            </label>
            <span className="muted small">{runs && runs.length ? p('persist.lib.usage', { n: runs.length, size: fmtBytes(total) }) : ''}</span>
          </div>
          {runs === null && <p className="muted">{p('persist.lib.loading')}</p>}
          {runs && runs.length === 0 && <p className="muted">{p('persist.lib.empty')}</p>}
          {runs && runs.length > 0 && (
            <ul className="persist-list">
              {runs.map((r) => (
                <li key={r.id} className="persist-row" data-run={r.id}>
                  <div className="persist-row-main">
                    {renaming?.id === r.id ? (
                      <input type="text" autoFocus value={renaming.name} aria-label={p('persist.lib.rename')}
                        onChange={(e) => setRenaming({ id: r.id, name: e.target.value })}
                        onBlur={() => void commitRename()}
                        onKeyDown={(e) => { if (e.key === 'Enter') void commitRename(); else if (e.key === 'Escape') setRenaming(null); }} />
                    ) : (
                      <strong className="persist-name">{r.name}</strong>
                    )}
                    <span className="muted small">
                      {wt(METHOD_LABELS[r.method])} · Q {fmtNum(r.Q_sci_max)} · E_fus {fmtNum(r.E_fusion_MJ)} MJ · {p('persist.lib.saved', { when: when(r.savedAt) })} · v{r.appVersion} · {fmtBytes(r.bytes)}
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      {r.origin === 'import' && <span className="badge">{p('persist.lib.imported')}</span>}
                      {isVerifyStatus(r.verification) && <VerifyBadge status={r.verification} />}
                    </span>
                  </div>
                  <div className="row persist-row-actions">
                    <button className="btn sm primary" title={p('persist.lib.openTitle')} onClick={() => void open(r.id)}>{p('persist.lib.open')}</button>
                    <button className="btn sm" onClick={() => setRenaming({ id: r.id, name: r.name })}>{p('persist.lib.rename')}</button>
                    <button className="btn sm" onClick={() => void exportRun(r.id)}>{p('persist.lib.export')}</button>
                    <button className="btn sm danger" onClick={() => void remove(r.id)}>{p('persist.lib.delete')}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {runs && runs.length > 1 && (
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              {confirmClear ? (
                <>
                  <span className="small">{p('persist.lib.confirmClear', { n: runs.length })}</span>
                  <button className="btn sm danger" onClick={() => void clear()}>{p('persist.lib.clear')}</button>
                  <button className="btn sm" onClick={() => setConfirmClear(false)}>{p('persist.imp.cancel')}</button>
                </>
              ) : (
                <button className="btn sm danger" onClick={() => setConfirmClear(true)}>{p('persist.lib.clear')}</button>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
