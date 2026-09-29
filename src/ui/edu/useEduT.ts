/**
 * Translator for the education screens. The dictionaries are separate from the main ones (src/edu/i18n), so the
 * one of the current locale is loaded on first use; until it is there the English text shows and the screen
 * re-renders when the dictionary arrives.
 */
import { useEffect, useMemo, useState } from 'react';
import { EduTranslate, eduTranslator, isEduLoaded, loadEduLocale } from '../../edu/i18n';
import { useApp } from '../state/store';

export function useEduT(): EduTranslate {
  const locale = useApp((s) => s.locale);
  const [loaded, setLoaded] = useState(() => isEduLoaded(locale));
  useEffect(() => {
    if (isEduLoaded(locale)) { setLoaded(true); return; }
    let live = true;
    setLoaded(false);
    void loadEduLocale(locale).then(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [locale]);
  // `loaded` is a dependency on purpose: the translator reads the dictionary that has just been loaded
  return useMemo(() => eduTranslator(locale), [locale, loaded]);
}
