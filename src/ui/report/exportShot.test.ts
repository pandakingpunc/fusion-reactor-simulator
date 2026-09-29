import { describe, expect, it } from 'vitest';
import type { ShotReport } from '../../physics/types';
import { reportCsv } from './exportShot';

const report = {
  method: 'tokamak', duration: 10, timeUnit: 's', Tmax_keV: 20, Tmax_MC: 232, Timax_keV: 20, Temax_keV: 18, stableTime_s: 10, burnTime_s: 5, ignitionTime_s: 0,
  Q_sci_max: 9, Q_sci_avg: 8, Q_eng: 0.4, E_fusion_MJ: 1, E_input_MJ: 1, neutronYield: 1, neutronFluence_m2: 1, tripleProduct_max: 1, lawson_ratio: 1, score: 50,
  termination: { reason: 'Reached the end of the programme' },
  engineering: { 'Cryoplant power (MW)': 32.6, 'Loop voltage (avg., V)': 0.12, 'Detachment state': 'partially detached', 'Tandem': true, 'Some new key': 3 },
  extras: { 'ELM count': 12, 'Status': 'No net energy production under known physics (easter egg)' },
} as unknown as ShotReport;

const lines = (locale: 'en' | 'tr') => reportCsv(report, locale).split('\n');

describe('summary CSV', () => {
  it('keeps the key and value columns and adds the label and unit of the engineering keys', () => {
    const l = lines('en');
    expect(l[0]).toBe('key,value,label,unit');
    expect(l).toContain('method,"tokamak",,');
    expect(l).toContain('eng.Cryoplant power (MW),"32.6",Cryoplant electric power,MW'); // the engineering numbers are quoted text, as they always were
    expect(l).toContain('extra.ELM count,12,ELM count,');
  });

  it('quotes a key that holds a comma, and keeps the raw key in every language', () => {
    for (const locale of ['en', 'tr'] as const) {
      expect(lines(locale).some((x) => x.startsWith('"eng.Loop voltage (avg., V)","0.12"'))).toBe(true);
    }
    expect(lines('tr').find((x) => x.startsWith('"eng.Loop voltage'))).toContain('Çevrim gerilimi (ortalama),V');
  });

  it('writes the text values and the labels in the language, and leaves an unknown key without a label', () => {
    expect(lines('en')).toContain('eng.Detachment state,"partially detached",Divertor detachment,');
    expect(lines('tr')).toContain('eng.Detachment state,"kısmen ayrılmış",Divertör ayrılma durumu,');
    expect(lines('tr')).toContain('eng.Some new key,"3",,');
  });
});
