import React, { useEffect, useMemo, useState } from 'react';
import { MagneticConfig } from '../../physics/types';
import { SimApi } from '../useSim';
import { TimeChart, Series } from '../charts/TimeChart';
import { Popcon } from '../charts/Popcon';
import { CrossSection } from '../viz/CrossSection';
import { Implosion } from '../viz/Implosion';
import { fmtNum, fmtTime, keVtoMC, PALETTE } from '../format';
import { CONTROL_DEFS, DEFAULT_CHART_GROUPS, KPI_PREF, SPEEDS, ctrlDef } from './controls';

interface Props { sim: SimApi; onReport: () => void; onSetup: () => void }

export function RunScreen({ sim, onReport, onSetup }: Props) {
  const { state } = sim;
  const { meta, frames, events, status } = state;
  const last = frames.length ? frames[frames.length - 1] : null;
  const [groupsOn, setGroupsOn] = useState<Set<string>>(new Set(DEFAULT_CHART_GROUPS));
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);

  useEffect(() => { setScrubIdx(null); }, [state.runId]);

  const groups = useMemo(() => {
    if (!meta) return [] as { name: string; series: Series[] }[];
    const m = new Map<string, Series[]>();
    meta.diagSpecs.forEach((s, i) => {
      const arr = m.get(s.group) ?? [];
      arr.push({ key: s.key, label: s.label, unit: s.unit, color: PALETTE[i % PALETTE.length], log: s.log });
      m.set(s.group, arr);
    });
    return [...m.entries()].map(([name, series]) => ({ name, series }));
  }, [meta]);

  const kpis = useMemo(() => {
    if (!meta || !last) return [];
    const specs = new Map(meta.diagSpecs.map((s) => [s.key, s]));
    return KPI_PREF.filter((k) => specs.has(k) && last.d[k] !== undefined).slice(0, 12).map((k) => ({ key: k, spec: specs.get(k)!, v: last.d[k] }));
  }, [meta, last]);

  if (!meta) return <div className="panel">{status === 'error' ? <pre className="err">{state.error}</pre> : <span className="muted">Loading simulation…</span>}</div>;

  const isMag = meta.kind === 'magnetic' && (meta.method === 'tokamak' || meta.method === 'spherical_tokamak' || meta.method === 'stellarator');
  const isPulsed = meta.kind === 'pulsed';
  const cfg = state.cfg!;
  const canPlay = status === 'ready' || status === 'paused';
  const stepDt = meta.tEnd / 200;

  const seekTo = (idx: number) => { sim.rewind(Math.max(0, Math.min(idx, frames.length - 1))); setScrubIdx(null); };
  const seekT = (t: number) => { let lo = 0; while (lo < frames.length - 1 && frames[lo].t < t) lo++; seekTo(lo); };

  const disrupted = status === 'done' && !!state.report?.termination?.disruption;
  const lastElm = events.length ? [...events].reverse().find((e) => e.kind === 'ELM') : undefined;
  const elmFlash = lastElm && last ? Math.max(0, 1 - (last.t - lastElm.t) / (meta.tEnd * 0.01 + 0.05)) : 0;

  return (
    <div className="run">
      <div className="panel tight controls">
        <div className="row" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 4 }}>
            {status === 'running'
              ? <button className="btn icon" onClick={sim.pause} title="Pause">❚❚</button>
              : <button className="btn icon primary" onClick={sim.play} disabled={!canPlay} title="Play">▶</button>}
            <button className="btn icon" onClick={() => sim.step(stepDt)} disabled={!canPlay} title={`Step (${fmtTime(stepDt, meta.timeUnit)})`}>▶❚</button>
            <button className="btn icon" onClick={() => seekTo(0)} disabled={frames.length < 2 || status === 'loading'} title="Rewind to start">⏮</button>
            <button className="btn icon" onClick={sim.restart} title="Restart (same configuration)">⟲</button>
          </div>
          <div className="speed-btns">
            {SPEEDS.map((s) => <button key={s} className={`btn ${state.speed === s ? 'active' : ''}`} onClick={() => sim.setSpeed(s)}>{s}×</button>)}
          </div>
          <span className="muted small">{meta.timeUnit === 's' ? '1× = real time' : `1× ≈ shot in 8 s (${meta.timeUnit} scale)`}</span>
          <div className="spacer" />
          <span className="mono small">t = <b>{fmtTime(state.t, meta.timeUnit)}</b> / {fmtTime(meta.tEnd, meta.timeUnit)} · dt = {fmtNum(state.dt, 2)} · {state.nSteps}  steps · {frames.length}  frames · {state.wallMs.toFixed(0)}  ms/tick</span>
          {status === 'done' && <button className="btn primary sm" onClick={onReport}>Report ▶</button>}
          <button className="btn sm" onClick={onSetup}>Setup</button>
        </div>
        <div className="timeline" style={{ marginTop: 6 }}>
          <input type="range" min={0} max={Math.max(frames.length - 1, 1)} value={scrubIdx ?? frames.length - 1}
            onChange={(e) => setScrubIdx(parseInt(e.target.value))} onMouseUp={() => scrubIdx !== null && seekTo(scrubIdx)} onKeyUp={() => scrubIdx !== null && seekTo(scrubIdx)} />
        </div>
        {scrubIdx !== null && frames[scrubIdx] && <div className="small accent">rewind to: {fmtTime(frames[scrubIdx].t, meta.timeUnit)}  (on release, the simulation resumes from this point; subsequent history is deleted)</div>}
      </div>

      <div className="left">
        <div className="panel">
          <h3>Live values</h3>
          <div className="kpis">
            {kpis.map(({ key, spec, v }) => (
              <div className="kpi" key={key}>
                <div className="k">{spec.label}</div>
                <div className="v">{fmtNum(v)}<span className="u">{spec.unit}</span></div>
                {(key === 'Ti' || key === 'Te') && <div className="small muted mono">{fmtNum(keVtoMC(v), 3)} M°C</div>}
              </div>
            ))}
          </div>
          {state.report?.termination && (
            <div className={`diag-box ${state.report.termination.disruption ? 'bad' : state.report.termination.natural ? 'ok' : ''}`} style={{ marginTop: 8 }}>
              <b>{state.report.termination.reason}</b>
              <div className="small muted" style={{ marginTop: 4 }}>{state.report.termination.diagnosis}</div>
            </div>
          )}
        </div>
        {Object.keys(state.controls).length > 0 && (
          <div className="panel">
            <h3>Live controls</h3>
            {Object.entries(state.controls).map(([k, v]) => {
              const d = ctrlDef(k, v);
              const toSlider = (x: number) => (d.log ? Math.log10(Math.max(x, d.min)) : x);
              const fromSlider = (x: number) => (d.log ? Math.pow(10, x) : x);
              return (
                <div key={k} className="slider-row" title={d.hint}>
                  <div>
                    <div className="lbl">{d.label} {d.unit && <span className="mono">[{d.unit}]</span>}</div>
                    <input type="range" min={toSlider(d.min)} max={toSlider(d.max)} step={d.log ? 0.01 : d.step} value={toSlider(v)}
                      onChange={(e) => sim.control({ [k]: fromSlider(parseFloat(e.target.value)) })} disabled={status === 'done'} />
                  </div>
                  <input type="text" className="num" value={fmtNum(v, 4)} readOnly />
                </div>
              );
            })}
            {!CONTROL_DEFS[Object.keys(state.controls)[0]] && <div className="hint">Unknown control key: automatic range.</div>}
          </div>
        )}
        <div className="panel">
          <div className="panel-title"><h3>Event log</h3><span className="muted small">{events.length}</span></div>
          <div className="event-log">
            {events.length === 0 && <span className="muted">no events yet</span>}
            {events.slice(-200).reverse().map((ev, i) => (
              <div key={i} className={`event ${ev.kind}`}><span className="t">{fmtTime(ev.t, meta.timeUnit)}</span><span>{ev.msg}</span></div>
            ))}
          </div>
        </div>
      </div>

      <div className="center">
        <div className="panel tight">
          <div className="row" style={{ gap: 6 }}>
            <span className="muted small">Charts:</span>
            {groups.map((g) => (
              <button key={g.name} className={`btn sm ${groupsOn.has(g.name) ? 'active' : ''}`} style={groupsOn.has(g.name) ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                onClick={() => setGroupsOn((s) => { const n = new Set(s); n.has(g.name) ? n.delete(g.name) : n.add(g.name); return n; })}>{g.name}</button>
            ))}
            <span className="spacer" />
            <span className="muted small">wheel: zoom · drag: pan · double-click: reset · click: rewind</span>
          </div>
        </div>
        {groups.filter((g) => groupsOn.has(g.name)).map((g) => (
          <TimeChart key={g.name} title={g.name} frames={frames} series={g.series} timeUnit={meta.timeUnit} tEnd={meta.tEnd} events={events}
            live={status === 'running'} resetKey={state.runId} height={200} onSeek={canPlay || status === 'done' ? seekT : undefined} />
        ))}
      </div>

      <div className="right">
        {isMag && last && (
          <div className="panel tight">
            <h3>Poloidal cross-section</h3>
            <CrossSection R={meta.geometry.R} a={meta.geometry.a} kappa={meta.geometry.kappa} delta={meta.geometry.delta}
              gap={meta.geometry.gap ?? 0.5} coilThickness={meta.geometry.coilThickness ?? 0.5}
              T0_keV={last.d.Ti0 ?? last.d.Ti ?? 0} alphaT={(cfg as MagneticConfig).transport?.alpha_T ?? 1}
              Hmode={(last.d.H_mode ?? 0) > 0.5} divertor={(meta.geometry.kappa ?? 1) > 1.25} stellarator={meta.method === 'stellarator'}
              disrupted={disrupted} elmFlash={elmFlash} height={320} />
          </div>
        )}
        {isMag && (
          <div className="panel tight">
            <div className="panel-title"><h3>Live POPCON</h3><span className="muted small">P_aux map, 0D approximation</span></div>
            <Popcon cfg={cfg as MagneticConfig} point={last ? { n: (last.d.ne ?? 0) * 1e20, T: last.d.Ti ?? 0 } : null} height={280} />
          </div>
        )}
        {isPulsed && (
          <div className="panel tight">
            <h3>Implosion</h3>
            <Implosion kind={meta.method.startsWith('icf') ? 'icf' : 'mtf'} frames={frames} t={state.t} tEnd={meta.tEnd} timeUnit={meta.timeUnit}
              geometry={meta.geometry} bang_ns={meta.method.startsWith('icf') ? (cfg as { pulse_ns?: number }).pulse_ns : undefined} height={260} />
          </div>
        )}
        <div className="panel tight">
          <h3>Geometry summary</h3>
          <table className="kv"><tbody>
            {Object.entries(meta.geometry).slice(0, 12).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{fmtNum(v)}</td></tr>)}
          </tbody></table>
        </div>
      </div>
    </div>
  );
}
