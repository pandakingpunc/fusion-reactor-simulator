/**
 * Translator of the scenario UI's own dictionary (src/i18n/scenario.*.ts). English is the fallback until the Turkish dictionary, a
 * separate chunk, has been loaded.
 */
import { useEffect, useMemo, useState } from 'react';
import { format, Params } from '../../i18n';
import { scenarioEn, ScenarioKey } from '../../i18n/scenario.en';
import { useApp } from '../state/store';

export type ScenarioT = (key: ScenarioKey, params?: Params) => string;

let tr: Record<ScenarioKey, string> | null = null;
let loading: Promise<void> | null = null;

/** Load the Turkish dictionary (once). */
export function loadScenarioTr(): Promise<void> {
  return (loading ??= import('../../i18n/scenario.tr').then((m) => { tr = m.scenarioTr; }, (e: unknown) => { loading = null; throw e; }));
}

/** Translator for a locale, from the dictionaries loaded so far. */
export function scenarioTranslator(locale: string): ScenarioT {
  const d: Record<ScenarioKey, string> = locale === 'tr' && tr ? tr : scenarioEn;
  return (key, params) => format(d[key] ?? scenarioEn[key], params, locale === 'tr' ? 'tr' : 'en');
}

export function useScenarioT(): ScenarioT {
  const locale = useApp((s) => s.locale);
  const [ready, setReady] = useState(tr !== null);
  useEffect(() => {
    if (locale === 'tr' && !tr) void loadScenarioTr().then(() => setReady(true), () => { /* the English texts stay */ });
  }, [locale]);
  return useMemo(() => scenarioTranslator(locale), [locale, ready]);
}
