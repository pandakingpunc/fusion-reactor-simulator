/**
 * The persistence features as the application sees them, in one lazily loaded chunk: the Share and Saved runs buttons
 * (placed in the top bar through a portal), the panels they open, the automatic saving of completed runs to the
 * archive, and the landing of a share link (#/share/<code>).
 *
 * Nothing here is needed to use the simulator: when the chunk fails to load, or the browser has no IndexedDB, the
 * application works as before, minus these features.
 */
import { lazy, ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import './persist.css';
import { createPortal } from 'react-dom';
import { ArchiveError } from './archive';
import { errorText, usePersistDeps } from './deps';
import { autoSaveEnabled } from './prefs';
import type { DecodedShare } from './codec';
import { Router, routeOfTab, Route } from './router';
import { shotToNewRun } from './shots';
import { usePersistT } from './usePersistT';
import { APP_VERSION } from './version';
import { useApp, useAppStore } from '../state/store';
import type { ReactorConfig } from '../../physics/types';
import type { ScenarioSpec } from '../../physics/scenario';
import type { RunProvenanceMsg } from '../../worker/protocol';
import type { WorkerFactory } from '../state/sim';

const SharePanel = lazy(() => import('./SharePanel'));
const LibraryPanel = lazy(() => import('./LibraryPanel'));

type Notice =
  | { kind: 'opened'; name: string; odd: number; share: DecodedShare | null }
  | { kind: 'failed'; reason: string }
  | { kind: 'reproducing'; pct: number }
  | { kind: 'reproduced'; match: boolean | null; name: string }
  | { kind: 'replayFailed'; reason: string }
  | { kind: 'archive'; reason: string };

interface Props {
  /** the place in the top bar for the buttons (null until it is mounted) */
  slot: HTMLElement | null;
  router: Router;
  route: Route;
  /** the simulation worker's factory: the share dialog builds the model of the configuration with it and checks the scenario against it before it makes a link */
  createWorker?: WorkerFactory;
  /** the run that just finished (its configuration and what defines it besides that), for an exact-run link; null: none */
  exactRun?: { cfg: ReactorConfig; provenance: RunProvenanceMsg } | null;
}

export default function PersistHost({ slot, router, route, createWorker, exactRun = null }: Props) {
  const p = usePersistT();
  const deps = usePersistDeps();
  const { actions } = useAppStore();
  const cfg = useApp((s) => s.cfg);
  const cfgName = useApp((s) => s.cfgName);
  const scenario = useApp((s) => s.scenario);
  const shots = useApp((s) => s.shots);
  const [panel, setPanel] = useState<'share' | 'library' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const pRef = useRef(p);
  pRef.current = p;

  // ── completed runs go to the archive ──────────────────────────────────────
  const saved = useRef(new Set<number>());
  useEffect(() => {
    for (const shot of shots) {
      // shots opened from the archive or a file (sourceKey) are already stored or are saved by their own flow
      if (shot.sourceKey || saved.current.has(shot.id)) continue;
      saved.current.add(shot.id);
      if (!autoSaveEnabled()) continue;
      void deps.archive().then((a) => a.put(shotToNewRun(shot))).catch((e: unknown) => {
        // no archive in this browser is not an error to nag about; a full disk or a failing database is
        if (!(e instanceof ArchiveError && e.code === 'unavailable')) setNotice({ kind: 'archive', reason: errorText(e) });
      });
    }
  }, [shots, deps]);

  // ── a notice about a shared link is about that configuration ─────────────
  // "Opened X from a shared link" (and the reproduction that follows it) is stale once a different configuration is picked or run: the
  // name of the configuration in the wizard is no longer the one the link brought. Editing the shared configuration keeps its name.
  useEffect(() => {
    setNotice((n) => (n && (n.kind === 'opened' || n.kind === 'reproduced') && n.name !== cfgName ? null : n));
  }, [cfgName]);

  // ── share links ───────────────────────────────────────────────────────────
  const landed = useRef<string | null>(null);
  const shareCode = route.name === 'share' ? route.code : null;
  useEffect(() => {
    if (shareCode === null || landed.current === shareCode) return;
    landed.current = shareCode;
    let alive = true;
    void (async () => {
      const { tryDecodeShare } = await import('./codec');
      const r = await tryDecodeShare(shareCode);
      if (!alive) return;
      if (r.ok) {
        const { payload, warnings } = r.value;
        const name = payload.name ?? 'Shared';
        // the scenario against the model of the link's configuration (its controls, diagnostics and end time), before anything is applied; when
        // the model cannot be built here (no worker) the structural check of the decoder is what remains, and the run itself reports the rest
        if (payload.scenario && createWorker) {
          const [{ problems, editorContext }, { probeOnce }] = await Promise.all([import('../scenario/model'), import('../scenario/useModel')]);
          const meta = await probeOnce(payload.cfg, createWorker).catch(() => null);
          if (!alive) return;
          const issues = meta ? problems(payload.scenario as ScenarioSpec, editorContext(meta)) : [];
          if (issues.length) {
            const why = issues.slice(0, 3).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ');
            setNotice({ kind: 'failed', reason: pRef.current('persist.notice.scenarioNoFit', { reason: why }) });
            router.navigate(routeOfTab('setup'), { replace: true });
            return;
          }
        }
        actions.setCfg(payload.cfg);
        actions.setCfgName(name);
        // the scenario of the link (checked with the rest of the payload: an invalid one is refused before this point); a link without one clears the old
        actions.setScenario(payload.scenario === undefined || payload.scenario === null ? null : (payload.scenario as ScenarioSpec));
        actions.setTab('setup');
        const exact = !!(payload.actuatorLog?.length || payload.breakpoints?.length || payload.scenario !== undefined);
        setNotice({ kind: 'opened', name, odd: warnings.length, share: exact ? r.value : null });
      } else {
        setNotice({ kind: 'failed', reason: r.error.message });
      }
      router.navigate(routeOfTab('setup'), { replace: true });
    })();
    return () => { alive = false; landed.current = null; };
  }, [shareCode, actions, router, createWorker]);

  const reproduce = async (share: DecodedShare) => {
    const { payload } = share;
    const name = payload.name ?? 'Shared';
    setNotice({ kind: 'reproducing', pct: 0 });
    try {
      const result = await deps.replay({
        cfg: payload.cfg, actuatorLog: payload.actuatorLog, breakpoints: payload.breakpoints, scenario: payload.scenario,
        appVersion: payload.appVersion ?? APP_VERSION, keepFrames: true,
      }, { onProgress: ({ t, tEnd }) => setNotice({ kind: 'reproducing', pct: Math.min(100, Math.round((100 * t) / tEnd)) }) });
      actions.openShot({
        name, cfg: payload.cfg, meta: result.meta, report: result.report, events: result.events, frames: result.frames ?? [],
        sourceKey: `share:${result.fingerprint}`,
        prov: {
          interventions: payload.actuatorLog?.length ?? 0,
          ...(payload.actuatorLog ? { actuatorLog: payload.actuatorLog } : {}), ...(payload.breakpoints ? { breakpoints: payload.breakpoints } : {}),
          ...(payload.scenario !== undefined ? { scenario: payload.scenario } : {}), fingerprint: result.fingerprint,
        },
      });
      setNotice({ kind: 'reproduced', name, match: payload.fingerprint ? payload.fingerprint === result.fingerprint : null });
    } catch (e) {
      setNotice({ kind: 'replayFailed', reason: errorText(e) });
    }
  };

  const buttons = (
    <span className="row" style={{ gap: 6 }}>
      <button className="btn sm" title={p('persist.share.title')} onClick={() => setPanel('share')}>{p('persist.share')}</button>
      <button className="btn sm" title={p('persist.library.title')} onClick={() => setPanel('library')}>{p('persist.library')}</button>
    </span>
  );

  return (
    <>
      {slot && createPortal(buttons, slot)}
      {notice && <NoticeBar notice={notice} onDismiss={() => setNotice(null)} onReproduce={(s) => void reproduce(s)} />}
      {panel && (
        <Suspense fallback={null}>
          {panel === 'share' && <SharePanel cfg={cfg} name={cfgName} scenario={scenario} createWorker={createWorker} exactRun={exactRun} onClose={() => setPanel(null)} />}
          {panel === 'library' && <LibraryPanel onClose={() => setPanel(null)} />}
        </Suspense>
      )}
    </>
  );
}

function NoticeBar({ notice, onDismiss, onReproduce }: { notice: Notice; onDismiss(): void; onReproduce(s: DecodedShare): void }) {
  const p = usePersistT();
  let cls = 'ok';
  let text: string;
  let action: ReactNode = null;
  switch (notice.kind) {
    case 'opened':
      text = p('persist.notice.opened', { name: notice.name }) + (notice.odd ? ` ${p('persist.notice.odd', { n: notice.odd })}` : '');
      if (notice.share) {
        text += ` ${p('persist.notice.extras')}`;
        const s = notice.share;
        action = <button className="btn sm primary" onClick={() => onReproduce(s)}>{p('persist.notice.reproduce')}</button>;
      }
      break;
    case 'failed': cls = 'bad'; text = p('persist.notice.failed', { reason: notice.reason }); break;
    case 'reproducing': cls = ''; text = p('persist.notice.reproducing', { pct: notice.pct }); break;
    case 'reproduced':
      text = `${p('persist.notice.reproduced')} ${notice.match === null ? '' : p(notice.match ? 'persist.notice.fpMatch' : 'persist.notice.fpDiffers')}`.trim();
      if (notice.match === false) cls = 'warn';
      break;
    case 'replayFailed': cls = 'bad'; text = p('persist.notice.replayFailed', { reason: notice.reason }); break;
    case 'archive': cls = 'warn'; text = p('persist.lib.failed', { reason: notice.reason }); break;
  }
  return (
    <div className={`persist-notice panel ${cls}`} role={cls === 'bad' ? 'alert' : 'status'}>
      <span>{text}</span>
      {action}
      <button className="btn sm" onClick={onDismiss}>{p('persist.notice.dismiss')}</button>
    </div>
  );
}
