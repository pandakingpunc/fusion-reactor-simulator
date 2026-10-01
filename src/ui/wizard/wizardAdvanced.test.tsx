// @vitest-environment jsdom
/**
 * The wizard's Advanced section and its Turkish texts, through the component: the section is closed until it is opened and then loads its chunk,
 * shows the model's defaults without writing them, writes a value only when it is edited, and appears on the steps and for the configurations that
 * have something to show. The run summary lists the settings a configuration carries.
 */
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ITER, ITER_15D, JET, JET_15D, TAE, W7X } from '../../physics/presets';
import type { ReactorConfig } from '../../physics/types';
import { AppStore, AppStoreContext, createAppStore } from '../state/store';
import { installDomStubs } from '../testing/dom';
import { Wizard } from './Wizard';
import { getPath } from './schema';

beforeAll(installDomStubs);
let store: AppStore = createAppStore();
afterEach(async () => { cleanup(); await store.actions.setLocale('en'); });

/** the wizard with its configuration in state, as App holds it */
function mount(initial: ReactorConfig) {
  store = createAppStore();
  const seen: { cfg: ReactorConfig; name: string } = { cfg: initial, name: 'Test' };
  function Host() {
    const [cfg, setCfg] = useState(initial);
    const [name, setName] = useState('Test');
    seen.cfg = cfg; seen.name = name;
    return <Wizard cfg={cfg} setCfg={setCfg} name={name} setName={setName} onRun={() => undefined} />;
  }
  render(<AppStoreContext.Provider value={store}><Host /></AppStoreContext.Provider>);
  return seen;
}
const step = (title: string) => fireEvent.click(screen.getAllByText(title).find((e) => e.closest('.step'))!.closest('.step')!);
const input = (label: string) => screen.getByText(label).closest('label')!.querySelector('input.num') as HTMLInputElement;
const type = (el: HTMLInputElement, text: string) => { fireEvent.change(el, { target: { value: text } }); fireEvent.blur(el); };
// the section's chunk is fetched (and, the first time, transformed) when it is opened
const openAdvanced = async () => {
  fireEvent.click(screen.getByText('Advanced'));
  await waitFor(() => expect(document.querySelector('[data-testid^="advanced-"]')).not.toBeNull(), { timeout: 20_000 });
};

describe('wizard: the Advanced section', () => {
  it('is closed until it is opened, then shows the pulse length, the edge options and their defaults', async () => {
    const seen = mount(JET); // a preset without a design pulse or edge settings
    step('Magnet / Driver');
    expect(screen.getByText('Advanced')).toBeTruthy();
    expect(screen.queryByText('Plant pulse length')).toBeNull(); // not loaded yet
    await openAdvanced();
    const pulse = input('Plant pulse length');
    expect(pulse.value).toBe(''); // blank = the model's 1055 s
    expect(screen.getByText(/Blank = 1055 s/)).toBeTruthy();
    expect(input('Sheath heat transmission γ').value).toBe('7');
    expect(input('Outer-leg power share').value).toBe('0.666667');
    expect(input('Detachment onset T_t').value).toBe('5');
    expect((screen.getByText('Momentum and power loss fit').closest('label')!.querySelector('select') as HTMLSelectElement).value).toBe('stangeby1');
    // looking at the defaults changes nothing in the configuration
    expect(getPath(seen.cfg, 'divertor.edge')).toBeUndefined();
    expect(getPath(seen.cfg, 'systems')).toBeUndefined();
    // a preset that carries a pulse length shows it: the published ITER design pulse
    cleanup();
    mount(ITER);
    step('Magnet / Driver');
    await openAdvanced();
    expect(input('Plant pulse length').value).toBe('500');
  });

  it('writes a value only when it is edited, and a blank one goes back to undefined', async () => {
    const seen = mount(ITER);
    step('Magnet / Driver');
    await openAdvanced();
    type(input('Plant pulse length'), '7200');
    expect(getPath(seen.cfg, 'systems.pulseLength_s')).toBe(7200);
    type(input('Sheath heat transmission γ'), '8.6');
    expect(getPath(seen.cfg, 'divertor.edge.sheathGamma')).toBe(8.6);
    fireEvent.change(screen.getByText('Momentum and power loss fit').closest('label')!.querySelector('select')!, { target: { value: 'body2025' } });
    expect(getPath(seen.cfg, 'divertor.edge.lossFit')).toBe('body2025');
    type(input('Plant pulse length'), '');
    expect(getPath(seen.cfg, 'systems.pulseLength_s')).toBeUndefined();
    // a value outside the recommended range is flagged and still written (the model replaces what it cannot use)
    type(input('Sheath heat transmission γ'), '50');
    expect(screen.getByText(/Outside the recommended range \(4–12\)/)).toBeTruthy();
    expect(getPath(seen.cfg, 'divertor.edge.sheathGamma')).toBe(50);
    // the run is not blocked by any of it
    step('RUN');
    expect(screen.getByRole('button', { name: /Start the run|Run/i })).toBeTruthy();
  });

  it('shows the solver settings on the heating step for a 1.5D run only', async () => {
    mount(ITER);
    step('Heating & Fueling');
    expect(screen.queryByText('Advanced')).toBeNull(); // 0D: no solver
    cleanup();
    const seen = mount(ITER_15D);
    step('Heating & Fueling');
    await openAdvanced();
    expect(input('1.5D solver · relative tolerance').value).toBe('0.01');
    expect(input('1.5D solver · longest transport step').value).toBe('0.5');
    expect(input('1.5D solver · edge cell packing').value).toBe('4');
    expect((screen.getByText('1.5D solver · nonlinear solver').closest('label')!.querySelector('select') as HTMLSelectElement).value).toBe('auto');
    type(input('1.5D solver · relative tolerance'), '0.001');
    expect(getPath(seen.cfg, 'profiles.rtol')).toBe(0.001);
    // no range slider for a tolerance
    expect(screen.getByText('1.5D solver · relative tolerance').closest('label')!.querySelector('input[type=range]')).toBeNull();
    expect(screen.getByText('1.5D solver · edge cell packing').closest('label')!.querySelector('input[type=range]')).not.toBeNull();
  });

  it('has only the pulse length for a stellarator, and nothing for a device that has no systems report', async () => {
    mount(W7X);
    step('Magnet / Driver');
    await openAdvanced();
    expect(input('Plant pulse length')).toBeTruthy();
    expect(screen.queryByText('Sheath heat transmission γ')).toBeNull();
    cleanup();
    mount(TAE);
    step('Magnet / Driver');
    expect(screen.queryByText('Advanced')).toBeNull();
  });

  it('lists the settings the configuration carries on the run summary, and nothing when they are all at the defaults', async () => {
    mount(JET_15D);
    step('RUN');
    expect(screen.queryByTestId('advanced-summary')).toBeNull();
    cleanup();
    mount(ITER_15D); // carries the published 500 s design pulse
    step('RUN');
    expect(within(await screen.findByTestId('advanced-summary')).getByText('Plant pulse length').closest('tr')!.textContent).toContain('500');
    cleanup();
    const cfg = { ...ITER_15D, systems: { pulseLength_s: 7200 }, profiles: { ...(ITER_15D as { profiles?: object }).profiles, rtol: 0.005, nonlinearSolver: 'newton' } } as ReactorConfig;
    mount(cfg);
    step('RUN');
    const box = await screen.findByTestId('advanced-summary');
    expect(within(box).getByText('Plant pulse length').closest('tr')!.textContent).toContain('7200');
    expect(within(box).getByText('1.5D solver · relative tolerance').closest('tr')!.textContent).toContain('0.00500');
    expect(within(box).getByText('1.5D solver · nonlinear solver').closest('tr')!.textContent).toContain('Newton–Raphson');
  });
});

describe('wizard: Turkish', () => {
  it('translates the step titles, the labels, hints, options and the method and preset texts that had no translation', async () => {
    mount(ITER);
    await act(async () => { await store.actions.setLocale('tr'); });
    await waitFor(() => expect(screen.getAllByText('Yöntem').length).toBeGreaterThan(0)); // the step list
    expect(screen.getAllByText('Küresel Tokamak').length).toBeGreaterThan(0); // a method card, and the preset that uses it
    expect(screen.getAllByText('Manyetik').length).toBeGreaterThan(0); // its group
    expect(screen.getByText('Geleneksel A≈3; IPB98(y,2) H-modu; disrupsiyon sınırları')).toBeTruthy();
    expect(screen.getByText('R=6,2 m, B=5,3 T, I_p=15 MA, 50 MW → Q≈10 hedefi')).toBeTruthy(); // a preset
    step('Geometri'); // the step list: STEP_TITLES.geometry
    expect(screen.getByRole('heading', { name: /Geometri ve alan/ })).toBeTruthy(); // the title of the step's page
    expect(screen.getByText('Büyük yarıçap R')).toBeTruthy();
    expect(screen.getByText('Plazma akımı I_p')).toBeTruthy();
    expect(screen.getByText('Stellaratör: 0')).toBeTruthy(); // a hint
    expect(screen.queryByText('Major radius R')).toBeNull();
    step('Yakıt');
    expect(screen.getByRole('heading', { name: /Yakıt ve safsızlıklar/ })).toBeTruthy();
    expect(screen.getAllByText('Yakıt').length).toBeGreaterThan(1); // the step and the field
    expect(screen.getByRole('option', { name: 'p-¹¹B (nötronsuz)' })).toBeTruthy(); // an option
    step('Mıknatıs / Sürücü');
    expect(screen.getByText('Bakır (normal iletken)', { selector: 'option' })).toBeTruthy();
    expect(screen.getByText('yıl')).toBeTruthy(); // the unit that is a word
    fireEvent.click(screen.getByText('Gelişmiş'));
    expect(await screen.findByText('Santral atım süresi', {}, { timeout: 20_000 })).toBeTruthy();
    expect(screen.getByText('Kılıf ısı geçirme katsayısı γ')).toBeTruthy();
    expect(screen.getByText(/Boş = 1055 s/)).toBeTruthy();
  });

  it('translates the required-field message and the run summary', async () => {
    const cfg = { ...ITER, geometry: { ...ITER.geometry, R: undefined } } as unknown as ReactorConfig;
    mount(cfg);
    await act(async () => { await store.actions.setLocale('tr'); });
    await waitFor(() => expect(screen.getAllByText('Yöntem').length).toBeGreaterThan(0));
    step('ÇALIŞTIR');
    // the blank field is named in Turkish, with its step
    const li = screen.getAllByText('Büyük yarıçap R').map((e) => e.closest('li')).find((x) => x)!;
    expect(li.textContent).toContain('Geometri ve alan');
    expect(screen.queryByText('Major radius R')).toBeNull();
  });
});
