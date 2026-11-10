import { beforeAll, describe, expect, it } from 'vitest';
import { loadLocale } from './index';
import { hasPhysicsRules, physicsText } from './physicsText';
import { DISRUPTION_FIXES, DISRUPTION_LABELS } from '../physics/disruption';
import { MAGNET_TECH } from '../physics/systems/magnets';
import { requirePreset, presetIds, runShot } from '../physics/index';
import type { ReactorConfig } from '../physics/types';

const tr = (s: string) => physicsText(s, 'tr');

/** [English sentence as the physics writes it, expected Turkish] per rule family */
const SAMPLES: [string, string][] = [
  // terminations
  ['Scheduled end', 'Planlı bitiş'],
  ['The shot completed the scheduled duration of 400 s without disruption.', 'Atış, planlanan 400 s süreyi disrupsiyon olmadan tamamladı.'],
  ['The shot completed the scheduled duration of 50 ns.', 'Atış, planlanan 50 ns süreyi tamamladı.'],
  ['Density-limit disruption (Greenwald)', 'Yoğunluk sınırı disrupsiyonu (Greenwald)'],
  ['Magnet quench', 'Mıknatıs sönmesi (quench)'],
  ['Peak field in the toroidal field coil B_coil = 14.2 T, Nb3Sn superconductor (4.5 K, ITER) has a limit of 13 T. The coil quenched; shot aborted.',
    'Toroidal alan bobinindeki tepe alan B_coil = 14,2 T; Nb3Sn süperiletken (4,5 K, ITER) için sınır 13 T. Bobin sönmeye geçti (quench); atış iptal edildi.'],
  ['Density-limit disruption (Greenwald) — n̄/n_G reached 1.02, t = 1.37 s. Thermal quench 1.4 ms, current quench 51 ms; halo current I_h/I_p·TPF = 0.29; runaway electron avalanche e^38 → ~0.0 MA; wall deposition 2.9 MJ/m².',
    'Yoğunluk sınırı disrupsiyonu (Greenwald) — n̄/n_G oranı 1,02 oldu, t = 1,37 s. Termal sönme 1,4 ms, akım sönmesi 51 ms; halo akımı I_h/I_p·TPF = 0,29; kaçak elektron çığı e^38 → ~0,0 MA; duvara bırakılan enerji 2,9 MJ/m².'],
  ['Beta limit — ideal MHD instability (Troyon) — β_N 3.41 > 2.8, t = 0.80 s. Thermal quench 1.1 ms, current quench 20 ms; halo current I_h/I_p·TPF = 0.21; runaway electron avalanche e^9 → ~0.0 MA; wall deposition 1.5 MJ/m².',
    'Beta sınırı — ideal MHD kararsızlığı (Troyon) — β_N 3,41 > 2,8, t = 0,80 s. Termal sönme 1,1 ms, akım sönmesi 20 ms; halo akımı I_h/I_p·TPF = 0,21; kaçak elektron çığı e^9 → ~0,0 MA; duvara bırakılan enerji 1,5 MJ/m².'],
  ['Radiative collapse (P_rad > P_heat) — n/n_Sudo = 1.20 and P_rad > P_heat — radiative collapse (soft extinction, not a disruption), t = 2.10 s. ',
    'Işımalı çöküş (P_rad > P_heat) — n/n_Sudo = 1,20 ve P_rad > P_heat — ışımalı çöküş (yumuşak sönme, disrupsiyon değil), t = 2,10 s.'],
  ['No Grad–Shafranov equilibrium could be computed for the requested boundary (R = 2.96 m, a = 0.93 m, κ = 4.5, δ = 0.9): nominal: Grad–Shafranov (maxIter): no convergence. The 1.5D model needs it for its transport geometry; shot aborted.',
    'İstenen sınır için Grad–Shafranov dengesi hesaplanamadı (R = 2,96 m, a = 0,93 m, κ = 4,5, δ = 0,9): nominal: Grad–Shafranov (maxIter): no convergence. 1.5D modelin taşınım geometrisi için buna ihtiyacı var; atış iptal edildi.'],
  ['Equilibrium failure', 'Denge hatası'],
  ['Bring elongation, triangularity and aspect ratio into the usual range, or run the shot at 0D fidelity.',
    'Uzamayı, üçgenselliği ve en-boy oranını olağan aralığa getirin ya da atışı 0D doğrulukta çalıştırın.'],
  ['Numerical failure', 'Sayısal hata'],
  ['The implicit transport solver could not advance the plasma: singular heat system. The shot was stopped at the last accepted state rather than continued with a non-converged or non-finite one.',
    'Örtük taşınım çözücüsü plazmayı ilerletemedi: singular heat system. Atış, yakınsamamış ya da sonlu olmayan bir durumla sürdürülmek yerine son kabul edilen durumda durduruldu.'],
  ['This is a solver failure, not a plasma limit: try a coarser radial grid (nRho) or slower heating/density ramps, or run the shot at 0D fidelity.',
    'Bu bir çözücü hatasıdır, plazma sınırı değil: daha kaba bir radyal ağ (nRho) ya da daha yavaş ısıtma/yoğunluk rampaları deneyin veya atışı 0D doğrulukta çalıştırın.'],
  ['Numerical failure — singular heat system', 'Sayısal hata — singular heat system'],
  // disruption events
  ['DISRUPTION: Density-limit disruption (Greenwald) — n̄/n_G reached 1.02', 'DİSRUPSİYON: Yoğunluk sınırı disrupsiyonu (Greenwald) — n̄/n_G oranı 1,02 oldu'],
  ['DISRUPTION: Beta limit — ideal MHD instability (Troyon) — β_N 3.41 > 2.8', 'DİSRUPSİYON: Beta sınırı — ideal MHD kararsızlığı (Troyon) — β_N 3,41 > 2,8'],
  ['DISRUPTION: q95 below its limit — locked mode / vertical displacement (VDE) — q95 = 1.80 < 2', 'DİSRUPSİYON: q95 sınırın altında — kilitli mod / dikey kayma (VDE) — q95 = 1,80 < 2'],
  ['DISRUPTION: NTM grew and locked (locked mode) — 2/1 island w/a = 0.118 > 0.10 — mode locked to the wall',
    'DİSRUPSİYON: NTM büyüdü ve kilitlendi (kilitli mod) — 2/1 adası w/a = 0,118 > 0,10 — mod duvara kilitlendi'],
  ['DISRUPTION: Tungsten accumulation — core radiative collapse — c_W = 1.2e-4 > 1.0e-4', 'DİSRUPSİYON: Tungsten birikimi — çekirdekte ışımalı çöküş — c_W = 1,2e-4 > 1,0e-4'],
  ['DISRUPTION: Radiative collapse (P_rad > P_heat) — P_rad 45.0 MW > P_heat 30.0 MW, T_e fell to 1.20 keV',
    'DİSRUPSİYON: Işımalı çöküş (P_rad > P_heat) — P_rad 45,0 MW > P_heat 30,0 MW, T_e düştü: 1,20 keV'],
  ['DISRUPTION: Radiative collapse (P_rad > P_heat) — P_rad 45.0 MW > P_heat 30.0 MW, ⟨T_e⟩ fell to 1.20 keV',
    'DİSRUPSİYON: Işımalı çöküş (P_rad > P_heat) — P_rad 45,0 MW > P_heat 30,0 MW, ⟨T_e⟩ düştü: 1,20 keV'],
  ['RADIATIVE COLLAPSE: Radiative collapse (P_rad > P_heat) — n/n_Sudo = 1.20 and P_rad > P_heat — radiative collapse (soft extinction, not a disruption)',
    'IŞIMALI ÇÖKÜŞ: Işımalı çöküş (P_rad > P_heat) — n/n_Sudo = 1,20 ve P_rad > P_heat — ışımalı çöküş (yumuşak sönme, disrupsiyon değil)'],
  ['DENSITY COLLAPSE: Density collapse — fuelling lost — n_e = 1.2e+19 m⁻³ is below 50 % of the target 5.0e+19 m⁻³, T_e 12.0 keV, T_i 8.00 keV, fuelling rate limit 0.001 × 10²⁰ s⁻¹',
    'YOĞUNLUK ÇÖKÜŞÜ: Yoğunluk çöküşü — yakıt beslemesi kayboldu — n_e = 1,2e+19 m⁻³, hedef 5,0e+19 m⁻³ değerinin %50 eşiğinin altında, T_e 12,0 keV, T_i 8,00 keV, yakıt besleme hızı sınırı 0,001 × 10²⁰ s⁻¹'],
  ['Thermal quench complete (1.4 ms) → current quench starting', 'Termal sönme tamamlandı (1,4 ms) → akım sönmesi başlıyor'],
  ['Plasma extinguished', 'Plazma söndü'],
  // burn and modes
  ['Scheduled end of shot', 'Atışın planlı sonu'],
  ['IGNITION: P_alpha 120 MW ≥ P_loss 118 MW', 'ATEŞLEME: P_alpha 120 MW ≥ P_loss 118 MW'],
  ['Ignition condition lost', 'Ateşleme koşulu kayboldu'],
  ['Q ≥ 1 (scientific breakeven)', 'Q ≥ 1 (bilimsel başabaş)'],
  ['Ignition test: Q = 5.2 ≥ 5 — external heating ramping off over 10 s', 'Ateşleme testi: Q = 5,2 ≥ 5 — dış ısıtma 10 s içinde kapatılıyor'],
  ['L→H transition: P_L 31.4 MW > P_LH 25.0 MW', 'L→H geçişi: P_L 31,4 MW > P_LH 25,0 MW'],
  ['L→H transition: P_loss 31.4 MW > P_LH 25.0 MW — edge transport barrier forms', 'L→H geçişi: P_loss 31,4 MW > P_LH 25,0 MW — kenar taşınım bariyeri oluşuyor'],
  ['H→L back-transition: P_L 10.1 MW < 0.7·P_LH 17.5 MW — τ_E collapsed', 'H→L geri geçişi: P_L 10,1 MW < 0,7·P_LH 17,5 MW — τ_E çöktü'],
  ['H→L back-transition: P_loss 10.1 MW < 0.7·P_LH 17.5 MW — pedestal lost', 'H→L geri geçişi: P_loss 10,1 MW < 0,7·P_LH 17,5 MW — pedestal kayboldu'],
  ['Type-I ELM: ΔW = 11.72 MJ', 'Tip-I ELM: ΔW = 11,72 MJ'],
  ['Type-I ELM (p_ped/p_lim = 1.00): ΔW = 0.83 MJ, 0.12 W_ped at ν*_ped = 0.145, capped', 'Tip-I ELM (p_ped/p_lim = 1,00): ΔW = 0,83 MJ, ν*_ped = 0,145 iken 0,12 W_ped, sınırlandı'],
  ['Type-I ELM (α_ped/α_crit = 1.01): ΔW = 0.83 MJ', 'Tip-I ELM (α_ped/α_crit = 1,01): ΔW = 0,83 MJ'],
  ['Sawtooth crash: ≈ 12.5% of W redistributed from inside q = 1', "Testere dişi çöküşü: W'nin ≈ %12,5 kadarı q = 1 yüzeyinin içinden yeniden dağıldı"],
  ['Sawtooth crash (s₁ = 0.21): ρ(q=1) = 0.35, ρ_mix = 0.45, T_e0 20.1 → 18.2 keV', 'Testere dişi çöküşü (s₁ = 0,21): ρ(q=1) = 0,35, ρ_mix = 0,45, T_e0 20,1 → 18,2 keV'],
  ['Sawtooth crash (s₁ = 0.21, Porcelli 1315): ρ(q=1) = 0.35, ρ_mix = 0.45, T_e0 20.1 → 18.2 keV, q0 → 1.02',
    'Testere dişi çöküşü (s₁ = 0,21, Porcelli 1315): ρ(q=1) = 0,35, ρ_mix = 0,45, T_e0 20,1 → 18,2 keV, q0 → 1,02'],
  ['Sawtooth-seeded NTM (3/2) started: thermal β_N = 2.10 — τ_E is degrading', 'Testere dişinin tohumladığı NTM (3/2) başladı: termal β_N = 2,10 — τ_E bozuluyor'],
  ['NTM decayed: thermal β_N 1.20 below the marginal threshold', 'NTM söndü: termal β_N 1,20 marjinal eşiğin altında'],
  ['NTM 3/2 island grew to w/a = 0.021 (thermal β_N = 2.10) — local profile flattening, τ_E degrading', 'NTM 3/2 adası w/a = 0,021 değerine büyüdü (termal β_N = 2,10) — yerel profil düzleşmesi, τ_E bozuluyor'],
  ['NTM 2/1 island decayed', 'NTM 2/1 adası söndü'],
  // operating-limit warnings
  ['Divertor heat flux 10.04 MW/m² > 10 MW/m² — material lifetime at risk', 'Divertör ısı akısı 10,04 MW/m² > 10 MW/m² — malzeme ömrü risk altında'],
  ['Divertor heat flux 46 MW/m² > 10 MW/m² — material lifetime at risk', 'Divertör ısı akısı 46 MW/m² > 10 MW/m² — malzeme ömrü risk altında'],
  ['n̄/n_G = 0.86 — approaching the density limit', 'n̄/n_G = 0,86 — yoğunluk sınırına yaklaşılıyor'],
  ['n̄/n_Sudo = 0.86 — approaching the density limit', 'n̄/n_Sudo = 0,86 — yoğunluk sınırına yaklaşılıyor'],
  ['β_N = 2.40 — approaching the Troyon limit', 'β_N = 2,40 — Troyon sınırına yaklaşılıyor'],
  // inertial, pinch, FRC, mirror, muon
  ['Bang-time: IGNITION (χ_ig = 1.12 ≥ 1), hotspot 9.8 keV, ρR = 0.45 g/cm²', 'Bang-time: ATEŞLEME (χ_ig = 1,12 ≥ 1), sıcak nokta 9,8 keV, ρR = 0,45 g/cm²'],
  ['Bang-time: NO ignition (χ_ig = 0.62 < 1) — low burn', 'Bang-time: ateşleme YOK (χ_ig = 0,62 < 1) — düşük yanma'],
  ['Below the ignition threshold (χ_ig = 0.62 < 1): inadequate velocity, ρR, asymmetry, or roughness — low burn efficiency.',
    'Ateşleme eşiğinin altında (χ_ig = 0,62 < 1): yetersiz hız, ρR, asimetri ya da pürüzlülük — düşük yanma verimi.'],
  ['Low-mode asymmetry of 8% is high — the hotspot degrades and yield drops.', 'Düşük modlu asimetri (%8) yüksek — sıcak nokta bozuluyor ve verim düşüyor.'],
  ['Low-mode asymmetry of 4.5% is high — the hotspot degrades and yield drops.', 'Düşük modlu asimetri (%4,5) yüksek — sıcak nokta bozuluyor ve verim düşüyor.'],
  ['Stagnation: C = 12.3, n = 2.2e29 m⁻³, T = 1.85 keV, B = 450 T', 'Durgunluk: C = 12,3, n = 2,2e29 m⁻³, T = 1,85 keV, B = 450 T'],
  ['Instability reduced effective compression: CR 20 → 15.4 (jitter/flow shear).', 'Kararsızlık etkin sıkıştırmayı azalttı: CR 20 → 15,4 (zamanlama sapması/akış kayması).'],
  ['MTF is far from net energy at these parameters (G≪1) — consistent with current experiments.', 'MTF bu parametrelerde net enerjiden uzak (G≪1) — bugünkü deneylerle uyumlu.'],
  ['The Z-pinch is far from net energy at these parameters (G≪1) — consistent with current experiments.', 'Z-pinch bu parametrelerde net enerjiden uzak (G≪1) — bugünkü deneylerle uyumlu.'],
  ['FRC is far from scientific breakeven at these parameters (Q≪1) — as expected: current FRC experiments do not yet produce net energy.',
    'FRC bu parametrelerde bilimsel başabaştan uzak (Q≪1) — beklendiği gibi: bugünkü FRC deneyleri henüz net enerji üretmiyor.'],
  ['Simple/tandem mirrors yield low Q due to the loss cone — net energy is not expected without flow shear or a deep potential barrier.',
    'Basit/tandem aynalar kayıp konisi yüzünden düşük Q verir — akış kayması ya da derin bir potansiyel bariyeri olmadan net enerji beklenmez.'],
  ['Muon-catalyzed fusion works at room/cold temperatures but remains at Q<1 due to α-sticking and muon production costs (a fundamental physics limit).',
    'Müon katalizli füzyon oda/soğuk sıcaklıklarda çalışır ama α-yapışması ve müon üretim maliyeti yüzünden Q<1 düzeyinde kalır (temel bir fizik sınırı).'],
  // report warnings of the magnetic methods
  ['TBR = 0.82 < 1.05 — this reactor cannot breed its own tritium.', 'TBR = 0,82 < 1,05 — bu reaktör kendi trityumunu üretemez.'],
  ['Peak divertor heat flux 12.5 MW/m² > 10 MW/m² — target plates cannot withstand this; increase the divertor radiation fraction.',
    'Divertörde tepe ısı akısı 12,5 MW/m² > 10 MW/m² — hedef plakalar buna dayanamaz; divertör ışıma oranını artırın.'],
  ['TF coil stress 720 MPa > 660 MPa limit.', 'TF bobin gerilmesi 720 MPa > 660 MPa sınırı.'],
  ['CS flux swing 120 V s is 43 % of the 277 V s the pulse needs — the PF coils would have to supply more than 30 % of it; enlarge the solenoid, raise its field or give the PF flux (systems.cs.pfFlux_Vs).',
    'CS akı salınımı 120 V s; atışın ihtiyaç duyduğu 277 V s akının %43 kadarı — PF bobinleri bunun %30 değerinden fazlasını karşılamak zorunda kalır; solenoidi büyütün, alanını artırın ya da PF akısını verin (systems.cs.pfFlux_Vs).'],
  ['CS flux swing 120 V s is 43 % of the 277 V s the pulse needs, and with the 40 V s of the PF coils 58 % — enlarge the solenoid, raise its field or the PF flux (systems.cs.pfFlux_Vs).',
    'CS akı salınımı 120 V s; atışın ihtiyaç duyduğu 277 V s akının %43 kadarı, PF bobinlerinin 40 V s akısıyla birlikte %58 kadarı — solenoidi büyütün, alanını ya da PF akısını artırın (systems.cs.pfFlux_Vs).'],
  ['Neutron damage 31 dpa/year — the first wall needs replacement within a few years.', 'Nötron hasarı 31 dpa/yıl — birinci duvarın birkaç yıl içinde değiştirilmesi gerekir.'],
  ['Negative net electricity (-120 MW): Q_eng < 1, the plant draws power from the grid.', 'Net elektrik negatif (-120 MW): Q_eng < 1, santral şebekeden güç çeker.'],
  // 1.5D model
  ['Initial Grad–Shafranov equilibrium did not converge (residual 3.2e-5 after 600 iterations) — used until the first accepted update',
    'Başlangıç Grad–Shafranov dengesi yakınsamadı (kalıntı 3,2e-5, 600 yinelemeden sonra) — ilk kabul edilen güncellemeye kadar kullanıldı'],
  ['Initial Grad–Shafranov equilibrium did not converge (residual 3.2e-5) — it was used until the first accepted update (there was none); geometry coefficients may be inaccurate.',
    'Başlangıç Grad–Shafranov dengesi yakınsamadı (kalıntı 3,2e-5) — ilk kabul edilen güncellemeye kadar kullanıldı (hiç güncelleme olmadı); geometri katsayıları yanlış olabilir.'],
  ['Grad–Shafranov equilibrium did not fully converge — geometry coefficients may be inaccurate.', 'Grad–Shafranov dengesi tam yakınsamadı — geometri katsayıları yanlış olabilir.'],
  ['Grad–Shafranov update rejected (nominal: residual 1.0e-3 after 40 iterations; 2 attempts) — geometry held at the equilibrium of t = 1.50 s, retried from t = 1.75 s',
    'Grad–Shafranov güncellemesi reddedildi (nominal: residual 1,0e-3 after 40 iterations; 2 deneme) — geometri t = 1,50 s dengesinde tutuldu, t = 1,75 s zamanından yeniden denenecek'],
  ['Grad–Shafranov update followed only 62 % of the change of the transport profiles: the equilibrium of the whole change did not converge (pressure and current tables at the limit of what the boundary can hold); the geometry lags the profiles by the rest — reported once, at t = 2.50 s',
    'Grad–Shafranov güncellemesi taşınım profillerindeki değişimin yalnızca %62 kadarını izledi: değişimin tamamının dengesi yakınsamadı (basınç ve akım tabloları sınırın taşıyabileceğinin eşiğinde); geometri kalanı kadar profillerin gerisinde — bir kez bildirildi, t = 2,50 s'],
  ['Grad–Shafranov: 3 of 12 equilibrium updates were rejected (no equilibrium of the transport profiles was found, or its tables did not converge to its flux surfaces) — the transport geometry was held at the last accepted equilibrium in between.',
    'Grad–Shafranov: 12 denge güncellemesinden 3 tanesi reddedildi (taşınım profillerinin dengesi bulunamadı ya da tabloları akı yüzeylerine yakınsamadı) — aradaki sürede taşınım geometrisi son kabul edilen dengede tutuldu.'],
  ['4 transport step(s) exhausted the Δt retries and were forced at the smallest Δt without Picard convergence — accuracy is reduced around those times.',
    '4 taşınım adımı Δt denemelerini tüketti ve Picard yakınsaması olmadan en küçük Δt ile zorlandı — bu zamanlar çevresinde doğruluk düşük.'],
  ['Transport step at t = 1.2000 s did not converge in 8 attempts; forced at Δt = 1.0e-6 s (Picard not converged) — accuracy is reduced here',
    't = 1,2000 s zamanındaki taşınım adımı 8 denemede yakınsamadı; Δt = 1,0e-6 s ile zorlandı (Picard yakınsamadı) — burada doğruluk düşük'],
  // scenario triggers
  ["Scenario trigger 'dens': n_e = 1.2 > 1 → P_NBI_MW = 0", "Senaryo tetikleyicisi 'dens': n_e = 1,2 > 1 → P_NBI_MW = 0"],
  ["Scenario trigger 'dens' re-armed: n_e = 0.9 → P_NBI_MW = 30", "Senaryo tetikleyicisi 'dens' yeniden kuruldu: n_e = 0,9 → P_NBI_MW = 30"],
];

/** sentences that read the same in both languages and have no number to localise */
const SAME = new Set(['Q < 1']);

describe('physicsText', () => {
  beforeAll(async () => { await loadLocale('tr'); });

  it('loads its Turkish rules with the Turkish dictionary', () => {
    expect(hasPhysicsRules('en')).toBe(true);
    expect(hasPhysicsRules('tr')).toBe(true);
  });

  it.each(SAMPLES)('translates %s', (en, trText) => {
    expect(tr(en)).toBe(trText);
  });

  it('is the identity in English, for any text', () => {
    for (const [en] of SAMPLES) expect(physicsText(en, 'en')).toBe(en);
    expect(physicsText('anything at all', 'en')).toBe('anything at all');
  });

  it('returns a sentence no rule knows unchanged, and never throws', () => {
    for (const s of ['', 'A sentence from a future version of the model: 1.5.', 'Type-I ELM', "Scenario trigger 'x", 'ProfileSettings.rtol = -1 is not a positive number: 1e-4 is used.']) {
      expect(tr(s)).toBe(s);
    }
    expect(() => physicsText(undefined as unknown as string, 'tr')).not.toThrow();
  });

  it('keeps the numbers: the decimal point becomes a comma, names and exponents are kept', () => {
    expect(tr('Type-I ELM (α_ped/α_crit = 1.25): ΔW = 3.50 MJ')).toBe('Tip-I ELM (α_ped/α_crit = 1,25): ΔW = 3,50 MJ');
    expect(tr('Initial Grad–Shafranov equilibrium did not converge (residual 1.0e-3) — it was used until the first accepted update; geometry coefficients may be inaccurate.')).toContain('1,0e-3');
  });

  it('has a Turkish text for every disruption label, every fix and every magnet technology', () => {
    for (const [cause, label] of Object.entries(DISRUPTION_LABELS)) if (cause !== 'none') expect(tr(label), cause).not.toBe(label);
    for (const [cause, fix] of Object.entries(DISRUPTION_FIXES)) if (cause !== 'none') expect(tr(fix), cause).not.toBe(fix);
    for (const m of Object.values(MAGNET_TECH)) {
      const s = `Peak field in the toroidal field coil B_coil = 14.0 T, ${m.label} has a limit of 9 T. The coil quenched; shot aborted.`;
      expect(tr(s), m.label).toContain('Toroidal alan bobinindeki');
      // the technology name is in Turkish too (REBCO HTS keeps its English name: an abbreviation)
      if (!m.label.startsWith('REBCO')) expect(tr(s), m.label).not.toContain(m.label);
    }
  });
});

describe('physicsText on real shots', () => {
  beforeAll(async () => { await loadLocale('tr'); });

  const cfgOf = (id: string): Record<string, unknown> => JSON.parse(JSON.stringify(requirePreset(id).cfg)) as Record<string, unknown>;
  const withPatch = (id: string, patch: Record<string, unknown>) => ({ ...cfgOf(id), ...patch }) as unknown as ReactorConfig;
  const part = (id: string, key: string, patch: Record<string, unknown>) => ({ ...(cfgOf(id)[key] as object), ...patch });

  /** every distinct sentence a shot puts into the event log, the warnings and the termination */
  function sentences(cfg: ReactorConfig): string[] {
    const r = runShot(cfg);
    const t = r.report.termination;
    return [...new Set([...r.sim.events.map((e) => e.msg), ...r.report.warnings, t.reason, t.diagnosis, t.fix].filter((s) => s !== ''))];
  }
  function expectTranslated(label: string, list: string[]) {
    const left = list.filter((s) => !SAME.has(s) && tr(s) === s);
    expect(left, `${label}: sentences without a Turkish rule`).toEqual([]);
  }

  // DEMO takes 15 s and writes the same kinds of sentences as ITER; the 1.5D presets are covered by the three shots below
  const ZeroD = presetIds().filter((id) => (requirePreset(id).cfg as { fidelity?: string }).fidelity !== '1.5D' && id !== 'DEMO');

  it.each(ZeroD)('translates every sentence of the 0D preset %s', (id) => {
    expectTranslated(id, sentences(requirePreset(id).cfg));
  }, 30000);

  const FORCED: [string, () => ReactorConfig][] = [
    ['density-limit disruption', () => withPatch('JET', { n_target: 3e20, n_rampTime: 1, t_end: 4 })],
    ['beta-limit disruption', () => withPatch('JET', { heating: part('JET', 'heating', { P_NBI_MW: 200 }), t_end: 4 })],
    ['low q95', () => withPatch('JET', { Ip_MA: 9, t_end: 4 })],
    ['magnet quench', () => withPatch('JET', { B0: 12 })],
    ['radiative collapse', () => withPatch('JET', { impurity: part('JET', 'impurity', { species: 'Ar', concentration: 0.08 }) })],
    ['tungsten accumulation', () => withPatch('JET', { impurity: part('JET', 'impurity', { species: 'W', concentration: 0.003, W_source_frac: 1 }) })],
    ['density collapse', () => withPatch('JET', { fueling: part('JET', 'fueling', { maxRate_1e20s: 0.0001 }) })],
    ['stellarator radiative collapse', () => withPatch('W7X', { n_target: 4e20 })],
    ['stellarator density collapse', () => withPatch('W7X', { fueling: part('W7X', 'fueling', { maxRate_1e20s: 0.0001 }) })],
    ['indirect-drive capsule that does not ignite', () => withPatch('NIF', { asymmetry_rms: 8 })],
    ['direct-drive capsule that does not ignite', () => withPatch('DIRECT', { asymmetry_rms: 8 })],
  ];
  it.each(FORCED)('translates every sentence of a forced shot: %s', (name, make) => {
    const list = sentences(make());
    expect(list.length).toBeGreaterThan(2);
    expectTranslated(name, list);
  }, 30000);

  it('names the cause of each forced disruption in the termination reason', () => {
    const reasons = FORCED.slice(0, 7).map(([, make]) => runShot(make()).report.termination.reason);
    expect(new Set(reasons).size).toBeGreaterThanOrEqual(6);
    for (const r of reasons) expect(tr(r), r).not.toBe(r);
  }, 30000);

  const FORCED_15D: [string, () => ReactorConfig][] = [
    ['JET 1.5D to the end', () => requirePreset('JET15').cfg],
    ['1.5D density-limit disruption', () => withPatch('JET15', { n_target: 3e20, n_rampTime: 1, t_end: 3 })],
    ['1.5D beta-limit disruption', () => withPatch('JET15', { heating: part('JET15', 'heating', { P_NBI_MW: 200 }), t_end: 3 })],
  ];
  it.each(FORCED_15D)('translates every sentence of %s', (name, make) => {
    expectTranslated(name, sentences(make()));
  }, 90000);
});
