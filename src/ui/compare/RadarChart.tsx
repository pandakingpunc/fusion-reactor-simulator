import React from 'react';
import { radarPoints } from './radar';

export interface RadarSeries { id: number; name: string; color: string; radii: number[] }

interface Props {
  labels: string[];
  series: RadarSeries[];
  /** accessible description of the whole chart */
  title: string;
}

const W = 380, H = 330, CX = W / 2, CY = H / 2 + 4, R = 112;
const RINGS = [0.25, 0.5, 0.75, 1];

/** Polygon (radar) chart: one axis per label, one polygon per series, radii already scaled to [0, 1]. */
export function RadarChart({ labels, series, title }: Props) {
  const n = labels.length;
  const axisEnd = radarPoints(new Array(n).fill(1), CX, CY, R);
  const labelPos = radarPoints(new Array(n).fill(1), CX, CY, R + 14);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
      {RINGS.map((r) => (
        <polygon key={r} points={radarPoints(new Array(n).fill(r), CX, CY, R).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
          fill="none" stroke="var(--border)" strokeWidth={r === 1 ? 1.2 : 0.7} />
      ))}
      {axisEnd.map((p, i) => <line key={labels[i]} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="var(--border)" strokeWidth={0.7} />)}
      {labelPos.map((p, i) => (
        <text key={labels[i]} x={p.x} y={p.y} textAnchor={Math.abs(p.x - CX) < 6 ? 'middle' : p.x > CX ? 'start' : 'end'} dominantBaseline="middle">{labels[i]}</text>
      ))}
      {series.map((s) => {
        const pts = radarPoints(s.radii, CX, CY, R);
        return (
          <g key={s.id}>
            <polygon points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill={s.color} fillOpacity={0.16} stroke={s.color} strokeWidth={1.6}>
              <title>{s.name}</title>
            </polygon>
            {pts.map((p, i) => <circle key={labels[i]} cx={p.x} cy={p.y} r={2.4} fill={s.color} />)}
          </g>
        );
      })}
    </svg>
  );
}
