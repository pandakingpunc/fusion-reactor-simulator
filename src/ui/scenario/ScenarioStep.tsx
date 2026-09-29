/**
 * The wizard's Scenario step: the note and the editor, for the model of the configuration being edited (read through a probe of the
 * simulation worker). The scenario lives in the application state; the wizard only hosts this component.
 */
import type { WorkerFactory } from '../state/sim';
import { useApp, useAppStore } from '../state/store';
import ScenarioEditor from './ScenarioEditor';
import { useModel } from './useModel';
import { useScenarioT } from './useScenarioT';

export default function ScenarioStep({ createWorker }: { createWorker: WorkerFactory }) {
  const t = useScenarioT();
  const { actions } = useAppStore();
  const cfg = useApp((s) => s.cfg);
  const scenario = useApp((s) => s.scenario);
  const { ctx, error } = useModel(cfg, createWorker);
  return (
    <>
      <p className="muted small">{t('scn.step.note')}</p>
      <ScenarioEditor scenario={scenario} ctx={ctx ?? null} modelError={error} onChange={actions.setScenario} />
    </>
  );
}
