// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadLocale } from '../../i18n';
import { requirePreset, runShot } from '../../physics/index';
import { ITER_15D } from '../../physics/presets';
import { Simulation } from '../../physics/simulation';
import { TerminationInfo } from '../../physics/types';
import { AppStoreContext, createAppStore } from '../state/store';
import { TerminationBox, solverFailureTitle, terminationClass } from './TerminationBox';
import { LiveValuesPanel } from './panels/LiveValuesPanel';
import { makeMeta } from '../../worker/host';
import { toUiFrame } from '../../worker/protocol';

const numerical: TerminationInfo = {
  t: 3.2, natural: false, reason: 'Numerical failure',
  diagnosis: 'The implicit transport solver could not advance the plasma: singular heat system.',
  fix: 'This is a solver failure, not a plasma limit: try a coarser radial grid (nRho).',
};
const equilibrium: TerminationInfo = { ...numerical, t: 0, reason: 'Equilibrium failure', diagnosis: 'No Grad–Shafranov equilibrium could be computed.', fix: 'Bring elongation into the usual range.' };
const quench: TerminationInfo = { t: 0, natural: false, reason: 'Magnet quench', diagnosis: 'B_coil exceeds the limit.', fix: 'Use a stronger conductor.' };
const scheduled: TerminationInfo = { t: 5, natural: true, reason: 'Scheduled end', diagnosis: 'The shot reached t_end.', fix: '' };

const html = (term: TerminationInfo, locale: 'en' | 'tr' = 'en', full = false) =>
  renderToStaticMarkup(React.createElement(AppStoreContext.Provider, { value: createAppStore({ locale }) }, React.createElement(TerminationBox, { term, timeUnit: 's', full })));

describe('how a finished shot is shown', () => {
  beforeAll(async () => { await loadLocale('tr'); });

  it("names the two 1.5D solver failures and shows the model's diagnosis and fix, as for a magnet quench", () => {
    for (const term of [numerical, equilibrium]) {
      const h = html(term);
      expect(h).toContain(term.reason);
      expect(h).toContain(term.diagnosis);
      expect(h).toContain(term.fix);
      expect(h).toContain('How to fix:');
      expect(h).toContain('A solver failure, not a plasma limit');
      expect(h).toContain('diag-box bad');
    }
    const q = html(quench);
    expect(q).toContain('Magnet quench');
    expect(q).toContain(quench.diagnosis);
    expect(q).toContain(quench.fix);
    expect(q).not.toContain('solver failure');
  });

  it('classifies the verdicts: solver failure and disruption bad, scheduled end good, other aborts neutral', () => {
    expect(solverFailureTitle(numerical)).toBe('end.numerical');
    expect(solverFailureTitle(equilibrium)).toBe('end.equilibrium');
    expect(solverFailureTitle(quench)).toBeUndefined();
    expect(solverFailureTitle({ ...numerical, natural: true })).toBeUndefined();
    expect(terminationClass(numerical)).toBe('bad');
    expect(terminationClass(quench)).toBe('');
    expect(terminationClass(scheduled)).toBe('ok');
    expect(terminationClass({ ...quench, disruption: {} as never })).toBe('bad');
  });

  it('translates the failure name and the note into Turkish, keeping the model text', () => {
    const h = html(numerical, 'tr');
    expect(h).toContain('Sayısal hata');
    expect(h).toContain('Bir çözücü hatası');
    expect(h).toContain(numerical.diagnosis);
    expect(html(equilibrium, 'tr')).toContain('Denge hatası');
  });

  it('writes the reason, diagnosis and fix of a real disruption in Turkish, and leaves them English in English', () => {
    const term = runShot({ ...(requirePreset('JET').cfg as object), n_target: 3e20, n_rampTime: 1, t_end: 4 } as never).report.termination;
    expect(term.disruption).toBeDefined();
    const h = html(term, 'tr', true);
    expect(h).toContain('Yoğunluk sınırı disrupsiyonu (Greenwald)');
    expect(h).toContain('Termal sönme');
    expect(h).toContain('Nasıl düzeltilir:');
    expect(h).toContain('Hedef yoğunluğu düşürün');
    expect(h).not.toContain('Thermal quench');
    expect(html(term, 'en', true)).toContain(term.diagnosis);
  });

  it('keeps the model text of a sentence no rule knows, in both languages', () => {
    const odd: TerminationInfo = { t: 1, natural: false, reason: 'Unknown stop', diagnosis: 'Something the model has not said before: 1.5.', fix: 'Try again.' };
    expect(html(odd, 'tr')).toContain(odd.diagnosis);
    expect(html(odd, 'tr')).toContain('Try again.');
  });

  it('the report layout adds the end time; an empty fix text leaves no fix line', () => {
    expect(html(numerical, 'en', true)).toContain('@ 3.20 s');
    expect(html(scheduled)).not.toContain('How to fix');
  });

  it('the live panel shows the verdict and the power-balance tiles of a 1.5D shot', () => {
    const sim = new Simulation({ ...ITER_15D, t_end: 20 });
    const report = { ...sim.report(), termination: equilibrium };
    const meta = makeMeta(sim.model);
    const markup = renderToStaticMarkup(React.createElement(AppStoreContext.Provider, { value: createAppStore() },
      React.createElement(LiveValuesPanel, { meta, last: toUiFrame(sim.history[0]), report })));
    expect(markup).toContain('Equilibrium failure');
    expect(markup).toContain(equilibrium.fix);
    expect(markup).toContain('Power balance and energy');
    expect(markup).toContain('title="P_beam (NBI ions, deposited)"');
    expect(markup).toContain('>no<'); // the ignited tile is a word, not 0
  }, 60_000);
});
