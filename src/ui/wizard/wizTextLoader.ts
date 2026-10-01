/**
 * The Turkish texts of the setup wizard and of the physics catalogs (src/i18n/wizard.tr.ts, catalog.tr.ts), fetched once. Apart from wizText.ts (the hook) so that the store can load them together
 * with the message dictionary when the language is switched (the wizard is the first screen: it must not paint in English first).
 */
import type { Locale } from '../../i18n';

type Dict = Readonly<Record<string, string>>;
let turkish: Dict | null = null;
let loading: Promise<void> | null = null;

/** Fetch the Turkish texts (once; nothing for another locale). A failed load leaves the English texts in place and is retried at the next request. */
export function loadWizardText(locale: Locale): Promise<void> {
  if (locale !== 'tr' || turkish) return Promise.resolve();
  // the wizard's own texts and the catalogs of the physics layer (methods, presets, diagnostics, report lines): one dictionary, two source files
  return (loading ??= Promise.all([import('../../i18n/wizard.tr'), import('../../i18n/catalog.tr')]).then(([w, c]) => { turkish = { ...w.wizardTr, ...c.catalogTr }; }).catch((e: unknown) => { loading = null; throw e; }));
}

export function isWizardTextLoaded(locale: Locale): boolean { return locale !== 'tr' || turkish !== null; }

/** the Turkish dictionary, once loaded */
export function wizardDictionary(locale: Locale): Dict | null { return locale === 'tr' ? turkish : null; }
