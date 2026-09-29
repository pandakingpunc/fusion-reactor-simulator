/**
 * Live POPCON (Plasma OPeration CONtour): the auxiliary power P_aux a steady state needs at each (n̄, T̄), Q contours,
 * the run's trajectory and the operating point on top; hover for the values of a point, click to steer the shot there.
 * APPROXIMATION: 0D steady state, profile factors (1−ρ²)^α, T_i = T_e; impurities and He ash through Z_eff; the map is
 * qualitative and does not coincide with the full model (see physics/popcon.ts).
 *
 * The grid is computed in a worker (usePopcon): a 16 × 16 preview while the controls move, the 44 × 44 map when they
 * rest. This component only draws it (popconRender.ts), at the width of its container and the device pixel ratio
 * (useCanvasSize). The map (cells, contours, axes) is drawn once per grid and size into an offscreen layer; a new
 * frame of the run or a movement of the pointer only composites it and draws the overlay.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MagneticConfig } from '../../physics/types';
import { UiFrame } from '../../worker/protocol';
import type { PopconStage } from '../../worker/popconProtocol';
import { fmtNum } from '../format';
import { prepareCanvas, useCanvasSize } from '../hooks/useCanvasSize';
import { useT } from '../state/store';
import { FrameColumns } from './lod';
import { MapLayer, MapPoint, PopconView, drawOverlay, drawPopcon, fromPx, heatingContour, inPlot, readoutAt, trajectoryOf } from './popconRender';
import { PopconWorkerFactory, steerPatch, usePopcon } from './usePopcon';

export interface PopconProps {
  /** configuration of the map (with the live controls applied: popconCfg) */
  cfg: MagneticConfig;
  /** the run's frames: the trajectory, and the last one is the operating point */
  frames?: readonly UiFrame[];
  /** an operating point of its own [n in m⁻³, T in keV] instead of the last frame's (the Learn missions set it with sliders); null shows none */
  point?: MapPoint | null;
  height?: number;
  /** auxiliary heating applied now [MW]: its contour is drawn */
  heatingMW?: number | null;
  /** the live controls of the run (click-to-steer spreads the heating over them) */
  controls?: Readonly<Record<string, number>>;
  /** click-to-steer: called with the live-control patch of the clicked point; without it the map only shows values */
  onSteer?: (patch: Record<string, number>) => void;
  /** worker factory and stage plan (tests) */
  createWorker?: PopconWorkerFactory;
  stages?: readonly PopconStage[];
}

/** the shot has arrived at the steering point when it is within this fraction of each axis of it */
const TARGET_REACHED = 0.03;

export function Popcon({ cfg, frames, point: given, height = 260, heatingMW, controls, onSteer, createWorker, stages }: PopconProps) {
  const t = useT();
  const { ref, width, dpr } = useCanvasSize<HTMLCanvasElement>();
  const popcon = usePopcon(cfg, { createWorker, stages });
  const { grid, axes } = popcon;
  const view = useMemo<PopconView | null>(() => (axes ? { width, height, nMax: axes.nMax, Tmax: axes.Tmax } : null), [axes, width, height]);

  // the run's path over the map, thinned by the chart level of detail; the last frame is the operating point
  const colsRef = useRef<FrameColumns | null>(null);
  const trajectory = useMemo(() => trajectoryOf((colsRef.current ??= new FrameColumns()).sync(frames ?? []), 240), [frames]);
  const last = frames && frames.length ? frames[frames.length - 1] : null;
  const lastPoint = useMemo<MapPoint | null>(() => (last && Number.isFinite(last.d.ne) && Number.isFinite(last.d.Ti) ? { n: last.d.ne * 1e20, T: last.d.Ti } : null), [last]);
  const point = given !== undefined ? given : lastPoint;

  // the contour of the heating power applied now, found again only when the grid or that power changes
  const heatingSegments = useMemo(() => (grid && heatingMW != null && heatingMW > 0 ? heatingContour(grid, heatingMW) : null), [grid, heatingMW]);
  const layerRef = useRef<MapLayer | null>(null);

  const [hover, setHover] = useState<MapPoint | null>(null);
  const [target, setTarget] = useState<{ p: MapPoint; Paux_MW: number } | null>(null);

  // the shot has arrived: drop the steering marker
  useEffect(() => {
    if (target && point && view && Math.abs(point.n - target.p.n) < TARGET_REACHED * view.nMax && Math.abs(point.T - target.p.T) < TARGET_REACHED * view.Tmax) setTarget(null);
  }, [point, target, view]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !grid || !view) return;
    const ctx = prepareCanvas(cv, width, height, dpr);
    if (!ctx) return;
    const overlay = { trajectory, point, target: target?.p ?? null, hover, heatingSegments };
    const layer = (layerRef.current ??= new MapLayer()).get(grid, view, cfg, dpr);
    if (!layer) { drawPopcon(ctx, grid, view, cfg, overlay); return; }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(layer, 0, 0, width, height);
    drawOverlay(ctx, grid, view, overlay);
  }, [ref, grid, view, cfg, trajectory, point, target, hover, heatingSegments, width, height, dpr]);

  const at = (e: React.MouseEvent<HTMLCanvasElement>): MapPoint | null => {
    if (!view) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    return inPlot(view, x, y) ? fromPx(view, x, y) : null;
  };
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSteer || !grid || !axes) return;
    const p = at(e);
    const ro = p && readoutAt(grid, cfg, axes.nMax, axes.Tmax, p.n, p.T);
    if (!p || !ro) return;
    const patch = steerPatch({ n: p.n, Paux_MW: ro.Paux_MW }, controls ?? {});
    if (!Object.keys(patch).length) return;
    onSteer(patch);
    setTarget({ p, Paux_MW: ro.Paux_MW });
  };

  const ro = grid && axes && hover ? readoutAt(grid, cfg, axes.nMax, axes.Tmax, hover.n, hover.T) : null;
  const refining = popcon.pending && grid !== null;
  return (
    <div>
      <canvas ref={ref} role="img" aria-label={t('popcon.aria')} style={{ width: '100%', height, display: 'block', cursor: onSteer ? 'crosshair' : 'default' }}
        onMouseMove={(e) => setHover(at(e))} onMouseLeave={() => setHover(null)} onClick={onClick} />
      <div className="row small" style={{ gap: 8, minHeight: 18, alignItems: 'center' }}>
        {popcon.error ? <span className="badge bad" role="alert">{t('popcon.error', { msg: popcon.error })}</span>
          : !popcon.available ? <span className="muted">{t('popcon.unavailable')}</span>
          : ro ? <span className="mono" data-testid="popcon-readout">{readoutText(ro, t)}</span>
          : target ? <span className="mono muted">{t('popcon.steered', { n: fmtNum(target.p.n / 1e20), p: fmtNum(Math.max(0, target.Paux_MW)) })}</span>
          : <span className="muted">{t(onSteer ? 'popcon.hintSteer' : 'popcon.hint')}</span>}
        <span className="spacer" />
        {refining && grid && <span className="badge warn">{t('popcon.preview', { nx: grid.nx, ny: grid.ny })}</span>}
      </div>
    </div>
  );
}

function readoutText(ro: NonNullable<ReturnType<typeof readoutAt>>, t: ReturnType<typeof useT>): string {
  const parts = [
    `n̄ ${fmtNum(ro.n / 1e20)}·10²⁰`, `T ${fmtNum(ro.T)} keV`, `P_aux ${fmtNum(ro.Paux_MW)} MW`,
    `Q ${Number.isFinite(ro.Q) ? fmtNum(ro.Q) : '∞'}`, `β_N ${fmtNum(ro.betaN)}`,
  ];
  if (ro.selfHeated) parts.push(t('popcon.selfHeated'));
  if (ro.aboveBetaLimit) parts.push(t('popcon.betaLimit'));
  if (ro.belowLH) parts.push(t('popcon.belowLH'));
  if (ro.aboveGreenwald) parts.push(t('popcon.aboveGreenwald'));
  return parts.join(' · ');
}
