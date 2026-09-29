import React from 'react';
import { TerminationInfo } from '../../physics/types';
import { MessageKey } from '../../i18n';
import { fmtTime } from '../format';
import { useT } from '../state/store';

/**
 * How a shot ended when the 1.5D solver, not the plasma, ended it. The model reports these two as
 * ordinary terminations (reason, diagnosis, fix) with `natural: false` and no disruption record:
 *  - 'Numerical failure'   the implicit transport step could not be advanced at any step size;
 *  - 'Equilibrium failure' no Grad–Shafranov equilibrium exists for the requested boundary.
 * The reason string is the model's identifier of the failure (src/physics/profiles); the UI names it in the
 * interface language and shows the model's diagnosis and fix text under it, as for a magnet quench.
 */
const SOLVER_FAILURES: Record<string, MessageKey> = {
  'Numerical failure': 'end.numerical',
  'Equilibrium failure': 'end.equilibrium',
};

/** Title key of a solver-failure termination, or undefined for any other way a shot can end. */
export function solverFailureTitle(term: TerminationInfo): MessageKey | undefined {
  return term.natural || term.disruption ? undefined : SOLVER_FAILURES[term.reason];
}

/** CSS state of the verdict box: a disruption or a solver failure is bad, a scheduled end is good, other aborts are neutral. */
export function terminationClass(term: TerminationInfo): 'bad' | 'ok' | '' {
  return term.disruption || solverFailureTitle(term) ? 'bad' : term.natural ? 'ok' : '';
}

interface Props {
  term: TerminationInfo;
  timeUnit: string;
  /** report layout: time next to the title, fix text with its own label */
  full?: boolean;
  style?: React.CSSProperties;
}

/** The verdict of a finished shot: reason, diagnosis and how to fix it (live values panel and report). */
export function TerminationBox({ term, timeUnit, full, style }: Props) {
  const t = useT();
  const failure = solverFailureTitle(term);
  return (
    <div className={`diag-box ${terminationClass(term)}`} style={style}>
      <div>
        <b>{failure ? t(failure) : term.reason}</b>
        {full && <span className="muted small"> @ {fmtTime(term.t, timeUnit)}</span>}
      </div>
      {failure && <div className="small warn" style={{ marginTop: 2 }}>{t('end.solverNote')}</div>}
      <p className={full ? undefined : 'small muted'} style={{ margin: full ? '6px 0' : '4px 0' }}>{term.diagnosis}</p>
      {term.fix && <div className={full ? undefined : 'small'}><span className="accent">{t('rep.fix')}</span> {term.fix}</div>}
    </div>
  );
}
