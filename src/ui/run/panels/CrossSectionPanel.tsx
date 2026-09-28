import React, { useMemo } from 'react';
import { MagneticConfig, SimEvent } from '../../../physics/types';
import { SimMeta, UiFrame } from '../../../worker/protocol';
import { CrossSection } from '../../viz/CrossSection';
import { useT } from '../../state/store';

interface Props {
  meta: SimMeta;
  cfg: MagneticConfig;
  last: UiFrame;
  events: SimEvent[];
  disrupted: boolean;
  /** 1.5D only: latest equilibrium and profile frames */
  eqFrame: UiFrame | null;
  profFrame: UiFrame | null;
}

/** Poloidal cross-section of a magnetic device (flux surfaces from the equilibrium in 1.5D). */
export function CrossSectionPanel({ meta, cfg, last, events, disrupted, eqFrame, profFrame }: Props) {
  const t = useT();
  const g = meta.geometry;
  const is15 = (g.profiles ?? 0) > 0;
  const crossProf = useMemo(() => (profFrame?.prof ? { rho: profFrame.prof.rho, Te: profFrame.prof.Te } : null), [profFrame]);
  let lastElm: SimEvent | undefined;
  for (let i = events.length - 1; i >= 0 && !lastElm; i--) if (events[i].kind === 'ELM') lastElm = events[i];
  const elmFlash = lastElm ? Math.max(0, 1 - (last.t - lastElm.t) / (meta.tEnd * 0.01 + 0.05)) : 0;

  return (
    <div className="panel tight">
      <h3>{t('run.cross')}</h3>
      <CrossSection R={g.R} a={g.a} kappa={g.kappa} delta={g.delta}
        gap={g.gap ?? 0.5} coilThickness={g.coilThickness ?? 0.5}
        T0_keV={last.d.Ti0 ?? last.d.Ti ?? 0} alphaT={cfg.transport?.alpha_T ?? 1}
        Hmode={(last.d.H_mode ?? 0) > 0.5} divertor={(g.kappa ?? 1) > 1.25} stellarator={meta.method === 'stellarator'}
        disrupted={disrupted} elmFlash={elmFlash} height={320}
        eq={is15 ? eqFrame?.eq ?? null : null} prof={is15 ? crossProf : null} />
    </div>
  );
}
