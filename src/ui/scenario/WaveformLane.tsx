/**
 * One lane of the scenario editor: the waveform of a control over the run, as an SVG the user can work on.
 *
 *  - drag a point to move it (its time is held between its neighbours, its value inside the sanity limits of the control);
 *    the vertical scale is frozen while a point is dragged, so the lane does not rescale under the pointer;
 *  - double-click an empty place to add a point there; Delete removes the focused point; the arrow keys nudge it
 *    (a hundredth of the axis per press, ten times that with Shift);
 *  - a point on the configured value (a `null` point) is drawn hollow; the configured value is the dashed line, and it is what the
 *    control keeps before the first point.
 * In the run view the same lane is read-only and shows what the run actually did (`actual`, the control values of the frames) over the
 * programmed waveform, with a cursor at the simulated time.
 *
 * All geometry is a function of the props; the pointer, keyboard and form events only call onMovePoint / onInsertPoint / onRemovePoint.
 */
import React, { useRef, useState } from 'react';
import type { WaveformSpec } from '../../physics/scenario';
import { fmtAxis, fmtNum, fmtTime } from '../format';
import { laneRange, resolved, waveformPolyline } from './model';
import { useScenarioT } from './useScenarioT';

export const LANE_W = 640;
export const LANE_H = 124;
const PL = 48, PR = 12, PT = 10, PB = 22;

/** what a run actually did: a control value at each frame time */
export interface LaneSeries { t: readonly number[]; v: readonly number[] }

export interface LaneProps {
  ctlKey: string;
  label: string;
  unit: string;
  /** the programmed waveform (null: the control has none, only `actual` is drawn) */
  wf: WaveformSpec | null;
  /** the configured value of the control (what `null` and the time before the first point mean) */
  base: number;
  tEnd: number;
  timeUnit: string;
  actual?: LaneSeries;
  /** simulated time of the run, drawn as a cursor */
  now?: number;
  editable?: boolean;
  onMovePoint?(i: number, t: number, v: number): void;
  onInsertPoint?(t: number, v: number): void;
  onRemovePoint?(i: number): void;
  /** the lane has a problem (drawn with the warning colour) */
  invalid?: boolean;
  /** the point that is selected (in the table below the lane) */
  selected?: number | null;
  onSelect?(i: number | null): void;
}

/** At most `n` samples of a series (the last one always kept), so that a long run does not make a huge polyline. */
export function thin(s: LaneSeries, n = 500): [number, number][] {
  const len = Math.min(s.t.length, s.v.length);
  const stride = Math.max(1, Math.ceil(len / n));
  const out: [number, number][] = [];
  for (let i = 0; i < len; i += stride) out.push([s.t[i], s.v[i]]);
  if (len && (len - 1) % stride !== 0) out.push([s.t[len - 1], s.v[len - 1]]);
  return out;
}

/** A polyline that holds each value until the next sample (the controls are staircases of the steps). */
const stair = (pts: readonly [number, number][]): [number, number][] => pts.flatMap((p, i) => (i === 0 ? [p] : [[p[0], pts[i - 1][1]] as [number, number], p]));

export function WaveformLane(p: LaneProps) {
  const t = useScenarioT();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [frozen, setFrozen] = useState<[number, number] | null>(null);
  const plotW = LANE_W - PL - PR, plotH = LANE_H - PT - PB;

  const auto = laneRange(p.ctlKey, p.wf, p.base);
  const actualPts = p.actual ? thin(p.actual) : [];
  let [lo, hi] = frozen ?? auto;
  if (!frozen && actualPts.length) {
    const av = actualPts.map((q) => q[1]).filter(Number.isFinite);
    if (av.length) { lo = Math.min(lo, ...av); hi = Math.max(hi, ...av); if (hi <= lo) hi = lo + 1; }
  }
  const X = (time: number) => PL + (time / p.tEnd) * plotW;
  const Y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * plotH;
  const path = (pts: readonly [number, number][]) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${X(a).toFixed(1)},${Y(b).toFixed(1)}`).join(' ');

  const toData = (clientX: number, clientY: number): { t: number; v: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const sx = r.width ? LANE_W / r.width : 1, sy = r.height ? LANE_H / r.height : 1;
    const x = (clientX - r.left) * sx, y = (clientY - r.top) * sy;
    return { t: ((x - PL) / plotW) * p.tEnd, v: hi - ((y - PT) / plotH) * (hi - lo) };
  };

  const endDrag = () => { setDrag(null); setFrozen(null); };
  const editable = !!p.editable && !!p.wf;
  const points = p.wf?.points ?? [];
  const yTicks = [lo, (lo + hi) / 2, hi];
  const xTicks = [0, p.tEnd / 2, p.tEnd];
  const valueText = (v: number | null) => `${fmtNum(v === null ? p.base : v, 4)}${p.unit ? ` ${p.unit}` : ''}${v === null ? ` (${t('scn.configuredWord')})` : ''}`;

  const nudge = (i: number, e: React.KeyboardEvent) => {
    if (!editable || !p.wf) return;
    const pt = points[i];
    const big = e.shiftKey ? 10 : 1;
    const dt = (p.tEnd / 100) * big, dv = ((hi - lo) / 100) * big;
    const v = resolved(pt, p.base);
    switch (e.key) {
      case 'ArrowLeft': p.onMovePoint?.(i, pt[0] - dt, v); break;
      case 'ArrowRight': p.onMovePoint?.(i, pt[0] + dt, v); break;
      case 'ArrowUp': p.onMovePoint?.(i, pt[0], v + dv); break;
      case 'ArrowDown': p.onMovePoint?.(i, pt[0], v - dv); break;
      case 'Delete': case 'Backspace': p.onRemovePoint?.(i); break;
      default: return;
    }
    e.preventDefault();
  };

  return (
    <svg ref={svgRef} className={`scn-lane${p.invalid ? ' invalid' : ''}${editable ? ' editable' : ''}`} viewBox={`0 0 ${LANE_W} ${LANE_H}`} role="group"
      aria-label={t('scn.laneLabel', { label: p.label })}
      onPointerMove={(e) => {
        if (drag === null || !editable) return;
        const d = toData(e.clientX, e.clientY);
        if (d) p.onMovePoint?.(drag, d.t, d.v);
      }}
      onPointerUp={endDrag} onPointerCancel={endDrag}
      onDoubleClick={(e) => {
        if (!editable) return;
        const d = toData(e.clientX, e.clientY);
        if (d && d.t >= 0 && d.t <= p.tEnd) p.onInsertPoint?.(d.t, d.v);
      }}>
      <rect x={PL} y={PT} width={plotW} height={plotH} className="scn-plot" />
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PL} x2={PL + plotW} y1={Y(v)} y2={Y(v)} className="scn-grid" />
          <text x={PL - 4} y={Y(v) + 3} textAnchor="end" className="scn-tick">{fmtAxis(v)}</text>
        </g>
      ))}
      {xTicks.map((v, i) => (
        <text key={i} x={X(v)} y={LANE_H - 6} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="scn-tick">{fmtTime(v, p.timeUnit)}</text>
      ))}
      {/* the configured value: what the control keeps before its first point */}
      <line x1={PL} x2={PL + plotW} y1={Y(p.base)} y2={Y(p.base)} className="scn-base"><title>{t('scn.configured', { value: valueText(p.base) })}</title></line>
      {p.wf && <path d={path(waveformPolyline(p.wf, p.base, p.tEnd))} className="scn-prog" data-testid={`prog-${p.ctlKey}`} />}
      {actualPts.length > 0 && <path d={path(stair(actualPts))} className="scn-actual" data-testid={`actual-${p.ctlKey}`} />}
      {p.now !== undefined && p.now > 0 && p.now <= p.tEnd && <line x1={X(p.now)} x2={X(p.now)} y1={PT} y2={PT + plotH} className="scn-now" />}
      {editable && points.map((pt, i) => {
        const v = resolved(pt, p.base);
        return (
          <circle key={i} cx={X(pt[0])} cy={Y(v)} r={p.selected === i || drag === i ? 6 : 5} tabIndex={0} role="button"
            className={`scn-pt${pt[1] === null ? ' null' : ''}${p.selected === i ? ' sel' : ''}`}
            aria-label={t('scn.point', { n: i + 1, t: fmtTime(pt[0], p.timeUnit), value: valueText(pt[1]) })}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDrag(i);
              setFrozen([lo, hi]);
              p.onSelect?.(i);
              try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* not every environment can capture the pointer */ }
            }}
            onFocus={() => p.onSelect?.(i)}
            onKeyDown={(e) => nudge(i, e)}
            onDoubleClick={(e) => e.stopPropagation()}>
            <title>{`${fmtTime(pt[0], p.timeUnit)}: ${valueText(pt[1])}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}
