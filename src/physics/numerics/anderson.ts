/**
 * Anderson acceleration of a fixed-point iteration x = G(x) (D. G. Anderson, "Iterative
 * procedures for nonlinear integral equations", J. ACM 12 (1965) 547; algorithm "AA" with
 * depth m and damping β as in H. F. Walker & P. Ni, "Anderson acceleration for fixed-point
 * iterations", SIAM J. Numer. Anal. 49 (2011) 1715):
 *
 *   f_k = G(x_k) − x_k,   γ_k = argmin_γ ‖f_k − ΔF_k γ‖₂,
 *   x_{k+1} = G(x_k) − ΔG_k γ_k − (1 − β)(f_k − ΔF_k γ_k),
 *
 * where the columns of ΔF_k and ΔG_k are the last m differences f_{i+1} − f_i and
 * G(x_{i+1}) − G(x_i). With m = 0 (or an empty history) this is damped Picard,
 * x_{k+1} = x_k + β f_k. The small least-squares problem is solved with modified Gram–Schmidt
 * QR; a column that is numerically dependent on the older ones is dropped for that step
 * (the conditioning safeguard discussed by Walker & Ni, §4). Deterministic and allocation-free
 * after construction.
 */
export class AndersonMixer {
  private readonly dF: Float64Array[];
  private readonly dG: Float64Array[];
  private readonly Q: Float64Array[];
  private readonly f: Float64Array;
  private readonly fPrev: Float64Array;
  private readonly gPrev: Float64Array;
  private readonly Rm: Float64Array;
  private readonly gam: Float64Array;
  private readonly used: Int32Array;
  /** number of stored difference columns (≤ depth) */
  private count = 0;
  /** next ring-buffer slot */
  private head = 0;
  private hasPrev = false;

  constructor(readonly n: number, readonly depth: number) {
    if (!(Number.isInteger(n) && n > 0) || !(Number.isInteger(depth) && depth >= 0)) throw new Error('AndersonMixer: invalid size or depth');
    const mk = () => new Float64Array(n);
    this.dF = Array.from({ length: depth }, mk);
    this.dG = Array.from({ length: depth }, mk);
    this.Q = Array.from({ length: depth }, mk);
    this.f = mk(); this.fPrev = mk(); this.gPrev = mk();
    this.Rm = new Float64Array(depth * depth);
    this.gam = new Float64Array(depth);
    this.used = new Int32Array(depth);
  }

  /** Forget the history (restart); the next step is a plain damped Picard step. */
  reset(): void { this.count = 0; this.head = 0; this.hasPrev = false; }

  /** Number of difference columns currently in the history. */
  get historySize(): number { return this.count; }

  /**
   * One acceleration step. x: current iterate x_k (overwritten with x_{k+1}); g: G(x_k)
   * (not modified); beta ∈ (0, 1]: damping (1 = undamped).
   */
  step(x: Float64Array, g: Float64Array, beta = 1): void {
    const { n, depth, f, fPrev, gPrev } = this;
    for (let i = 0; i < n; i++) f[i] = g[i] - x[i];
    if (this.hasPrev && depth > 0) {
      const s = this.head, dFs = this.dF[s], dGs = this.dG[s];
      for (let i = 0; i < n; i++) { dFs[i] = f[i] - fPrev[i]; dGs[i] = g[i] - gPrev[i]; }
      this.head = (s + 1) % depth;
      if (this.count < depth) this.count++;
    }
    fPrev.set(f); gPrev.set(g); this.hasPrev = true;
    const m = this.count;
    if (m === 0) { for (let i = 0; i < n; i++) x[i] += beta * f[i]; return; }
    // columns in chronological order (oldest first)
    const cols = this.used;
    let nc = 0;
    const { Q, Rm, gam } = this;
    for (let c = 0; c < m; c++) {
      const slot = (this.head - m + c + depth) % depth;
      const v = Q[nc], a = this.dF[slot];
      let a2 = 0;
      for (let i = 0; i < n; i++) { v[i] = a[i]; a2 += a[i] * a[i]; }
      for (let p = 0; p < nc; p++) {
        const q = Q[p];
        let r = 0;
        for (let i = 0; i < n; i++) r += q[i] * v[i];
        Rm[p * depth + nc] = r;
        for (let i = 0; i < n; i++) v[i] -= r * q[i];
      }
      let v2 = 0;
      for (let i = 0; i < n; i++) v2 += v[i] * v[i];
      // numerically dependent column: skip it for this step
      if (!(v2 > 1e-20 * a2) || !(a2 > 0)) continue;
      const nv = Math.sqrt(v2);
      for (let i = 0; i < n; i++) v[i] /= nv;
      Rm[nc * depth + nc] = nv;
      cols[nc++] = slot;
    }
    if (nc === 0) { for (let i = 0; i < n; i++) x[i] += beta * f[i]; return; }
    // γ = R⁻¹ Qᵀ f
    for (let p = 0; p < nc; p++) {
      const q = Q[p];
      let r = 0;
      for (let i = 0; i < n; i++) r += q[i] * f[i];
      gam[p] = r;
    }
    for (let p = nc - 1; p >= 0; p--) {
      let s = gam[p];
      for (let c = p + 1; c < nc; c++) s -= Rm[p * depth + c] * gam[c];
      gam[p] = s / Rm[p * depth + p];
    }
    // x_{k+1} = g − ΔG γ − (1 − β)(f − ΔF γ)
    const damp = 1 - beta;
    for (let i = 0; i < n; i++) x[i] = g[i] - damp * f[i];
    for (let p = 0; p < nc; p++) {
      const gp = gam[p], dGs = this.dG[cols[p]], dFs = this.dF[cols[p]];
      for (let i = 0; i < n; i++) x[i] -= gp * (dGs[i] - damp * dFs[i]);
    }
  }
}
