/**
 * The Turkish texts of the setup wizard (src/i18n/wizard.tr.ts), fetched once. Apart from wizText.ts (the hook) so that the store can load them together
 * with the message dictionary when the language is switched (the wizard is the first screen: it must not paint in English first).
 */
import type { Locale } from '../../i18n';

type Dict = Readonly<Record<string, string>>;
let turkish: Dict | null = null;
let loading: Promise<void> | null = null;

/** Fetch the Turkish texts (once; nothing for another locale). A failed load leaves the English texts in place and is retried at the next request. */
export function loadWizardText(locale: Locale): Promise<void> {
  if (locale !== 'tr' || turkish) return Promise.resolve();
  return (loading ??= import('../../i18n/wizard.tr').then((m) => { turkish = m.wizardTr; }).catch((e: unknown) => { loading = null; throw e; }));
}

export function isWizardTextLoaded(locale: Locale): boolean { return locale !== 'tr' || turkish !== null; }

/** the Turkish dictionary, once loaded */
export function wizardDictionary(locale: Locale): Dict | null { return locale === 'tr' ? turkish : null; }
