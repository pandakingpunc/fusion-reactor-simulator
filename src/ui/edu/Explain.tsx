import { ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { findTerm, termKeys } from '../../edu/glossary';
import { useEduT } from './useEduT';
import './edu.css';

interface Props {
  /** glossary term id */
  term: string;
  /** the text the popover explains (shown as it is); a lone ⓘ button when omitted */
  children?: ReactNode;
  /** called by the "Open in the glossary" link of the popover (the link is not shown without it) */
  onOpenGlossary?: (termId: string) => void;
}

/**
 * A word or symbol with a small ⓘ button: it opens a popover with the glossary entry of the term, its symbol and
 * its related terms (which the popover can switch to). Escape, a click outside and the button close it.
 * The popover is rendered in a portal on document.body with fixed positioning, so that a scrolling ancestor (the
 * Compare table panel, a table cell) can neither clip it nor grow a scrollbar because of it.
 * English and Turkish come from the education dictionaries.
 */
export function Explain({ term, children, onOpenGlossary }: Props) {
  const t = useEduT();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(term);
  const root = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const id = useId();

  useEffect(() => { setCurrent(term); }, [term]);
  const close = useCallback(() => { setOpen(false); setCurrent(term); }, [term]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => {
      const n = e.target as Node;
      if (root.current && !root.current.contains(n) && !(pop.current && pop.current.contains(n))) close();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); };
  }, [open, close]);

  // place the fixed popover under the button (above it when there is no room below), inside the viewport
  const place = useCallback(() => {
    const b = btn.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const w = pop.current?.offsetWidth ?? 300;
    const h = pop.current?.offsetHeight ?? 0;
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left, vw - w - 8));
    const below = r.bottom + 6;
    const top = below + h > vh - 8 && r.top - h - 6 >= 8 ? r.top - h - 6 : below;
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  }, []);
  useLayoutEffect(() => { if (open) place(); else setPos(null); }, [open, current, place]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, place]);

  const entry = findTerm(current);
  if (!entry) return <>{children}</>;
  const k = termKeys(entry.id);
  return (
    <span className="explain" ref={root} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(); } }}>
      {children}
      <button type="button" className="explain-btn" ref={btn} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={t('edu.explain', { term: t(termKeys(term).name) })} onClick={() => (open ? close() : setOpen(true))}>ⓘ</button>
      {open && createPortal(
        <span className="explain-pop" role="dialog" aria-label={t(k.name)} id={id} ref={pop}
          style={{ position: 'fixed', left: pos ? pos.left : 0, top: pos ? pos.top : 0, visibility: pos ? 'visible' : 'hidden' }}>
          <span className="ep-name">{t(k.name)}</span>{entry.symbol && <span className="ep-sym">{entry.symbol}</span>}
          <span className="ep-def">{t(k.def)}</span>
          {entry.related.length > 0 && (
            <span className="ep-rel">{t('edu.glossary.related')}:{' '}
              {entry.related.map((r) => (
                <button type="button" key={r} className="chip" onClick={() => setCurrent(r)}>{t(termKeys(r).name)}</button>
              ))}
            </span>
          )}
          <span className="ep-foot">
            {onOpenGlossary ? <button type="button" className="btn sm" onClick={() => { onOpenGlossary(entry.id); close(); }}>{t('edu.inGlossary')}</button> : <span />}
            <button type="button" className="btn sm" onClick={close}>{t('edu.close')}</button>
          </span>
        </span>,
        document.body,
      )}
    </span>
  );
}
