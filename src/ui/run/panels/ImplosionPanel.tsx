import React from 'react';
import { ReactorConfig } from '../../../physics/types';
import { SimMeta, UiFrame } from '../../../worker/protocol';
import { Implosion } from '../../viz/Implosion';
import { useT } from '../../state/store';

interface Props { meta: SimMeta; cfg: ReactorConfig; frames: UiFrame[]; t: number }

/** Schematic implosion of a pulsed device (ICF capsule or MTF liner). */
export function ImplosionPanel({ meta, cfg, frames, t: time }: Props) {
  const t = useT();
  const icf = meta.method.startsWith('icf');
  return (
    <div className="panel tight">
      <h3>{t('run.implosion')}</h3>
      <Implosion kind={icf ? 'icf' : 'mtf'} frames={frames} t={time} tEnd={meta.tEnd} timeUnit={meta.timeUnit}
        geometry={meta.geometry} bang_ns={icf ? (cfg as { pulse_ns?: number }).pulse_ns : undefined} height={260} />
    </div>
  );
}
