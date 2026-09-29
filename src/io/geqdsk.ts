/**
 * G-EQDSK equilibrium files: a writer (COCOS 11 by default), a tolerant reader, COCOS detection and conversion,
 * and the import of a file as an `Equilibrium` of the Grad–Shafranov solver. Browser-safe (text in, text out).
 *
 * The format (the EFIT "g-file"; Lao et al., Nucl. Fusion 25 (1985) 1611), in Fortran terms:
 *   (a48, 3i4)  description, idum, nw, nh
 *   (5e16.9)    rdim, zdim, rcentr, rleft, zmid
 *   (5e16.9)    rmaxis, zmaxis, simag, sibry, bcentr
 *   (5e16.9)    current, simag, xdum, rmaxis, xdum
 *   (5e16.9)    zmaxis, xdum, sibry, xdum, xdum
 *   (5e16.9)    fpol(nw), pres(nw), ffprim(nw), pprime(nw)      F = R B_φ, p, FF', p' on ψ_N = 0 … 1 in nw steps
 *   (5e16.9)    psirz(nw, nh)                                    ψ on the uniform (R, Z) grid, R fastest
 *   (5e16.9)    qpsi(nw)
 *   (2i5)       nbbbs, limitr
 *   (5e16.9)    (rbbbs(i), zbbbs(i), i = 1, nbbbs)               plasma boundary
 *   (5e16.9)    (rlim(i), zlim(i), i = 1, limitr)                limiter / first wall
 * ψ is on the uniform grid R = rleft + i rdim/(nw − 1), Z = zmid − zdim/2 + j zdim/(nh − 1).
 *
 * The sign and unit conventions of the file are the COCOS of O. Sauter and S. Yu. Medvedev, "Tokamak coordinate
 * conventions: COCOS", Comput. Phys. Commun. 184 (2013) 293, an integer 1–8 (ψ in Wb/rad, "ψ/2π") or 11–18 (ψ in Wb),
 * fixed by σ_Bp (ψ increases outwards for I_p > 0 when +1), σ_RφZ ((R, φ, Z) right-handed when +1) and σ_ρθφ ((ρ, θ, φ)
 * right-handed when +1) through
 *   B = F ∇φ + σ_Bp (2π)^(−e_Bp) ∇φ × ∇ψ,   sign(q) = σ_Ip σ_B0 σ_ρθφ,   sign(p') = −σ_Ip σ_Bp .
 * The solver's own state is COCOS 7 with I_p, B0 > 0: ψ [Wb/rad] maximal on the axis, q > 0, p' > 0. Going from one COCOS
 * to another multiplies ψ by σ_Bp' σ_RφZ' (2π)^e', I_p, B0 and F by σ_RφZ', q by σ_ρθφ', and p', FF' by the inverse of the
 * ψ factor (primes: the product of the input's and the output's σ; e' the difference of the e_Bp).
 *
 * A file does not contain σ_RφZ, and the odd COCOS 1, 3, 5, 7 (and 11, 13, 15, 17) stand for the pair with the next even
 * one: the same geometry with φ reversed, which a flux-surface code does not see.
 */
import { Bicubic, CubicSpline, Pchip } from '../physics/numerics/interp';
import { Equilibrium, GSSolver, StateProfiles } from '../physics/equilibrium/gs';
import { ShapeBoundary, boundaryPolygon } from '../physics/equilibrium/miller';
import { contourBoundary, polygonBoundary, shapeGeometry } from '../physics/equilibrium/shapes';

const MU0 = 1.25663706212e-6;
const TWO_PI = 2 * Math.PI;

/** a file that cannot be read, or a request that cannot be honoured */
export class GeqdskError extends Error {
  constructor(message: string) {
    super(`G-EQDSK: ${message}`);
    this.name = 'GeqdskError';
  }
}

/** the contents of a G-EQDSK file (in the units and signs of `cocos` when a function says so; SI otherwise: m, T, A, Pa, Wb) */
export interface Geqdsk {
  /** text of the first line (the first 48 characters of it in a file) */
  description: string;
  /** the "idum" integer of the first line (EFIT writes 3) */
  idum: number;
  /** grid points in R and in Z (also the length of the 1-D tables) */
  nw: number;
  nh: number;
  /** width and height of the (R, Z) box [m] */
  rdim: number;
  zdim: number;
  /** reference radius of bcentr [m] */
  rcentr: number;
  /** left edge of the box [m] */
  rleft: number;
  /** height of the middle of the box [m] */
  zmid: number;
  /** magnetic axis [m] */
  rmaxis: number;
  zmaxis: number;
  /** ψ on the axis and on the plasma boundary */
  simag: number;
  sibry: number;
  /** vacuum toroidal field at rcentr [T] */
  bcentr: number;
  /** plasma current [A] */
  current: number;
  /** F = R B_φ [T m] on ψ_N = i/(nw − 1) */
  fpol: Float64Array;
  /** pressure [Pa] */
  pres: Float64Array;
  /** FF' = F dF/dψ */
  ffprim: Float64Array;
  /** p' = dp/dψ */
  pprime: Float64Array;
  /** ψ(R, Z): nh rows of nw values, psirz[j·nw + i] */
  psirz: Float64Array;
  /** safety factor on ψ_N = i/(nw − 1) */
  qpsi: Float64Array;
  /** plasma boundary polygon (may be empty) */
  rbbbs: Float64Array;
  zbbbs: Float64Array;
  /** limiter / wall polygon (may be empty) */
  rlim: Float64Array;
  zlim: Float64Array;
}

// ------------------------------------------------------------------------------------------------ COCOS

export interface CocosInfo {
  cocos: number;
  /** 1 when ψ is the full poloidal flux [Wb] (COCOS 11–18), 0 when it is ψ/2π [Wb/rad] (1–8) */
  eBp: 0 | 1;
  sigmaBp: 1 | -1;
  sigmaRphiZ: 1 | -1;
  sigmaRhoThetaPhi: 1 | -1;
}

/** (σ_Bp, σ_RφZ, σ_ρθφ) of COCOS 1–8 (Sauter and Medvedev 2013, Table I) */
const COCOS_SIGNS: Record<number, [1 | -1, 1 | -1, 1 | -1]> = {
  1: [1, 1, 1], 2: [1, -1, 1], 3: [-1, 1, -1], 4: [-1, -1, -1],
  5: [1, 1, -1], 6: [1, -1, -1], 7: [-1, 1, 1], 8: [-1, -1, 1],
};

/** The signs and the flux unit of a COCOS number (1–8 or 11–18) */
export function cocosInfo(cocos: number): CocosInfo {
  const base = cocos % 10;
  if (!(Number.isInteger(cocos) && (cocos >= 1 && cocos <= 8 || cocos >= 11 && cocos <= 18) && COCOS_SIGNS[base])) {
    throw new GeqdskError(`COCOS must be an integer in 1–8 or 11–18 (got ${cocos})`);
  }
  const [sBp, sRphiZ, sRthetaPhi] = COCOS_SIGNS[base];
  return { cocos, eBp: cocos >= 11 ? 1 : 0, sigmaBp: sBp, sigmaRphiZ: sRphiZ, sigmaRhoThetaPhi: sRthetaPhi };
}

/** The factor ψ_out = f ψ_in of a change of COCOS: σ_Bp' σ_RφZ' (2π)^e' */
export function psiFactor(from: number, to: number): number {
  const a = cocosInfo(from), b = cocosInfo(to);
  return a.sigmaBp * b.sigmaBp * a.sigmaRphiZ * b.sigmaRphiZ * Math.pow(TWO_PI, b.eBp - a.eBp);
}

// + 0 turns a −0 (0 × a negative factor) into 0: files should not carry "-0.000000000E+00"
const scaled = (v: Float64Array, f: number): Float64Array => Float64Array.from(v, (x) => x * f + 0);

/**
 * The same equilibrium in another COCOS: ψ (psirz, simag, sibry) times σ_Bp' σ_RφZ' (2π)^e', I_p, B0 and F times σ_RφZ',
 * q times σ_ρθφ', p' and FF' times the inverse of the ψ factor; geometry and p unchanged. (Additive constants of ψ are
 * not touched: ψ is scaled, not shifted.)
 */
export function convertCocos(g: Geqdsk, from: number, to: number): Geqdsk {
  const a = cocosInfo(from), b = cocosInfo(to);
  const fPsi = psiFactor(from, to), r = a.sigmaRphiZ * b.sigmaRphiZ, h = a.sigmaRhoThetaPhi * b.sigmaRhoThetaPhi;
  return {
    ...g,
    simag: g.simag * fPsi + 0, sibry: g.sibry * fPsi + 0, psirz: scaled(g.psirz, fPsi),
    current: g.current * r + 0, bcentr: g.bcentr * r + 0, fpol: scaled(g.fpol, r),
    qpsi: scaled(g.qpsi, h),
    pprime: scaled(g.pprime, 1 / fPsi), ffprim: scaled(g.ffprim, 1 / fPsi),
  };
}

const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

/** the (R, Z) → ψ map of the file as a bicubic spline */
function psiMap(g: Geqdsk): Bicubic {
  return new Bicubic(g.psirz, g.nw, g.nh, g.rleft, g.zmid - 0.5 * g.zdim, g.rdim / (g.nw - 1), g.zdim / (g.nh - 1));
}

/**
 * The current the file's ψ map carries through the ψ = ψ_axis + 0.98(ψ_b − ψ_axis) contour, (1/μ0) ∮ |∇ψ|/R dl, over the
 * plasma current the file states: 1 when ψ is in Wb/rad and 2π when it is the full flux (the contour holds about 0.97 to
 * 1 of I_p). Ampère's law is what tells the two flux units apart; nothing in the file does.
 */
function ampereRatio(g: Geqdsk): number {
  if (!(Math.abs(g.current) > 0)) throw new GeqdskError('the file states no plasma current');
  const bi = psiMap(g), g3 = new Float64Array(3);
  const level = g.simag + 0.98 * (g.sibry - g.simag);
  const axis: [number, number] = [g.rmaxis, g.zmaxis];
  const c = contourBoundary((R, Z) => bi.eval(R, Z), axis, level, Math.hypot(g.rdim, g.zdim), 128);
  const n = 128;
  const pts = Array.from({ length: n }, (_, k) => c.point((TWO_PI * k) / n));
  let I = 0;
  for (let k = 0; k < n; k++) {
    const p = pts[k], q = pts[(k + 1) % n];
    const Rm = 0.5 * (p[0] + q[0]), Zm = 0.5 * (p[1] + q[1]);
    bi.evalGrad(Rm, Zm, g3);
    I += (Math.hypot(g3[1], g3[2]) / Rm) * Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return I / MU0 / Math.abs(g.current);
}

export interface CocosDetection extends CocosInfo {
  /** what the detection rests on and where it had to guess */
  notes: string[];
  /** (1/μ0) ∮ |∇ψ|/R dl on the 98 % surface over |current|: ≈ 1 for ψ in Wb/rad, ≈ 2π for Wb (NaN if it could not be evaluated) */
  ampereRatio: number;
}

/**
 * COCOS of a file from its signs and Ampère's law. σ_Ip and σ_B0 are the signs of `current` and `bcentr`;
 * σ_Bp = sign(ψ_b − ψ_axis) σ_Ip (ψ increases outwards for I_p > 0 when σ_Bp = +1); σ_ρθφ = sign(q) σ_Ip σ_B0 (from the
 * safety-factor table; +1 without it); e_Bp from the current the ψ map carries (see ampereRatio; 0 if it cannot be
 * evaluated). σ_RφZ is not in a file: the odd COCOS is returned (σ_RφZ = +1). The signs of p' must be −σ_Ip σ_Bp, which is
 * checked against the file's own pprime.
 */
export function detectCocos(g: Geqdsk): CocosDetection {
  const notes: string[] = [];
  const sIp = sign(g.current), sB0 = sign(g.bcentr !== 0 ? g.bcentr : g.fpol[g.nw - 1]);
  if (sIp === 0) notes.push('current is 0: σ_Ip taken as +1');
  if (sB0 === 0) notes.push('bcentr is 0: σ_B0 taken as +1');
  const Ip = sIp || 1, B0 = sB0 || 1;
  const dpsi = g.sibry - g.simag;
  if (dpsi === 0) throw new GeqdskError('simag equals sibry: no flux difference to fix the COCOS from');
  const sigmaBp = sign(dpsi) * Ip;
  let qs = 0;
  for (let i = 1; i < g.nw - 1; i++) qs += sign(g.qpsi[i]);
  let sigmaRho: number;
  if (qs === 0) { sigmaRho = 1; notes.push('no usable qpsi: σ_ρθφ taken as +1'); } else sigmaRho = sign(qs) * Ip * B0;
  let pp = 0;
  for (let i = 0; i < g.nw; i++) pp += g.pprime[i];
  if (pp !== 0 && sign(pp) !== -Ip * sigmaBp) notes.push('the sign of pprime disagrees with −σ_Ip σ_Bp: the file mixes conventions, σ_Bp was taken from ψ');
  let ratio = NaN, eBp: 0 | 1 = 0;
  try {
    ratio = ampereRatio(g);
    if (ratio > Math.sqrt(TWO_PI)) eBp = 1;
    if (ratio < 0.5 || (ratio > 1.6 && ratio < 4) || ratio > 12) notes.push(`Ampère's law gives ${ratio.toFixed(3)} of the stated current: the flux unit (Wb or Wb/rad) is uncertain`);
  } catch (e) {
    notes.push(`the flux unit could not be checked against Ampère's law (${(e as Error).message}): ψ taken in Wb/rad`);
  }
  const base = sigmaBp > 0 ? (sigmaRho > 0 ? 1 : 5) : (sigmaRho > 0 ? 7 : 3);
  return { ...cocosInfo(base + 10 * eBp), notes, ampereRatio: ratio };
}

// ------------------------------------------------------------------------------------------- text format

/** E-format like Fortran E(w).d with the leading digit before the point: width d + 7 (sign column included) */
function fmtE(x: number, digits: number): string {
  if (!Number.isFinite(x)) throw new GeqdskError(`cannot write a non-finite number (${x})`);
  const [m, e] = x.toExponential(digits).split('e');
  const ex = parseInt(e, 10), ax = Math.abs(ex);
  const es = ax >= 100 ? `${ex < 0 ? '-' : '+'}${ax}` : `E${ex < 0 ? '-' : '+'}${String(ax).padStart(2, '0')}`;
  return (x < 0 ? '' : ' ') + m + es;
}

export interface GeqdskFormatOptions {
  /** digits after the point of the E format (default 9: the standard 5e16.9; up to 17) */
  digits?: number;
}

/**
 * The text of a G-EQDSK file: the standard (a48, 3i4) header, (5e16.9) numbers, (2i5) boundary sizes. With `digits` above
 * 9 the numbers are wider (still five per line): a file for readers that do not use fixed columns, holding ψ to
 * 5e-17 relative instead of 5e-10.
 */
export function formatGeqdsk(g: Geqdsk, opts: GeqdskFormatOptions = {}): string {
  const digits = opts.digits ?? 9;
  if (!(Number.isInteger(digits) && digits >= 1 && digits <= 17)) throw new GeqdskError(`digits must be an integer in 1–17 (got ${digits})`);
  if (!(Number.isInteger(g.nw) && Number.isInteger(g.nh) && g.nw >= 3 && g.nh >= 3 && g.nw <= 9999 && g.nh <= 9999)) throw new GeqdskError(`nw and nh must be integers in 3–9999 (got ${g.nw}, ${g.nh})`);
  const tables: [string, Float64Array, number][] = [['fpol', g.fpol, g.nw], ['pres', g.pres, g.nw], ['ffprim', g.ffprim, g.nw], ['pprime', g.pprime, g.nw], ['psirz', g.psirz, g.nw * g.nh], ['qpsi', g.qpsi, g.nw]];
  for (const [name, a, n] of tables) if (a.length !== n) throw new GeqdskError(`${name} has ${a.length} values, expected ${n}`);
  if (g.rbbbs.length !== g.zbbbs.length || g.rlim.length !== g.zlim.length) throw new GeqdskError('rbbbs/zbbbs and rlim/zlim must have equal lengths');
  const out: string[] = [];
  const int = (v: number, w: number) => String(v).padStart(w, ' ');
  const desc = g.description.replace(/[^\x20-\x7E]+/g, ' ').padEnd(48, ' ').slice(0, 48); // a Fortran reader wants plain ASCII
  out.push(desc + int(g.idum, 4) + int(g.nw, 4) + int(g.nh, 4));
  const rows = (vals: ArrayLike<number>) => {
    for (let i = 0; i < vals.length; i += 5) {
      let line = '';
      for (let k = i; k < Math.min(i + 5, vals.length); k++) line += fmtE(vals[k], digits);
      out.push(line);
    }
  };
  rows([g.rdim, g.zdim, g.rcentr, g.rleft, g.zmid]);
  rows([g.rmaxis, g.zmaxis, g.simag, g.sibry, g.bcentr]);
  rows([g.current, g.simag, 0, g.rmaxis, 0]);
  rows([g.zmaxis, 0, g.sibry, 0, 0]);
  for (const t of [g.fpol, g.pres, g.ffprim, g.pprime, g.psirz, g.qpsi]) rows(t);
  out.push(int(g.rbbbs.length, 5) + int(g.rlim.length, 5));
  const pairs = (r: Float64Array, z: Float64Array) => rows(Array.from({ length: 2 * r.length }, (_, k) => (k % 2 === 0 ? r[k >> 1] : z[k >> 1])));
  pairs(g.rbbbs, g.zbbbs);
  pairs(g.rlim, g.zlim);
  return out.join('\n') + '\n';
}

/** numbers of a data section: fixed-width Fortran fields run together ("1.5E+00-2.5E+00"), D exponents and "1.5-100" (no E) are read */
function readNumbers(text: string): number[] {
  const fixed = text.replace(/(\d\.\d*)([-+]\d{2,3})(?=[\s\-+]|$)/g, '$1E$2');
  const m = fixed.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][-+]?\d+)?/g) ?? [];
  return m.map((s) => Number(s.replace(/[dD]/, 'E')));
}

export interface GeqdskRead {
  data: Geqdsk;
  /** what was odd about the file and how it was read (empty for a clean file) */
  warnings: string[];
}

/**
 * Parse a G-EQDSK file. Tolerant of what real files do: fields that touch, D exponents, exponents without the E, a header
 * whose description is not 48 columns wide (nw and nh are then the last two integers), Windows line ends, a file that ends
 * after qpsi (no boundary), a limiter of 0 points, extra numbers at the end. It refuses a file with too few numbers for its
 * nw and nh, or with a box that has no size.
 */
export function readGeqdsk(text: string): GeqdskRead {
  const warnings: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = lines[0] ?? '';
  const cands: [number, number, number][] = [];
  if (header.length >= 60) {
    const a = [48, 52, 56].map((c) => Number(header.slice(c, c + 4)));
    if (a.every((v) => Number.isInteger(v))) cands.push([a[0], a[1], a[2]]);
  }
  const toks = header.trim().split(/\s+/);
  if (toks.length >= 3) {
    const a = toks.slice(-3).map(Number);
    if (a.every((v) => Number.isInteger(v))) cands.push([a[0], a[1], a[2]]);
  }
  const nums = readNumbers(lines.slice(1).join('\n'));
  let pick: [number, number, number] | null = null;
  for (const c of cands) {
    const [, nw, nh] = c;
    if (nw >= 3 && nh >= 3 && nw <= 100000 && nh <= 100000 && nums.length >= 20 + 5 * nw + nw * nh) { pick = c; break; }
  }
  if (!pick) {
    if (cands.length === 0) throw new GeqdskError('the first line does not end in the integers idum, nw, nh');
    const [, nw, nh] = cands[0];
    throw new GeqdskError(`nw = ${nw}, nh = ${nh} need ${20 + 5 * nw + nw * nh} numbers, the file has ${nums.length}`);
  }
  const [idum, nw, nh] = pick;
  let at = 0;
  const take = (n: number) => { const a = Float64Array.from(nums.slice(at, at + n)); at += n; return a; };
  const [rdim, zdim, rcentr, rleft, zmid] = take(5);
  const [rmaxis, zmaxis, simag, sibry, bcentr] = take(5);
  const l4 = take(5), l5 = take(5);
  const current = l4[0];
  // lines 4 and 5 repeat simag, rmaxis, zmaxis and sibry; some writers leave them 0
  const same = (dup: number, v: number) => dup === 0 || Math.abs(dup - v) <= 1e-6 * (Math.abs(dup) + Math.abs(v)) + 1e-12;
  if (!same(l4[1], simag) || !same(l4[3], rmaxis) || !same(l5[0], zmaxis) || !same(l5[2], sibry)) warnings.push('the repeated values of lines 4 and 5 (simag, rmaxis, zmaxis, sibry) differ from those of line 3: line 3 is used');
  const fpol = take(nw), pres = take(nw), ffprim = take(nw), pprime = take(nw), psirz = take(nw * nh), qpsi = take(nw);
  if (!(rdim > 0 && zdim > 0)) throw new GeqdskError(`the (R, Z) box has no size (rdim = ${rdim}, zdim = ${zdim})`);
  let nb = 0, nl = 0;
  const pairs = (n: number): [Float64Array, Float64Array] => {
    const r = new Float64Array(n), z = new Float64Array(n);
    for (let k = 0; k < n; k++) { r[k] = nums[at + 2 * k]; z[k] = nums[at + 2 * k + 1]; }
    at += 2 * n;
    return [r, z];
  };
  let rbbbs: Float64Array = new Float64Array(0), zbbbs: Float64Array = new Float64Array(0), rlim: Float64Array = new Float64Array(0), zlim: Float64Array = new Float64Array(0);
  if (nums.length - at >= 2) {
    nb = Math.round(nums[at]); nl = Math.round(nums[at + 1]); at += 2;
    if (!(nb >= 0 && nl >= 0 && nb + nl <= 1e6)) throw new GeqdskError(`nbbbs = ${nb}, limitr = ${nl} are not counts`);
    if (nums.length - at < 2 * nb) { warnings.push(`the boundary has ${nb} points, the file only ${Math.floor((nums.length - at) / 2)}: boundary dropped`); nb = 0; at = nums.length; }
    else [rbbbs, zbbbs] = pairs(nb);
    if (nums.length - at < 2 * nl) { if (nl > 0) warnings.push(`the limiter has ${nl} points, the file only ${Math.floor((nums.length - at) / 2)}: limiter dropped`); nl = 0; }
    else [rlim, zlim] = pairs(nl);
  } else warnings.push('the file ends after qpsi: no plasma boundary');
  if (nums.length - at > 0) warnings.push(`${nums.length - at} numbers after the limiter were ignored`);
  const description = header.length >= 60 && cands[0] === pick ? header.slice(0, 48).trim() : header.replace(/\s*-?\d+\s+-?\d+\s+-?\d+\s*$/, '').trim();
  return { data: { description, idum, nw, nh, rdim, zdim, rcentr, rleft, zmid, rmaxis, zmaxis, simag, sibry, bcentr, current, fpol, pres, ffprim, pprime, psirz, qpsi, rbbbs, zbbbs, rlim, zlim }, warnings };
}

// ---------------------------------------------------------------------------------------------- writing

export interface GeqdskWriteOptions {
  /** COCOS of the file, 1–8 or 11–18 (default 11: the IMAS convention, ψ in Wb increasing outwards) */
  cocos?: number;
  /** ψ grid points (default: the solver grid's NR × NZ, written as they are; other values resample ψ by the bicubic spline of the state) */
  nw?: number;
  nh?: number;
  /** points of the boundary polygon before closing it (default 256: the file has one more, the first repeated) */
  nBoundary?: number;
  /** limiter / wall polygon (default: none, limitr = 0) */
  limiter?: { R: ArrayLike<number>; Z: ArrayLike<number> };
  /** text of the first line */
  description?: string;
  /** value of ψ on the boundary in the file's own units (default 0: the solver's ψ_b = 0 scaled) */
  psiBoundary?: number;
}

/**
 * The G-EQDSK contents of an Equilibrium, in the requested COCOS: the solver's state (COCOS 7) with F, p, FF', p' and q
 * interpolated onto the uniform ψ_N grid of nw points, ψ on a uniform (R, Z) grid, the boundary polygon and an optional
 * limiter. The vacuum values of ψ outside the plasma are the solver's smooth continuation, not a coil-consistent field.
 */
export function geqdskFromEquilibrium(eq: Equilibrium, opts: GeqdskWriteOptions = {}): Geqdsk {
  const cocos = opts.cocos ?? 11;
  cocosInfo(cocos);
  const grid = eq.grid, P = eq.prof;
  const nw = opts.nw ?? grid.NR, nh = opts.nh ?? grid.NZ;
  if (!(Number.isInteger(nw) && Number.isInteger(nh) && nw >= 3 && nh >= 3)) throw new GeqdskError(`nw and nh must be integers ≥ 3 (got ${nw}, ${nh})`);
  const nb = opts.nBoundary ?? 256;
  if (!(Number.isInteger(nb) && nb >= 8)) throw new GeqdskError(`nBoundary must be an integer ≥ 8 (got ${nb})`);
  const rdim = (grid.NR - 1) * grid.dR, zdim = (grid.NZ - 1) * grid.dZ;
  const rleft = grid.Rmin, zmid = grid.Zmin + 0.5 * zdim;
  let psirz: Float64Array;
  if (nw === grid.NR && nh === grid.NZ) psirz = Float64Array.from(eq.psi);
  else {
    const bi = grid.bicubic(eq.psi);
    psirz = new Float64Array(nw * nh);
    for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) psirz[j * nw + i] = bi.eval(rleft + (rdim * i) / (nw - 1), zmid - 0.5 * zdim + (zdim * j) / (nh - 1));
  }
  const xs = Float64Array.from({ length: nw }, (_, i) => i / (nw - 1));
  const onGrid = (f: (x: number) => number) => Float64Array.from(xs, f);
  const F = new CubicSpline(P.psiN, P.F), p = new Pchip(P.psiN, P.p), pp = new CubicSpline(P.psiN, P.pp), ffp = new CubicSpline(P.psiN, P.FFp), q = new Pchip(P.psiN, P.q);
  const bp = boundaryPolygon(grid.boundary, nb);
  const rb = new Float64Array(nb + 1), zb = new Float64Array(nb + 1);
  rb.set(bp.R); zb.set(bp.Z); rb[nb] = bp.R[0]; zb[nb] = bp.Z[0];
  const lim = opts.limiter;
  if (lim && lim.R.length !== lim.Z.length) throw new GeqdskError('the limiter R and Z must have equal lengths');
  const solver: Geqdsk = {
    description: opts.description ?? 'fusion-sim v4 fixed-boundary Grad-Shafranov',
    idum: 3, nw, nh, rdim, zdim, rcentr: eq.R0, rleft, zmid,
    rmaxis: eq.Raxis, zmaxis: eq.Zaxis, simag: eq.psiAxis, sibry: 0, bcentr: eq.B0, current: eq.Ip,
    fpol: onGrid((x) => F.eval(x)), pres: onGrid((x) => Math.max(p.eval(x), 0)), ffprim: onGrid((x) => ffp.eval(x)), pprime: onGrid((x) => pp.eval(x)),
    psirz, qpsi: onGrid((x) => q.eval(x)),
    rbbbs: rb, zbbbs: zb,
    rlim: lim ? Float64Array.from(lim.R) : new Float64Array(0), zlim: lim ? Float64Array.from(lim.Z) : new Float64Array(0),
  };
  const out = convertCocos(solver, 7, cocos);
  if (opts.psiBoundary) {
    out.psirz = out.psirz.map((v) => v + opts.psiBoundary!);
    out.simag += opts.psiBoundary; out.sibry += opts.psiBoundary;
  }
  return out;
}

/** G-EQDSK text of an Equilibrium (geqdskFromEquilibrium, formatGeqdsk) */
export function writeGeqdsk(eq: Equilibrium, opts: GeqdskWriteOptions & GeqdskFormatOptions = {}): string {
  return formatGeqdsk(geqdskFromEquilibrium(eq, opts), opts);
}

// ---------------------------------------------------------------------------------------------- import

export interface GeqdskImportOptions {
  /** COCOS of the file (default: detectCocos) */
  cocos?: number;
  /** nodes along R of the solver grid the state is resampled onto (default: the file's nw, between 65 and 129) */
  NR?: number;
  /** grid margin around the plasma, in units of a (default: 0.06, less if the file's box is tighter) */
  margin?: number;
  /**
   * ψ (in the file's own units and sign) of the surface taken as the plasma boundary: the ψ = boundaryPsi contour of the
   * file's map, e.g. simag + 0.99 (sibry − simag) for the 99 % surface. Default: the file's boundary polygon
   * (or the sibry contour if the file has none). A surface inside a separatrix avoids its X-point, where q diverges and
   * |∇ψ| → 0; then ψ_N = 1 is that surface, I_p is the current inside it and the profiles are those of the file.
   */
  boundaryPsi?: number;
  /** rays of a contour boundary (default 256) */
  contourRays?: number;
  /** output flux surfaces of the Equilibrium (as EquilibriumOptions) */
  nSurf?: number;
  psiLevels?: ArrayLike<number>;
  nTheta?: number;
}

export interface GeqdskImport {
  /** the equilibrium, in the solver's conventions (COCOS 7, I_p and B0 > 0) */
  eq: Equilibrium;
  /** the solver whose grid the state lives on (forceBalanceOf, further assemble calls) */
  solver: GSSolver;
  /** the COCOS the file was read in (detected or given) */
  cocos: CocosInfo;
  /** the file in the solver's conventions, before resampling */
  data: Geqdsk;
  /** what the import did about oddities of the file (empty for a consistent file) */
  notes: string[];
}

/**
 * An Equilibrium from a G-EQDSK file. The file is converted to the solver's COCOS (a current or field of the other sign is
 * taken as its magnitude: flux surfaces do not know the direction of φ), ψ is resampled from the file's uniform grid onto
 * a Shortley–Weller grid of the boundary polygon by the bicubic spline of the map, F, p, p' and FF' are the file's
 * tables on ψ_N, and GSSolver.assemble traces the flux surfaces. q is re-traced from ψ and F, not copied from qpsi. The
 * returned equilibrium's `residual` is how well the imported ψ satisfies the Grad–Shafranov equation with the file's
 * p' and FF' on this grid, `forceBalanceResidual` the force-balance measure; the notes list what the file got wrong
 * (current or field of another sign, a boundary that is not a flux surface, ...).
 */
export function equilibriumFromGeqdsk(file: Geqdsk, opts: GeqdskImportOptions = {}): GeqdskImport {
  const notes: string[] = [];
  const nw = file.nw, nh = file.nh;
  if (!(file.psirz.length === nw * nh && file.fpol.length === nw)) throw new GeqdskError('the tables of the file do not match nw and nh');
  let cocos: CocosInfo;
  if (opts.cocos !== undefined) cocos = cocosInfo(opts.cocos);
  else { const d = detectCocos(file); cocos = d; notes.push(...d.notes.map((n) => `COCOS detection: ${n}`)); }
  // to the solver's convention: COCOS 7 with I_p, B0 > 0 by magnitude (and ψ decreasing outwards)
  let g = convertCocos(file, cocos.cocos, 7);
  let fPsi = psiFactor(cocos.cocos, 7);
  if (g.current < 0) {
    g = convertCocos(g, 7, 8); fPsi *= psiFactor(7, 8);
    notes.push('I_p < 0 in this COCOS: the direction of φ was reversed (COCOS 7 → 8), which leaves the geometry unchanged');
  }
  if (g.simag === g.sibry) throw new GeqdskError('simag equals sibry: the file has no flux difference between the axis and the boundary');
  if (!(g.simag > g.sibry)) {
    // ψ must be maximal on the axis: the data decide
    g = { ...g, simag: -g.simag, sibry: -g.sibry, psirz: scaled(g.psirz, -1), pprime: scaled(g.pprime, -1), ffprim: scaled(g.ffprim, -1) };
    fPsi = -fPsi;
    notes.push('ψ does not decrease outwards in the file\'s COCOS for I_p > 0: the orientation was taken from the data');
  }
  if (g.bcentr < 0 || g.fpol[nw - 1] < 0) notes.push('B0 has the opposite direction to I_p: the field is taken as its magnitude (q as |q|)');
  const F = g.fpol.map((v) => Math.abs(v));
  const B0file = Math.abs(g.bcentr);
  // boundary
  const dRf = g.rdim / (nw - 1), dZf = g.zdim / (nh - 1), Zlo = g.zmid - 0.5 * g.zdim;
  const bi = new Bicubic(g.psirz, nw, nh, g.rleft, Zlo, dRf, dZf);
  const nbp = g.rbbbs.length;
  let boundary: ShapeBoundary;
  let psiL = g.sibry;
  if (opts.boundaryPsi !== undefined) {
    psiL = opts.boundaryPsi * fPsi;
    if (!(psiL < g.simag && psiL >= g.sibry - 1e-12 * Math.abs(g.simag - g.sibry))) throw new GeqdskError(`boundaryPsi ${opts.boundaryPsi} is not between the axis and the boundary of the file (simag ${file.simag}, sibry ${file.sibry}) or on the wrong side of sibry`);
    boundary = contourBoundary((R, Z) => bi.eval(R, Z), [g.rmaxis, g.zmaxis], psiL, Math.hypot(g.rdim, g.zdim), opts.contourRays ?? 256);
  } else if (nbp >= 4) {
    try {
      boundary = polygonBoundary(g.rbbbs, g.zbbbs);
    } catch (e) {
      notes.push(`the file's boundary polygon is not usable (${(e as Error).message}): the ψ = sibry contour is used`);
      boundary = contourBoundary((R, Z) => bi.eval(R, Z), [g.rmaxis, g.zmaxis], g.sibry + 1e-9 * (g.simag - g.sibry), Math.hypot(g.rdim, g.zdim), opts.contourRays ?? 256);
    }
  } else {
    notes.push('the file has no boundary polygon: the ψ = sibry contour is used');
    boundary = contourBoundary((R, Z) => bi.eval(R, Z), [g.rmaxis, g.zmaxis], g.sibry + 1e-9 * (g.simag - g.sibry), Math.hypot(g.rdim, g.zdim), opts.contourRays ?? 256);
  }
  const geom = shapeGeometry(boundary);
  // grid: as wide a margin as the file's box allows
  const zr = boundary.zRange!;
  const roomR = Math.min(boundary.R0 - boundary.a - g.rleft, g.rleft + g.rdim - (boundary.R0 + boundary.a));
  const roomZ = Math.min(zr[0] - Zlo, Zlo + g.zdim - zr[1]);
  if (roomR < 0 || roomZ < 0) notes.push('the plasma boundary leaves the (R, Z) box of the file: ψ is extrapolated there');
  const mMax = Math.min(roomR / geom.a, roomZ / (geom.kappa * geom.a));
  const margin = opts.margin ?? Math.min(0.06, Math.max(0, 0.9 * mMax));
  if (opts.margin === undefined && margin < 0.02) notes.push(`the file's (R, Z) box hardly extends beyond the plasma (margin ${margin.toFixed(3)} a): the flux near the boundary is less accurate`);
  const NR = opts.NR ?? Math.min(129, Math.max(65, nw));
  const solver = new GSSolver(geom, { NR, margin, boundary });
  const grid = solver.grid;
  // ψ at the grid nodes (all of them: the file's own exterior is kept)
  const psi = new Float64Array(grid.NR * grid.NZ);
  for (let j = 0; j < grid.NZ; j++) for (let i = 0; i < grid.NR; i++) psi[j * grid.NR + i] = bi.eval(grid.R(i), grid.Z(j)) - psiL;
  // profiles of ψ_N; ψ_N of the solver = x_b × ψ_N of the file (x_b < 1 when the boundary is a surface inside the file's)
  const dFile = g.simag - g.sibry, xb = (g.simag - psiL) / dFile;
  const dpsi = g.simag - psiL;
  const xf = Float64Array.from({ length: nw }, (_, i) => i / (nw - 1));
  const sF = new CubicSpline(xf, F), sP = new CubicSpline(xf, g.pres);
  let ppF = g.pprime, ffF = g.ffprim;
  const zero = (a: Float64Array) => a.every((v) => v === 0);
  if (zero(ppF) || zero(ffF)) {
    // dp/dψ = −(dp/dx)/Δψ_file, FF' = −F (dF/dx)/Δψ_file with x the file's ψ_N
    if (zero(ppF)) ppF = Float64Array.from(xf, (x) => -sP.deriv(x) / dFile);
    if (zero(ffF)) ffF = Float64Array.from(xf, (x) => -(sF.eval(x) * sF.deriv(x)) / dFile);
    notes.push('pprime or ffprim of the file is zero everywhere: derived from pres and fpol');
  }
  const sPP = new CubicSpline(xf, ppF), sFF = new CubicSpline(xf, ffF);
  const profiles = (): StateProfiles => ({
    p: (x) => Math.max(sP.eval(Math.min(Math.max(xb * x, 0), 1)), 0),
    pp: (x) => sPP.eval(Math.min(Math.max(xb * x, 0), 1)),
    ffp: (x) => sFF.eval(Math.min(Math.max(xb * x, 0), 1)),
    F: (x) => sF.eval(Math.min(Math.max(xb * x, 0), 1)),
  });
  const tab = { psiLevels: opts.psiLevels, nSurf: opts.nSurf, nTheta: opts.nTheta, keepExterior: true };
  const R0 = geom.R;
  const B0 = (B0file * Math.abs(g.rcentr)) / R0;
  let Ip = Math.abs(g.current);
  let eq = solver.assemble(psi, profiles, { Ip, B0, ...tab });
  if (opts.boundaryPsi !== undefined) {
    Ip = eq.prof.Ienc[eq.prof.Ienc.length - 1];
    notes.push(`I_p of the boundary surface (Ampère on it) is ${(Ip / 1e6).toFixed(4)} MA against ${(Math.abs(g.current) / 1e6).toFixed(4)} MA of the file`);
    eq = solver.assemble(psi, profiles, { Ip, B0, ...tab });
  } else {
    const Iamp = eq.prof.Ienc[eq.prof.Ienc.length - 1];
    if (!(Math.abs(Iamp / Ip - 1) < 0.05)) notes.push(`Ampère's law on the boundary gives ${(Iamp / 1e6).toFixed(4)} MA, the file states ${(Ip / 1e6).toFixed(4)} MA (${(100 * (Iamp / Ip - 1)).toFixed(1)} %)`);
  }
  if (Math.abs(eq.psiAxis - dpsi) > 5e-3 * dpsi) notes.push(`ψ on the axis of the resampled map (${eq.psiAxis.toExponential(4)}) differs from the file's simag − boundary (${dpsi.toExponential(4)}) by ${(100 * (eq.psiAxis / dpsi - 1)).toFixed(2)} %`);
  return { eq, solver, cocos, data: g, notes };
}

/** Read a G-EQDSK file text and import it: readGeqdsk, equilibriumFromGeqdsk (the reader's warnings come first in `notes`) */
export function importGeqdsk(text: string, opts: GeqdskImportOptions = {}): GeqdskImport {
  const { data, warnings } = readGeqdsk(text);
  const r = equilibriumFromGeqdsk(data, opts);
  r.notes.unshift(...warnings.map((w) => `file: ${w}`));
  return r;
}
