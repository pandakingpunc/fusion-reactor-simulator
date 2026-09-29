/**
 * G-EQDSK: the writer (5e16.9, COCOS 11), the tolerant reader, COCOS detection and conversion, and the import of a file as an
 * Equilibrium. Files come from the solver's own equilibria (round trips), from hand-made text, and from an analytic single-null
 * Solov'ev equilibrium written in COCOS 1 (an independent reference for q).
 */
import { describe, expect, it } from 'vitest';
import {
  Geqdsk, GeqdskError, cocosInfo, convertCocos, detectCocos, equilibriumFromGeqdsk, formatGeqdsk, geqdskFromEquilibrium, importGeqdsk,
  psiFactor, readGeqdsk, writeGeqdsk,
} from './geqdsk';
import { GSFailure, GSSolver, StateProfiles } from '../physics/equilibrium/gs';
import { millerShape } from '../physics/equilibrium/miller';
import { shapeGeometry } from '../physics/equilibrium/shapes';
import { PhysicalSolovev } from '../physics/equilibrium/solovev';
import { Pchip } from '../physics/numerics/interp';

const TWO_PI = 2 * Math.PI;
const ITER = { R: 6.2, a: 2, kappa: 1.7, delta: 0.33 };
const profile = { kind: 'shape' as const, alphaM: 2, alphaN: 1.3, betaP: 0.65 };
const solve = (geom = ITER, NR = 65) => new GSSolver(geom, { NR }).solve({ Ip: 15e6, B0: 5.3, profile, tol: 1e-10 });

const maxRel = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let m = 0, s = 0;
  for (let i = 0; i < a.length; i++) { m = Math.max(m, Math.abs(a[i] - b[i])); s = Math.max(s, Math.abs(b[i])); }
  return m / s;
};

describe('the text format', () => {
  const eq = solve();
  const g = geqdskFromEquilibrium(eq);
  const text = formatGeqdsk(g);

  it('is the standard layout: (a48, 3i4) header, five 16-character E-format numbers per line, (2i5) boundary sizes', () => {
    const lines = text.split('\n');
    expect(lines[0].length).toBe(60);
    expect(lines[0].slice(0, 48).trim()).toBe('fusion-sim v4 fixed-boundary Grad-Shafranov');
    expect(Number(lines[0].slice(48, 52))).toBe(3);
    expect(Number(lines[0].slice(52, 56))).toBe(g.nw);
    expect(Number(lines[0].slice(56, 60))).toBe(g.nh);
    const nbLine = 1 + 4 + Math.ceil((4 * g.nw) / 5) + Math.ceil((g.nw * g.nh) / 5) + Math.ceil(g.nw / 5);
    expect(lines[nbLine].length).toBe(10);
    expect(Number(lines[nbLine].slice(0, 5))).toBe(g.rbbbs.length);
    expect(Number(lines[nbLine].slice(5, 10))).toBe(0);
    for (let i = 1; i < nbLine; i++) {
      // the tables run on across lines: only the last line of a table may be shorter; every field is 16 characters
      expect(lines[i].length % 16, `line ${i + 1}`).toBe(0);
      for (let c = 0; c < lines[i].length; c += 16) expect(lines[i].slice(c, c + 16), `line ${i + 1}`).toMatch(/^[ -]\d\.\d{9}E[+-]\d{2}$/);
    }
    expect(lines[1].length).toBe(80);
    expect(text.endsWith('\n')).toBe(true);
    expect(g.rbbbs.length).toBe(257); // 256 points and the first repeated
    expect(g.rbbbs[256]).toBe(g.rbbbs[0]);
  });

  it('reads back to the numbers it wrote, to the 10 digits of the format: ψ to 5e-10 of its range, and re-writing the read file gives the same text', () => {
    const { data, warnings } = readGeqdsk(text);
    expect(warnings).toEqual([]);
    expect(data.nw).toBe(g.nw);
    expect(data.nh).toBe(g.nh);
    expect(maxRel(data.psirz, g.psirz)).toBeLessThan(5e-10);
    expect(maxRel(data.fpol, g.fpol)).toBeLessThan(5e-10);
    expect(maxRel(data.qpsi, g.qpsi)).toBeLessThan(5e-10);
    expect(data.current).toBe(g.current);
    expect(data.description).toBe('fusion-sim v4 fixed-boundary Grad-Shafranov');
    expect(formatGeqdsk(data)).toBe(text);
  });

  it('with digits = 15 the round trip reproduces ψ to 1e-14 of its range (the E format holds 5e-17 relative), and in the solver\'s COCOS to 1e-14 of ψ_axis', () => {
    const precise = formatGeqdsk(g, { digits: 15 });
    const { data } = readGeqdsk(precise);
    expect(maxRel(data.psirz, g.psirz)).toBeLessThan(1e-14);
    expect(maxRel(data.qpsi, g.qpsi)).toBeLessThan(1e-14);
    const back = convertCocos(data, 11, 7);
    let worst = 0;
    for (let k = 0; k < eq.psi.length; k++) worst = Math.max(worst, Math.abs(back.psirz[k] - eq.psi[k]));
    expect(worst / eq.psiAxis).toBeLessThan(1e-14);
    expect(back.simag).toBeCloseTo(eq.psiAxis, 12);
    expect(back.sibry).toBeCloseTo(0, 12);
  });

  it('is COCOS 11: ψ = −2π ψ_solver (rising outwards, boundary 0), q, F, I_p, B0 > 0, p′ and FF′ per Wb', () => {
    expect(g.psirz[Math.floor(g.psirz.length / 2)]).toBeLessThan(0);
    expect(g.simag).toBeCloseTo(-TWO_PI * eq.psiAxis, 12);
    expect(g.sibry).toBe(0);
    expect(Object.is(g.sibry, 0)).toBe(true);
    expect(g.current).toBe(15e6);
    expect(g.bcentr).toBe(5.3);
    expect(g.rcentr).toBe(6.2);
    expect(g.rmaxis).toBe(eq.Raxis);
    expect(g.fpol[g.nw - 1]).toBeCloseTo(6.2 * 5.3, 6);
    expect(g.qpsi[0]).toBeCloseTo(eq.q0, 6);
    expect(g.qpsi[g.nw - 1]).toBeCloseTo(eq.prof.q[eq.prof.q.length - 1], 6);
    expect(g.pprime[0]).toBeLessThan(0); // dp/dψ < 0 when ψ rises outwards
    expect(g.pprime[0]).toBeCloseTo(eq.prof.pp[0] / -TWO_PI, 6);
    expect(g.ffprim[0]).toBeCloseTo(eq.prof.FFp[0] / -TWO_PI, 6);
    expect(g.pres[0]).toBeCloseTo(eq.prof.p[0], 4);
    expect(g.pres[g.nw - 1]).toBeCloseTo(0, 6);
    // the box is the solver's grid
    expect(g.rleft).toBe(eq.grid.Rmin);
    expect(g.rleft + g.rdim).toBeCloseTo(eq.grid.R(eq.grid.NR - 1), 12);
    expect(g.zmid - 0.5 * g.zdim).toBeCloseTo(eq.grid.Z(0), 12);
  });

  it('writes other resolutions (ψ resampled by the bicubic spline of the state), a limiter and a ψ offset; any COCOS', () => {
    const lim = { R: [3, 9, 9, 3], Z: [-4, -4, 4, 4] };
    const c = geqdskFromEquilibrium(eq, { nw: 33, nh: 41, cocos: 3, limiter: lim, psiBoundary: 0.5, description: 'test' });
    expect(c.nw).toBe(33);
    expect(c.psirz.length).toBe(33 * 41);
    expect(Array.from(c.rlim)).toEqual(lim.R);
    // COCOS 3 (σ_Bp = −1 like the solver's COCOS 7, ψ in Wb/rad, θ reversed: q < 0): ψ = ψ_solver + 0.5
    expect(c.sibry).toBeCloseTo(0.5, 12);
    expect(c.simag).toBeCloseTo(0.5 + eq.psiAxis, 9);
    expect(c.qpsi[10]).toBeLessThan(0);
    const t = formatGeqdsk(c);
    const r = readGeqdsk(t).data;
    expect(r.nw).toBe(33);
    expect(Array.from(r.rlim)).toEqual(lim.R);
    expect(Array.from(r.zlim)).toEqual(lim.Z);
    // a resampled ψ is the state's own field: at the box centre the spline of the state
    const bi = eq.grid.bicubic(eq.psi);
    const i = 16, j = 20;
    expect(c.psirz[j * 33 + i] - 0.5).toBeCloseTo(bi.eval(c.rleft + (c.rdim * i) / 32, c.zmid - 0.5 * c.zdim + (c.zdim * j) / 40), 9);
  });

  it('refuses what cannot be written', () => {
    expect(() => formatGeqdsk(g, { digits: 0 })).toThrow(GeqdskError);
    expect(() => formatGeqdsk(g, { digits: 18 })).toThrow(/digits/);
    expect(() => formatGeqdsk({ ...g, psirz: g.psirz.slice(1) })).toThrow(/psirz has/);
    expect(() => formatGeqdsk({ ...g, fpol: Float64Array.from(g.fpol, (v, i) => (i === 3 ? NaN : v)) })).toThrow(/non-finite/);
    expect(() => formatGeqdsk({ ...g, nw: 10000 })).toThrow(/nw and nh/);
    expect(() => formatGeqdsk({ ...g, zbbbs: g.zbbbs.slice(1) })).toThrow(/equal lengths/);
    expect(() => geqdskFromEquilibrium(eq, { cocos: 9 })).toThrow(/COCOS/);
    expect(() => geqdskFromEquilibrium(eq, { nw: 2 })).toThrow(/nw and nh/);
    expect(() => geqdskFromEquilibrium(eq, { nBoundary: 4 })).toThrow(/nBoundary/);
    expect(() => geqdskFromEquilibrium(eq, { limiter: { R: [1, 2], Z: [1] } })).toThrow(/equal lengths/);
  });
});

describe('the reader is tolerant', () => {
  /** a 5 × 5 file by hand: values chosen to be recognisable */
  const tiny = (): Geqdsk => ({
    description: 'hand made', idum: 3, nw: 5, nh: 5, rdim: 2, zdim: 3, rcentr: 1.5, rleft: 0.5, zmid: 0.25,
    rmaxis: 1.55, zmaxis: 0.05, simag: 0.4, sibry: -0.1, bcentr: 2,
    current: 1e6, fpol: Float64Array.from([3, 3.01, 3.02, 3.03, 3.04]), pres: Float64Array.from([1e4, 8e3, 5e3, 2e3, 0]),
    ffprim: Float64Array.from([-0.1, -0.1, -0.1, -0.1, -0.1]), pprime: Float64Array.from([-1e4, -1e4, -1e4, -1e4, -1e4]),
    psirz: Float64Array.from({ length: 25 }, (_, k) => (k === 7 ? 1e-120 : 0.01 * k - 0.1)),
    qpsi: Float64Array.from([1, 1.2, 1.5, 2, 3]),
    rbbbs: Float64Array.from([2, 1.5, 1, 1.5, 2]), zbbbs: Float64Array.from([0, 1, 0, -1, 0]),
    rlim: Float64Array.from([0.6, 2.4, 2.4, 0.6]), zlim: Float64Array.from([-1.4, -1.4, 1.6, 1.6]),
  });
  const text = formatGeqdsk(tiny());

  it('a value below 1e-99 is written without the E and read back; the file is otherwise plain', () => {
    expect(text).toMatch(/1\.000000000-120/);
    const { data, warnings } = readGeqdsk(text);
    expect(warnings).toEqual([]);
    expect(data.psirz[7]).toBe(1e-120);
    expect(data.psirz[8]).toBeCloseTo(-0.02, 12);
    expect(data.nw).toBe(5);
    expect(Array.from(data.zlim)).toEqual([-1.4, -1.4, 1.6, 1.6]);
    expect(Array.from(data.rbbbs)).toEqual([2, 1.5, 1, 1.5, 2]);
    expect(data.current).toBe(1e6);
    // the same value with the E, and with a D
    expect(readGeqdsk(text.replace('1.000000000-120', ' 1.000000000E-120')).data.psirz[7]).toBe(1e-120);
    expect(readGeqdsk(text.replace('1.000000000-120', ' 1.000000000D-120')).data.psirz[7]).toBe(1e-120);
  });

  it('reads Windows line ends, D exponents, a header of another width, fields that touch, and a limiter of 0 points', () => {
    const want = readGeqdsk(text).data;
    const crlf = readGeqdsk(text.replace(/\n/g, '\r\n')).data;
    expect(crlf.psirz).toEqual(want.psirz);
    const lines = text.split('\n');
    const dExp = [lines[0], ...lines.slice(1).map((l) => l.replace(/E/g, 'D'))].join('\n');
    expect(readGeqdsk(dExp).data.qpsi).toEqual(want.qpsi);
    // a header that is not 48 wide: nw and nh are the last two integers
    const odd = ['EFIT   0   5   5', ...lines.slice(1)].join('\n');
    const o = readGeqdsk(odd).data;
    expect(o.nw).toBe(5);
    expect(o.nh).toBe(5);
    expect(o.description).toBe('EFIT');
    // a negative number that touches its neighbour is what a full 16-character field looks like
    expect(text).toMatch(/E[+-]\d\d-\d\.\d/);
    // limitr = 0
    const noLim = readGeqdsk(formatGeqdsk({ ...tiny(), rlim: new Float64Array(0), zlim: new Float64Array(0) }));
    expect(noLim.warnings).toEqual([]);
    expect(noLim.data.rlim.length).toBe(0);
    expect(noLim.data.rbbbs.length).toBe(5);
  });

  it('warns and goes on when the file ends after qpsi, when the boundary is cut short, when numbers are left over or lines 4 and 5 disagree', () => {
    const lines = text.split('\n');
    const nbLine = 1 + 4 + Math.ceil(20 / 5) + Math.ceil(25 / 5) + 1;
    const cut = readGeqdsk(lines.slice(0, nbLine).join('\n'));
    expect(cut.warnings.join(' ')).toMatch(/no plasma boundary/);
    expect(cut.data.rbbbs.length).toBe(0);
    expect(cut.data.qpsi.length).toBe(5);
    const halved = readGeqdsk([...lines.slice(0, nbLine), '    5    0', ' 2.0E+00 0.0E+00 1.5E+00'].join('\n'));
    expect(halved.warnings.join(' ')).toMatch(/boundary has 5 points/);
    expect(halved.data.rbbbs.length).toBe(0);
    const extra = readGeqdsk(text + ' 1.0 2.0 3.0\n');
    expect(extra.warnings.join(' ')).toMatch(/3 numbers after the limiter/);
    const l4 = [...lines];
    l4[3] = l4[3].replace(/^ 1\.000000000E\+06/, ' 1.000000000E+06').replace(/ 4\.000000000E-01/, ' 5.000000000E-01');
    expect(readGeqdsk(l4.join('\n')).warnings.join(' ')).toMatch(/lines 4 and 5/);
  });

  it('refuses a file with too few numbers, no header integers, no box or absurd counts', () => {
    const lines = text.split('\n');
    expect(() => readGeqdsk(lines.slice(0, 12).join('\n'))).toThrow(/need 70 numbers, the file has 55/);
    expect(() => readGeqdsk('nothing here\n 1.0 2.0\n')).toThrow(/first line/);
    expect(() => readGeqdsk('')).toThrow(GeqdskError);
    expect(() => readGeqdsk(text.replace(' 2.000000000E+00 3.000000000E+00', ' 0.000000000E+00 3.000000000E+00'))).toThrow(/no size/);
    const nbLine = 1 + 4 + Math.ceil(20 / 5) + Math.ceil(25 / 5) + 1;
    const l = [...lines]; l[nbLine] = '   -3    2';
    expect(() => readGeqdsk(l.join('\n'))).toThrow(/not counts/);
  });
});

describe('COCOS: table, conversion, detection', () => {
  it('has the sign table of Sauter and Medvedev (2013) and the flux unit of 1–8 (Wb/rad) and 11–18 (Wb)', () => {
    const rows: [number, number, number, number][] = [[1, 1, 1, 1], [2, 1, -1, 1], [3, -1, 1, -1], [4, -1, -1, -1], [5, 1, 1, -1], [6, 1, -1, -1], [7, -1, 1, 1], [8, -1, -1, 1]];
    for (const [c, sBp, sR, sRho] of rows) {
      for (const [k, e] of [[c, 0], [c + 10, 1]] as const) {
        const i = cocosInfo(k);
        expect([i.sigmaBp, i.sigmaRphiZ, i.sigmaRhoThetaPhi, i.eBp]).toEqual([sBp, sR, sRho, e]);
      }
    }
    for (const bad of [0, 9, 10, 19, 1.5, NaN]) expect(() => cocosInfo(bad)).toThrow(GeqdskError);
    // the factor of ψ: 1 → 11 is 2π, 7 → 11 is −2π, 2 → 11 is −2π (σ_RφZ flips), 11 → 1 is 1/(2π)
    expect(psiFactor(1, 11)).toBeCloseTo(TWO_PI, 12);
    expect(psiFactor(7, 11)).toBeCloseTo(-TWO_PI, 12);
    expect(psiFactor(2, 11)).toBeCloseTo(-TWO_PI, 12);
    expect(psiFactor(11, 1)).toBeCloseTo(1 / TWO_PI, 14);
    expect(psiFactor(3, 3)).toBe(1);
  });

  it('a hand-made COCOS-1 file (ψ, p and FF′ per rad, ψ rising outwards, p′ < 0) is COCOS 11 after conversion: ψ × 2π, p′ and FF′ ÷ 2π, the rest unchanged', () => {
    const g1: Geqdsk = {
      description: 'cocos 1', idum: 3, nw: 3, nh: 3, rdim: 2, zdim: 2, rcentr: 1.7, rleft: 1, zmid: 0,
      rmaxis: 1.7, zmaxis: 0, simag: -0.3, sibry: 0, bcentr: 2.5, current: 1e6,
      fpol: Float64Array.from([4.3, 4.27, 4.25]), pres: Float64Array.from([2e4, 1e4, 0]),
      ffprim: Float64Array.from([-0.2, -0.1, -0.05]), pprime: Float64Array.from([-8e4, -6e4, -4e4]),
      psirz: Float64Array.from([0, 0, 0, 0, -0.3, 0, 0, 0, 0]), qpsi: Float64Array.from([1.1, 2, 4]),
      rbbbs: new Float64Array(0), zbbbs: new Float64Array(0), rlim: new Float64Array(0), zlim: new Float64Array(0),
    };
    const g11 = convertCocos(g1, 1, 11);
    expect(g11.simag).toBeCloseTo(-0.3 * TWO_PI, 14);
    expect(g11.sibry).toBe(0);
    expect(g11.psirz[4]).toBeCloseTo(-0.3 * TWO_PI, 14);
    expect(g11.pprime[0]).toBeCloseTo(-8e4 / TWO_PI, 8);
    expect(g11.ffprim[2]).toBeCloseTo(-0.05 / TWO_PI, 14);
    expect(Array.from(g11.fpol)).toEqual(Array.from(g1.fpol));
    expect(Array.from(g11.qpsi)).toEqual(Array.from(g1.qpsi));
    expect(g11.current).toBe(1e6);
    expect(g11.bcentr).toBe(2.5);
    expect(Array.from(g11.pres)).toEqual(Array.from(g1.pres));
    // the same file in COCOS 7 (the solver's: ψ falling outwards): ψ → −ψ, p′ and FF′ flip
    const g7 = convertCocos(g1, 1, 7);
    expect(g7.simag).toBeCloseTo(0.3, 14);
    expect(g7.pprime[0]).toBeCloseTo(8e4, 8);
    // φ reversed (1 → 2): I_p, B0, F change sign, ψ too (σ_Bp σ_RφZ), q does not
    const g2 = convertCocos(g1, 1, 2);
    expect(g2.current).toBe(-1e6);
    expect(g2.bcentr).toBe(-2.5);
    expect(g2.fpol[0]).toBe(-4.3);
    expect(g2.simag).toBeCloseTo(0.3, 14);
    expect(g2.qpsi[1]).toBe(2);
    // θ reversed (1 → 5): q changes sign, nothing else
    const g5 = convertCocos(g1, 1, 5);
    expect(g5.qpsi[1]).toBe(-2);
    expect(g5.simag).toBe(-0.3);
    expect(g5.current).toBe(1e6);
    // geometry untouched, and converting there and back is the identity
    expect(Array.from(g11.rbbbs)).toEqual([]);
    for (let a = 1; a <= 18; a++) {
      if (a === 9 || a === 10) continue;
      for (const b of [1, 3, 8, 12, 17]) {
        const back = convertCocos(convertCocos(g1, 1, a), a, b);
        const direct = convertCocos(g1, 1, b);
        expect(maxRel(back.psirz, direct.psirz), `${a} → ${b}`).toBeLessThan(1e-14);
        expect(maxRel(back.pprime, direct.pprime)).toBeLessThan(1e-14);
        expect(back.current).toBe(direct.current);
        expect(back.qpsi[2]).toBe(direct.qpsi[2]);
      }
    }
  });

  const eq = solve(ITER, 49);
  const g11 = geqdskFromEquilibrium(eq);

  it('detects the COCOS of a file from its signs and Ampère\'s law: every COCOS of the solver\'s state comes back as its odd number, with the flux unit right', () => {
    const d11 = detectCocos(g11);
    expect(d11.cocos).toBe(11);
    expect(d11.ampereRatio).toBeGreaterThan(6.1);
    expect(d11.ampereRatio).toBeLessThan(6.4);
    expect(d11.notes).toEqual([]);
    for (const c of [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18]) {
      const g = convertCocos(g11, 11, c);
      const d = detectCocos(g);
      const odd = c % 2 === 0 ? c - 1 : c; // σ_RφZ is not in the file
      expect(d.cocos, `COCOS ${c}`).toBe(odd);
      const e = cocosInfo(c).eBp;
      expect(d.ampereRatio, `COCOS ${c}`).toBeGreaterThan(e ? 6.1 : 0.97);
      expect(d.ampereRatio, `COCOS ${c}`).toBeLessThan(e ? 6.4 : 1.02);
    }
  });

  it('notes what it has to guess: no q, no current, a flux map that does not carry the stated current, pprime of the wrong sign', () => {
    const noQ = detectCocos({ ...g11, qpsi: new Float64Array(g11.nw) });
    expect(noQ.cocos).toBe(11);
    expect(noQ.notes.join(' ')).toMatch(/no usable qpsi/);
    const noI = detectCocos({ ...g11, current: 0 });
    expect(noI.notes.join(' ')).toMatch(/current is 0/);
    expect(noI.notes.join(' ')).toMatch(/could not be checked/);
    const off = detectCocos({ ...g11, current: 3 * g11.current });
    expect(off.notes.join(' ')).toMatch(/uncertain/);
    const wrongP = detectCocos({ ...g11, pprime: g11.pprime.map((v) => -v) });
    expect(wrongP.notes.join(' ')).toMatch(/pprime disagrees/);
    expect(() => detectCocos({ ...g11, sibry: g11.simag })).toThrow(/no flux difference/);
    expect(detectCocos({ ...g11, bcentr: 0 }).notes.join(' ')).not.toMatch(/bcentr is 0/); // fpol gives the sign
    expect(detectCocos({ ...g11, bcentr: 0, fpol: new Float64Array(g11.nw) }).notes.join(' ')).toMatch(/bcentr is 0/);
  });
});

describe('an equilibrium from a file', () => {
  const eq = solve();
  const text = writeGeqdsk(eq);
  const imp = importGeqdsk(text);
  const e2 = imp.eq;

  it("the solver's own equilibrium written as COCOS 11 and imported comes back: q re-traced from the imported ψ and F matches the file's qpsi within 1e-4, the integral quantities within 3e-4", () => {
    expect(imp.notes).toEqual([]);
    expect(imp.cocos.cocos).toBe(11);
    expect(e2.converged).toBe(true);
    expect(e2.iterations).toBe(0);
    // q of the import against the file's own table (interpolated to the surfaces of the import), on ψ_N ≤ 0.98
    const { data } = readGeqdsk(text);
    const xs = Float64Array.from({ length: data.nw }, (_, i) => i / (data.nw - 1));
    const qFile = new Pchip(xs, data.qpsi);
    let worst = 0;
    for (let i = 1; i < e2.prof.psiN.length; i++) {
      if (e2.prof.psiN[i] > 0.98) break;
      worst = Math.max(worst, Math.abs(e2.prof.q[i] / qFile.eval(e2.prof.psiN[i]) - 1));
    }
    expect(worst).toBeLessThan(1e-4);
    for (const k of ['q95', 'q0', 'li3', 'betaP', 'betaT', 'betaN', 'volume', 'area', 'W_th', 'pAvg', 'PhiB', 'psiAxis'] as const) {
      expect(Math.abs((e2[k] as number) / (eq[k] as number) - 1), k).toBeLessThan(3e-4);
    }
    expect(Math.abs(e2.Raxis - eq.Raxis)).toBeLessThan(1e-6);
    expect(Math.abs(e2.Zaxis)).toBeLessThan(1e-6);
    expect(e2.Ip).toBe(15e6);
    expect(e2.B0).toBeCloseTo(5.3, 12);
    expect(e2.R0).toBeCloseTo(6.2, 6);
    // the profiles are the file's
    for (const k of ['p', 'F', 'FFp', 'pp'] as const) expect(maxRel(e2.prof[k], eq.prof[k]), k).toBeLessThan(1e-3);
    // ψ itself: the resampled state is the solver's to interpolation accuracy
    const g = e2.grid;
    const bi = eq.grid.bicubic(eq.psi);
    let wpsi = 0;
    for (const k of g.interior) { const i = k % g.NR, j = (k - i) / g.NR; wpsi = Math.max(wpsi, Math.abs(e2.psi[k] - bi.eval(g.R(i), g.Z(j)))); }
    expect(wpsi / eq.psiAxis).toBeLessThan(5e-8);
  });

  it('measures how well the state satisfies Grad–Shafranov: force balance and residual are the discretisation error of the file (a few 1e-3), Ampère on the boundary gives I_p', () => {
    expect(e2.forceBalanceResidual).toBeLessThan(1e-2);
    expect(e2.forceBalanceRatio).toBeGreaterThan(0.98);
    expect(e2.forceBalanceRatio).toBeLessThan(1.02);
    expect(e2.residual).toBeLessThan(1e-2);
    expect(Math.abs(e2.prof.Ienc[e2.prof.Ienc.length - 1] / 15e6 - 1)).toBeLessThan(3e-3);
    expect(e2.warnings).toEqual([]);
  });

  it('is independent of the COCOS the file is in: all 16, and a flipped direction of B0, give the same equilibrium', () => {
    const small = solve(ITER, 49);
    const g11 = geqdskFromEquilibrium(small);
    const ref = equilibriumFromGeqdsk(g11).eq;
    for (const c of [1, 2, 3, 4, 5, 6, 7, 8, 12, 14, 16, 18]) {
      const r = equilibriumFromGeqdsk(convertCocos(g11, 11, c));
      const odd = c % 2 === 0 ? c - 1 : c;
      expect(r.cocos.cocos).toBe(odd);
      for (const k of ['q95', 'li3', 'betaP', 'volume', 'W_th', 'psiAxis'] as const) expect(Math.abs((r.eq[k] as number) / (ref[k] as number) - 1), `${k} COCOS ${c}`).toBeLessThan(1e-9);
    }
    // B0 against I_p: F and q of the other sign (helicity), the same flux surfaces
    const rev = { ...g11, bcentr: -g11.bcentr, fpol: g11.fpol.map((v) => -v), qpsi: g11.qpsi.map((v) => -v), ffprim: g11.ffprim };
    const r = equilibriumFromGeqdsk(rev);
    expect(r.notes.join(' ')).toMatch(/opposite direction/);
    for (const k of ['q95', 'li3', 'betaP', 'volume'] as const) expect(Math.abs((r.eq[k] as number) / (ref[k] as number) - 1), k).toBeLessThan(1e-9);
    // I_p < 0 in COCOS 1 (the direction of φ is reversed): I_p, B0 and F change sign, ψ too
    const neg = convertCocos(g11, 11, 2);
    const rn = equilibriumFromGeqdsk(neg, { cocos: 1 });
    expect(rn.notes.join(' ')).toMatch(/I_p < 0/);
    expect(Math.abs(rn.eq.q95 / ref.q95 - 1)).toBeLessThan(1e-9);
    // ψ of the wrong orientation for the stated COCOS (17 has ψ falling outwards): the data decide, the flux unit (Wb) is right
    const wrong = equilibriumFromGeqdsk(g11, { cocos: 17 });
    expect(wrong.notes.join(' ')).toMatch(/orientation was taken from the data/);
    expect(Math.abs(wrong.eq.q95 / ref.q95 - 1)).toBeLessThan(1e-9);
  });

  it('does not need the boundary polygon (the ψ = sibry contour is used), the tables pprime and ffprim (derived from pres and fpol), or the file\'s resolution', () => {
    const { data } = readGeqdsk(text);
    const noPoly = equilibriumFromGeqdsk({ ...data, rbbbs: new Float64Array(0), zbbbs: new Float64Array(0) });
    expect(noPoly.notes.join(' ')).toMatch(/no boundary polygon/);
    for (const k of ['q95', 'li3', 'volume'] as const) expect(Math.abs((noPoly.eq[k] as number) / (eq[k] as number) - 1), k).toBeLessThan(3e-4);
    const zeros = equilibriumFromGeqdsk({ ...data, pprime: new Float64Array(data.nw), ffprim: new Float64Array(data.nw) });
    expect(zeros.notes.join(' ')).toMatch(/derived from pres and fpol/);
    expect(Math.abs(zeros.eq.q95 / e2.q95 - 1)).toBeLessThan(1e-12); // q does not depend on p′, FF′
    expect(zeros.eq.forceBalanceResidual).toBeLessThan(2e-2);
    const bent = equilibriumFromGeqdsk({ ...data, rbbbs: Float64Array.from([1, 2, 3, 4]), zbbbs: Float64Array.from([0, 0, 0, 0]) });
    expect(bent.notes.join(' ')).toMatch(/not usable/);
    // a coarser solver grid, and other output surfaces
    const coarse = equilibriumFromGeqdsk(data, { NR: 41, nSurf: 41 });
    expect(coarse.eq.prof.psiN.length).toBe(41);
    expect(Math.abs(coarse.eq.q95 / eq.q95 - 1)).toBeLessThan(2e-3);
  });

  it('boundaryPsi puts the boundary on an inner flux surface: the 99 % surface has the file\'s profiles at ψ_N × 0.99 and the current inside it', () => {
    const { data } = readGeqdsk(text);
    const psi99 = data.simag + 0.99 * (data.sibry - data.simag);
    const inner = equilibriumFromGeqdsk(data, { boundaryPsi: psi99 });
    expect(inner.notes.join(' ')).toMatch(/I_p of the boundary surface/);
    const P = inner.eq.prof, n = P.psiN.length - 1;
    // the surface encloses the current of the file to Ampère's accuracy (the edge carries almost none) and less volume
    expect(Math.abs(inner.eq.Ip / 15e6 - 1)).toBeLessThan(1e-2);
    expect(inner.eq.volume).toBeLessThan(eq.volume);
    expect(inner.eq.volume).toBeGreaterThan(0.97 * eq.volume);
    // p at the new boundary is the file's at ψ_N = 0.99; q of the axis is the same
    const pFile = new Pchip(eq.prof.psiN, eq.prof.p);
    expect(Math.abs(P.p[n] - pFile.eval(0.99)) / eq.prof.p[0]).toBeLessThan(1e-4);
    expect(Math.abs(inner.eq.q0 / eq.q0 - 1)).toBeLessThan(1e-4);
    // and q at half radius: the same surface as in the full equilibrium (ψ_N = 0.495 of the file is 0.5 here)
    const qFull = new Pchip(eq.prof.psiN, eq.prof.q), qIn = new Pchip(P.psiN, P.q);
    expect(Math.abs(qIn.eval(0.5) / qFull.eval(0.495) - 1)).toBeLessThan(5e-4);
    expect(() => equilibriumFromGeqdsk(data, { boundaryPsi: data.simag + 1.2 * (data.sibry - data.simag) })).toThrow(/boundaryPsi/);
    expect(() => equilibriumFromGeqdsk(data, { boundaryPsi: data.simag * 1.1 })).toThrow(GeqdskError);
  });

  it('refuses files that do not fit: tables of the wrong size, no flux difference; the solver rejects a box that leaves no room', () => {
    const { data } = readGeqdsk(text);
    expect(() => equilibriumFromGeqdsk({ ...data, psirz: data.psirz.slice(1) })).toThrow(/do not match/);
    expect(() => equilibriumFromGeqdsk({ ...data, sibry: data.simag }, { cocos: 11 })).toThrow(/no flux difference/);
    expect(() => equilibriumFromGeqdsk(data, { NR: 8 })).toThrow(GSFailure);
    expect(() => importGeqdsk('garbage')).toThrow(GeqdskError);
  });
});

describe('up-down asymmetric and shifted plasmas', () => {
  it('a shifted, squared, asymmetric Miller equilibrium survives the round trip: axis, q, l_i, β_p, volume', () => {
    const b = millerShape({ R0: 1.7, a: 0.6, kappa: 1.6, deltaUpper: 0.3, deltaLower: 0.5, zeta: 0.05, Z0: 0.1 });
    const solver = new GSSolver(shapeGeometry(b), { NR: 65, boundary: b });
    const eq = solver.solve({ Ip: 2e6, B0: 2.5, profile, tol: 1e-10 });
    expect(eq.converged).toBe(true);
    const imp = importGeqdsk(writeGeqdsk(eq));
    expect(imp.notes).toEqual([]);
    const e2 = imp.eq;
    expect(Math.abs(e2.Zaxis - eq.Zaxis)).toBeLessThan(1e-6);
    expect(Math.abs(e2.Raxis - eq.Raxis)).toBeLessThan(1e-6);
    expect(Math.abs(e2.Zaxis)).toBeGreaterThan(0.05);
    for (const k of ['q95', 'q0', 'li3', 'betaP', 'volume', 'W_th'] as const) expect(Math.abs((e2[k] as number) / (eq[k] as number) - 1), k).toBeLessThan(5e-4);
    expect(e2.forceBalanceResidual).toBeLessThan(2e-2);
    // the file's box is the solver's: its boundary polygon is the shape's
    const g = geqdskFromEquilibrium(eq);
    expect(Math.min(...g.zbbbs)).toBeCloseTo(b.zRange![0], 6);
    expect(Math.max(...g.zbbbs)).toBeCloseTo(b.zRange![1], 6);
  });
});

/**
 * An analytic single-null Solov'ev equilibrium (Cerfon and Freidberg 2010) written by hand as a COCOS-1 file: ψ per radian
 * rising outwards from the axis, p′ and FF′ constant and negative. Its X-point is in the file, so the boundary is the
 * 95 % surface (boundaryPsi); the reference q is a contour integral of the analytic ψ, independent of the solver.
 */
describe("an analytic single-null Solov'ev equilibrium as a COCOS-1 file", () => {
  const R0 = 6.2, B0 = 5.3, Ip = 15e6, A = -0.155;
  const shape = { epsilon: 0.32, kappa: 1.7, delta: 0.33, A, singleNull: true };
  const phys = new PhysicalSolovev(R0, B0, Ip, shape, 500);
  const sol = phys.eq;
  // the axis: Newton on ∇ψ̄ = 0
  let xa = 1.05, ya = 0.05;
  for (let it = 0; it < 60; it++) {
    const gx = sol.psiBar(xa, ya, 1, 0), gy = sol.psiBar(xa, ya, 0, 1);
    const hxx = sol.psiBar(xa, ya, 2, 0), hxy = sol.psiBar(xa, ya, 1, 1), hyy = sol.psiBar(xa, ya, 0, 2);
    const det = hxx * hyy - hxy * hxy;
    xa -= (hyy * gx - hxy * gy) / det;
    ya -= (-hxy * gx + hxx * gy) / det;
  }
  const psiAxisPhys = phys.psi(xa * R0, ya * R0); // > 0 inside; 0 on the separatrix
  const nw = 129, nh = 161, rleft = 3.4, rdim = 6.2, zdim = 9.6, zmid = -0.3;
  const psirz = new Float64Array(nw * nh);
  for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) psirz[j * nw + i] = -phys.psi(rleft + (rdim * i) / (nw - 1), zmid - 0.5 * zdim + (zdim * j) / (nh - 1));
  const t = Float64Array.from({ length: nw }, (_, i) => i / (nw - 1));
  const psiOf = (x: number) => psiAxisPhys * (1 - x); // ψ_phys at ψ_N = x
  const file: Geqdsk = {
    description: "Solov'ev single null, COCOS 1", idum: 3, nw, nh, rdim, zdim, rcentr: R0, rleft, zmid,
    rmaxis: xa * R0, zmaxis: ya * R0, simag: -psiAxisPhys, sibry: 0, bcentr: B0, current: Ip,
    fpol: t.map((x) => phys.F(psiOf(x))), pres: t.map((x) => phys.pressure(psiOf(x))),
    ffprim: t.map(() => -phys.FFprime), pprime: t.map(() => -phys.pPrime),
    psirz, qpsi: t.map(() => 2), rbbbs: new Float64Array(0), zbbbs: new Float64Array(0), rlim: new Float64Array(0), zlim: new Float64Array(0),
  };
  const text = formatGeqdsk(file);

  /** q on the contour ψ_phys = ψ of the analytic map: (F/2π) ∮ dl/(R|∇ψ|), the contour by 4096 rays from the axis */
  const qContour = (psi: number, F: number) => {
    const n = 4096;
    const pts: [number, number][] = [];
    for (let j = 0; j < n; j++) {
      const th = (TWO_PI * j) / n, c = Math.cos(th), s = Math.sin(th);
      // first crossing from the axis (the polynomial ψ is not monotone far from the plasma)
      let lo = 0, hi = 0.02;
      while (phys.psi(xa * R0 + hi * c, ya * R0 + hi * s) > psi) { lo = hi; hi += 0.02; }
      for (let it = 0; it < 60; it++) { const m = 0.5 * (lo + hi); if (phys.psi(xa * R0 + m * c, ya * R0 + m * s) > psi) lo = m; else hi = m; }
      pts.push([xa * R0 + 0.5 * (lo + hi) * c, ya * R0 + 0.5 * (lo + hi) * s]);
    }
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const p = pts[j], q = pts[(j + 1) % n];
      const Rm = 0.5 * (p[0] + q[0]), Zm = 0.5 * (p[1] + q[1]);
      const [gR, gZ] = phys.grad(Rm, Zm);
      sum += Math.hypot(q[0] - p[0], q[1] - p[1]) / (Rm * Math.hypot(gR, gZ));
    }
    return (F / TWO_PI) * sum;
  };

  it('is read, detected as COCOS 1 (ψ per radian from Ampère\'s law, rising outwards) and converted to COCOS 11 by 2π', () => {
    const { data, warnings } = readGeqdsk(text);
    expect(warnings).toEqual([]);
    const d = detectCocos(data);
    expect(d.cocos).toBe(1);
    expect(d.ampereRatio).toBeGreaterThan(0.95);
    expect(d.ampereRatio).toBeLessThan(1.05);
    expect(d.notes).toEqual([]);
    const g11 = convertCocos(data, d.cocos, 11);
    expect(g11.simag / data.simag).toBeCloseTo(TWO_PI, 12);
    expect(g11.pprime[3] / data.pprime[3]).toBeCloseTo(1 / TWO_PI, 12);
    expect(detectCocos(g11).cocos).toBe(11);
  });

  it('imported with the boundary on the 95 % surface it has the analytic q(ψ_N) (contour integral of the exact ψ) to 5e-4 and the exact axis', () => {
    const psiL = file.simag + 0.95 * (file.sibry - file.simag);
    const imp = importGeqdsk(text, { boundaryPsi: psiL, contourRays: 512 });
    const eq = imp.eq;
    expect(imp.cocos.cocos).toBe(1);
    expect(eq.converged).toBe(true);
    expect(Math.abs(eq.Raxis - xa * R0)).toBeLessThan(2e-3);
    expect(Math.abs(eq.Zaxis - ya * R0)).toBeLessThan(2e-3);
    expect(Math.abs(eq.Zaxis)).toBeGreaterThan(0.05);
    const qE = new Pchip(eq.prof.psiN, eq.prof.q);
    const psiLphys = 0.05 * psiAxisPhys; // ψ_phys at the 95 % surface
    for (const x of [0.3, 0.6, 0.9]) {
      // the solver's ψ_N = x is ψ_phys = ψ_axis − x (ψ_axis − ψ_L); the file's F there
      const psi = psiAxisPhys - x * (psiAxisPhys - psiLphys);
      const qRef = qContour(psi, phys.F(psi));
      expect(Math.abs(qE.eval(x) / qRef - 1), `q at ψ_N = ${x}`).toBeLessThan(5e-4);
    }
    // the current inside the 95 % surface, by Ampère on it, is below I_p and consistent with the analytic p′ and FF′: β_p from p
    expect(eq.Ip).toBeLessThan(Ip);
    expect(eq.Ip).toBeGreaterThan(0.8 * Ip);
    expect(eq.forceBalanceResidual).toBeLessThan(1e-2);
    expect(imp.notes.join(' ')).toMatch(/I_p of the boundary surface/);
    // the equilibrium on the analytic contour: ψ of the file is an exact solution of the equation with constant p′ and FF′
    expect(eq.residual).toBeLessThan(2e-3);
  }, 60000);
});

describe('GSSolver.assemble: an equilibrium from a state that was not solved', () => {
  const solver = new GSSolver(ITER, { NR: 49 });
  const eq = solver.solve({ Ip: 15e6, B0: 5.3, profile, tol: 1e-11 });
  const P = eq.prof;
  const mk = (): StateProfiles => {
    const p = new Pchip(P.psiN, P.p);
    return { p: (x) => p.eval(x), pp: (x) => new Pchip(P.psiN, P.pp).eval(x), ffp: (x) => new Pchip(P.psiN, P.FFp).eval(x), F: (x) => new Pchip(P.psiN, P.F).eval(x) };
  };

  it("given a solved state and its own profiles it returns that equilibrium's tables (to the interpolation of the profiles) with a Picard residual at the solve's tolerance", () => {
    const again = solver.assemble(eq.psi, mk, { Ip: 15e6, B0: 5.3 });
    expect(again.iterations).toBe(0);
    expect(again.converged).toBe(true);
    expect(again.residual).toBeLessThan(1e-5);
    for (const k of ['q95', 'li3', 'betaP', 'volume', 'W_th', 'psiAxis', 'Raxis'] as const) expect(Math.abs((again[k] as number) / (eq[k] as number) - 1), k).toBeLessThan(1e-6);
    expect(maxRel(again.prof.q, eq.prof.q)).toBeLessThan(1e-9);
    expect(again.forceBalanceResidual).toBeLessThan(1e-5);
    // the input is not changed, and a kept exterior is used as given
    const before = Float64Array.from(eq.psi);
    solver.assemble(eq.psi, mk, { Ip: 15e6, B0: 5.3, keepExterior: true });
    expect(Array.from(eq.psi)).toEqual(Array.from(before));
  });

  it('validates its input', () => {
    const bad: [string, () => unknown][] = [
      ['I_p', () => solver.assemble(eq.psi, mk, { Ip: -1, B0: 5.3 })],
      ['B0', () => solver.assemble(eq.psi, mk, { Ip: 1e6, B0: 0 })],
      ['size', () => solver.assemble(new Float64Array(10), mk, { Ip: 1e6, B0: 5.3 })],
      ['finite', () => solver.assemble(Float64Array.from(eq.psi, (v, k) => (k === solver.grid.interior[5] ? NaN : v)), mk, { Ip: 1e6, B0: 5.3 })],
    ];
    for (const [name, f] of bad) {
      let e: unknown;
      try { f(); } catch (x) { e = x; }
      expect(e, name).toBeInstanceOf(GSFailure);
      expect((e as GSFailure).reason, name).toBe('bad-input');
    }
  });
});

