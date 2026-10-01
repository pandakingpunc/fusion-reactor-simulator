/**
 * Translator of the persistence UI's own dictionary (src/i18n/persist.*.ts). English is the fallback until the Turkish
 * dictionary, a separate chunk, has been loaded.
 */
import { useEffect, useMemo, useState } from 'react';
import { format, Params } from '../../i18n';
import { persistEn, PersistKey } from '../../i18n/persist.en';
import { useApp } from '../state/store';

export type PersistT = (key: PersistKey, params?: Params) => string;

let tr: Record<PersistKey, string> | null = null;
let loading: Promise<void> | null = null;

/** Load the Turkish dictionary (once). */
export function loadPersistTr(): Promise<void> {
  return (loading ??= import('../../i18n/persist.tr').then((m) => { tr = m.persistTr; }, (e: unknown) => { loading = null; throw e; }));
}

/** Translator for a locale, from the dictionaries loaded so far. */
export function persistTranslator(locale: string): PersistT {
  const d = locale === 'tr' && tr ? tr : persistEn;
  return (key, params) => format(d[key] ?? persistEn[key], params, locale === 'tr' ? 'tr' : 'en');
}

export function usePersistT(): PersistT {
  const locale = useApp((s) => s.locale);
  const [ready, setReady] = useState(tr !== null);
  useEffect(() => {
    // no state update after the component is gone: in a test that ends first, the chunk arrives after jsdom's teardown
    // and the update throws "window is not defined" as an unhandled rejection (vitest exit code 1 with every test green)
    let live = true;
    if (locale === 'tr' && !tr) void loadPersistTr().then(() => { if (live) setReady(true); }, () => { /* the English texts stay */ });
    return () => { live = false; };
  }, [locale]);
  return useMemo(() => persistTranslator(locale), [locale, ready]);
}
