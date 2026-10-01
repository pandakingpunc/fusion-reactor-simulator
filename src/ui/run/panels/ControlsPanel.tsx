import React from 'react';
import { fmtNum } from '../../format';
import { useT } from '../../state/store';
import { ctrlSlider, sliderPos, sliderStep, sliderValue } from '../controls';

interface Props {
  controls: Record<string, number>;
  /** control values at load time (centre of multiplicative sliders) */
  defaults: Record<string, number>;
  disabled: boolean;
  onChange: (patch: Record<string, number>) => void;
}

/** Live intervention sliders (heating, fueling, density, confinement multipliers …). */
export function ControlsPanel({ controls, defaults, disabled, onChange }: Props) {
  const t = useT();
  const keys = Object.keys(controls);
  if (!keys.length) return null;
  const sliders = keys.map((k) => ({ k, v: controls[k], s: ctrlSlider(k, controls[k], defaults[k], t) }));

  return (
    <div className="panel">
      <h3>{t('run.controls')}</h3>
      {sliders.map(({ k, v, s }) => (
        <div key={k} className="slider-row" title={s.hint}>
          <div>
            <div className="lbl">{s.label} {s.unit && <span className="mono">[{s.unit}]</span>}</div>
            <input type="range" aria-label={s.label} aria-valuetext={`${fmtNum(v, 4)}${s.unit ? ` ${s.unit}` : ''}`} min={sliderPos(s, s.min)} max={sliderPos(s, s.max)} step={sliderStep(s)} value={sliderPos(s, v)}
              onChange={(e) => onChange({ [k]: sliderValue(s, parseFloat(e.target.value)) })} disabled={disabled} />
          </div>
          <input type="text" className="num" value={fmtNum(v, 4)} readOnly tabIndex={-1} aria-hidden="true" />
        </div>
      ))}
      {sliders.some((x) => !x.s.known) && <div className="hint">{t('run.ctrlUnknown')}</div>}
    </div>
  );
}
