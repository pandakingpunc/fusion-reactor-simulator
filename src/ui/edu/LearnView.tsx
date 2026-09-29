import { useCallback, useEffect, useState } from 'react';
import { GLOSSARY } from '../../edu/glossary';
import { MISSIONS, MissionId, missionKey } from '../../edu/missions';
import type { EduKey } from '../../edu/i18n';
import { RunPool } from '../pool/pool';
import type { WorkerFactory } from '../state/sim';
import { GlossaryView } from './GlossaryView';
import { MissionView } from './MissionView';
import { loadSolved, saveSolved } from './progress';
import { useEduT } from './useEduT';
import './edu.css';

/** Where in the Learn screen: the mission list (no id) or one mission, the glossary (no id) or one term. */
export interface LearnLocation { section: 'missions' | 'glossary'; id?: string }

interface Props {
  /** the simulation worker factory (tests inject a fake worker) */
  createWorker: WorkerFactory;
  /** pool to run the missions on (a pool of the screen's own by default) */
  pool?: RunPool;
  /**
   * Where the screen is, when the address bar owns it (#/learn/missions/<id>, #/learn/glossary/<term>: the app
   * passes the route). Without it the screen keeps its place in its own state. An id that is not a mission or a
   * term shows the list and is dropped from the address.
   */
  location?: LearnLocation;
  /** the user moved (a tab, a mission, a term): the app writes it to the address (and the address comes back as `location`); `replace` rewrites the current history entry */
  onNavigate?: (to: LearnLocation, opts?: { replace?: boolean }) => void;
}

/** The Learn screen: the ten missions and the glossary. */
export function LearnView({ createWorker, pool: given, location, onNavigate }: Props) {
  const t = useEduT();
  const [place, setPlace] = useState<LearnLocation>({ section: 'missions' });
  const loc = location ?? place;
  const go = useCallback((to: LearnLocation, opts?: { replace?: boolean }) => {
    if (onNavigate) onNavigate(to, opts);
    else setPlace(to);
  }, [onNavigate]);
  const section = loc.section;
  const mission = section === 'missions' && loc.id ? MISSIONS.find((m) => m.id === loc.id) : undefined;
  const term = section === 'glossary' && loc.id && GLOSSARY.some((g) => g.id === loc.id) ? loc.id : null;
  // an address that names nothing we have: show the list, and write that back so that the address is honest
  const unknownId = !!loc.id && (section === 'missions' ? !mission : !term);
  useEffect(() => { if (unknownId) go({ section }, { replace: true }); }, [unknownId, section, go]);
  const [solved, setSolved] = useState<string[]>(() => loadSolved());
  // a pool of its own unless one is given; it is stopped with the screen (and works again if the screen comes back)
  const [own] = useState(() => (given ? null : new RunPool(createWorker, 2)));
  const pool = given ?? own!;
  useEffect(() => () => { pool.dispose(); }, [pool]);

  const markSolved = useCallback((id: MissionId) => {
    setSolved((s) => {
      if (s.includes(id)) return s;
      const next = [...s, id];
      saveSolved(next);
      return next;
    });
  }, []);

  return (
    <div className="edu">
      <div className="edu-head">
        <div>
          <h2>{t('edu.title')}</h2>
          <div className="muted small">{t('edu.sub')}</div>
        </div>
        <div className="row">
          <span className="badge">{t('edu.progress', { n: solved.length, total: MISSIONS.length })}</span>
          <div className="edu-subtabs" role="tablist">
            {(['missions', 'glossary'] as const).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={section === s} className={section === s ? 'active' : ''}
                onClick={() => go({ section: s })}>{t(`edu.sub.${s}` as EduKey)}</button>
            ))}
          </div>
        </div>
      </div>

      {section === 'glossary' && <GlossaryView selected={term} onSelect={(id) => go(id ? { section: 'glossary', id } : { section: 'glossary' })} />}

      {section === 'missions' && !mission && (
        <div className="mission-grid">
          {MISSIONS.map((m) => {
            const done = solved.includes(m.id);
            return (
              <button key={m.id} type="button" className={`mission-card ${done ? 'solved' : ''}`} onClick={() => go({ section: 'missions', id: m.id })}>
                <span className="mc-top">
                  <span className="mc-title">{t(missionKey(m.id, 'title'))}</span>
                  {done ? <span className="badge ok">{t('edu.solved')}</span> : <span className="level" title={t(`lvl.${m.level}` as EduKey)}>{'●'.repeat(m.level)}</span>}
                </span>
                <span className="mc-brief">{t(missionKey(m.id, 'brief'))}</span>
                <span className="muted small">{m.machine} · {t(`lvl.${m.level}` as EduKey)}</span>
              </button>
            );
          })}
        </div>
      )}

      {section === 'missions' && mission && (
        <MissionView key={mission.id} mission={mission} pool={pool} solved={solved.includes(mission.id)} onSolved={markSolved}
          onBack={() => go({ section: 'missions' })} onOpenGlossary={(id) => go({ section: 'glossary', id })} />
      )}
    </div>
  );
}
