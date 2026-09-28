import { describe, expect, it } from 'vitest';
import { translator } from '../../i18n';
import { ctrlSlider, sliderPos, sliderValue } from './controls';

const t = translator('en');

describe('live control sliders', () => {
  it('multiplicative controls get a log slider centred on the model default (FRC 10, mirror 50)', () => {
    for (const def of [10, 50]) {
      const s = ctrlSlider('kappa_conf', def, def, t);
      expect(s).toMatchObject({ label: 'Confinement multiplier', log: true, min: def / 10, max: def * 10, known: true });
      expect(sliderPos(s, def)).toBeCloseTo((sliderPos(s, s.min) + sliderPos(s, s.max)) / 2, 12);
      expect(sliderValue(s, sliderPos(s, 3 * def))).toBeCloseTo(3 * def, 9);
      expect(s.hint).toContain('×/÷10');
    }
  });

  it('the centre stays at the load-time default while the value moves', () => {
    const s = ctrlSlider('kappa_conf', 400, 50, t);
    expect([s.min, s.max]).toEqual([5, 500]);
  });

  it('keeps symbols untranslated and descriptive labels translated', () => {
    expect(ctrlSlider('P_NBI_MW', 33, 33, t).label).toBe('P_NBI');
    expect(ctrlSlider('n_target_1e20', 1, 1, translator('en')).label).toBe('Target n_e');
  });

  it('unknown controls size their range from the load-time value', () => {
    const s = ctrlSlider('mystery_knob', 90, 10, t);
    expect(s).toMatchObject({ label: 'mystery_knob', known: false, min: 0, max: 30, log: false });
  });
});
