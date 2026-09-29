import { describe, expect, it } from 'vitest';
import { translator } from '../../i18n';
import { createModel, Simulation } from '../../physics/simulation';
import { ITER, ITER_15D, NIF, PRESETS, W7X } from '../../physics/presets';
import { KPI_HEADLINE_MAX, ctrlSlider, selectKpis, sliderPos, sliderValue } from './controls';

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

describe('every live control of every preset model has a slider definition', () => {
  // A control key without a CONTROL_DEFS entry falls back to an unlabelled 0-based slider
  // (ctrlSlider: known === false). Stellarators expose H_ISS04 instead of H98 since ws2b.
  for (const p of PRESETS) {
    it(`${p.id}: no control falls back to the automatic slider`, () => {
      const keys = Object.keys(createModel(p.cfg).getControls());
      const unknown = keys.filter((k) => !ctrlSlider(k, 1, 1, t).known);
      expect(unknown).toEqual([]);
    });
  }
});

/** the diagnostics the v4 physics added to a magnetic frame: each must have a chart channel (DiagSpec) */
const NEW_0D = ['P_beam_heat', 'W_alpha', 'W_beam', 'ignited', 'nbar', 'betaN_th', 'P_loss', 'dWdt', 'P_rad_core', 'P_ei', 'P_ELM', 'P_transport', 'P_cond'];
const NEW_15D = ['P_bound', 'W_alpha', 'W_beam', 'betaN_th', 'ignited', 'P_beam_heat', 'P_rad_core', 'P_loss', 'dWdt_s', 'Wf', 'tauE_scal'];

describe('chart channels of the new diagnostics', () => {
  const frame = (cfg: Parameters<typeof createModel>[0]) => {
    const sim = new Simulation(cfg);
    sim.advance(sim.model.tEnd * 0.05);
    return { specs: sim.model.diagSpecs, d: sim.history[sim.history.length - 1].d };
  };

  it('0D magnetic devices chart every new diagnostic, each in a group', () => {
    for (const cfg of [ITER, W7X]) {
      const { specs, d } = frame(cfg);
      const keys = new Set(specs.map((s) => s.key));
      for (const k of NEW_0D) { expect(keys.has(k), `${cfg.method} ${k}`).toBe(true); expect(d[k], `value of ${k}`).toBeDefined(); }
      for (const s of specs.filter((x) => NEW_0D.includes(x.key))) expect(s.group, s.key).toBeTruthy();
    }
  });

  it('1.5D charts the boundary power, the fast-ion pools, thermal beta_N and the ignition flag next to the earlier ones', () => {
    const { specs, d } = frame({ ...ITER_15D, t_end: 20 });
    const keys = new Set(specs.map((s) => s.key));
    for (const k of NEW_15D) { expect(keys.has(k), k).toBe(true); expect(d[k], `value of ${k}`).toBeDefined(); }
  }, 60_000);

  it('no chart channel of a 0D magnetic model is dead: every spec key is in the frame', () => {
    for (const cfg of [ITER, W7X]) {
      const { specs, d } = frame(cfg);
      expect(specs.filter((s) => d[s.key] === undefined).map((s) => s.key), cfg.method).toEqual([]);
    }
  });
});

describe('live-value tiles', () => {
  const sim = new Simulation(ITER);
  sim.advance(ITER.t_end * 0.05);
  const { d } = sim.history[sim.history.length - 1];

  it('keeps the headline block at its size and puts the power balance and energy content below it', () => {
    const { headline, detail } = selectKpis(sim.model.diagSpecs, d);
    expect(headline).toHaveLength(KPI_HEADLINE_MAX);
    expect(headline.slice(0, 3).map((k) => k.key)).toEqual(['Ti', 'Te', 'ne']);
    const keys = detail.map((k) => k.key);
    for (const k of ['P_alpha', 'P_beam_heat', 'P_rad_core', 'P_transport', 'P_cond', 'P_ELM', 'P_ei', 'P_loss', 'dWdt', 'W_alpha', 'W_beam', 'betaN_th', 'nbar', 'ignited']) expect(keys, k).toContain(k);
    // nothing twice, and every tile has its value from the frame
    expect(new Set([...headline, ...detail].map((k) => k.key)).size).toBe(headline.length + detail.length);
    for (const k of [...headline, ...detail]) expect(k.v).toBe(d[k.key]);
  });

  it('skips a tile whose diagnostic the model does not provide (a pulsed device has no beam power)', () => {
    const nif = new Simulation(NIF);
    nif.advance(1e-9);
    const { headline, detail } = selectKpis(nif.model.diagSpecs, nif.history[nif.history.length - 1].d);
    expect(headline.length).toBeGreaterThan(0);
    expect(detail.map((k) => k.key)).not.toContain('P_beam_heat');
  });

  it('P_cond + P_ELM = P_transport in the frame the tiles show (0D)', () => {
    expect(d.P_cond + d.P_ELM).toBeCloseTo(d.P_transport, 6);
  });
});
