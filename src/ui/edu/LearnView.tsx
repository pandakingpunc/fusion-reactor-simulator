import { useCallback, useEffect, useState } from 'react';
import { MISSIONS, MissionId, missionKey } from '../../edu/missions';
import type { EduKey } from '../../edu/i18n';
import { RunPool } from '../pool/pool';
import type { WorkerFactory } from '../state/sim';
import { GlossaryView } from './GlossaryView';
import { MissionView } from './MissionView';
import { loadSolved, saveSolved } from './progress';
import { useEduT } from './useEduT';
import './edu.css';

interface Props {
  /** the simulation worker factory (tests inject a fake worker) */
  createWorker: WorkerFactory;
  /** pool to run the missions on (a pool of the screen's own by default) */
  pool?: RunPool;
}

type Section = 'missions' | 'glossary';

/** The Learn screen: the ten missions and the glossary. */
export function LearnView({ createWorker, pool: given }: Props) {
  const t = useEduT();
  const [section, setSection] = useState<Section>('missions');
  const [open, setOpen] = useState<MissionId | null>(null);
  const [solved, setSolved] = useState<string[]>(() => loadSolved());
  const [term, setTerm] = useState<string | null>(null);
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

  const mission = open ? MISSIONS.find((m) => m.id === open) : undefined;

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
                onClick={() => { setSection(s); if (s === 'missions') setOpen(null); }}>{t(`edu.sub.${s}` as EduKey)}</button>
            ))}
          </div>
        </div>
      </div>

      {section === 'glossary' && <GlossaryView selected={term} onSelect={setTerm} />}

      {section === 'missions' && !mission && (
        <div className="mission-grid">
          {MISSIONS.map((m) => {
            const done = solved.includes(m.id);
            return (
              <button key={m.id} type="button" className={`mission-card ${done ? 'solved' : ''}`} onClick={() => setOpen(m.id)}>
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
          onBack={() => setOpen(null)} onOpenGlossary={(id) => { setTerm(id); setSection('glossary'); }} />
      )}
    </div>
  );
}
