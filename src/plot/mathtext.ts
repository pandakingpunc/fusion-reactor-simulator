/**
 * Small TeX-like label language: "T_e (keV)", "$n_e\,(10^{20}\,\mathrm{m^{-3}})$", "$\beta_N$",
 * "$\frac{dq}{d\rho}$", "$\bar{n}_e$", "$\hat{T}$".
 *
 * Inside $...$: Latin and lowercase Greek letters italic, digits and upper-case Greek upright (TeX
 * convention); \alpha…\Omega; \cdot \times \pm \approx \propto \leq \geq \infty \partial \nabla \langle
 * \rangle \to \sim \prime …; _x, _{…}, ^x, ^{…} sub/superscripts (scale 0.72, nestable); \mathrm{}
 * \mathit{} \mathbf{} \text{}; spacing \, \: \; \quad \qquad \! (TeX mu widths); \frac{a}{b}
 * (text-style fraction: scaled numerator/denominator and a rule on the math axis); accents \hat \tilde
 * \dot (spacing-modifier glyphs centred over the base) and \bar / \overline (a rule over the base);
 * \left / \right are accepted and ignored. Binary operators and relations get TeX's medium/thick space.
 *
 * Output: runs of (font, scale, baseline rise, optional pen move `dx`, optional horizontal `rule`),
 * all lengths in em of the label's base size. The SVG and PDF back ends render the same runs.
 * Horizontal placement of accents and fraction parts needs text widths: pass the {@link Measurer}
 * (the FontSet) — without one a crude 0.5 em/character estimate is used.
 */
import type { FontKey } from './fonts';

export interface Run {
  text: string;
  font: FontKey;
  scale: number;
  /** baseline shift, em of the base size (up positive) */
  rise: number;
  /** horizontal pen move before this run, em of the base size (may be negative) */
  dx?: number;
  /** a horizontal rule instead of text (text is ''): width w and thickness t in em of the base size, centred at `rise`; advances the pen by w */
  rule?: { w: number; t: number };
}
// A run with empty text and no rule is a pen move only (`dx`): the parser ends a label with one when
// a move follows the last glyph (the right side bearing of a trailing \frac, a trailing \,).

/** Text measurement (em at scale 1): the FontSet implements it. */
export interface Measurer {
  width(text: string, font: FontKey): number;
  /** highest glyph top above the baseline, em */
  height?(text: string, font: FontKey): number;
}

const APPROX: Measurer = {
  width: (t) => 0.5 * [...t].length,
  height: (t) => (/[A-Z0-9bdfhkltΑ-Ωβδζθλξ∂]/.test(t) ? 0.68 : t.trim() ? 0.47 : 0),
};

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς',
  tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
/** ordinary symbols (no automatic spacing) */
const SYMBOLS: Record<string, string> = {
  infty: '∞', partial: '∂', nabla: '∇', langle: '⟨', rangle: '⟩', prime: '′', int: '∫', sqrt: '√', sum: '∑', prod: '∏',
  degree: '°', parallel: '‖', perp: '⊥', ell: 'ℓ', hbar: 'ℏ', odot: '⊙', star: '*', lbrace: '{', rbrace: '}', percent: '%',
  ldots: '…', dots: '…', cdots: '⋯', angle: '∠', emptyset: '∅',
};
/** binary operators (medium space 4/18 em around them in text style) */
const BINARY: Record<string, string> = { cdot: '·', times: '×', pm: '±', mp: '∓', div: '÷', circ: '∘', ast: '∗', oplus: '⊕', otimes: '⊗' };
/** relations (thick space 5/18 em) */
const RELATIONS: Record<string, string> = {
  approx: '≈', propto: '∝', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', sim: '∼', simeq: '≃', equiv: '≡',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', leftrightarrow: '↔', ll: '≪', gg: '≫', in: '∈', mapsto: '↦',
};
/** accents drawn with spacing-modifier glyphs */
const ACCENTS: Record<string, string> = { hat: 'ˆ', widehat: 'ˆ', tilde: '˜', widetilde: '˜', dot: '˙', check: 'ˇ', breve: '˘', acute: 'ˊ', grave: 'ˋ' };
/** TeX math spacing, em (thin 3 mu, medium 4 mu, thick 5 mu; 18 mu = 1 em) */
const SPACES: Record<string, number> = { ',': 3 / 18, ':': 4 / 18, '>': 4 / 18, ';': 5 / 18, '!': -3 / 18, quad: 1, qquad: 2, ' ': 0.25, enspace: 0.5, thinspace: 3 / 18 };
const MED = 4 / 18, THICK = 5 / 18;
const LOWER_GREEK = /[α-ωϑϕϖϱϵ]/;

/** upright: inside \mathrm/\mathbf letters are not italicised, but _ ^ and operators still work */
interface State { font: FontKey; scale: number; rise: number; math: boolean; upright: boolean }

/** Total advance of runs at a base size (pt), including pen moves and rules. */
export function runsWidth(runs: readonly Run[], size: number, m: Measurer = APPROX): number {
  let w = 0;
  for (const r of runs) {
    w += (r.dx ?? 0) * size;
    w += r.rule ? r.rule.w * size : m.width(r.text, r.font) * size * r.scale;
  }
  return w;
}

class Parser {
  private i = 0;
  private out: Run[] = [];
  /** pen move (em) waiting for the next run */
  private pending = 0;
  constructor(private readonly s: string, private readonly m: Measurer) {}

  run(): Run[] {
    this.parseGroup({ font: 'roman', scale: 1, rise: 0, math: false, upright: false }, false);
    // a move after the last glyph still belongs to the label's advance (layout width, anchoring)
    if (this.pending) { this.out.push({ text: '', font: 'roman', scale: 1, rise: 0, dx: this.pending }); this.pending = 0; }
    return this.out;
  }

  private push(text: string, st: State, font: FontKey = st.font): void {
    if (!text) return;
    const last = this.out[this.out.length - 1];
    if (!this.pending && last && !last.rule && last.font === font && last.scale === st.scale && last.rise === st.rise) { last.text += text; return; }
    const r: Run = { text, font, scale: st.scale, rise: st.rise };
    if (this.pending) { r.dx = this.pending; this.pending = 0; }
    this.out.push(r);
  }
  private rule(w: number, t: number, rise: number): void {
    const r: Run = { text: '', font: 'roman', scale: 1, rise, rule: { w: Math.max(w, 0), t } };
    if (this.pending) { r.dx = this.pending; this.pending = 0; }
    this.out.push(r);
  }
  private move(em: number): void { this.pending += em; }
  /** appends runs parsed separately (their first run takes the pending pen move) */
  private emit(runs: Run[]): void {
    for (const r of runs) {
      if (this.pending) { r.dx = (r.dx ?? 0) + this.pending; this.pending = 0; }
      this.out.push(r);
    }
  }
  /** parses into a separate list; a trailing pen move inside the group is dropped */
  private sub(fn: () => void): { runs: Run[]; w: number } {
    const out = this.out, pending = this.pending;
    this.out = []; this.pending = 0;
    fn();
    const runs = this.out;
    this.out = out; this.pending = pending;
    return { runs, w: runsWidth(runs, 1, this.m) };
  }
  private height(runs: Run[], st: State): number {
    let h = 0;
    for (const r of runs) {
      if (r.rule) h = Math.max(h, r.rise - st.rise + r.rule.t / 2);
      else h = Math.max(h, this.glyphTop(r.text, r.font) * r.scale + r.rise - st.rise);
    }
    return h;
  }
  private glyphTop(text: string, font: FontKey): number {
    return this.m.height ? this.m.height(text, font) : APPROX.height!(text, font);
  }
  private prevChar(): string {
    for (let k = this.out.length - 1; k >= 0; k--) if (this.out[k].text) return this.out[k].text.slice(-1);
    return '';
  }
  private operandBefore(): boolean {
    const prev = this.prevChar();
    return prev !== '' && !/[\s(\[{−+=<>≤≥≈×·±∓÷∝∼→←,∈≠≡≃]/.test(prev);
  }
  /** operator with automatic spacing (text style only, like TeX) */
  private operator(sym: string, st: State, space: number): void {
    const spaced = st.math && st.scale === 1 && this.operandBefore();
    if (spaced) this.move(space);
    this.push(sym, st, st.font === 'bold' ? 'bold' : 'roman');
    if (spaced) this.move(space);
  }

  private parseGroup(st: State, stopAtBrace: boolean): void {
    const s = this.s;
    while (this.i < s.length) {
      const ch = s[this.i];
      if (ch === '}' && stopAtBrace) { this.i++; return; }
      if (ch === '$') { st = { ...st, math: !st.math, font: st.math ? 'roman' : st.font }; this.i++; continue; }
      if (ch === '{') { this.i++; this.parseGroup({ ...st }, true); continue; }
      if ((ch === '_' || ch === '^') && st.math) {
        this.i++;
        const sub: State = { ...st, scale: st.scale * 0.72, rise: st.rise + (ch === '^' ? 0.42 : -0.22) * st.scale };
        this.parseArg(sub);
        continue;
      }
      this.parseToken(st);
    }
  }

  /** one argument: {group} or a single token (spaces skipped in math) */
  private parseArg(st: State): void {
    const s = this.s;
    while (st.math && s[this.i] === ' ') this.i++;
    if (s[this.i] === '{') { this.i++; this.parseGroup(st, true); }
    else this.parseToken(st);
  }

  private parseToken(st: State): void {
    const s = this.s;
    const ch = s[this.i];
    if (ch === undefined) return;
    if (ch === '\\') {
      this.i++;
      let name = '';
      if (/[A-Za-z]/.test(s[this.i] ?? '')) { while (this.i < s.length && /[A-Za-z]/.test(s[this.i])) name += s[this.i++]; }
      else name = s[this.i++] ?? '';
      const eatSpace = () => { if (/^[A-Za-z]/.test(name) && s[this.i] === ' ') this.i++; };
      if (name in GREEK) {
        const g = GREEK[name];
        const font: FontKey = st.upright ? st.font : st.math && LOWER_GREEK.test(g) ? 'italic' : st.font === 'bold' ? 'bold' : 'roman';
        this.push(g, st, font); eatSpace(); return;
      }
      if (name in SYMBOLS) { this.push(SYMBOLS[name], st, st.font === 'bold' ? 'bold' : 'roman'); eatSpace(); return; }
      if (name in BINARY) { eatSpace(); this.operator(BINARY[name], st, MED); return; }
      if (name in RELATIONS) { eatSpace(); this.operator(RELATIONS[name], st, THICK); return; }
      if (name in SPACES) { this.move(SPACES[name] * st.scale); eatSpace(); return; }
      if (name === 'mathrm' || name === 'text' || name === 'mathit' || name === 'mathbf' || name === 'mathsf' || name === 'textrm' || name === 'textbf' || name === 'textit' || name === 'operatorname') {
        const font: FontKey = name === 'mathit' || name === 'textit' ? 'italic' : name === 'mathbf' || name === 'textbf' ? 'bold' : 'roman';
        const inner: State = name.startsWith('text') ? { ...st, font, math: false, upright: true } : { ...st, font, upright: true };
        this.parseArg(inner);
        return;
      }
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') { this.frac(st); return; }
      if (name === 'bar' || name === 'overline') { this.overbar(st, name === 'overline'); return; }
      if (name in ACCENTS) { this.accent(st, ACCENTS[name]); return; }
      if (name === 'left' || name === 'right' || name === 'big' || name === 'Big') {
        eatSpace();
        if (s[this.i] === '.') this.i++; // null delimiter
        else if (s[this.i] === '\\' && (s[this.i + 1] === '{' || s[this.i + 1] === '}' || s[this.i + 1] === '|')) { this.push(s[this.i + 1] === '|' ? '‖' : s[this.i + 1], st, 'roman'); this.i += 2; }
        return;
      }
      if (name === '$' || name === '%' || name === '_' || name === '{' || name === '}' || name === '&' || name === '#' || name === '\\') { this.push(name, st, 'roman'); return; }
      this.push(name, st, 'roman'); // unknown command: its name as plain text
      return;
    }
    this.i++;
    if (!st.math) { this.push(ch, st); return; }
    if (ch === ' ') return; // TeX: spaces are ignored in math mode
    if (ch === '-' || ch === '+') { this.operator(ch === '-' ? '−' : '+', st, MED); return; }
    if (ch === '=' || ch === '<' || ch === '>') { this.operator(ch, st, THICK); return; }
    if (ch === '\'') { this.push('′', st, 'roman'); return; }
    if (/[A-Za-z]/.test(ch) || LOWER_GREEK.test(ch)) { this.push(ch, st, st.upright ? st.font : 'italic'); return; }
    this.push(ch, st, st.font === 'bold' ? 'bold' : 'roman');
  }

  /**
   * Text-style fraction (TeX: numerator/denominator one script level smaller, rule on the math axis).
   * Emitted as rule, narrower part, wider part (pen moves in between); the move from the wider part's
   * end to the fraction's end (padding and side bearing) is left pending for what follows, and kept
   * as a pen-only run when the fraction ends the label. Runs are therefore not in left-to-right order:
   * the SVG back end places such labels explicitly.
   */
  private frac(st: State): void {
    const k = st.scale;
    const fs = Math.max(0.45, k * 0.72);
    const num = this.sub(() => this.parseArg({ ...st, scale: fs, rise: st.rise + 0.46 * k }));
    const den = this.sub(() => this.parseArg({ ...st, scale: fs, rise: st.rise - 0.36 * k }));
    const pad = 0.06 * k, side = 0.05 * k;
    const W = Math.max(num.w, den.w) + 2 * pad;
    this.move(side);
    this.rule(W, 0.045 * k, st.rise + 0.25 * k);
    const [a, b] = num.w <= den.w ? [num, den] : [den, num];
    this.move(-W + (W - a.w) / 2);
    this.emit(a.runs);
    this.move(-(W + a.w) / 2 + (W - b.w) / 2);
    this.emit(b.runs);
    this.move((W - b.w) / 2 + side);
  }

  /** skew of an accent over an italic base (slant ≈ 12°): half the horizontal offset at the base's height */
  private skew(runs: Run[], h: number): number {
    return runs.length && runs.every((r) => r.rule || r.font === 'italic') ? 0.5 * Math.tan((12 * Math.PI) / 180) * h : 0;
  }

  /** \bar (slightly narrower than the base) and \overline (full width): a rule above the base */
  private overbar(st: State, full: boolean): void {
    const k = st.scale;
    const base = this.sub(() => this.parseArg(st));
    const h = this.height(base.runs, st);
    const w = full ? base.w : Math.max(base.w - 0.08 * k, 0.25 * k);
    const off = (base.w - w) / 2 + this.skew(base.runs, h);
    this.move(off);
    this.rule(w, 0.04 * k, st.rise + h + 0.1 * k);
    this.move(-(off + w));
    this.emit(base.runs);
  }

  /** accent glyph centred over the base (emitted first so that the pen ends at the base's end; the base follows with a backward move) */
  private accent(st: State, glyph: string): void {
    const k = st.scale;
    const base = this.sub(() => this.parseArg(st));
    const h = this.height(base.runs, st);
    const xh = this.glyphTop('x', 'roman') * k;
    const wa = this.m.width(glyph, 'roman') * k;
    const off = (base.w - wa) / 2 + this.skew(base.runs, h);
    this.move(off);
    this.push(glyph, { ...st, rise: st.rise + Math.max(0, h - xh) }, 'roman');
    this.move(-(off + wa));
    this.emit(base.runs);
  }
}

/** Parses a label into runs (pass the FontSet as measurer for exact accent/fraction placement). */
export function parseMath(s: string, m: Measurer = APPROX): Run[] {
  return new Parser(s, m).run();
}

/** Plain text → one run (fast path) */
export function plainRuns(s: string, m?: Measurer): Run[] {
  return s.includes('$') || s.includes('\\') ? parseMath(s, m) : [{ text: s, font: 'roman', scale: 1, rise: 0 }];
}
