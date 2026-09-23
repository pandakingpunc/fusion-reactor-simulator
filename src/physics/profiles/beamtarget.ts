/**
 * Demet-hedef reaktivitesi ⟨σv⟩_bt(E_c, T_i) için önbellekli tablo (sabit demet enerjisi E0).
 * beamTargetReactivity (yavaşlama dağılımı üzerinden 48 noktalı integral) log(E_c)–log(T_i)
 * ızgarasında bir kez hesaplanır; adım başına çift-doğrusal interpolasyon (~100× hızlı).
 */
import { FUEL_CHANNELS, FuelType, beamTargetReactivity } from '../reactivity';

const NE = 40, NT = 32;
const LE0 = Math.log(5), LE1 = Math.log(6000);
const LT0 = Math.log(0.05), LT1 = Math.log(150);

export class BeamTargetTable {
  private nch: number;
  private tab: Float64Array; // [ch][iT][iE]
  constructor(readonly fuel: FuelType, readonly E0: number) {
    this.nch = FUEL_CHANNELS[fuel].length;
    this.tab = new Float64Array(this.nch * NE * NT);
    for (let it = 0; it < NT; it++) {
      const Ti = Math.exp(LT0 + ((LT1 - LT0) * it) / (NT - 1));
      for (let ie = 0; ie < NE; ie++) {
        const Ec = Math.exp(LE0 + ((LE1 - LE0) * ie) / (NE - 1));
        const sv = beamTargetReactivity(fuel, E0, Ec, Ti);
        for (let c = 0; c < this.nch; c++) this.tab[(c * NT + it) * NE + ie] = sv[c];
      }
    }
  }
  /** kanal başına ⟨σv⟩_bt [m³/s] */
  eval(Ec: number, Ti: number, out: number[]): number[] {
    const x = ((Math.log(Math.min(Math.max(Ec, 5), 6000)) - LE0) / (LE1 - LE0)) * (NE - 1);
    const y = ((Math.log(Math.min(Math.max(Ti, 0.05), 150)) - LT0) / (LT1 - LT0)) * (NT - 1);
    const ie = Math.min(NE - 2, Math.floor(x)), it = Math.min(NT - 2, Math.floor(y));
    const fx = x - ie, fy = y - it;
    for (let c = 0; c < this.nch; c++) {
      const b = (c * NT + it) * NE + ie;
      const v00 = this.tab[b], v10 = this.tab[b + 1], v01 = this.tab[b + NE], v11 = this.tab[b + NE + 1];
      out[c] = (1 - fy) * ((1 - fx) * v00 + fx * v10) + fy * ((1 - fx) * v01 + fx * v11);
    }
    return out;
  }
}
