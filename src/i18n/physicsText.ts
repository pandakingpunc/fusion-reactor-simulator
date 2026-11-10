/**
 * The sentences the physics layer writes (event messages, report warnings, termination reason / diagnosis / fix) are English and part of
 * exports, run files and tests, so the physics layer does not change. The interface translates them here, by pattern: an English sentence
 * with numbers in it is recognised by a regular expression and written again in the interface language with the same numbers.
 *
 * This file is the always-loaded part: the API and the fallback. The rule table of a language is its own chunk (physicsText.tr.ts) that
 * loadLocale() fetches together with the dictionary and that registers itself here. A sentence no rule knows, and every sentence while the
 * rules are not loaded, comes back as it is: never an exception, never a half translation.
 */
import { activeLocale, localizeDecimals, type Locale } from './index';

/** What a rule's writer gets: the groups of the match and the translator itself (for the parts of a composite sentence). */
export type PhysicsRule = readonly [re: RegExp, write: (g: string[], tx: (part: string) => string) => string];
export interface PhysicsRuleSet {
  /** sentences that are the same every time (labels, fixes, fixed warnings) */
  exact: Readonly<Record<string, string>>;
  /** sentences with numbers or names in them, tried in order; the first match wins */
  rules: readonly PhysicsRule[];
}

const sets: Partial<Record<Locale, PhysicsRuleSet>> = {};

/** Called by a language's rule chunk when it is evaluated. */
export function registerPhysicsRules(locale: Locale, set: PhysicsRuleSet): void { sets[locale] = set; }

/** Whether the rules of `locale` are loaded (English needs none). */
export function hasPhysicsRules(locale: Locale): boolean { return locale === 'en' || locale in sets; }

function translateWith(set: PhysicsRuleSet, msg: string, locale: Locale): string {
  const tx = (part: string): string => translateWith(set, part, locale);
  const hit = set.exact[msg];
  if (hit !== undefined) return hit;
  for (const [re, write] of set.rules) {
    const m = re.exec(msg);
    if (m) return write(m.slice(1), tx).split(/(1\.5D)/).map((part, i) => (i % 2 ? part : localizeDecimals(part, locale))).join(''); // "1.5D" is the name of the model, not a number
  }
  return msg;
}

/**
 * A sentence of the physics layer in the language of the interface. English (and any sentence without a rule) is returned unchanged;
 * numbers keep their value and take the decimal mark of the language.
 */
export function physicsText(msg: string, locale: Locale = activeLocale()): string {
  const set = locale === 'en' ? undefined : sets[locale];
  if (!set) return msg;
  try { return translateWith(set, msg, locale); } catch { return msg; }
}
