/**
 * The chrome-less views for an <iframe> (#/embed/run/<code>, #/embed/report/<code>): the configuration in the code,
 * either as a live run or as a report computed when the page loads, with a link to open it in the full simulator.
 * Nothing is saved from here (an embedded page keeps no archive and adds no shots to anything).
 */
import { lazy, useCallback, useEffect, useRef, useState } from 'react';
import './persist.css';
import type { ReactorConfig } from '../../physics/types';
import type { ScenarioSpec } from '../../physics/scenario';
import type { SavedShot } from '../state/types';
import { useApp, useAppStore } from '../state/store';
import type { SimApi } from '../useSim';
import { RunScreen } from '../run/RunScreen';
import { usePersistDeps } from './deps';
import type { Route } from './router';
import { usePersistT } from './usePersistT';

const Report = lazy(() => import('../report/Report').then((m) => ({ default: m.Report })));

type EmbedRoute = Extract<Route, { name: 'embed' }>;

type Loaded = { kind: 'loading' } | { kind: 'error'; reason: string } | { kind: 'ok'; cfg: ReactorConfig; name: string; scenario: ScenarioSpec | null };

export default function EmbedView({ route, sim }: { route: EmbedRoute; sim: SimApi }) {
  const p = usePersistT();
  const deps = usePersistDeps();
  const { actions } = useAppStore();
  const locale = useApp((s) => s.locale);
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [shot, setShot] = useState<SavedShot | null>(null);
  const [pct, setPct] = useState(0);
  const started = useRef<string | null>(null);

  useEffect(() => { if (route.lang && route.lang !== locale) void actions.setLocale(route.lang); }, [route.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { tryDecodeShare } = await import('./codec');
      const r = await tryDecodeShare(route.code);
      if (!alive) return;
      setLoaded(r.ok
        ? { kind: 'ok', cfg: r.value.payload.cfg, name: r.value.payload.name ?? 'Shared', scenario: (r.value.payload.scenario as ScenarioSpec | undefined) ?? null }
        : { kind: 'error', reason: r.error.message });
    })();
    return () => { alive = false; };
  }, [route.code]);

  const compute = useCallback((cfg: ReactorConfig, name: string, scenario: ScenarioSpec | null) => {
    setShot(null);
    setPct(0);
    void sim.runAll(cfg, true, ({ t, tEnd }) => setPct(Math.min(100, Math.round((100 * t) / tEnd))), scenario).then((r) => {
      setShot({ id: -1, name, cfg, meta: r.meta, report: r.report, frames: r.frames ?? [], events: r.events ?? [] });
    }).catch((e: unknown) => setLoaded({ kind: 'error', reason: e instanceof Error ? e.message : String(e) }));
  }, [sim.runAll]);

  useEffect(() => {
    if (loaded.kind !== 'ok' || started.current === route.code + route.view) return;
    started.current = route.code + route.view;
    actions.setCfg(loaded.cfg);
    actions.setCfgName(loaded.name);
    if (route.view === 'run') sim.load(loaded.cfg, route.autoplay ?? true, loaded.scenario);
    else compute(loaded.cfg, loaded.name, loaded.scenario);
  }, [loaded, route.code, route.view, route.autoplay]); // eslint-disable-line react-hooks/exhaustive-deps

  const openHref = `${deps.baseUrl()}#/share/${route.code}`;
  const link = <a className="persist-embed-open" href={openHref} target="_blank" rel="noopener noreferrer">{p('persist.embed.open')} ↗</a>;

  if (loaded.kind === 'error') return <div className="panel bad persist-embed" role="alert">{p('persist.notice.failed', { reason: loaded.reason })}{' '}{link}</div>;
  if (loaded.kind === 'loading') return <div className="panel muted persist-embed">{p('persist.lib.loading')}</div>;
  return (
    <div className="persist-embed">
      <div className="row persist-embed-bar"><span className="muted small">{loaded.name}</span><span className="spacer" />{link}</div>
      {route.view === 'run'
        ? <RunScreen sim={sim} onReport={() => undefined} onSetup={() => undefined} embedded />
        : shot
          ? <Report shot={shot} onRerun={() => compute(loaded.cfg, loaded.name, loaded.scenario)} onEdit={() => window.open(openHref, '_blank', 'noopener')} />
          : <div className="panel muted" role="status">{p('persist.imp.checking', { pct })}</div>}
    </div>
  );
}
