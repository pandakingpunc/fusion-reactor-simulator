import { useMemo } from 'react';
import { fmtAxis } from '../format';
import { Trace, extent, tickValues } from './overlay';

export interface OverlaySeries { id: number; name: string; color: string; trace: Trace }

interface Props {
  series: OverlaySeries[];
  log: boolean;
  xLabel: string;
  yLabel: string;
  title: string;
}

const W = 640, H = 300, PAD = { l: 56, r: 12, t: 10, b: 34 };

/** Overlay of time traces on shared axes (SVG polylines). A log axis drops the non-positive points. */
export function OverlayChart({ series, log, xLabel, yLabel, title }: Props) {
  const traces = useMemo(() => series.map((s) => s.trace), [series]);
  const ext = useMemo(() => extent(traces, log), [traces, log]);
  if (!ext) return <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} />;

  let { x0, x1, y0, y1 } = ext;
  if (x1 <= x0) x1 = x0 + 1;
  if (log) { y0 = 10 ** Math.floor(Math.log10(y0)); y1 = 10 ** Math.ceil(Math.log10(y1)); if (y1 <= y0) y1 = y0 * 10; }
  else { const pad = (y1 - y0) * 0.05 || Math.abs(y1) * 0.05 || 1; y0 -= pad; y1 += pad; }
  const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;
  const X = (v: number) => PAD.l + ((v - x0) / (x1 - x0)) * pw;
  const Y = (v: number) => PAD.t + ph - ((log ? Math.log10(v) - Math.log10(y0) : v - y0) / (log ? Math.log10(y1) - Math.log10(y0) : y1 - y0)) * ph;
  const xt = tickValues(x0, x1, false, 6), yt = tickValues(y0, y1, log, 5);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
      {yt.map((v) => (
        <g key={`y${v}`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={Y(v)} y2={Y(v)} stroke="var(--border)" strokeWidth={0.6} />
          <text x={PAD.l - 5} y={Y(v)} textAnchor="end" dominantBaseline="middle">{fmtAxis(v)}</text>
        </g>
      ))}
      {xt.map((v) => (
        <g key={`x${v}`}>
          <line x1={X(v)} x2={X(v)} y1={PAD.t} y2={H - PAD.b} stroke="var(--border)" strokeWidth={0.4} />
          <text x={X(v)} y={H - PAD.b + 13} textAnchor="middle">{fmtAxis(v)}</text>
        </g>
      ))}
      <rect x={PAD.l} y={PAD.t} width={pw} height={ph} fill="none" stroke="var(--border)" />
      <text className="axis-label" x={PAD.l + pw / 2} y={H - 4} textAnchor="middle">{xLabel}</text>
      <text className="axis-label" x={12} y={PAD.t + ph / 2} textAnchor="middle" transform={`rotate(-90 12 ${PAD.t + ph / 2})`}>{yLabel}</text>
      {series.map((s) => {
        const pts = s.trace.points.filter((p) => !log || p.y > 0);
        if (pts.length < 2) return null;
        return (
          <polyline key={s.id} fill="none" stroke={s.color} strokeWidth={1.6} strokeLinejoin="round"
            points={pts.map((p) => `${X(p.x).toFixed(1)},${Y(Math.min(Math.max(p.y, y0), y1)).toFixed(1)}`).join(' ')}>
            <title>{s.name}</title>
          </polyline>
        );
      })}
    </svg>
  );
}
