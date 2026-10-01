import { useEffect, useMemo, useRef, useState } from 'react';
import { GLOSSARY, GLOSSARY_GROUPS, GlossaryGroup, termKeys } from '../../edu/glossary';
import type { EduKey } from '../../edu/i18n';
import { useEduT } from './useEduT';
import './edu.css';

interface Props { selected?: string | null; onSelect?: (id: string | null) => void }

/** The glossary: a searchable list of every term, filtered by group; a term can be selected (and linked to). */
export function GlossaryView({ selected = null, onSelect }: Props) {
  const t = useEduT();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<GlossaryGroup | 'all'>('all');
  const selRef = useRef<HTMLElement | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GLOSSARY.filter((g) => {
      if (group !== 'all' && g.group !== group) return false;
      if (!q) return true;
      const k = termKeys(g.id);
      return `${t(k.name)} ${t(k.def)} ${g.symbol ?? ''} ${g.id}`.toLowerCase().includes(q);
    });
  }, [query, group, t]);

  useEffect(() => { selRef.current?.scrollIntoView?.({ block: 'center' }); }, [selected]);

  return (
    <div className="edu">
      <div className="glossary-tools">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('edu.glossary.search')} aria-label={t('edu.glossary.search')} />
        <button type="button" className={`chip ${group === 'all' ? 'active' : ''}`} aria-pressed={group === 'all'} onClick={() => setGroup('all')}>{t('edu.glossary.all')}</button>
        {GLOSSARY_GROUPS.map((g) => (
          <button type="button" key={g} className={`chip ${group === g ? 'active' : ''}`} aria-pressed={group === g} onClick={() => setGroup(g)}>{t(`grp.${g}` as EduKey)}</button>
        ))}
        <span className="muted small">{t('edu.glossary.count', { n: rows.length })}</span>
      </div>
      {rows.length === 0 && <div className="panel muted">{t('edu.glossary.none')}</div>}
      <div className="glossary-list">
        {rows.map((g) => {
          const k = termKeys(g.id);
          const sel = selected === g.id;
          return (
            <article key={g.id} id={`gl-${g.id}`} className={`gl-entry ${sel ? 'selected' : ''}`} ref={sel ? (el) => { selRef.current = el; } : undefined} aria-current={sel ? 'true' : undefined}>
              <h3>{t(k.name)}{g.symbol && <span className="sym" title={t('edu.glossary.symbol')}>{g.symbol}</span>}<span className="grp">{t(`grp.${g.group}` as EduKey)}</span></h3>
              <p>{t(k.def)}</p>
              {g.related.length > 0 && (
                <div className="rel">{t('edu.glossary.related')}:
                  {g.related.map((r) => (
                    <button type="button" key={r} className="chip" onClick={() => { setQuery(''); setGroup('all'); onSelect?.(r); }}>{t(termKeys(r).name)}</button>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
