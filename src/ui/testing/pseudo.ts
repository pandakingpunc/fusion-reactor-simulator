/**
 * Pseudo-locale for tests (not imported by the application bundle).
 *
 * Every dictionary string is turned into `[!! Ťéxţ ŝŝŝ !!]`: the letters are accented, the text is padded by about 30 % (a
 * German or Turkish string is that much longer than the English one), and the whole is fenced by `[!!` and `!!]`. {name}
 * placeholders are kept, so the values the interface fills in still show. A test renders a screen in this locale and looks
 * for visible text that is NOT fenced: that text does not come from a dictionary, so it is hard-coded in one language.
 */

const ACCENT: Record<string, string> = {
  a: 'å', b: 'ƀ', c: 'ç', d: 'ď', e: 'é', f: 'ƒ', g: 'ğ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
  n: 'ñ', o: 'ö', p: 'þ', q: 'ɋ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ď', E: 'É', F: 'Ƒ', G: 'Ğ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
  N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ɋ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

export const PSEUDO_OPEN = '[!! ';
export const PSEUDO_CLOSE = ' !!]';
const FILLER = 'ŝ';

/** Pseudo-translate one string; `{placeholders}` stay as written. */
export function pseudo(text: string): string {
  let letters = 0;
  const body = text
    .split(/(\{\w+\})/)
    .map((part) => {
      if (/^\{\w+\}$/.test(part)) return part;
      let out = '';
      for (const ch of part) {
        const a = ACCENT[ch];
        if (a) { out += a; letters++; } else out += ch;
      }
      return out;
    })
    .join('');
  const pad = FILLER.repeat(Math.max(1, Math.round(letters * 0.3)));
  return `${PSEUDO_OPEN}${body} ${pad}${PSEUDO_CLOSE}`;
}

/** A dictionary with every value pseudo-translated (keys unchanged). */
export function pseudoDict<T extends Record<string, string>>(dict: T): T {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dict)) out[k] = pseudo(v);
  return out as T;
}

/** A wizard dictionary: the English text is the key, so the keys are the strings to pseudo-translate. */
export function pseudoByKey(dict: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(dict)) out[k] = pseudo(k);
  return out;
}

/** an innermost fenced text (one that holds no other `[!! `): a pseudo-translated text can sit inside another, as in `Explain [!! Ignition !!]` */
const FENCED = /\[!! (?:(?!\[!! )[\s\S])*? !!\]/g;

/** `text` without its pseudo-translated parts, nested ones included */
function withoutFenced(text: string): string {
  let prev: string;
  let cur = text;
  do { prev = cur; cur = cur.replace(FENCED, ' '); } while (cur !== prev);
  return cur;
}

export function isPseudo(text: string): boolean {
  return text.includes(PSEUDO_OPEN) && text.includes(PSEUDO_CLOSE);
}

/**
 * Words that may stay as they are in every locale: units, SI prefixes, physics symbols, acronyms and proper names (machines,
 * people, institutions). Anything else that shows as a plain word is hard-coded text. Short and explicit on purpose: a word is
 * added here only when it would read the same in Turkish.
 */
export const ALLOWED_WORDS: ReadonlySet<string> = new Set([
  // units
  'MW', 'GW', 'kW', 'W', 'MJ', 'GJ', 'kJ', 'J', 'keV', 'MeV', 'eV', 'MA', 'kA', 'A', 'T', 'mT', 'V', 'kV', 'Hz', 'kHz', 'MHz', 'GHz',
  'Pa', 'kPa', 'MPa', 'GPa', 'bar', 'atm', 'Wb', 'mWb', 'ms', 'ns', 'us', 'µs', 'ps', 'fs', 'm', 'cm', 'mm', 'km', 'kg', 'g', 'mg',
  's', 'h', 'K', 'kK', 'Ohm', 'Ω', 'dpa', 'MK', 'ppm', 'pu', 'sr',
  // symbols and quantities written as letters in the equations of the text
  'Q', 'Ip', 'Bt', 'Te', 'Ti', 'ne', 'ni', 'Zeff', 'tau', 'dW', 'ELM', 'ELMs', 'LH', 'HL', 'DT', 'DD', 'DHe', 'pB', 'B', 'He', 'D', 'H',
  // acronyms and terms that are the same in the Turkish literature
  'POPCON', 'NBI', 'ECRH', 'ICRH', 'LHCD', 'ECCD', 'MHD', 'CSV', 'JSON', 'NDJSON', 'NetCDF', 'IMAS', 'EQDSK', 'URL', 'HTML', 'PNG', 'SVG',
  'PDF', 'WebGL', 'WebGL2', 'IPB98', 'ITPA20', 'ISS04', 'DIII', 'FRC', 'TAE', 'MTF', 'ICF', 'MIF', 'MCF', 'MagLIF',
  'ITER', 'JET', 'SPARC', 'DEMO', 'NIF', 'ARC', 'EAST', 'KSTAR', 'WEST', 'MAST', 'MASTU', 'LHD', 'W7', 'MAGLIF', 'Wendelstein',
  // the names of the two languages in the language picker are written in each language, on purpose
  'English', 'Türkçe',
  // more units, chemical symbols, materials and coil/blanket technologies that read the same in Turkish
  'dt', 'cZ', 'GS', 'ρR', 'JT', 'Norman', 'GDT', 'GAMMA', 'WHAM', 'MN', 'GeV', 'µm', 'µg', 'nm', 'Cu', 'Li', 'Nb', 'Sn', 'NbTi', 'REBCO', 'HTS', 'HCPB', 'HCLL', 'WCLL', 'DCLL', 'FLiBe', 'HDC', 'CH', 'NTM',
]);

/** whole words (hyphens included) that are symbols or names, written the same in every language (the symbol of the H-mode glossary entry) */
export const ALLOWED_CHUNKS: ReadonlySet<string> = new Set(['H-mode', 'L-mode', 'nTτ', 'nTτ_E', 'EU']);

export interface Untranslated {
  /** CSS-like path of the element that carries the text */
  where: string;
  /** the text node or attribute value */
  text: string;
  /** 'text' for a text node, else the attribute name */
  kind: string;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
const TEXT_ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'aria-roledescription', 'aria-valuetext'];

function describe(el: Element): string {
  const parts: string[] = [];
  for (let e: Element | null = el; e && parts.length < 4; e = e.parentElement) {
    const cls = typeof e.className === 'string' && e.className.trim() ? `.${e.className.trim().split(/\s+/)[0]}` : '';
    parts.unshift(`${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${cls}`);
  }
  return parts.join(' > ');
}

function isHidden(el: Element): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (e.hasAttribute('hidden')) return true;
    const style = (e as HTMLElement).style;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
  }
  return false;
}

/** The plain words of `text` once the pseudo-translated parts, numbers, symbols and allowed words are taken out. */
export function plainWords(text: string, extraAllowed: ReadonlySet<string> = new Set()): string[] {
  const rest = withoutFenced(text);
  const out: string[] = [];
  for (const chunk of rest.split(/\s+/)) {
    // a chunk with a digit, an underscore, a caret or an operator is a number with its unit or a symbol (n_e/n_GW, 10.5MW, H98(y,2), a=b).
    // A slash is not on this list: "Import/Export" and "on/off" are two words, tested one by one below ("m/s" and "keV/u" stay allowed word by word)
    if (!chunk || ALLOWED_CHUNKS.has(chunk.replace(/[.,;:()]+$/, '')) || /[\d_^=<>~±×·√∑∂Δ]/.test(chunk)) continue;
    // split compound chunks at punctuation, slashes and hyphens and test the parts
    for (const w of chunk.split(/[^\p{L}\p{M}’']+/u)) {
      if (w.length < 2) continue; // one letter: a symbol or an index
      if (ALLOWED_WORDS.has(w) || extraAllowed.has(w)) continue;
      out.push(w);
    }
  }
  return out;
}

/**
 * Visible text (text nodes, option labels, and the label-like attributes) under `root` that is neither pseudo-translated nor made
 * only of numbers, units, symbols and allowed words.
 */
export interface ScanOptions {
  /** words allowed on top of ALLOWED_WORDS */
  allowed?: ReadonlySet<string>;
  /** text the screen shows on purpose in its source language (a machine key as a tooltip, the model's own messages): not reported */
  ignore?: (el: Element, kind: string, text: string) => boolean;
}

export function findUntranslated(root: ParentNode, { allowed: extraAllowed = new Set<string>(), ignore }: ScanOptions = {}): Untranslated[] {
  const found: Untranslated[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const text = node.textContent ?? '';
      const parent = node.parentElement;
      if (parent && !isHidden(parent) && !SKIP_TAGS.has(parent.tagName) && plainWords(text, extraAllowed).length && !ignore?.(parent, 'text', text.trim())) {
        found.push({ where: describe(parent), text: text.trim(), kind: 'text' });
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (SKIP_TAGS.has(el.tagName)) return;
    if (!isHidden(el)) {
      for (const a of TEXT_ATTRS) {
        const v = el.getAttribute(a);
        if (v && plainWords(v, extraAllowed).length && !ignore?.(el, a, v)) found.push({ where: describe(el), text: v, kind: a });
      }
    }
    for (const c of Array.from(el.childNodes)) walk(c);
  };
  for (const c of Array.from((root as Node).childNodes)) walk(c);
  return found;
}
