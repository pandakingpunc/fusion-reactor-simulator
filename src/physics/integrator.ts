/**
 * Adaptif adımlı Dormand-Prince RK5(4) entegratörü (Hairer, Nørsett & Wanner, "Solving ODEs I").
 * Sabit dt yok: hata tahminine göre dt otomatik ayarlanır (disruption'da küçülür).
 */
export type RHS = (t: number, y: Float64Array, dydt: Float64Array) => void;

export interface IntegratorOptions {
  rtol: number;
  atol: number | Float64Array;
  dtMin: number;
  dtMax: number;
  /** negatif olamayan bileşenler (n, W) — kenetlenir; true = hepsi, dizi = seçili indisler */
  nonNegative?: boolean | number[];
}

const A21 = 1 / 5;
const A31 = 3 / 40, A32 = 9 / 40;
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9;
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729;
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656;
const A71 = 35 / 384, A73 = 500 / 1113, A74 = 125 / 192, A75 = -2187 / 6784, A76 = 11 / 84;
// hata katsayıları (5. − 4. derece)
const E1 = 71 / 57600, E3 = -71 / 16695, E4 = 71 / 1920, E5 = -17253 / 339200, E6 = 22 / 525, E7 = -1 / 40;

export class DormandPrince {
  private k1: Float64Array; private k2: Float64Array; private k3: Float64Array; private k4: Float64Array;
  private k5: Float64Array; private k6: Float64Array; private k7: Float64Array;
  private ytmp: Float64Array; private ynew: Float64Array;
  dt: number;
  nRejected = 0;
  nSteps = 0;

  constructor(private n: number, private rhs: RHS, public opts: IntegratorOptions, dt0: number) {
    this.k1 = new Float64Array(n); this.k2 = new Float64Array(n); this.k3 = new Float64Array(n);
    this.k4 = new Float64Array(n); this.k5 = new Float64Array(n); this.k6 = new Float64Array(n);
    this.k7 = new Float64Array(n); this.ytmp = new Float64Array(n); this.ynew = new Float64Array(n);
    this.dt = dt0;
  }

  /**
   * Bir kabul edilmiş adım at; y yerinde güncellenir; yeni t döner.
   * tMax'ı aşmaz (adım kesilir).
   */
  step(t: number, y: Float64Array, tMax: number): number {
    const { n, rhs, k1, k2, k3, k4, k5, k6, k7, ytmp, ynew } = this;
    const { rtol, atol, dtMin, dtMax } = this.opts;
    let h = Math.min(this.dt, dtMax, tMax - t);
    if (h <= 0) return t;
    rhs(t, y, k1);
    for (let iter = 0; iter < 30; iter++) {
      for (let i = 0; i < n; i++) ytmp[i] = y[i] + h * A21 * k1[i];
      rhs(t + h / 5, ytmp, k2);
      for (let i = 0; i < n; i++) ytmp[i] = y[i] + h * (A31 * k1[i] + A32 * k2[i]);
      rhs(t + (3 * h) / 10, ytmp, k3);
      for (let i = 0; i < n; i++) ytmp[i] = y[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
      rhs(t + (4 * h) / 5, ytmp, k4);
      for (let i = 0; i < n; i++) ytmp[i] = y[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
      rhs(t + (8 * h) / 9, ytmp, k5);
      for (let i = 0; i < n; i++) ytmp[i] = y[i] + h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
      rhs(t + h, ytmp, k6);
      for (let i = 0; i < n; i++) ynew[i] = y[i] + h * (A71 * k1[i] + A73 * k3[i] + A74 * k4[i] + A75 * k5[i] + A76 * k6[i]);
      rhs(t + h, ynew, k7);
      // hata normu
      let err = 0;
      for (let i = 0; i < n; i++) {
        const ei = h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i]);
        const sc = (typeof atol === 'number' ? atol : atol[i]) + rtol * Math.max(Math.abs(y[i]), Math.abs(ynew[i]));
        const r = ei / sc;
        err += r * r;
      }
      err = Math.sqrt(err / n);
      let bad = err > 1;
      if (!bad) for (let i = 0; i < n; i++) if (!isFinite(ynew[i])) { bad = true; break; }
      if (!bad || h <= dtMin) {
        for (let i = 0; i < n; i++) y[i] = ynew[i];
        const nn = this.opts.nonNegative;
        if (nn === true) for (let i = 0; i < n; i++) if (y[i] < 0) y[i] = 0;
        else if (Array.isArray(nn)) for (const i of nn) if (y[i] < 0) y[i] = 0;
        const fac = Math.min(5, Math.max(0.2, 0.9 * Math.pow(Math.max(err, 1e-10), -0.2)));
        this.dt = Math.min(dtMax, Math.max(dtMin, h * fac));
        this.nSteps++;
        return t + h;
      }
      this.nRejected++;
      h = Math.max(dtMin, h * Math.max(0.1, 0.9 * Math.pow(err, -0.25)));
    }
    for (let i = 0; i < n; i++) y[i] = ynew[i];
    this.dt = Math.max(dtMin, h);
    return t + h;
  }
}
