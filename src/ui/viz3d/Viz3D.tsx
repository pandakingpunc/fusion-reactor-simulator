/**
 * The 3D view of a magnetic device: nested flux surfaces of the plasma, the vacuum vessel and the toroidal field coils, with a
 * cut-away, drawn with raw WebGL2 (a canvas 2D projection when WebGL2 is not available). This module and everything under it
 * is a separate chunk: the run screen loads it on demand (Viz3DPanel).
 *
 * The canvas is created and removed by the effect that creates the viewer, not by React: a canvas keeps the context type it was
 * given, and a WebGL context that was released cannot be reused, so every start (including the second one of React's strict mode
 * in development, and the fallback to 2D) gets a fresh element.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../state/store';
import { attachControls } from './controls';
import { Viz3DSource, toViewerInput } from './input';
import type { Scene3D } from './scene';
import { Viewer3D, ViewerInput, ViewerMode } from './viewer';

type Notice = 'noWebgl' | 'lost' | 'failed' | null;

export interface Viz3DProps extends Viz3DSource {
  /** height of the drawing area in CSS pixels */
  height?: number;
}

const toggleStyle = (on: boolean): React.CSSProperties | undefined => (on ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined);

export default function Viz3D(props: Viz3DProps) {
  const t = useT();
  const { height = 340 } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<Viewer3D | null>(null);
  const [mode, setMode] = useState<ViewerMode>('webgl2');
  const [notice, setNotice] = useState<Notice>(null);
  const [source, setSource] = useState<Scene3D['source'] | null>(null);
  const [cutaway, setCutaway] = useState(true);
  const [coils, setCoils] = useState(true);
  const [spin, setSpin] = useState(false);

  const input: ViewerInput = useMemo(
    () => toViewerInput(props),
    [props.meta, props.cfg, props.last, props.events, props.disrupted, props.eqFrame, props.profFrame],
  );
  // what a viewer created later (after a fallback, or by strict mode) has to start from
  const latest = useRef({ input, toggles: { cutaway, coils, autoRotate: spin }, label: t('viz3d.aria') });
  latest.current = { input, toggles: { cutaway, coils, autoRotate: spin }, label: t('viz3d.aria') };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', latest.current.label);
    canvas.setAttribute('aria-describedby', 'viz3d-help');
    Object.assign(canvas.style, {
      width: '100%', height: `${height}px`, display: 'block', touchAction: 'none', borderRadius: '6px', background: '#0b0e14', cursor: 'grab',
    });
    host.appendChild(canvas);
    let viewer: Viewer3D;
    try {
      viewer = new Viewer3D(canvas, mode);
    } catch {
      // no WebGL2, or its shaders do not build here: the projection on a 2D canvas takes over
      host.removeChild(canvas);
      if (mode === 'webgl2') { setNotice('noWebgl'); setMode('2d'); } else setNotice('failed');
      return undefined;
    }
    canvasRef.current = canvas;
    viewerRef.current = viewer;
    viewer.onContextLost = () => { setNotice('lost'); setMode('2d'); };
    viewer.onSceneBuilt = (s) => setSource(s.source);
    const detach = attachControls(canvas, () => viewerRef.current);
    const measure = () => viewer.resize(canvas.clientWidth || 300, height, window.devicePixelRatio || 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    viewer.setToggles(latest.current.toggles);
    viewer.setInput(latest.current.input);
    return () => {
      detach();
      ro.disconnect();
      viewer.dispose();
      viewerRef.current = null;
      canvasRef.current = null;
      host.removeChild(canvas);
    };
  }, [mode, height]);

  useEffect(() => { viewerRef.current?.setInput(input); }, [input]);
  useEffect(() => { viewerRef.current?.setToggles({ cutaway, coils, autoRotate: spin }); }, [cutaway, coils, spin]);
  useEffect(() => { canvasRef.current?.setAttribute('aria-label', t('viz3d.aria')); }, [t]);

  const stellarator = props.meta.method === 'stellarator';
  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        <button className="btn sm" aria-pressed={cutaway} style={toggleStyle(cutaway)} onClick={() => setCutaway((v) => !v)}>{t('viz3d.cutaway')}</button>
        <button className="btn sm" aria-pressed={coils} style={toggleStyle(coils)} onClick={() => setCoils((v) => !v)}>{t('viz3d.coils')}</button>
        <button className="btn sm" aria-pressed={spin} style={toggleStyle(spin)} onClick={() => setSpin((v) => !v)}>{t('viz3d.spin')}</button>
        <button className="btn sm" onClick={() => viewerRef.current?.resetView()}>{t('viz3d.reset')}</button>
      </div>
      {notice && <div className="hint" role="status" style={{ marginBottom: 4 }}>{t(`viz3d.${notice}` as const)}</div>}
      <div ref={hostRef} />
      <div id="viz3d-help" className="hint">{t('viz3d.help')}</div>
      <div className="hint">
        {source ? t(source === 'equilibrium' ? 'viz3d.srcEq' : 'viz3d.srcMiller') : ''} · {t('viz3d.schematic')}
        {stellarator ? ` · ${t('viz3d.stellarator')}` : ''}
      </div>
    </div>
  );
}
