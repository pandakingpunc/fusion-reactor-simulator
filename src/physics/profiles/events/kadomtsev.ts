/**
 * The poloidal-flux reset of Kadomtsev's full reconnection (Kadomtsev, Sov. J. Plasma Phys. 1 (1975) 389), conserving the helical flux.
 *
 * For the m = n = 1 kink the helical flux ψ* = ψ − Φ/2π (ψ the poloidal flux per radian, Φ the toroidal flux inside the surface; dψ/dΦ = 1/(2π q))
 * has its extremum at the q = 1 surface. With s = (2π/Φ_b) ψ* as a function of Φ̃ = Φ/Φ_b = ρ̂², ds/dΦ̃ = 1/q − 1: it rises from the axis (q < 1) to its
 * maximum s_1 at Φ̃_1 (q = 1) and falls back to its axis value at the mixing radius Φ̃_mix (s(Φ̃_mix) = 0). Reconnection joins the surfaces of equal
 * helical flux on the two sides of q = 1: the surface of level ℓ, at Φ̃_in(ℓ) < Φ̃_1 and Φ̃_out(ℓ) > Φ̃_1, becomes one surface enclosing the toroidal
 * flux (volume) Φ̃_new = Φ̃_out − Φ̃_in, and keeps its helical flux, s_new(Φ̃_new(ℓ)) = ℓ. The mixed region [0, Φ̃_mix] keeps its volume, s_new falls from
 * s_1 on the new axis to 0 at Φ̃_mix, and ds_new/dΦ̃ < 0 everywhere: q > 1 in the whole mixed region, with q → 1 on the axis. The poloidal flux outside is
 * untouched and continuous through Φ̃_mix, ψ_new(Φ̃) = ψ(Φ̃_mix) + (Φ_b/2π)[s_new(Φ̃) + Φ̃ − Φ̃_mix]; its slope jumps at the mixing radius (the current
 * sheet of the model: the enclosed current inside is that of the new profile, outside that of the old one).
 *
 * Numerics: 1/q is linear in Φ̃ between the faces of the grid, so s is exactly quadratic in a cell (the trapezoid at the faces); the surfaces of the
 * inner branch sampled at every face and cell centre, those of the outer branch found by bisection on the monotone s.
 */
import type { TransportGeometry } from '../geometry1d';

export interface KadomtsevReset {
  /** ρ̂ of the q = 1 surface and of the mixing radius */
  rho1: number; rhoMix: number;
  /** the helical flux at q = 1 in the units of Φ_b/2π */
  s1: number;
  /** the safety factor on the axis of the new profile, from the slope of ψ_new over the first two cells */
  q0New: number;
}

/**
 * Resets the poloidal flux `psi` (cell values) inside the mixing radius by the helical-flux-conserving reconnection of the q profile `qF` (faces 0 … N,
 * the axis value extrapolated). Returns null, leaving `psi` untouched, when there is no reconnection to do: no q = 1 surface (q(0) ≥ 1), no return of the
 * helical flux to its axis value before `rhoMax`, or a q profile that dips back below 1 outside q = 1 (the outer branch is then not monotone).
 */
export function kadomtsevReset(g: Pick<TransportGeometry, 'N' | 'rhoF' | 'rhoC' | 'PhiB'>, qF: ArrayLike<number>, psi: Float64Array, rhoMax = 0.95): KadomtsevReset | null {
  const N = g.N;
  const P = new Float64Array(N + 1), gg = new Float64Array(N + 1), s = new Float64Array(N + 1);
  for (let f = 0; f <= N; f++) { P[f] = g.rhoF[f] * g.rhoF[f]; gg[f] = 1 / Math.max(qF[f], 1e-3) - 1; }
  for (let f = 1; f <= N; f++) s[f] = s[f - 1] + 0.5 * (gg[f - 1] + gg[f]) * (P[f] - P[f - 1]);

  /** s at Φ̃ in cell c (between faces c and c + 1) */
  const sIn = (c: number, ph: number): number => {
    const x = ph - P[c], d = P[c + 1] - P[c];
    return s[c] + gg[c] * x + ((gg[c + 1] - gg[c]) * x * x) / (2 * d);
  };
  const cellOf = (ph: number): number => {
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m] <= ph) lo = m; else hi = m; }
    return lo;
  };
  const sOf = (ph: number) => sIn(cellOf(ph), ph);

  // the q = 1 surface: the outermost face pair with q ≤ 1 inside and q > 1 outside (g > 0 inside, g ≤ 0 outside)
  let fb = -1;
  for (let f = N; f >= 1; f--) if (gg[f] <= 0 && gg[f - 1] > 0) { fb = f; break; }
  if (fb < 1 || !(gg[0] > 0)) return null;
  const ph1 = P[fb - 1] + (gg[fb - 1] / (gg[fb - 1] - gg[fb])) * (P[fb] - P[fb - 1]);
  const s1 = sIn(fb - 1, ph1);
  if (!(s1 > 0)) return null;

  // the mixing radius: the first face beyond q = 1 where s ≤ 0; the root by bisection in its cell
  let fm = -1;
  for (let f = fb; f <= N; f++) if (s[f] <= 0) { fm = f; break; }
  if (fm < 0) return null;
  let a = Math.max(P[fm - 1], ph1), b = P[fm];
  if (fm - 1 === fb - 1) a = ph1;
  for (let it = 0; it < 80; it++) { const m = 0.5 * (a + b); if (sIn(fm - 1, m) > 0) a = m; else b = m; }
  const phMix = 0.5 * (a + b);
  const rhoMix = Math.sqrt(phMix);
  if (!(rhoMix <= rhoMax)) return null;
  // the outer branch must fall monotonically: no face between q = 1 and the mixing radius with 1/q > 1
  for (let f = fb; f < fm; f++) if (!(gg[f] <= 0)) return null;

  // the level sets: the inner branch at every face and cell centre inside q = 1 (and q = 1 itself), the outer partner by bisection
  const phIn: number[] = [];
  for (let f = 0; f < fb; f++) { phIn.push(P[f]); phIn.push(0.5 * (P[f] + P[f + 1]) > ph1 ? ph1 : 0.5 * (P[f] + P[f + 1])); }
  phIn.push(ph1);
  const tabPhi: number[] = [], tabS: number[] = [];
  for (const pin of phIn) {
    if (pin > ph1) continue;
    const lev = Math.min(Math.max(sOf(pin), 0), s1);
    let lo = ph1, hi = phMix;
    for (let it = 0; it < 70; it++) { const m = 0.5 * (lo + hi); if (sOf(m) > lev) lo = m; else hi = m; }
    const pout = 0.5 * (lo + hi);
    tabPhi.push(pout - pin); tabS.push(lev);
  }
  // s_new(Φ̃_new): Φ̃_new falls from Φ̃_mix (level 0) to 0 (level s_1); sorted ascending in Φ̃_new
  const order = tabPhi.map((_, i) => i).sort((i, j) => tabPhi[i] - tabPhi[j]);
  const X: number[] = [], Y: number[] = [];
  for (const i of order) {
    if (X.length && !(tabPhi[i] > X[X.length - 1])) continue;
    X.push(tabPhi[i]); Y.push(tabS[i]);
  }
  if (X.length < 3 || !(X[0] < 1e-6)) return null;
  const sNew = (ph: number): number => {
    if (ph <= X[0]) return Y[0];
    if (ph >= X[X.length - 1]) return Y[Y.length - 1];
    let lo = 0, hi = X.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] <= ph) lo = m; else hi = m; }
    return Y[lo] + ((ph - X[lo]) / (X[hi] - X[lo])) * (Y[hi] - Y[lo]);
  };

  // the reference: the old flux at the mixing radius, linear between the two cell centres around it
  let ic = 0;
  while (ic < N - 2 && g.rhoC[ic + 1] < rhoMix) ic++;
  const t = (rhoMix - g.rhoC[ic]) / (g.rhoC[ic + 1] - g.rhoC[ic]);
  const psiRef = psi[ic] + t * (psi[ic + 1] - psi[ic]);
  const k = g.PhiB / (2 * Math.PI);
  let first = -1, second = -1;
  for (let i = 0; i < N; i++) {
    const rc = g.rhoC[i];
    if (!(rc < rhoMix)) break;
    const ph = rc * rc;
    psi[i] = psiRef + k * (sNew(ph) + ph - phMix);
    if (first < 0) first = i; else if (second < 0) second = i;
  }
  let q0New = NaN;
  if (second > 0) {
    const dpsi = (psi[second] - psi[first]) / (g.rhoC[second] - g.rhoC[first]);
    q0New = (g.PhiB * 0.5 * (g.rhoC[first] + g.rhoC[second])) / (Math.PI * dpsi);
  }
  return { rho1: Math.sqrt(ph1), rhoMix, s1, q0New };
}
