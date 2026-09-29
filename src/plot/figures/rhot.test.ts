/**
 * Radius-time heat map: field extraction from history frames, uniform resampling, and the figure.
 */
import { describe, expect, it } from 'vitest';
import type { HistoryFrame } from '../../physics/types';
import { nodeFontSet } from '../fontsNode';
import { RhoTField, figRhoT, resampleUniform, rhoTFromFrames } from './rhot';
import { NRHO, RHO, syntheticEvents, syntheticFrames } from './testdata/synthetic';

const fonts = nodeFontSet();

/** field that is linear in time and radius: Z(t, rho) = 2 t + 5 rho, on uneven times */
function linearField(): RhoTField {
  const t = [0, 0.5, 1.5, 2, 5, 5.5, 9, 10];
  const rho = [0.1, 0.3, 0.5, 0.7, 0.9];
  const Z = new Float64Array(t.length * rho.length);
  t.forEach((tt, i) => rho.forEach((r, j) => { Z[i * rho.length + j] = 2 * tt + 5 * r; }));
  return { t, rho, Z };
}

describe('rhoTFromFrames', () => {
  const frames = syntheticFrames(30);

  it('collects one profile per frame in time order', () => {
    const f = rhoTFromFrames(frames, 'Te')!;
    expect(f.t.length).toBe(30);
    expect(f.rho).toEqual(RHO);
    expect(f.Z.length).toBe(30 * NRHO);
    for (const i of [0, 7, 29]) for (const j of [0, 11, NRHO - 1]) expect(f.Z[i * NRHO + j]).toBe(frames[i].prof!.Te[j]);
    expect(rhoTFromFrames(frames, 'Te', 1000)!.Z[5 * NRHO + 3]).toBe(1000 * frames[5].prof!.Te[3]);
  });

  it('is null without two usable frames, or when the profile is absent', () => {
    expect(rhoTFromFrames(frames, 'nope')).toBeNull();
    expect(rhoTFromFrames([], 'Te')).toBeNull();
    expect(rhoTFromFrames(frames.slice(0, 1), 'Te')).toBeNull();
    const noProf: HistoryFrame[] = frames.map((f) => ({ ...f, prof: undefined }));
    expect(rhoTFromFrames(noProf, 'Te')).toBeNull();
  });

  it('skips frames whose profile has another length (a re-gridded run) and frames without profiles', () => {
    const mixed: HistoryFrame[] = [
      frames[0], { ...frames[1], prof: undefined }, { ...frames[2], prof: { rho: [0.5, 1], Te: [1, 2] } }, frames[3], frames[4],
    ];
    const f = rhoTFromFrames(mixed, 'Te')!;
    expect(f.t).toEqual([frames[0].t, frames[3].t, frames[4].t]);
    expect(rhoTFromFrames([frames[0], mixed[2]], 'Te')).toBeNull(); // only one frame of the first length remains
  });
});

describe('resampleUniform', () => {
  it('a field that is linear in time is reproduced exactly on the uniform grid', () => {
    const f = linearField();
    const r = resampleUniform(f, 41);
    expect(r.t.length).toBe(41);
    expect(r.t[0]).toBe(0);
    expect(r.t[40]).toBe(10);
    expect(r.rho).toBe(f.rho);
    for (let i = 1; i < r.t.length; i++) expect(r.t[i] - r.t[i - 1]).toBeCloseTo(0.25, 12);
    r.t.forEach((tt, i) => f.rho.forEach((rho, j) => expect(r.Z[i * f.rho.length + j]).toBeCloseTo(2 * tt + 5 * rho, 10)));
  });

  it('nearest mode keeps frame values (crashes stay sharp) and never invents new ones', () => {
    const f = linearField();
    const r = resampleUniform(f, 33, 'nearest');
    const original = new Set(f.Z);
    for (const v of r.Z) expect(original.has(v)).toBe(true);
    // at the first and last time it is the first and last frame
    expect(Array.from(r.Z.slice(0, 5))).toEqual(Array.from(f.Z.slice(0, 5)));
    expect(Array.from(r.Z.slice(-5))).toEqual(Array.from(f.Z.slice(-5)));
  });

  it('at least two columns, whatever is asked; two frames are enough', () => {
    const f: RhoTField = { t: [1, 3], rho: [0.5], Z: Float64Array.from([10, 20]) };
    expect(resampleUniform(f, 0).t).toEqual([1, 3]);
    const r = resampleUniform(f, 5);
    expect(Array.from(r.Z)).toEqual([10, 12.5, 15, 17.5, 20]);
    // frames at one time: no division by zero
    const same: RhoTField = { t: [2, 2, 2], rho: [0.5], Z: Float64Array.from([1, 2, 3]) };
    expect(Array.from(resampleUniform(same, 3).Z).every(Number.isFinite)).toBe(true);
  });
});

describe('figRhoT', () => {
  const frames = syntheticFrames(50);
  const field = rhoTFromFrames(frames, 'Te')!;

  it('image with colour bar, contours and event marks', () => {
    const svg = figRhoT({ field, label: '$T_e$ (keV)', cmap: 'inferno', contours: [5, 10, 15], events: syntheticEvents(), title: 'Te(rho, t)' }).toSVG({ fonts });
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain('<title>Te(rho, t)</title>');
    expect((svg.match(/<image /g) ?? []).length).toBe(2); // the map and the colour bar
    for (const t of ['ELM', 'sawtooth', 'NTM onset']) expect(svg, t).toContain(`<tspan>${t}</tspan>`);
    expect(svg).toContain('keV');
    expect(svg).toContain('stroke-dasharray'); // the L-H line is dotted
  });

  it('log colours, a fixed colour range, the nearest-frame mode and a column count all render', () => {
    for (const o of [{ log: true }, { vmin: 0, vmax: 30 }, { mode: 'nearest' as const }, { nt: 12 }, { cmap: 'RdBu' }, { cmap: 'no-such-map' }]) {
      const svg = figRhoT({ field: rhoTFromFrames(frames, 'ne')!, label: 'n', ...o }).toSVG({ fonts });
      expect(svg, JSON.stringify(o)).not.toMatch(/NaN|Infinity/);
    }
  });

  it('a field with a single radius and only two frames still draws; events of other kinds are ignored', () => {
    const tiny: RhoTField = { t: [0, 1], rho: [0.5], Z: Float64Array.from([1, 2]) };
    const svg = figRhoT({ field: tiny, label: 'x', events: [{ t: 0.5, kind: 'warning', msg: 'w' }] }).toSVG({ fonts });
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).not.toContain('<tspan>ELM</tspan>');
  });
});
