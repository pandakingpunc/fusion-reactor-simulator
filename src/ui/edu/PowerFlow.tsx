import { useMemo, useState } from 'react';
import { PowerWindow, balanceTotals, pickDiag, powerBalance, powerFlowGraph } from '../../edu/powerFlow';
import { layoutSankey } from '../../edu/sankey';
import type { EduKey } from '../../edu/i18n';
import { fmtNum } from '../format';
import { Explain } from './Explain';
import { useEduT } from './useEduT';
import './edu.css';

interface Props {
  frames: readonly { t: number; d: Readonly<Record<string, number>> }[];
  /** part of the run to start with (default: the flat-top) */
  initialWindow?: 'flat' | 'shot' | 'peak';
  /** hide the window selector (a caller that fixes the part of the run) */
  fixedWindow?: boolean;
}

const W = 640, H = 300, MARGIN = { l: 112, r: 124, t: 18, b: 8 };
const NODE_W = 14;

/** colour of a node: sources warm, radiation blue, transport green, the rest grey */
const COLOR: Record<string, string> = {
  aux: '#f8961e', ohmic: '#ffd166', alpha: '#f72585', release: '#9d4edd', plasma: '#4cc9f0',
  radiation: '#4895ef', brems: '#8ecae6', sync: '#48bfe3', line: '#4361ee', radMisc: '#7f8ba3',
  conduction: '#06d6a0', elm: '#ef476f', stored: '#b5e48c', other: '#7f8ba3',
};
/** the glossary term each bar explains */
const TERM: Record<string, string> = {
  aux: 'nbi', ohmic: 'ohmic', alpha: 'alpha', radiation: 'radLine', brems: 'brems', sync: 'sync', conduction: 'transport',
  elm: 'elm', stored: 'stored',
};

/**
 * The power balance of a run as a Sankey diagram: the heating sources on the left, the plasma in the middle, the
 * losses and the stored energy on the right, the radiation split in the last column. The part of the run shown
 * (flat-top, whole shot, instant of the highest Q) is chosen above it.
 */
export function PowerFlow({ frames, initialWindow = 'flat', fixedWindow }: Props) {
  const t = useEduT();
  const [win, setWin] = useState<'flat' | 'shot' | 'peak'>(initialWindow);

  const pb = useMemo(() => powerBalance(pickDiag(frames, win as PowerWindow)), [frames, win]);
  const layout = useMemo(() => {
    if (!pb) return null;
    const g = powerFlowGraph(pb);
    return layoutSankey(g.nodes, g.links, { width: W - MARGIN.l - MARGIN.r, height: H - MARGIN.t - MARGIN.b, nodeWidth: NODE_W, nodePad: 16 });
  }, [pb]);

  const label = (id: string) => t(`pf.node.${id}` as EduKey);
  const total = pb ? balanceTotals(pb).in : 0;

  const WINDOWS: { id: 'flat' | 'shot' | 'peak'; key: EduKey }[] = [
    { id: 'flat', key: 'pf.win.flat' }, { id: 'shot', key: 'pf.win.shot' }, { id: 'peak', key: 'pf.win.peak' },
  ];

  return (
    <div className="pf">
      <div className="pf-tools">
        <span><b>{t('pf.title')}</b> <span className="muted small">{t('pf.sub')}</span></span>
        {!fixedWindow && (
          <span className="seg" role="group" aria-label={t('pf.window')}>
            {WINDOWS.map((w) => (
              <button key={w.id} type="button" className={win === w.id ? 'active' : ''} aria-pressed={win === w.id} onClick={() => setWin(w.id)}>{t(w.key)}</button>
            ))}
          </span>
        )}
      </div>
      {!pb || !layout || !layout.nodes.length ? (
        <div className="muted small">{t('pf.na')}</div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} role="img"
            aria-label={t('pf.aria', { items: layout.nodes.filter((n) => n.layer !== 1).map((n) => `${label(n.id)} ${fmtNum(n.value)} MW`).join(', ') })}>
            <g transform={`translate(${MARGIN.l},${MARGIN.t})`}>
              {layout.links.map((l) => (
                <path key={`${l.source}-${l.target}`} d={l.path} fill="none" stroke={COLOR[l.target === 'plasma' ? l.source : l.target] ?? '#7f8ba3'}
                  strokeOpacity={0.45} strokeWidth={Math.max(l.width, 0.5)}>
                  <title>{`${label(l.source)} → ${label(l.target)}: ${fmtNum(l.value)} MW`}</title>
                </path>
              ))}
              {layout.nodes.map((n) => {
                const hasOut = layout.links.some((l) => l.source === n.id);
                const hasIn = layout.links.some((l) => l.target === n.id);
                const src = !hasIn, sink = !hasOut;
                const x = n.x, cy = n.y + n.h / 2;
                return (
                  <g key={n.id}>
                    <rect x={n.x} y={n.y} width={n.w} height={Math.max(n.h, 1)} fill={COLOR[n.id] ?? '#7f8ba3'} rx={2}>
                      <title>{`${label(n.id)}: ${fmtNum(n.value)} MW`}</title>
                    </rect>
                    {src && <text x={x - 6} y={cy - 2} textAnchor="end">{label(n.id)}</text>}
                    {src && <text className="pf-val" x={x - 6} y={cy + 10} textAnchor="end">{fmtNum(n.value)} MW</text>}
                    {sink && <text x={x + n.w + 6} y={cy - 2}>{label(n.id)}</text>}
                    {sink && <text className="pf-val" x={x + n.w + 6} y={cy + 10}>{fmtNum(n.value)} MW</text>}
                    {!src && !sink && <text x={x + n.w / 2} y={n.y - 5} textAnchor="middle">{label(n.id)} · {fmtNum(n.value)} MW</text>}
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="pf-legend">
            <span>{t('pf.total', { p: fmtNum(total) })}</span>
            {Object.entries(TERM).filter(([id]) => layout.nodes.some((n) => n.id === id)).map(([id, term]) => (
              <Explain key={id} term={term}><span>{label(id)}</span></Explain>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
