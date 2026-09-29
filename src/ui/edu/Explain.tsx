import { ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
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
 * English and Turkish come from the education dictionaries.
 */
export function Explain({ term, children, onOpenGlossary }: Props) {
  const t = useEduT();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(term);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => { setCurrent(term); }, [term]);
  const close = useCallback(() => { setOpen(false); setCurrent(term); }, [term]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => { if (root.current && !root.current.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); };
  }, [open, close]);

  const entry = findTerm(current);
  if (!entry) return <>{children}</>;
  const k = termKeys(entry.id);
  return (
    <span className="explain" ref={root} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(); } }}>
      {children}
      <button type="button" className="explain-btn" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={t('edu.explain', { term: t(termKeys(term).name) })} onClick={() => (open ? close() : setOpen(true))}>ⓘ</button>
      {open && (
        <span className="explain-pop" role="dialog" aria-label={t(k.name)} id={id}>
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
        </span>
      )}
    </span>
  );
}
