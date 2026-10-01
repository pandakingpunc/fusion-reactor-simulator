// @vitest-environment jsdom
/**
 * The validation line of a preset card says what the line is worth: a tick only for a plain pass, and a distinct glyph with its own accessible
 * label for a benchmark beyond 20 %, a calibration shot and a documented miss. The statuses are derived from `npm run validate`
 * (src/physics/validation/references.ts), and this test keeps the two in step.
 */
import { useState } from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ITER } from '../../physics/presets';
import { PRESETS, type ValidationStatus } from '../../physics/presets';
import { REFERENCE_CHECKS } from '../../physics/validation/references';
import type { ReactorConfig } from '../../physics/types';
import { AppStore, AppStoreContext, createAppStore } from '../state/store';
import { installDomStubs } from '../testing/dom';
import { Wizard } from './Wizard';

beforeAll(installDomStubs);
let store: AppStore = createAppStore();
afterEach(async () => { cleanup(); await store.actions.setLocale('en'); });

function mount(initial: ReactorConfig = ITER) {
  store = createAppStore();
  function Host() {
    const [cfg, setCfg] = useState(initial);
    const [name, setName] = useState('Test');
    return <Wizard cfg={cfg} setCfg={setCfg} name={name} setName={setName} onRun={() => undefined} />;
  }
  render(<AppStoreContext.Provider value={store}><Host /></AppStoreContext.Provider>);
}

/** the validation line of a preset card, by the preset's name */
const line = (name: string): HTMLElement => {
  const card = screen.getAllByText(name).map((e) => e.closest('.preset')).find((c) => c) as HTMLElement;
  return card.querySelector('.val') as HTMLElement;
};

const STATUS: Record<string, ValidationStatus> = { SPARC: 'benchmarked', JET15: 'miss', NIF: 'miss', NIF210808: 'calibration' };
const status = (id: string): ValidationStatus => PRESETS.find((p) => p.id === id)!.validationStatus ?? 'ok';

describe('validation status of the presets', () => {
  it('is assigned to the four presets whose line is a benchmark beyond 20 %, a calibration or a documented miss, and to no other', () => {
    for (const p of PRESETS) expect(p.validationStatus ?? 'ok', p.id).toBe(STATUS[p.id] ?? 'ok');
    // a status belongs to a preset with a validation line
    for (const p of PRESETS) if (p.validationStatus) expect(p.validation, p.id).toBeTruthy();
  });

  it('follows the literature table: a miss is a known failure there, a calibration is a calibration row, a benchmark is a benchmark row', () => {
    const rows = (id: string) => REFERENCE_CHECKS.filter((c) => c.preset === id);
    for (const p of PRESETS) {
      if (!p.validation) continue;
      const st = status(p.id);
      const known = rows(p.id).some((c) => c.knownFailure !== undefined);
      const calibration = rows(p.id).some((c) => c.role === 'calibration');
      // a calibration shot also has a known failure (its T_i), but the line names the calibration; a miss is a known failure of a preset that is not one
      expect(known && !calibration, `${p.id} has a known failure`).toBe(st === 'miss');
      expect(calibration, `${p.id} has a calibration row`).toBe(st === 'calibration');
      if (st === 'benchmarked') expect(rows(p.id).some((c) => c.kind === 'benchmark'), `${p.id} has a benchmark row`).toBe(true);
    }
    // every known failure of the table that has a preset line is on a preset marked as a miss (or as the calibration shot whose T_i it is)
    const withLine = new Set(PRESETS.filter((p) => p.validation).map((p) => p.id));
    const missing = REFERENCE_CHECKS.filter((c) => c.knownFailure !== undefined && withLine.has(c.preset) && status(c.preset) !== 'miss' && status(c.preset) !== 'calibration').map((c) => c.id);
    expect(missing).toEqual([]);
  });
});

describe('wizard: the validation line of the preset cards', () => {
  it('puts a tick only before a plain pass; the others get their own glyph and label, none is a tick', () => {
    mount();
    const cases: [string, string, string][] = [
      ['ITER', '✓', 'Validated: within the published range'],
      ['SPARC', '≈', 'Benchmark: passes, but deviates more than 20 % from the published value'],
      ['NIF (N221204)', '✗', 'Documented miss: the model does not reach the published value'],
      ['NIF (N210808)', '◎', 'Calibration shot: passes by construction, not a validation'],
      ['JET DTE2 · 1.5D profiles', '✗', 'Documented miss: the model does not reach the published value'],
    ];
    for (const [name, glyph, label] of cases) {
      const glyphEl = within(line(name)).getByRole('img');
      expect(glyphEl.textContent, name).toBe(glyph);
      expect(glyphEl.getAttribute('aria-label'), name).toBe(label);
      expect(glyphEl.getAttribute('title'), name).toBe(label);
    }
    // the texts stay as they were, only the glyph differs
    expect(line('NIF (N221204)').textContent).toBe('✗ Published G = 1.5; model 0.67, a documented miss');
    expect(line('NIF (N210808)').textContent).toBe('◎ Calibration shot of the ICF model');
    // exactly the presets with status ok have a tick, and the other validation lines have none
    const ticks = [...document.querySelectorAll('.preset .val')].filter((v) => v.textContent!.startsWith('✓'));
    expect(ticks).toHaveLength(PRESETS.filter((p) => p.validation && status(p.id) === 'ok').length);
    expect(document.querySelectorAll('.preset .val.miss, .preset .val.calibration, .preset .val.benchmarked')).toHaveLength(Object.keys(STATUS).length);
    for (const v of document.querySelectorAll('.preset .val.miss, .preset .val.calibration, .preset .val.benchmarked')) expect(v.textContent!.startsWith('✓')).toBe(false);
  });

  it('has the accessible labels in Turkish too, and no English label is left', async () => {
    mount();
    await act(async () => { await store.actions.setLocale('tr'); });
    await waitFor(() => expect(within(line('NIF (N221204)')).getByRole('img').getAttribute('aria-label')).toBe('Belgelenmiş sapma: model yayınlanan değere ulaşmıyor'));
    expect(within(line('NIF (N210808)')).getByRole('img').getAttribute('aria-label')).toBe('Kalibrasyon atışı: yapı gereği geçer, doğrulama sayılmaz');
    expect(within(line('SPARC')).getByRole('img').getAttribute('aria-label')).toBe('Kıyas: geçiyor, ancak yayınlanan değerden %20’den fazla sapıyor');
    expect(within(line('ITER')).getByRole('img').getAttribute('aria-label')).toBe('Doğrulandı: yayınlanmış aralığın içinde');
    for (const img of document.querySelectorAll('.preset .val [role="img"]')) expect(img.getAttribute('aria-label')).not.toMatch(/Validated|Benchmark:|Calibration shot|Documented miss/);
  });
});
