/** The scenario of the run about to start, in the wizard's last step: its name and what it contains (nothing when there is none). */
import React from 'react';
import { useApp } from '../state/store';
import { STEP_TITLES } from '../wizard/schema';
import { summarize } from './model';
import { useScenarioT } from './useScenarioT';

export default function ScenarioSummary() {
  const t = useScenarioT();
  const scenario = useApp((s) => s.scenario);
  if (!scenario) return null;
  const s = summarize(scenario);
  return <p className="small"><b>{STEP_TITLES.scenario}</b>: {scenario.name ? `${scenario.name}: ` : ''}{t('scn.summary', { waveforms: s.waveforms, triggers: s.triggers })}</p>;
}
