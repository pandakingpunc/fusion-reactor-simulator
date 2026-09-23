/**
 * Küçük TeX-benzeri etiket dizgisi: "T_e (keV)", "$n_e\,(10^{20}\,\mathrm{m^{-3}})$", "$\beta_N$".
 * $...$ içinde: harfler italik, rakamlar düz; \alpha…\Omega, \cdot \times \pm \approx \propto
 * \leq \geq \infty \partial \nabla \langle \rangle \to \sim \prime; _x, _{…}, ^x, ^{…} alt/üst simge
 * (ölçek 0.7, iç içe olabilir); \mathrm{} \mathit{} \mathbf{} \text{}; \, \; \quad \! boşluklar.
 * Çıktı: yazı tipi / ölçek / taban kayması (em) çalıştırmaları — SVG ve PDF arka uçları ortak kullanır.
 */
import { FontKey, glyph } from './fonts';

export interface Run { text: string; font: FontKey; scale: number; rise: number }

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
const SYMBOLS: Record<string, string> = {
  cdot: '·', times: '×', pm: '±', approx: '≈', propto: '∝', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
  infty: '∞', partial: '∂', nabla: '∇', langle: '⟨', rangle: '⟩', to: '→', rightarrow: '→', leftarrow: '←', sim: '∼',
  prime: '′', int: '∫', sqrt: '√', sum: '∑', in: '∈', circ: '∘', degree: '°', parallel: '||', perp: '⊥', ell: 'ℓ',
  odot: '⊙', star: '*', lbrace: '{', rbrace: '}', percent: '%',
};
const SPACES: Record<string, number> = { ',': 0.17, ';': 0.28, ':': 0.22, quad: 1, qquad: 2, '!': -0.17, ' ': 0.25 };

/** upright: \mathrm/\mathbf içinde harfler italik yapılmaz ama _ ^ − çalışmaya devam eder */
interface State { font: FontKey; scale: number; rise: number; math: boolean; upright: boolean }

/** Etiketi çalıştırmalara ayrıştır */
export function parseMath(s: string): Run[] {
  const runs: Run[] = [];
  const push = (text: string, st: State, fontOverride?: FontKey) => {
    if (!text) return;
    const font = fontOverride ?? st.font;
    const last = runs[runs.length - 1];
    if (last && last.font === font && last.scale === st.scale && last.rise === st.rise) last.text += text;
    else runs.push({ text, font, scale: st.scale, rise: st.rise });
  };
  const space = (em: number, st: State) => {
    // boşluk: roman ' ' genişliği 0.25 em → oransal tekrar (yaklaşık); negatifte yok say
    const n = Math.round(em / 0.25);
    if (n > 0) push(' '.repeat(n), { ...st, font: 'roman' });
  };
  let i = 0;
  const parseGroup = (st: State, stopAtBrace: boolean): void => {
    while (i < s.length) {
      const ch = s[i];
      if (ch === '}' && stopAtBrace) { i++; return; }
      if (ch === '$') { st = { ...st, math: !st.math, font: st.math ? 'roman' : st.font }; i++; continue; }
      if (ch === '{') { i++; parseGroup({ ...st }, true); continue; }
      if ((ch === '_' || ch === '^') && st.math) {
        i++;
        const sub: State = { ...st, scale: st.scale * 0.72, rise: st.rise + (ch === '^' ? 0.42 : -0.22) * st.scale };
        if (s[i] === '{') { i++; parseGroup(sub, true); }
        else parseToken(sub);
        continue;
      }
      parseToken(st);
    }
  };
  const parseToken = (st: State): void => {
    const ch = s[i];
    if (ch === undefined) return;
    if (ch === '\\') {
      i++;
      let name = '';
      if (/[A-Za-z]/.test(s[i] ?? '')) { while (i < s.length && /[A-Za-z]/.test(s[i])) name += s[i++]; }
      else name = s[i++] ?? '';
      if (name in GREEK) { push(GREEK[name], st, 'roman'); if (s[i] === ' ') i++; return; }
      if (name in SYMBOLS) { push(SYMBOLS[name], st, 'roman'); if (s[i] === ' ') i++; return; }
      if (name in SPACES) { space(SPACES[name], st); return; }
      if (name === 'mathrm' || name === 'text' || name === 'mathit' || name === 'mathbf' || name === 'mathsf') {
        const font: FontKey = name === 'mathit' ? 'italic' : name === 'mathbf' ? 'bold' : 'roman';
        const inner: State = name === 'text' ? { ...st, font: 'roman', math: false, upright: true } : { ...st, font, upright: true };
        if (s[i] === '{') { i++; parseGroup(inner, true); }
        return;
      }
      if (name === '$' || name === '%' || name === '_' || name === '{' || name === '}' || name === '&' || name === '#') { push(name, st, 'roman'); return; }
      push(name, st, 'roman'); // bilinmeyen komut: düz metin
      return;
    }
    i++;
    if (!st.math) { push(ch, st); return; }
    if (ch === ' ') return; // TeX: matematik kipinde boşluk yok sayılır
    // ikili işleçler (TeX orta boşluk ≈ 0.22 em): önünde işlenen varsa çevresine boşluk
    const prev = runs.length ? runs[runs.length - 1].text.slice(-1) : '';
    const operandBefore = prev !== '' && !/[\s(\[{−+=<>≤≥≈×·^_,]/.test(prev);
    if ((ch === '-' || ch === '+' || ch === '=' || ch === '<' || ch === '>') && operandBefore && st.scale === 1) {
      push(' ', { ...st, font: 'roman' }); push(ch === '-' ? '−' : ch, st, 'roman'); push(' ', { ...st, font: 'roman' });
      return;
    }
    if (ch === '-') { push('−', st, 'roman'); return; }
    if (/[A-Za-z]/.test(ch)) { push(ch, st, st.upright ? st.font : 'italic'); return; }
    push(ch, st, st.font === 'bold' ? 'bold' : 'roman');
  };
  parseGroup({ font: 'roman', scale: 1, rise: 0, math: false, upright: false }, false);
  return runs;
}

/** Çalıştırmaların toplam genişliği (pt) */
export function runsWidth(runs: Run[], size: number): number {
  let w = 0;
  for (const r of runs) for (const ch of r.text) w += (glyph(ch, r.font).w / 1000) * size * r.scale;
  return w;
}

/** Düz metin → tek çalıştırma (hızlı yol) */
export function plainRuns(s: string): Run[] {
  return s.includes('$') || s.includes('\\') ? parseMath(s) : [{ text: s, font: 'roman', scale: 1, rise: 0 }];
}
