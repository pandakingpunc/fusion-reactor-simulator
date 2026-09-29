import React, { useMemo } from 'react';
import { MagneticConfig } from '../../../physics/types';
import { UiFrame } from '../../../worker/protocol';
import { Popcon } from '../../charts/Popcon';
import { PopconWorkerFactory, popconCfg } from '../../charts/usePopcon';
import { useT } from '../../state/store';

interface Props {
  cfg: MagneticConfig;
  last: UiFrame | null;
  /** the run's frames: the trajectory over the map (without them only the operating point is shown) */
  frames?: readonly UiFrame[];
  /** live controls: the confinement multiplier and the impurity fraction change the map, the others are steered */
  controls?: Readonly<Record<string, number>>;
  /** apply a live-control patch (click-to-steer); without it, or with `steerable` false, the map is read-only */
  onSteer?: (patch: Record<string, number>) => void;
  steerable?: boolean;
  createWorker?: PopconWorkerFactory;
}

/** POPCON map of the configuration under the live controls, with the run's trajectory and the operating point. */
export function PopconPanel({ cfg, last, frames, controls, onSteer, steerable = true, createWorker }: Props) {
  const t = useT();
  const { H98, H_ISS04, cZ } = controls ?? {};
  // the map depends on these three controls only: moving the others does not start a new job
  const mapCfg = useMemo(() => popconCfg(cfg, { H98, H_ISS04, cZ } as Record<string, number>), [cfg, H98, H_ISS04, cZ]);
  const shown = useMemo(() => frames ?? (last ? [last] : []), [frames, last]);
  return (
    <div className="panel tight">
      <div className="panel-title"><h3>{t('run.popcon')}</h3><span className="muted small">{t('run.popconSub')}</span></div>
      <Popcon cfg={mapCfg} frames={shown} height={280} heatingMW={last?.d.P_aux} controls={controls}
        onSteer={steerable ? onSteer : undefined} createWorker={createWorker} />
    </div>
  );
}
