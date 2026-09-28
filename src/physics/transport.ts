/**
 * Enerji hapsetme süresi ölçeklemeleri ve L-H geçiş eşiği.
 * Girdiler: Ip [MA], B [T], n [m^-3], P [W], R,a [m], κ, M [amu]. Çıkış: τ_E [s].
 */
import { Geometry } from './geometry';

export type ConfinementScaling = 'IPB98y2' | 'ITPA20' | 'ITPA20-IL' | 'ITER89P' | 'ISS04' | 'ST_Valovic' | 'Bohm' | 'Pastukhov';

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
 * Güç yasası biçimindeki H-mod ölçeklemeleri veri olarak (sonraki modeller / karşılaştırma için):
 *  τ_E = C · I^αI · B^αB · n19^αn · P^αP · R^αR · κ_a^ακ · ε^αε · M^αM · (1+δ)^αδ
 *  (I MA, B T, n19 10^19 m^-3 çizgi-ort., P MW kayıp gücü, R m, κ_a alan elongasyonu, ε = a/R, M amu)
 */
export interface ConfinementScalingParams {
  /** ön çarpan [s] */
  C: number;
  exponents: { Ip: number; B: number; n19: number; P: number; R: number; kappa: number; eps: number; M: number; onePlusDelta: number };
  /** kaynak */
  ref: string;
}

/** IPB98(y,2) (yukarıdaki tauIPB98y2 ile aynı; o fonksiyon değişmeden kalır) */
export const IPB98Y2_PARAMS: ConfinementScalingParams = {
  C: 0.0562, exponents: { Ip: 0.93, B: 0.15, n19: 0.41, P: -0.69, R: 1.97, kappa: 0.78, eps: 0.58, M: 0.19, onePlusDelta: 0 },
  ref: 'ITER Physics Basis, Nucl. Fusion 39 (1999) 2175, eq. (20)',
};

/** ITPA20 — güncellenmiş ITPA H-mod veritabanı (DB5.2.3) regresyonu: Verdoolaege et al., Nucl. Fusion 61 (2021) 076006 */
export const ITPA20_PARAMS: ConfinementScalingParams = {
  C: 0.053, exponents: { Ip: 0.98, B: 0.22, n19: 0.24, P: -0.669, R: 1.71, kappa: 0.8, eps: 0.35, M: 0.2, onePlusDelta: 0.36 },
  ref: 'G. Verdoolaege et al., Nucl. Fusion 61 (2021) 076006 (ITPA20)',
};

/** ITPA20-IL — aynı çalışmanın ITER-benzeri alt kümesi (ε üssü yok): Verdoolaege et al. 2021 */
export const ITPA20_IL_PARAMS: ConfinementScalingParams = {
  C: 0.067, exponents: { Ip: 1.29, B: -0.13, n19: 0.15, P: -0.644, R: 1.19, kappa: 0.67, eps: 0, M: 0.3, onePlusDelta: 0.56 },
  ref: 'G. Verdoolaege et al., Nucl. Fusion 61 (2021) 076006 (ITPA20-IL)',
};

export const CONFINEMENT_SCALINGS: Record<'IPB98y2' | 'ITPA20' | 'ITPA20-IL', ConfinementScalingParams> = {
  IPB98y2: IPB98Y2_PARAMS, ITPA20: ITPA20_PARAMS, 'ITPA20-IL': ITPA20_IL_PARAMS,
};

/** Bir ConfinementScalingParams ölçeklemesini değerlendir [s]; girdiler tauIPB98y2 ile aynı birimlerde. */
export function tauFromParams(s: ConfinementScalingParams, g: Geometry, Ip_MA: number, B: number, n: number, P_W: number, M: number): number {
  const e = s.exponents;
  const P_MW = Math.max(P_W / 1e6, 0.1);
  const n19 = Math.max(n / 1e19, 0.01);
  return s.C * Math.pow(Ip_MA, e.Ip) * Math.pow(B, e.B) * Math.pow(n19, e.n19) * Math.pow(P_MW, e.P) * Math.pow(g.R, e.R) *
    Math.pow(g.kappa, e.kappa) * Math.pow(g.a / g.R, e.eps) * Math.pow(M, e.M) * Math.pow(1 + g.delta, e.onePlusDelta);
}

/** ITPA20 H-mod ölçeklemesi (Verdoolaege et al. 2021) */
export function tauITPA20(g: Geometry, Ip_MA: number, B: number, n: number, P_W: number, M: number): number {
  return tauFromParams(ITPA20_PARAMS, g, Ip_MA, B, n, P_W, M);
}

/** ITPA20-IL (ITER-benzeri alt küme) H-mod ölçeklemesi (Verdoolaege et al. 2021) */
export function tauITPA20IL(g: Geometry, Ip_MA: number, B: number, n: number, P_W: number, M: number): number {
  return tauFromParams(ITPA20_IL_PARAMS, g, Ip_MA, B, n, P_W, M);
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
 *  τ_E = H_ISS04 · 0.134 · a^2.28 · R^0.64 · P^-0.61 · n19^0.54 · B^0.84 · ι_{2/3}^0.41
 *  H_ISS04: konfigürasyona özgü renormalizasyon (ISS04'teki f_ren; W7-X ~0.7–1.0, LHD ~0.9)
 */
export function tauISS04(g: Geometry, B: number, n: number, P_W: number, iota23: number, H_ISS04: number): number {
  const P_MW = Math.max(P_W / 1e6, 0.1);
  const n19 = Math.max(n / 1e19, 0.01);
  return H_ISS04 * 0.134 * Math.pow(g.a, 2.28) * Math.pow(g.R, 0.64) * Math.pow(P_MW, -0.61) *
    Math.pow(n19, 0.54) * Math.pow(B, 0.84) * Math.pow(iota23, 0.41);
}

/**
 * Stellaratorun ISS04'e göre hapsetme çarpanı: τ_E = H_ISS04 · τ_ISS04 (tek çarpan; tokamak H98'i
 * stellaratora uygulanmaz). stellarator.H_ISS04 verilmemişse eski yapılandırmalar aynı sonucu
 * verir: H_ISS04 = f_ren · H98 (f_ren: kullanımdan kalkmış eş ad).
 */
export function stellaratorHISS04(st: { f_ren: number; H_ISS04?: number }, H98: number): number {
  return st.H_ISS04 ?? st.f_ren * H98;
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
 * Elektron-iyon sıcaklık eşitlenme süresi (Spitzer; NRL Formulary), tek iyon türü:
 *  ν_ie = 3.2e-9 · Z² · lnΛ / (μ · T_e[eV]^1.5) · n_e[cm^-3]  [s^-1]  (enerji eşitlenme hızı)
 * @deprecated Çok türlü plazma için equilibrationRate (Σ n_j Z_j²/A_j, hesaplanan lnΛ); 0D model onu kullanır.
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
