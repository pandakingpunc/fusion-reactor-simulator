// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field, parseNumberInput } from './Field';
import { FieldDef } from './schema';

afterEach(cleanup);

describe('parseNumberInput', () => {
  it('maps blank to undefined, garbage to null and accepts a decimal comma', () => {
    expect(parseNumberInput('')).toBeUndefined();
    expect(parseNumberInput('   ')).toBeUndefined();
    expect(parseNumberInput('abc')).toBeNull();
    expect(parseNumberInput('1,5')).toBe(1.5);
    expect(parseNumberInput(' 2e20 ')).toBe(2e20);
    expect(parseNumberInput('0')).toBe(0);
  });
});

/** a field bound to local state, the way the wizard binds it to the configuration */
function Bound({ def, initial, spy }: { def: FieldDef; initial: unknown; spy: (v: unknown) => void }) {
  const [v, setV] = useState<unknown>(initial);
  return React.createElement(Field, { def, value: v ?? def.def, onChange: (x: unknown) => { spy(x); setV(x); } });
}

const box = () => screen.getByRole('textbox') as HTMLInputElement;
const commit = (text: string) => { fireEvent.change(box(), { target: { value: text } }); fireEvent.blur(box()); };

describe('numeric wizard field', () => {
  const def: FieldDef = { path: 'n_target', label: 'Target n_e', unit: '10²⁰ m⁻³', scale: 1e20, min: 0.01, max: 20 };

  it('a blank input yields undefined instead of 0 or NaN', () => {
    const spy = vi.fn();
    render(React.createElement(Bound, { def, initial: 1.1e20, spy }));
    expect(box().value).toBe('1.1');
    commit('');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(undefined);
    expect(box().value).toBe('');
    expect(screen.getByText('Empty — no value is passed to the model')).toBeTruthy();
  });

  it('a blank input on a field with a documented default shows the default again', () => {
    const spy = vi.fn();
    render(React.createElement(Bound, { def: { ...def, scale: 1, def: 0.4 }, initial: 0.4, spy }));
    commit('');
    expect(spy).toHaveBeenLastCalledWith(undefined);
    expect(box().value).toBe('0.4');
  });

  it('scales typed values, rejects garbage and leaves untouched fields alone', () => {
    const spy = vi.fn();
    render(React.createElement(Bound, { def, initial: 1.23456789e20, spy }));
    fireEvent.blur(box()); // untouched: no rounding to 6 digits, no "modified" preset
    expect(spy).not.toHaveBeenCalled();
    commit('abc');
    expect(spy).not.toHaveBeenCalled();
    expect(box().value).toBe('1.23457');
    commit('2,5');
    expect(spy).toHaveBeenLastCalledWith(2.5e20);
    expect(box().value).toBe('2.5');
  });
});
