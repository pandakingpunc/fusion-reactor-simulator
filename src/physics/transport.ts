/**
 * Enerji hapsetme süresi ölçeklemeleri ve L-H geçiş eşiği.
 * Girdiler: Ip [MA], B [T], n [m^-3], P [W], R,a [m], κ, M [amu]. Çıkış: τ_E [s].
 */
import { Geometry } from './geometry';

export type ConfinementScaling = 'IPB98y2' | 'ITER89P' | 'ISS04' | 'ST_Valovic' | 'Bohm' | 'Pastukhov';

/**
 * ITER IPB98(y,2) ELMy H-mode ölçeklemesi — ITER Physics Basis, Nucl. Fusion 39 (1999) 2175,
 * Böl. 2, Denk. (20):
 *  τ_E,th = 0.0562 · I^0.93 · B^0.15 · n19^0.41 · P^-0.69 · R^1.97 · κ_a^0.78 · ε^0.58 · M^0.19
 *  (I MA, B T, n 10^19 m^-3, P MW, R m, κ_a = S/(πa²) alan elongasyonu)
 */
export function tauIPB98y2(g: Geometry, Ip_MA: number, B: number, n: number, P_W: number, M: number): number {
  const P_MW = Math.max(P_W / 1e6, 0.1);
  const n19 = Math.max(n / 1e19, 0.01);
  const eps = g.a / g.R;
  return 0.0562 * Math.pow(Ip_MA, 0.93) * Math.pow(B, 0.15) * Math.pow(n19, 0.41) * Math.pow(P_MW, -0.69) *
    Math.pow(g.R, 1.97) * Math.pow(g.kappa, 0.78) * Math.pow(eps, 0.58) * Math.pow(M, 0.19);
}

/**
 * ITER89-P L-mode ölçeklemesi — Yushmanov et al., Nucl. Fusion 30 (1990) 1999:
 *  τ_E = 0.048 · I^0.85 · R^1.2 · a^0.3 · κ^0.5 · n20^0.1 · B^0.2 · M^0.5 · P^-0.5
 */
export function tauITER89P(g: Geometry, Ip_MA: number, B: number, n: number, P_W: number, M: number): number {
  const P_MW = Math.max(P_W / 1e6, 0.1);
  const n20 = Math.max(n / 1e20, 0.001);
  return 0.048 * Math.pow(Ip_MA, 0.85) * Math.pow(g.R, 1.2) * Math.pow(g.a, 0.3) * Math.pow(g.kappa, 0.5) *
    Math.pow(n20, 0.1) * Math.pow(B, 0.2) * Math.pow(M, 0.5) * Math.pow(P_MW, -0.5);
}

/**
 * ISS04 stellarator ölçeklemesi — Yamada et al., Nucl. Fusion 45 (2005) 1684:
 *  τ_E = 0.134 · a^2.28 · R^0.64 · P^-0.61 · n19^0.54 · B^0.84 · ι_{2/3}^0.41
 *  f_ren: konfigürasyon renormalizasyon faktörü (W7-X ~0.7–1.0, LHD ~0.9)
 */
export function tauISS04(g: Geometry, B: number, n: number, P_W: number, iota23: number, f_ren: number): number {
  const P_MW = Math.max(P_W / 1e6, 0.1);
  const n19 = Math.max(n / 1e19, 0.01);
  return f_ren * 0.134 * Math.pow(g.a, 2.28) * Math.pow(g.R, 0.64) * Math.pow(P_MW, -0.61) *
    Math.pow(n19, 0.54) * Math.pow(B, 0.84) * Math.pow(iota23, 0.41);
}

/**
 * Sferik tokamak ölçeklemesi — Valovič et al., Nucl. Fusion 51 (2011) 073045 (MAST) /
 * Kaye et al. NSTX: τ_E ∝ I^0.59 B^1.4 n^0.44 P^-0.73 ; ön çarpan IPB98 ile
 * MAST referans noktasında (Ip=0.8 MA, B=0.5 T) eşleştirilir.
 * APPROXIMATION: ön çarpan normalizasyonu; sadece ST için B bağımlılığının güçlü
 * olduğunu göstermek amacıyla.
 */
export function tauSTValovic(g: Geometry, Ip_MA: number, B: number, n: number, P_W: number, M: number): number {
  const ref = tauIPB98y2(g, Ip_MA, B, n, P_W, M);
  const P_MW = Math.max(P_W / 1e6, 0.1);
  const n19 = Math.max(n / 1e19, 0.01);
  // IPB98 üsleri: I^0.93 B^0.15 n^0.41 P^-0.69 → ST üsleri: I^0.59 B^1.4 n^0.44 P^-0.73
  // Referans: I=0.8 MA, B=0.5 T, n19=3, P=2 MW → oran 1
  const ratio = Math.pow(Ip_MA / 0.8, 0.59 - 0.93) * Math.pow(B / 0.5, 1.4 - 0.15) *
    Math.pow(n19 / 3, 0.44 - 0.41) * Math.pow(P_MW / 2, -0.73 + 0.69);
  return ref * ratio;
}

/**
 * L-H geçiş güç eşiği — Martin et al., J. Phys. Conf. Ser. 123 (2008) 012033:
 *  P_LH [MW] = 0.0488 · n20^0.717 · B^0.803 · S^0.941 · (2/M)   (S plazma yüzeyi m²)
 * İzotop düzeltmesi (2/M) Righi 1999; D-T için M=2.5.
 */
export function pLH_Martin(n: number, B: number, S: number, M: number): number {
  const n20 = Math.max(n / 1e20, 0.01);
  return 0.0488e6 * Math.pow(n20, 0.717) * Math.pow(B, 0.803) * Math.pow(S, 0.941) * (2 / M);
}

/**
 * L-H eşiğinin minimum olduğu çizgi-ortalamalı yoğunluk [m^-3] — Ryter et al., Nucl. Fusion 54
 * (2014) 083003 (çok-makineli ölçekleme):
 *  n̄_e,min [10^19 m^-3] = 0.7 · I_p[MA]^0.34 · B[T]^0.62 · a[m]^-0.95 · (R/a)^0.4
 */
export function nLHmin(Ip_MA: number, B: number, a: number, R: number): number {
  return 0.7 * Math.pow(Math.max(Ip_MA, 0.01), 0.34) * Math.pow(B, 0.62) * Math.pow(a, -0.95) * Math.pow(R / a, 0.4) * 1e19;
}

/**
 * L-H geçiş eşiği, düşük yoğunluk kolu dahil: n̄ ≥ n̄_min için Martin (2008) (bit bit aynı);
 * n̄ < n̄_min için eşik yeniden yükselir (Ryter 2014): P_LH = P_Martin(n̄_min) · n̄_min / n̄.
 * APPROXIMATION: düşük yoğunluk kolunun biçimi (∝ 1/n̄) — derleme yükselişi gösterir, genel bir
 * ölçekleme vermez. n: ÇİZGİ-ortalamalı yoğunluk [m^-3] (Martin'in tanımı).
 */
export function pLH_threshold(nbar: number, B: number, S: number, M: number, Ip_MA: number, a: number, R: number): number {
  const nmin = nLHmin(Ip_MA, B, a, R);
  if (nbar >= nmin) return pLH_Martin(nbar, B, S, M);
  return pLH_Martin(nmin, B, S, M) * (nmin / Math.max(nbar, 1e17));
}

/**
 * Elektron-iyon sıcaklık eşitlenme süresi (Spitzer; NRL Formulary):
 *  ν_ie = 3.2e-9 · Z² · lnΛ / (μ · T_e[eV]^1.5) · n_e[cm^-3]  [s^-1]  (enerji eşitlenme hızı)
 */
export function tauEquilibration(ne: number, Te_keV: number, mu_amu: number, Zeff: number, lnLambda = 17): number {
  const ne_cm3 = ne * 1e-6;
  const Te_eV = Math.max(Te_keV, 0.01) * 1e3;
  const nu = (3.2e-9 * Zeff * Zeff * lnLambda * ne_cm3) / (mu_amu * Math.pow(Te_eV, 1.5));
  return 1 / Math.max(nu, 1e-12);
}

/**
 * Çok türlü plazmada elektron-iyon enerji eşitlenme hızı [1/s] (NRL Plasma Formulary, sıcaklık
 * eşitlenmesi, T_e/m_e ≫ T_i/m_i limiti):
 *  ν_eq = 3.2e-9 · lnΛ · Σ_j n_j Z_j²/A_j [cm^-3] / T_e[eV]^1.5 ,   P_ei = (3/2) n_e (T_e − T_i) ν_eq
 * ionSum = Σ_j n_j Z_j² / (n_e A_j) (yakıt, kül, safsızlıklar; Stix E_c ile aynı toplam).
 * lnΛ verilmezse n_e, T_e'den hesaplanır (coulombLog).
 */
export function equilibrationRate(ne: number, Te_keV: number, ionSum: number, lnLambda = coulombLog(ne, Te_keV)): number {
  const Te_eV = Math.max(Te_keV, 0.01) * 1e3;
  return (3.2e-9 * lnLambda * ne * 1e-6 * ionSum) / Math.pow(Te_eV, 1.5);
}

/**
 * Coulomb logaritması (e-i), NRL Formulary: lnΛ = 24 − ln(n_e^0.5 / T_e) (T_e>10 eV, n cm^-3, T eV)
 */
export function coulombLog(ne: number, Te_keV: number): number {
  const ne_cm3 = Math.max(ne * 1e-6, 1);
  const Te_eV = Math.max(Te_keV * 1e3, 10);
  return Math.max(24 - Math.log(Math.sqrt(ne_cm3) / Te_eV), 5);
}
