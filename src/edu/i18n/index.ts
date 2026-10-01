/**
 * Strings of the education and comparison screens (missions, glossary, power flow, Compare 2.0, the
 * validation view). They live in their own dictionaries, not in src/i18n/en.ts, because English is bundled
 * with the main chunk and this text is only needed once a lazy screen is opened: the dictionaries are
 * imported by the lazy chunks only, and the Turkish one is a chunk of its own, as in src/i18n.
 *
 * The rules are those of src/i18n: typed keys, {name} placeholders, English is the reference and the
 * fallback; edu.i18n.test.ts checks that both dictionaries define the same keys with the same placeholders.
 * Key prefixes: edu.* screens · lvl.* difficulty · mis.<id>.* missions · lever.* mission controls ·
 * metric.* mission goals · gl.<id>.* glossary · pf.* power flow · cmp2.* Compare 2.0 · val.* validation.
 */
import { format, Locale, Params } from '../../i18n';
import { eduEn } from './en';

export type EduKey = keyof typeof eduEn;
export type EduDict = Record<EduKey, string>;
export type EduTranslate = (key: EduKey, params?: Params) => string;

const loaders: Record<Locale, () => Promise<EduDict>> = {
  en: async () => eduEn,
  tr: () => import('./tr').then((m) => m.eduTr),
};
const dicts: Partial<Record<Locale, EduDict>> = { en: eduEn };

const pending: Partial<Record<Locale, Promise<EduDict>>> = {};

/** Fetch a locale's education dictionary (no-op when it is already loaded; concurrent callers share one fetch, a failed one is retried). */
export function loadEduLocale(locale: Locale): Promise<EduDict> {
  const have = dicts[locale];
  if (have) return Promise.resolve(have);
  return (pending[locale] ??= loaders[locale]().then(
    (d) => { dicts[locale] = d; delete pending[locale]; return d; },
    (e: unknown) => { delete pending[locale]; throw e; },
  ));
}

export function isEduLoaded(locale: Locale): boolean { return locale in dicts; }

/** Translator for a locale; English until that locale's dictionary is loaded. */
export function eduTranslator(locale: Locale): EduTranslate {
  const d = dicts[locale] ?? eduEn;
  return (key, params) => format(d[key] ?? eduEn[key] ?? key, params);
}
