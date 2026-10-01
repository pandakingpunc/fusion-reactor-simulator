import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactorConfig } from '../../physics/types';
import type { ScenarioSpec } from '../../physics/scenario';
import type { RunProvenanceMsg } from '../../worker/protocol';
import type { WorkerFactory } from '../state/sim';
import { errorText, usePersistDeps } from './deps';
import { Modal } from './Modal';
import { usePersistT } from './usePersistT';
import { APP_VERSION } from './version';

type EmbedView = 'run' | 'report';

export interface SharePanelProps {
  cfg: ReactorConfig;
  name: string;
  /** the scenario of the wizard, carried by the link when there is one */
  scenario?: ScenarioSpec | null;
  /** the simulation worker's factory: the model of the configuration is built with it (no run) and the scenario is checked against it before a link is made */
  createWorker?: WorkerFactory;
  /** the run that has just finished (its configuration and what defines it besides that): offered as an exact-run link when it is the run of `cfg` */
  exactRun?: { cfg: ReactorConfig; provenance: RunProvenanceMsg } | null;
  onClose(): void;
}

/** the scenario does not fit the configuration: the reason, shown as such (not as a failure of the link machinery) */
class ScenarioProblem extends Error {}

/**
 * Share dialog: the link to the configuration, and the HTML to embed it in a page.
 *
 * The link carries the configuration, its name and the scenario the wizard holds. It is checked before it is made: the scenario must be
 * valid for this configuration (its controls, diagnostics and end time, read from a probe of the model; when the model cannot be built the
 * structural check of the codec is what remains). After a run has finished the dialog also offers the exact run: the scenario, the live
 * interventions (actuator log), breakpoints and fingerprint that the simulation worker reported at completion, so that whoever opens the
 * link can reproduce the run and see that it comes out the same (the landing offers 'Reproduce the run').
 */
export default function SharePanel({ cfg, name, scenario = null, createWorker, exactRun = null, onClose }: SharePanelProps) {
  const p = usePersistT();
  const deps = usePersistDeps();
  const [built, setBuilt] = useState<{ code: string; url: string; length: number; long: boolean } | null>(null);
  const [error, setError] = useState<{ text: string; scenario: boolean } | null>(null);
  const [copied, setCopied] = useState<'link' | 'html' | 'manual' | null>(null);
  const [view, setView] = useState<EmbedView>('run');
  const canExact = !!exactRun && exactRun.cfg === cfg;
  const [exact, setExact] = useState(false);
  const useExact = canExact && exact;
  // the provenance object itself, not the wrapper the caller builds anew on every render (the link is not rebuilt for nothing)
  const exactProv = canExact ? exactRun!.provenance : null;
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    setBuilt(null);
    setError(null);
    void (async () => {
      try {
        const { encodeShare, shareUrl } = await import('./codec');
        const prov = useExact ? exactProv : null;
        const carried = prov ? prov.scenario : scenario;
        if (carried && createWorker) {
          // up front, against the model: an unknown control, a rampStep that does not fit the run ... When the probe fails (no worker) the codec's own check remains
          const [{ problems, editorContext }, { probeOnce }] = await Promise.all([import('../scenario/model'), import('../scenario/useModel')]);
          const meta = await probeOnce(cfg, createWorker).catch(() => null);
          const issues = meta ? problems(carried, editorContext(meta)) : [];
          if (issues.length) throw new ScenarioProblem(issues.slice(0, 3).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; '));
        }
        const code = await encodeShare({
          cfg, name, appVersion: prov?.appVersion ?? APP_VERSION,
          ...(prov
            ? {
              ...(prov.actuatorLog.length ? { actuatorLog: prov.actuatorLog } : {}), ...(prov.breakpoints?.length ? { breakpoints: prov.breakpoints } : {}),
              ...(prov.scenario ? { scenario: prov.scenario } : {}), fingerprint: prov.fingerprint,
            }
            : carried ? { scenario: carried } : {}),
        });
        const u = shareUrl(code, deps.baseUrl());
        if (alive) setBuilt({ code, ...u });
      } catch (e) {
        if (alive) setError(e instanceof ScenarioProblem ? { text: p('persist.share.scenarioInvalid', { reason: e.message }), scenario: true } : { text: errorText(e), scenario: false });
      }
    })();
    return () => { alive = false; };
  }, [cfg, name, scenario, createWorker, useExact, exactProv, deps, p]);

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

  const carriedScenario = useExact ? exactProv!.scenario : scenario;
  const counts = carriedScenario ? { waveforms: Object.keys(carriedScenario.waveforms ?? {}).length, triggers: carriedScenario.triggers?.length ?? 0 } : null;

  return (
    <Modal title={p('persist.share.heading')} onClose={onClose}>
      <div className="panel-title"><h3>{p('persist.share.heading')}</h3><button className="btn sm" onClick={onClose}>{p('persist.close')}</button></div>
      <p className="muted small">{p('persist.share.what', { name })}</p>
      {counts && <p className="muted small">{p('persist.share.scenario', counts)}</p>}
      {canExact && (
        <label className="row small" style={{ gap: 6, marginBottom: 6 }} title={p('persist.share.exactHint')}>
          <input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} />
          {p('persist.share.exact')}
        </label>
      )}
      {error && <p className="bad" role="alert">{error.scenario ? error.text : p('persist.share.failed', { reason: error.text })}</p>}
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
