import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactorConfig } from '../../physics/types';
import { errorText, usePersistDeps } from './deps';
import { Modal } from './Modal';
import { usePersistT } from './usePersistT';
import { APP_VERSION } from './version';

type EmbedView = 'run' | 'report';

/**
 * Share dialog: the link to the configuration, and the HTML to embed it in a page.
 * The link carries the configuration and its name only. The codec and the landing also read a link with an actuator
 * log, breakpoints, a scenario and a fingerprint (exact-run links), but this dialog does not make one yet: the
 * simulation worker does not report a live run's actuator log to the page (see the run file, runRecord.ts).
 */
export default function SharePanel({ cfg, name, onClose }: { cfg: ReactorConfig; name: string; onClose(): void }) {
  const p = usePersistT();
  const deps = usePersistDeps();
  const [built, setBuilt] = useState<{ code: string; url: string; length: number; long: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'link' | 'html' | 'manual' | null>(null);
  const [view, setView] = useState<EmbedView>('run');
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { encodeShare, shareUrl } = await import('./codec');
        const code = await encodeShare({ cfg, name, appVersion: APP_VERSION });
        const u = shareUrl(code, deps.baseUrl());
        if (alive) setBuilt({ code, ...u });
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    })();
    return () => { alive = false; };
  }, [cfg, name, deps]);

  const embedHtml = useMemo(() => {
    if (!built) return '';
    const src = `${deps.baseUrl()}#/embed/${view}/${built.code}`;
    return `<iframe src="${src}" width="960" height="640" style="border:0" loading="lazy" title="Fusion reactor simulator" allowfullscreen></iframe>`;
  }, [built, view, deps]);

  const copy = async (text: string, what: 'link' | 'html') => {
    try {
      await deps.copy(text);
      setCopied(what);
    } catch {
      setCopied('manual');
      linkRef.current?.select();
    }
  };

  return (
    <Modal title={p('persist.share.heading')} onClose={onClose}>
      <div className="panel-title"><h3>{p('persist.share.heading')}</h3><button className="btn sm" onClick={onClose}>{p('persist.close')}</button></div>
      <p className="muted small">{p('persist.share.what', { name })}</p>
      {error && <p className="bad">{p('persist.share.failed', { reason: error })}</p>}
      {!built && !error && <p className="muted">{p('persist.share.building')}</p>}
      {built && (
        <>
          <label className="field">
            <span className="lbl">{p('persist.share.link')}</span>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input ref={linkRef} type="text" readOnly value={built.url} onFocus={(e) => e.currentTarget.select()} aria-label={p('persist.share.link')} />
              <button className="btn primary" onClick={() => void copy(built.url, 'link')}>{copied === 'link' ? p('persist.share.copied') : p('persist.share.copy')}</button>
            </div>
          </label>
          {copied === 'manual' && <p className="warn small">{p('persist.share.manual')}</p>}
          {built.long && <p className="warn small">{p('persist.share.long', { n: built.length })}</p>}

          <h3 style={{ marginTop: 14 }}>{p('persist.share.embedHeading')}</h3>
          <div className="row" style={{ marginBottom: 6 }}>
            <label className="row small" style={{ gap: 6 }}>
              {p('persist.share.embedView')}
              <select value={view} onChange={(e) => setView(e.target.value as EmbedView)} style={{ width: 'auto' }}>
                <option value="run">{p('persist.share.embedRun')}</option>
                <option value="report">{p('persist.share.embedReport')}</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span className="lbl">{p('persist.share.embedCode')}</span>
            <textarea className="persist-code" readOnly rows={4} value={embedHtml} onFocus={(e) => e.currentTarget.select()} aria-label={p('persist.share.embedCode')} />
          </label>
          <button className="btn sm" style={{ marginTop: 6 }} onClick={() => void copy(embedHtml, 'html')}>{copied === 'html' ? p('persist.share.copied') : p('persist.share.embedCopy')}</button>
        </>
      )}
    </Modal>
  );
}
