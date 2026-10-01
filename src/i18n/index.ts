/**
 * Minimal i18n: typed message keys, {name} placeholders, lazily loaded locales.
 * English is bundled (reference + fallback); other locales are separate chunks loaded on demand.
 * The active locale lives in the UI store (src/ui/state/store.ts); components translate via useT().
 */
import { en, MessageKey } from './en';

export type { MessageKey };
export type Locale = 'en' | 'tr';
export type Dict = Record<MessageKey, string>;
export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

export const LOCALES: readonly Locale[] = ['en', 'tr'];
/** endonyms for the language picker */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', tr: 'Türkçe' };

const loaders: Record<Locale, () => Promise<Dict>> = {
  en: async () => en,
  tr: () => import('./tr').then((m) => m.tr),
};
const dicts: Partial<Record<Locale, Dict>> = { en };
let active: Locale = 'en';

export function isLocale(x: unknown): x is Locale {
  return typeof x === 'string' && (LOCALES as readonly string[]).includes(x);
}

export function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

const pending: Partial<Record<Locale, Promise<Dict>>> = {};

/** Fetch a locale's dictionary (no-op when already loaded; concurrent callers share one fetch, a failed one is retried). */
export function loadLocale(locale: Locale): Promise<Dict> {
  const have = dicts[locale];
  if (have) return Promise.resolve(have);
  return (pending[locale] ??= loaders[locale]().then(
    (d) => { dicts[locale] = d; delete pending[locale]; return d; },
    (e: unknown) => { delete pending[locale]; throw e; },
  ));
}

/**
 * Write the decimal point of the numbers in a text the way a locale does (Turkish: the comma, "0,5" for "0.5"). Only a point between two digits
 * is a decimal point: "1.5D" is a name, "v4.0" a version; an exponent ("1,2e-5") is kept. For text that people read, never for machine formats
 * (exports, share links, the physics).
 */
export function localizeDecimals(text: string, locale: Locale = active): string {
  return locale === 'tr' ? text.replace(/(\d)\.(\d)/g, '$1,$2') : text;
}

/** Replace {name} placeholders (a number is written with the decimal mark of the locale); unknown placeholders are left as written. */
export function format(template: string, params?: Params, locale: Locale = active): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (!(k in params)) return m;
    const v = params[k];
    return typeof v === 'number' ? localizeDecimals(String(v), locale) : String(v);
  });
}

/** Translator for a locale; falls back to English while the dictionary is not loaded. */
export function translator(locale: Locale): Translate {
  const d = dicts[locale] ?? en;
  return (key, params) => format(d[key] ?? en[key] ?? key, params, locale);
}

/** Make `locale` the active one for t() and mirror it on <html lang> (screen readers, hyphenation) and on the page title (the tab). */
export function setActiveLocale(locale: Locale): void {
  active = locale;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.title = translator(locale)('app.title');
  }
}

export function activeLocale(): Locale { return active; }

/** Translate with the active locale (for code outside React; components use useT()). */
export const t: Translate = (key, params) => translator(active)(key, params);
