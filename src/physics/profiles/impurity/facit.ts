/**
 * FACIT: analytical neoclassical (collisional) impurity transport at arbitrary collisionality, in the rotation-free limit.
 *
 * The particle flux of a trace impurity z in a plasma of main ions i is the sum of three parts, classical (CL), Pfirsch-Schlueter
 * (PS) and banana-plateau (BP), each linear in the gradients of the impurity density, the main-ion density and the main-ion
 * temperature (Fajardo et al. 2022, eq. 1; Fajardo PhD thesis, Ludwig-Maximilians-Universitaet Muenchen 2023, eq. 2.34):
 *
 *     <Gamma_z . grad r> = n_z ( -D dln n_z/dr + K dln n_i/dr + H dln T_i/dr ),        D = sum_c D^c, K = sum_c K^c, H = sum_c H^c,
 *
 * with r the minor-radius label of the flux surface and n_z the flux-surface average of the impurity density. K^c = (Z/Z_i) D^c for
 * every part: the convection driven by the main-ion density gradient is Z times the diffusion (the diamagnetic flows, that is the
 * mechanism of the inward accumulation of heavy impurities), and H^c/K^c is the temperature-screening coefficient (a negative value
 * turns the ion temperature gradient into an outward convection). The three parts:
 *
 *   PS   D = q^2 rho_Lz^2 nu_z (C_G / 2 eps^2),   H = { -[1 + (Z/Z_i)(C0 - 1)] + (Z/Z_i)(C_U/C_G)(C0 + k_i) } D      (thesis eqs. 2.37, 2.38)
 *   BP   D = (3 T_i / (2 Z^2 e^2 F^2 n_z)) / (1/K11_i + 1/K11_z),   H = [ (Z/Z_i)(K12_i/K11_i - 3/2) - (K12_z/K11_z - 3/2) ] D   (eqs. 2.41, 2.42)
 *   CL   D = (rho_Lz^2 nu_z / 2) <n/b^2>,   H = -[1 + (Z/Z_i)(C0 - 1)] D                                                        (eq. 2.43)
 *
 * where rho_Lz is the impurity Larmor radius, nu_z its collision frequency with the main ions, C0 the friction coefficient of the
 * parallel main-ion heat flow on the impurity (Hirshman and Sigmar, Nucl. Fusion 21 (1981) 1079; new fit of Wenzel and Sigmar,
 * Nucl. Fusion 30 (1990) 1117, in Fajardo et al. 2022), k_i the neoclassical main-ion flow coefficient, K11 and K12 the parallel
 * viscosity coefficients of the main ions and of the impurity (banana, plateau and Pfirsch-Schlueter regimes joined by rational
 * interpolations) and F = R0 B0. C_G and C_U are the poloidal-asymmetry factors of the impurity density; with no rotation and no
 * other source of asymmetry (the case here) the impurity density is constant on the flux surface and C_U = 0 and C_G is the
 * poloidally homogeneous geometric factor, which Fajardo et al. fit to NEO, 2 eps^2 * 0.96 (1 - 0.54 f_t^4.5) (P. Maget, P. Manas,
 * J. Frank, T. Nicolas, O. Agullo and X. Garbet, Plasma Phys. Control. Fusion 62 (2020) 105001, corrigendum 64 (2022) 069501, give
 * the poloidally asymmetric generalisation of the PS part).
 *
 * The formulas, the fitted factors (f1, f2, f3 of C0, the y factors of the viscosities, f_dps of the PS diffusion, f_hbp of the BP
 * temperature screening) and the flow coefficient k_i are those published by
 *   D. Fajardo, C. Angioni, P. Maget, P. Manas, "Analytical model for collisional impurity transport in tokamaks at arbitrary
 *   collisionality", Plasma Phys. Control. Fusion 64 (2022) 055017 (doi 10.1088/1361-6587/ac5b4d), fits to NEO scans over the trapped
 *   fraction, collisionality, charge and mass; and D. Fajardo and C. Angioni, "Analytical model for the combined effects of rotation
 *   and collisionality on neoclassical impurity transport", Plasma Phys. Control. Fusion 65 (2023) 035021 (doi 10.1088/1361-6587/acb0fc)
 *   for k_i. They were transcribed from the reference implementation of the FACIT authors (the FACIT module of the Aurora toolbox,
 *   github.com/fsciortino/Aurora, aurora/facit.py; F. Sciortino et al., Plasma Phys. Control. Fusion 63 (2021) 112001), which is where
 *   a change of the model has to be compared. The Braginskii collision times use the NRL Coulomb logarithms; the trapped fraction is the
 *   usual approximation f_t = 1 - (1 - eps)^{3/2} / (sqrt(1 + eps) (1 + 1.46 sqrt(eps))) (thesis eq. 2.31), close to sqrt(2 eps) at small eps.
 *
 * VALIDITY (Fajardo et al. 2022): trace impurities (Z^2 n_z / (Z_i^2 n_i) enters through the strength parameter alpha, the fits cover
 * alpha up to about 1), circular large-aspect-ratio flux surfaces (eps, q and f_t of the surface), a single main-ion species and one
 * charge state of the impurity. No poloidal asymmetry: a rotating or ICRH-heated plasma with heavy impurities has enhanced transport
 * that this function does not describe (rotation_model 1 and 2 of the reference implementation are not ported). The model was compared
 * with NEO for Z = 2 ... 74 (He, Be, C, Ne, Ar, W among them); the temperature screening of the BP part is not overestimated as in NCLASS.
 * These coefficients were NOT independently re-verified against NEO here: `facit.test.ts` checks the limits of the theory they must reduce
 * to (Z scaling of the convection, the -1/2 screening of the heavy-impurity collisional limit, the 2 q^2 ratio of the PS to the classical
 * diffusion) and the regression of the numbers.
 */

/** constants of the reference implementation [SI]: proton mass, electron mass, elementary charge, vacuum permittivity */
const MP = 1.672623e-27;
const ME = 9.1096e-31;
const QE = 1.60217653e-19;
const EPS0 = 8.8542e-12;
/** 3 eps0^2 (2 pi / e)^{3/2} / e: the common factor of the Braginskii times for T in eV */
const EPS_PI_FAC = (3 * EPS0 * EPS0 * Math.pow((2 * Math.PI) / QE, 1.5)) / QE;
/** lower bound of the inverse aspect ratio (the axis: the banana widths and f_t vanish there) */
export const FACIT_EPS_MIN = 0.005;
/** lower bound of the impurity density [m^-3]: the trace limit (the collision times are singular at n_z = 0) */
export const FACIT_NZ_MIN = 1e10;

/** Local inputs of the model at one radius */
export interface FacitInput {
  /** impurity charge state (the mean charge at the local T_e) and mass number */
  Zimp: number;
  Aimp: number;
  /** main-ion charge and mass number */
  Zi: number;
  Ai: number;
  /** main-ion temperature [eV] */
  Ti_eV: number;
  /** main-ion and (flux-surface average) impurity densities [m^-3] */
  Ni: number;
  Nimp: number;
  /** effective charge of the plasma */
  Zeff: number;
  /** T_e / T_i */
  TeOverTi: number;
  /** inverse aspect ratio of the flux surface r/R0, safety factor there, the geometric axis R0 [m] and B0 there [T] */
  eps: number;
  q: number;
  R0: number;
  B0: number;
}

/** One part of the flux: the coefficients of its diffusion, its main-ion density and its main-ion temperature convection [m^2/s] */
export interface FacitPart { D: number; K: number; H: number }

/** The coefficients of the model: the total and its classical, Pfirsch-Schlueter and banana-plateau parts */
export interface FacitResult extends FacitPart {
  PS: FacitPart; BP: FacitPart; CL: FacitPart;
  /** the intermediates worth reporting: trapped fraction, collisionality parameter g = q R0/(v_ti tau_ii), ion collisionality nu_i*, C0, k_i */
  ft: number; g: number; nuiStar: number; C0z: number; ki: number;
}

/** Trapped-particle fraction of a flux surface of inverse aspect ratio eps (the usual approximation of the FACIT papers) */
export function ftrap(eps: number): number {
  return 1 - Math.pow(1 - eps, 1.5) / (Math.sqrt(1 + eps) * (1 + 1.46 * Math.sqrt(eps)));
}

/**
 * The fitted factors f1, f2 (of C2) and f3 (of the ion-electron heat exchange in C0), the y factors of the viscosity coefficients
 * (banana, plateau and PS values of K11 and K12 of the impurity and of the main ions: [zb, zp, zps], [ib, ip, ips] pairs), f_dps
 * (PS diffusion), f_hbp (BP temperature screening) and f_v (3/2 without rotation). Fajardo et al. 2022, the appendix fits.
 */
function fitFactors(Z: number, A: number, ft: number): {
  f1: number; f2: number; f3: number;
  y11zb: number; y12zb: number; y11ib: number; y11ips: number; y12ib: number;
  fdps: number; fhbp: number; fv: number;
} {
  const f1 = (1.74 * (1 - 0.028 * A) + 10.25 / Math.pow(1 + A / 3.0, 2.8)) - 0.423 * (1 - 0.136 * A) * Math.pow(ft, 5 / 4);
  const f2 = (88.28389935 + 10.50852772 * Z) / (1 + 0.2157175 * Math.pow(Z, 2.57338463));
  const f3 = (-4.45719179e6 + 2.72813878e6 * Z) / (1 + 5.26716920e6 * Math.pow(Z, 8.33610108e-1));
  const y11zb = (8 * Math.pow(1 - ft, 20) - 0.66 * Math.pow(ft, 4.9) + 0.94)
    * ((1.085e4 + (9.3e3 * 14) / Math.pow(Z, 5 / 3)) / (1 + 14 / Math.pow(Z, 5 / 3)))
    * Math.pow(ft, 4.6) * (1 - ft) / (1 + 9.44e3 * (1 - 2e-3 * Z) * Math.pow(ft, 4.16));
  const y12zb = ((1.8e3 + 7.54 * Math.pow(Z, 1.8)) * Math.pow(ft, 4.05 * (1 + 0.0039 * Z))
    * Math.pow(1 - ft, 0.7 * (1 + 0.015 * Z))) / (1 + 1276 * (1 + 0.053 * Z) * Math.pow(ft, 3.6));
  const ybanana = 571.6 * (1 + 0.84 * Z + 7.8e-7 * Math.pow(Z, 5.15)) * Math.pow(ft, 3.43 * (1 + 0.012 * Z))
    * Math.pow(1 - ft, 1.2 * (1 + 1.6e-8 * Math.pow(Z, 5.1))) / (1 + 500 * Math.pow(ft, 8 / 3)) + 1e-3;
  const y11ib = ((5.91e-5 * Z + 0.812 + 0.806 / Math.pow(Z, 0.44)) + (0.013 * Z + 0.098 - 7.03 / Math.pow(Z, 1.04)) * ft
    + (-0.047 * Z + 0.79 + 13.8 / Math.pow(Z, 1.26)) * ft * ft + (0.04 * Z - 0.575 - 9.64 / Math.pow(Z, 1.31)) * ft * ft * ft) * ybanana;
  const y11ips = 1 / (1 + (99 / Math.pow(44, 6)) * Math.pow(Z, 6));
  const fdps = (0.711 + 2.08e-3 * Math.pow(Z, 1.26)) / (1 + 1.06e-11 * Math.pow(Z, 5.78));
  const fhbp = (1.01579172 - 1.78923911e-3 * Z) / (1 + 6.60170647e-13 * Math.pow(Z, 6.66398825));
  return { f1, f2, f3, y11zb, y12zb, y11ib, y11ips, y12ib: ybanana, fdps, fhbp, fv: 1.5 };
}

/**
 * The parallel viscosity coefficients K11 and K12 of the main ions (i) and of the impurity (a) [kg m^-1 s^-1]: banana + plateau + PS
 * regimes joined by K = y_b K_B / ((1 + y_b K_B / (y_p K_P)) (1 + y_p K_P / (y_ps K_PS))). Fajardo et al. 2022 section 3, after
 * Hirshman and Sigmar 1981 (PS coefficients of the Braginskii-type moment expansion, the q_ij of the friction matrix).
 */
function viscosities(o: {
  nimp: number; ni: number; ti: number; Ai: number; Aimp: number; Zi: number; Zimp: number;
  Tauii: number; Tauimpimp: number; Tauiimp: number; Tauimpi: number; eps: number; ft: number; R0: number; q: number;
  y11zb: number; y12zb: number; y11ib: number; y11ips: number; y12ib: number;
}): { K11i: number; K12i: number; K11a: number; K12a: number } {
  const { nimp, ni, ti, Ai, Aimp, Zi, Zimp, Tauii, Tauimpimp, Tauiimp, Tauimpi, eps, ft, R0, q } = o;
  const Ti = QE * ti;
  const wii = Math.sqrt((2 * Ti) / (Ai * MP)) / (q * R0);
  const wimpimp = Math.sqrt(Ai / Aimp) * wii;
  // plateau regime
  const facAP = (nimp * Ti * Math.sqrt(Math.PI)) / (3 * wimpimp);
  const facIP = (ni * Ti * Math.sqrt(Math.PI)) / (3 * wii);
  const K11aP = 2 * facAP, K12aP = 6 * facAP;
  const K11iP = 2 * facIP, K12iP = 6 * facIP;
  // Pfirsch-Schlueter regime: the friction matrix elements
  const r00 = 1 / Math.SQRT2, r01 = 1.5 / Math.SQRT2, r11 = 3.75 / Math.SQRT2;
  const xai = Math.sqrt(Aimp / Ai), xia = 1 / xai;
  const x2ai = xai * xai, x2ia = xia * xia;
  const xfacAi = Math.sqrt(1 + x2ai), xfacIa = Math.sqrt(1 + x2ia);
  const qaa00 = 8 / Math.pow(2, 1.5), qaa01 = 15 / Math.pow(2, 2.5), qaa11 = 132.5 / Math.pow(2, 3.5);
  const qii00 = qaa00, qii01 = qaa01, qii11 = qaa11;
  const qai00 = (3 + 5 * x2ai) / Math.pow(xfacAi, 3), qia00 = (3 + 5 * x2ia) / Math.pow(xfacIa, 3);
  const qai01 = (1.5 * (3 + 7 * x2ai)) / Math.pow(xfacAi, 5), qia01 = (1.5 * (3 + 7 * x2ia)) / Math.pow(xfacIa, 5);
  const qai11 = (35 * x2ai ** 3 + 38.5 * x2ai ** 2 + 46.25 * x2ai + 12.75) / Math.pow(xfacAi, 7);
  const qia11 = (35 * x2ia ** 3 + 38.5 * x2ia ** 2 + 46.25 * x2ia + 12.75) / Math.pow(xfacIa, 7);
  const facQai = (ni * Zi * Zi) / (nimp * Zimp * Zimp), facQia = 1 / facQai;
  const qa00 = facQai * qai00 + qaa00 - r00, qi00 = facQia * qia00 + qii00 - r00;
  const qa01 = facQai * qai01 + qaa01 - r01, qi01 = facQia * qia01 + qii01 - r01;
  const qa11 = facQai * qai11 + qaa11 - r11, qi11 = facQia * qia11 + qii11 - r11;
  const Qa = 0.4 * (qa00 * qa11 - qa01 * qa01), Qi = 0.4 * (qi00 * qi11 - qi01 * qi01);
  const la11 = qa11 / Qa, la12 = (3.5 * (qa11 + qa01)) / Qa;
  const li11 = qi11 / Qi, li12 = (3.5 * (qi11 + qi01)) / Qi;
  const facImpPS = nimp * Ti * Tauimpimp, facIonPS = ni * Ti * Tauii;
  const K11aPS = facImpPS * la11, K12aPS = facImpPS * la12;
  const K11iPS = facIonPS * li11, K12iPS = facIonPS * li12;
  // banana regime: the pitch-angle scattering frequencies integrated over the Maxwellian
  const facB = (ft / (1 - ft)) * ((2 * R0 * R0 * q * q) / (3 * eps * eps));
  const nuDaiInt = (xfacAi + x2ai * Math.log(xai / (1 + xfacAi))) / Tauimpi;
  const nuD2aiInt = 1 / (xfacAi * Tauimpi);
  const nuDiaInt = (xfacIa + x2ia * Math.log(xia / (1 + xfacIa))) / Tauiimp;
  const nuD2iaInt = 1 / (xfacIa * Tauiimp);
  const nuDaaInt = (Math.SQRT2 + Math.log(1 / (1 + Math.SQRT2))) / Tauimpimp;
  const nuD2aaInt = 1 / (Math.SQRT2 * Tauimpimp);
  const nuDiiInt = (Math.SQRT2 + Math.log(1 / (1 + Math.SQRT2))) / Tauii;
  const nuD2iiInt = 1 / (Math.SQRT2 * Tauii);
  const K11aB = facB * nimp * (Aimp * MP) * (nuDaiInt + nuDaaInt);
  const K12aB = facB * nimp * (Aimp * MP) * (nuD2aiInt + nuD2aaInt);
  const K11iB = facB * ni * (Ai * MP) * (nuDiaInt + nuDiiInt);
  const K12iB = facB * ni * (Ai * MP) * (nuD2iaInt + nuD2iiInt);
  // the joins (y factors of the plateau are 1; those of the PS regime are 1 except that of the main-ion K11)
  const join = (yb: number, KB: number, KP: number, yps: number, KPS: number) => (yb * KB) / ((1 + (yb * KB) / KP) * (1 + KP / (yps * KPS)));
  return {
    K11a: join(o.y11zb, K11aB, K11aP, 1, K11aPS),
    K12a: join(o.y12zb, K12aB, K12aP, 1, K12aPS),
    K11i: join(o.y11ib, K11iB, K11iP, o.y11ips, K11iPS),
    K12i: join(o.y12ib, K12iB, K12iP, 1, K12iPS),
  };
}

/**
 * The FACIT transport coefficients D, K and H [m^2/s] of a trace impurity at one radius, rotation-free (no poloidal asymmetry).
 * The flux is n_z (-D dln n_z/dr + K dln n_i/dr + H dln T_i/dr) [m^-2 s^-1] for r the minor radius of the flux surface (see the header).
 */
export function facitCoefficients(inp: FacitInput): FacitResult {
  const { Zimp, Aimp, Zi, Ai, Zeff, TeOverTi, q, R0, B0 } = inp;
  const Ti = Math.max(inp.Ti_eV, 1);
  const Ni = Math.max(inp.Ni, FACIT_NZ_MIN);
  const Nimp = Math.max(inp.Nimp, FACIT_NZ_MIN);
  const eps = Math.max(FACIT_EPS_MIN, inp.eps);
  const eps2 = eps * eps;
  const ft = ftrap(eps);
  const mi = Ai * MP, mimp = Aimp * MP;
  // Coulomb logarithms (NRL formulary; densities in cm^-3, temperatures in eV)
  const Lnii = 23 - Math.log(Math.pow(Zi, 3) * Math.sqrt(2 * (Ni / 1e6))) + 1.5 * Math.log(Ti);
  const Lnimpi = 23 - Math.log(Zi * Zimp * Math.sqrt((Ni / 1e6) * Zi * Zi + (Nimp / 1e6) * Zimp * Zimp)) + 1.5 * Math.log(Ti);
  const Lnimpimp = 23 - Math.log(Math.pow(Zimp, 3) * Math.sqrt(2 * (Nimp / 1e6))) + 1.5 * Math.log(Ti);
  // Braginskii collision times, all referred to tau_ii
  const Tauii = (EPS_PI_FAC * Math.sqrt(mi) * Math.pow(Ti, 1.5)) / (Math.pow(Zi, 4) * Ni * Lnii);
  const Tauimpi = Math.sqrt(Aimp / Ai) * ((Zi * Zi * Lnii) / (Zimp * Zimp * Lnimpi)) * Tauii;
  const Tauiimp = ((Zi * Zi * Ni * Lnii) / (Zimp * Zimp * Nimp * Lnimpi)) * Tauii;
  const Tauimpimp = Math.sqrt(Aimp / Ai) * ((Math.pow(Zi, 4) * Ni * Lnii) / (Math.pow(Zimp, 4) * Nimp * Lnimpimp)) * Tauii;
  // collisionalities: the impurity collision frequency, the transit-to-collision parameter g and the main-ion nu*
  const nuz = 1 / (Math.sqrt(1 + Aimp / Ai) * Tauimpi);
  const g = (q * R0) / (Math.sqrt((2 * QE * Ti) / mi) * Tauii);
  const nuiStar = g / Math.pow(eps, 1.5);
  const alpha = (Zimp * Zimp * Nimp) / (Zi * Zi * Ni);
  // ion-electron heat exchange (Fuelop and Helander, Phys. Plasmas 8 (2001) 3305)
  const muIe = ((96 * Math.SQRT2) / 125) * (1 / (Zi * Zi)) * Math.sqrt(ME / mi) * Math.pow(1 / TeOverTi, 1.5);
  const F = fitFactors(Zimp, Aimp, ft);
  // friction coefficient of the main-ion heat flow on the impurity: C0 = C2 / (1 + f3 mu_ie g^2)
  const C2 = 1.5 / (1 + F.f1 * (Ai / Aimp)) - (0.29 + 0.68 * alpha) / (0.59 + alpha + (1.34 + F.f2) * Math.pow(g, -2));
  const C0z = C2 / (1 + F.f3 * muIe * g * g);
  const ki = mainIonFlowCoefficient(nuiStar, ft, Zeff);
  const wcz = (Zimp * QE * B0) / mimp;
  const rhoLz2 = ((2 * QE * Ti) / mimp) / (wcz * wcz);
  const V = viscosities({
    nimp: Nimp, ni: Ni, ti: Ti, Ai, Aimp, Zi, Zimp, Tauii, Tauimpimp, Tauiimp, Tauimpi, eps, ft, R0, q,
    y11zb: F.y11zb, y12zb: F.y12zb, y11ib: F.y11ib, y11ips: F.y11ips, y12ib: F.y12ib,
  });
  const ZoverZi = Zimp / Zi;
  // poloidally homogeneous impurity density: C_G fitted to NEO, C_U = 0, classical geometric factor 1 + 2 eps^2
  const CgeoG = 2 * eps2 * (0.96 * (1 - 0.54 * Math.pow(ft, 4.5)));
  const CclG = 1 + 2 * eps2;
  // PS
  const DPS = (F.fdps * q * q * rhoLz2 * nuz * (CgeoG / (2 * eps2)));
  const PS: FacitPart = { D: DPS, K: ZoverZi * DPS, H: -(1 + ZoverZi * (C0z - 1)) * DPS };
  // BP
  const F0 = R0 * B0;
  const DBP = ((1.5 * QE * Ti) / (Zimp * Zimp * QE * QE * F0 * F0 * Nimp)) * (1 / (1 / V.K11i + 1 / V.K11a));
  const BP: FacitPart = {
    D: DBP, K: ZoverZi * DBP,
    H: F.fhbp * (ZoverZi * (V.K12i / V.K11i - F.fv) - (V.K12a / V.K11a - F.fv)) * DBP,
  };
  // classical (carries the f_dps factor of the PS diffusion through its definition, as in the reference implementation)
  const DCL = ((CclG * 2 * eps2) / CgeoG) * DPS / (2 * q * q);
  const CL: FacitPart = { D: DCL, K: ZoverZi * DCL, H: -(1 + ZoverZi * (C0z - 1)) * DCL };
  return {
    D: PS.D + BP.D + CL.D, K: PS.K + BP.K + CL.K, H: PS.H + BP.H + CL.H,
    PS, BP, CL, ft, g, nuiStar, C0z, ki,
  };
}

/**
 * Neoclassical main-ion flow coefficient k_i (poloidal flow u_i,theta = k_i (dT_i/dr) / (e B ...)) without rotation: banana regime
 * -(1 - f_t) / (1 - 1.158 f_t + 0.98 f_t^2) with the impurity correction in Z_eff, joined to the plateau and collisional limits
 * (Fajardo and Angioni 2023, fit to NEO; the Mach-number terms of the reference implementation vanish at zero rotation).
 * Only the PS part with C_U != 0 uses it (rotation), so here it is a reported diagnostic.
 */
export function mainIonFlowCoefficient(nuiStar: number, ft: number, Zeff: number): number {
  const c01 = 0.53, c02 = 1.158, c03 = -0.98;
  const l1k = 5.7 * Math.pow(1 - ft, 6.7) + 0.38;
  const l2k = -1.52 + 38.4 * Math.pow(1 - ft, 3.02) * Math.pow(ft, 2.07);
  const l3k = 0.25 + 1.2 * Math.pow(1 - ft, 3.65);
  const l5k = 0.1 * Math.pow(1 - ft, 1.46) * Math.pow(ft, 4.33);
  const l4k = 0.8;
  const l6k = (-0.05 + 1.95 * Math.pow(ft, 2.5)) / (1 + 2.55 * Math.pow(ft, 17));
  const ki0 = (-(c01 + 0.055 * (Zeff - 1)) * (1 - ft)) / ((0.53 + 0.17 * (Zeff - 1)) * (1 - (c02 - 0.065 * (Zeff - 1)) * ft - c03 * ft * ft));
  const nu2 = nuiStar * nuiStar, nu14 = Math.pow(nuiStar, 0.25);
  return ((ki0 + l1k * Zeff * Math.sqrt(ft * nuiStar) + l2k * nu14) / (1 + l3k * Math.sqrt(nuiStar)) - l4k * l5k * nu2 * Math.pow(ft, 6) + l6k * nu14)
    / (1 + l5k * nu2 * Math.pow(ft, 6));
}
