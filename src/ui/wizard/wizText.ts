/**
 * The texts of the setup wizard that are not in the message dictionary (src/i18n): the labels, hints, options, step titles, method cards and
 * preset descriptions of src/ui/wizard/schema.ts, which are written in English next to the numbers they describe. The English text is the key of
 * its Turkish one (src/i18n/wizard.tr.ts, one chunk, fetched when the interface is Turkish: by the store together with the message dictionary,
 * or here on first use); a text without an entry is shown as written.
 * src/ui/wizard/wizText.test.ts keeps the two in step: every text of the schema has its Turkish one, and none is left behind.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '../../i18n';
import { useApp } from '../state/store';
import type { WizText } from './schema';
import { isWizardTextLoaded, loadWizardText, wizardDictionary } from './wizTextLoader';

export { loadWizardText, isWizardTextLoaded };

/** The translator of a locale: English text as written, Turkish from the dictionary once it is loaded. */
export function wizText(locale: Locale): WizText {
  const d = wizardDictionary(locale);
  return d ? (s) => d[s] ?? s : (s) => s;
}

/** The translator of the current interface language; re-renders when the Turkish texts arrive. */
export function useWizText(): WizText {
  const locale = useApp((s) => s.locale);
  const [loaded, setLoaded] = useState(() => isWizardTextLoaded(locale));
  useEffect(() => {
    if (isWizardTextLoaded(locale)) { setLoaded(true); return; }
    let live = true;
    setLoaded(false);
    loadWizardText(locale).then(() => { if (live) setLoaded(true); }, () => { /* the English texts stay */ });
    return () => { live = false; };
  }, [locale]);
  // `loaded` is a dependency on purpose: the translator reads the dictionary that has just been loaded
  return useMemo(() => wizText(locale), [locale, loaded]);
}
