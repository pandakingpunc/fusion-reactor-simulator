/**
 * Turkish rules for the sentences of the physics layer (see physicsText.ts). A separate chunk: loadLocale('tr') fetches it with the
 * dictionary, so the first load stays English-only. The English side is copied from the templates in src/physics (the coverage test in
 * physicsText.test.ts runs real shots and fails on a sentence that no rule translates, so a changed template is found there).
 *
 * Words follow the Turkish dictionaries of the interface (hapsetme, ateşleme, testere dişi, disrupsiyon, safsızlık, divertör, ısı akısı,
 * başabaş, pedestal, sıcak nokta). Symbols and standard abbreviations stay (ELM, NTM, Q, β_N, n_G, q95, P_LH, τ_E, ΔW, MW, keV). Numbers are
 * captured as written and the decimal comma is set by physicsText() on the finished sentence. A suffix is never attached to a number
 * (Turkish vowel harmony depends on how the number is read): the sentences are built to avoid it.
 */
import { registerPhysicsRules, type PhysicsRule } from './physicsText';

/** a number as the physics writes it (toFixed, toExponential, plain): one capture group */
const NUM = '(-?[\\d.]+(?:e[-+]?\\d+)?|NaN|-?Infinity)';
const rx = (src: string): RegExp => new RegExp('^' + src.replace(/#/g, NUM) + '$');

/** DISRUPTION_LABELS (src/physics/disruption.ts) */
const LABELS: Record<string, string> = {
  'Density-limit disruption (Greenwald)': 'Yoğunluk sınırı disrupsiyonu (Greenwald)',
  'Beta limit — ideal MHD instability (Troyon)': 'Beta sınırı — ideal MHD kararsızlığı (Troyon)',
  'q95 below its limit — locked mode / vertical displacement (VDE)': 'q95 sınırın altında — kilitli mod / dikey kayma (VDE)',
  'Radiative collapse (P_rad > P_heat)': 'Işımalı çöküş (P_rad > P_heat)',
  'Tungsten accumulation — core radiative collapse': 'Tungsten birikimi — çekirdekte ışımalı çöküş',
  'Vertical displacement event (VDE)': 'Dikey kayma olayı (VDE)',
  'NTM grew and locked (locked mode)': 'NTM büyüdü ve kilitlendi (kilitli mod)',
  'Magnet quench — shot aborted': 'Mıknatıs sönmesi (quench) — atış iptal edildi',
  'Density collapse — fuelling lost': 'Yoğunluk çöküşü — yakıt beslemesi kayboldu',
};

/** DISRUPTION_FIXES (src/physics/disruption.ts) */
const FIXES: Record<string, string> = {
  'Lower the target density (n/n_G < 0.85), increase plasma current or reduce the minor radius; limit the fueling rate.':
    'Hedef yoğunluğu düşürün (n/n_G < 0,85), plazma akımını artırın ya da küçük yarıçapı azaltın; yakıt besleme hızını sınırlayın.',
  'Reduce heating power, increase B_T or I_p (β_N = β a B / I_p), or raise the β_N limit through wall stabilization/shaping.':
    'Isıtma gücünü azaltın, B_T ya da I_p değerini artırın (β_N = β a B / I_p) veya duvar kararlılaştırması/şekillendirmeyle β_N sınırını yükseltin.',
  'Reduce plasma current or increase B_T: aim for q95 ≈ 5 a² B κ_eff / (R I_p) > 3.':
    'Plazma akımını azaltın ya da B_T değerini artırın: q95 ≈ 5 a² B κ_eff / (R I_p) > 3 olacak biçimde hedefleyin.',
  'Reduce impurity concentration (wall conditioning), increase auxiliary heating, and lower density.':
    'Safsızlık derişimini azaltın (duvar koşullandırması), yardımcı ısıtmayı artırın ve yoğunluğu düşürün.',
  'Prevent W accumulation with central ECRH, increase ELM frequency (pellet pacing), and reduce the W source (divertor sputtering).':
    'W birikimini merkezi ECRH ile önleyin, ELM sıklığını artırın (peletle tetikleme) ve W kaynağını azaltın (divertör püskürtmesi).',
  'Reduce elongation or strengthen vertical position control.': 'Uzamayı azaltın ya da dikey konum denetimini güçlendirin.',
  'Keep β_N below the NTM threshold or stabilize the island with ECCD.': 'β_N değerini NTM eşiğinin altında tutun ya da adayı ECCD ile kararlı kılın.',
  'Reduce B_T below the magnet technology limit or select HTS (REBCO).': 'B_T değerini mıknatıs teknolojisinin sınırının altına indirin ya da HTS (REBCO) seçin.',
  'Raise the maximum fuelling rate or fuel with pellets instead of gas (the density controller cannot hold the target), or lower the target density; a heated plasma with no particle source loses its density and the temperature runs away.':
    'En büyük yakıt besleme hızını artırın ya da gaz yerine pelet ile yakıtlayın (yoğunluk denetleyicisi hedefi tutamıyor) veya hedef yoğunluğu düşürün; parçacık kaynağı olmayan ısıtılmış bir plazma yoğunluğunu yitirir ve sıcaklık kaçar.',
};

/** MAGNET_TECH labels (src/physics/systems/magnets.ts) */
const TECH: Record<string, string> = {
  'Copper (water-cooled, pulsed)': 'Bakır (su soğutmalı, darbeli)',
  'NbTi superconductor (4.5 K)': 'NbTi süperiletken (4,5 K)',
  'Nb3Sn superconductor (4.5 K, ITER)': 'Nb3Sn süperiletken (4,5 K, ITER)',
  'REBCO HTS (20 K, SPARC/ARC)': 'REBCO HTS (20 K, SPARC/ARC)',
};

const EXACT: Record<string, string> = {
  ...LABELS, ...FIXES,
  // terminations
  'Scheduled end': 'Planlı bitiş',
  'In progress': 'Sürüyor',
  'Magnet quench': 'Mıknatıs sönmesi (quench)',
  'Numerical failure': 'Sayısal hata',
  'Equilibrium failure': 'Denge hatası',
  'Bring elongation, triangularity and aspect ratio into the usual range, or run the shot at 0D fidelity.':
    'Uzamayı, üçgenselliği ve en-boy oranını olağan aralığa getirin ya da atışı 0D doğrulukta çalıştırın.',
  'This is a solver failure, not a plasma limit: try a coarser radial grid (nRho) or slower heating/density ramps, or run the shot at 0D fidelity.':
    'Bu bir çözücü hatasıdır, plazma sınırı değil: daha kaba bir radyal ağ (nRho) ya da daha yavaş ısıtma/yoğunluk rampaları deneyin veya atışı 0D doğrulukta çalıştırın.',
  // events
  'Scheduled end of shot': 'Atışın planlı sonu',
  'Plasma extinguished': 'Plazma söndü',
  'Ignition condition lost': 'Ateşleme koşulu kayboldu',
  'Q ≥ 1 (scientific breakeven)': 'Q ≥ 1 (bilimsel başabaş)',
  // warnings of the model summaries
  'Grad–Shafranov equilibrium did not fully converge — geometry coefficients may be inaccurate.':
    'Grad–Shafranov dengesi tam yakınsamadı — geometri katsayıları yanlış olabilir.',
  'MTF is far from net energy at these parameters (G≪1) — consistent with current experiments.':
    'MTF bu parametrelerde net enerjiden uzak (G≪1) — bugünkü deneylerle uyumlu.',
  'The Z-pinch is far from net energy at these parameters (G≪1) — consistent with current experiments.':
    'Z-pinch bu parametrelerde net enerjiden uzak (G≪1) — bugünkü deneylerle uyumlu.',
  'FRC is far from scientific breakeven at these parameters (Q≪1) — as expected: current FRC experiments do not yet produce net energy.':
    'FRC bu parametrelerde bilimsel başabaştan uzak (Q≪1) — beklendiği gibi: bugünkü FRC deneyleri henüz net enerji üretmiyor.',
  'Simple/tandem mirrors yield low Q due to the loss cone — net energy is not expected without flow shear or a deep potential barrier.':
    'Basit/tandem aynalar kayıp konisi yüzünden düşük Q verir — akış kayması ya da derin bir potansiyel bariyeri olmadan net enerji beklenmez.',
  'Muon-catalyzed fusion works at room/cold temperatures but remains at Q<1 due to α-sticking and muon production costs (a fundamental physics limit).':
    'Müon katalizli füzyon oda/soğuk sıcaklıklarda çalışır ama α-yapışması ve müon üretim maliyeti yüzünden Q<1 düzeyinde kalır (temel bir fizik sınırı).',
};

const L = Object.keys(LABELS).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const lbl = (s: string): string => LABELS[s] ?? s;
const PREFIX: Record<string, string> = { 'DISRUPTION': 'DİSRUPSİYON', 'DENSITY COLLAPSE': 'YOĞUNLUK ÇÖKÜŞÜ', 'RADIATIVE COLLAPSE': 'IŞIMALI ÇÖKÜŞ' };

const RULES: PhysicsRule[] = [
  // ---- terminations: the diagnosis of a scheduled end, of a disruption, of a quench, of the 1.5D solver failures
  [rx('The shot completed the scheduled duration of # (s|ns|µs)( without disruption)?\\.'),
    ([n, u, nd]) => `Atış, planlanan ${n} ${u} süreyi${nd ? ' disrupsiyon olmadan' : ''} tamamladı.`],
  [rx(`(${L}) — (.+), t = # s\\.(?: Thermal quench # ms, current quench # ms; halo current I_h/I_p·TPF = #; runaway electron avalanche e\\^# → ~# MA; wall deposition # MJ/m²\\.)? ?`),
    ([label, diag, t, tq, cq, halo, ef, ra, wall], tx) => `${lbl(label)} — ${tx(diag)}, t = ${t} s.` + (tq === undefined ? '' :
      ` Termal sönme ${tq} ms, akım sönmesi ${cq} ms; halo akımı I_h/I_p·TPF = ${halo}; kaçak elektron çığı e^${ef} → ~${ra} MA; duvara bırakılan enerji ${wall} MJ/m².`)],
  [rx('Peak field in the toroidal field coil B_coil = # T, (.+) has a limit of # T\\. The coil quenched; shot aborted\\.'),
    ([b, tech, lim]) => `Toroidal alan bobinindeki tepe alan B_coil = ${b} T; ${TECH[tech] ?? tech} için sınır ${lim} T. Bobin sönmeye geçti (quench); atış iptal edildi.`],
  [rx('No Grad–Shafranov equilibrium could be computed for the requested boundary \\(R = # m, a = # m, κ = #, δ = #\\): (.+)\\. The 1\\.5D model needs it for its transport geometry; shot aborted\\.'),
    ([R, a, k, d, detail]) => `İstenen sınır için Grad–Shafranov dengesi hesaplanamadı (R = ${R} m, a = ${a} m, κ = ${k}, δ = ${d}): ${detail}. 1.5D modelin taşınım geometrisi için buna ihtiyacı var; atış iptal edildi.`],
  [rx('The implicit transport solver could not advance the plasma: (.+)\\. The shot was stopped at the last accepted state rather than continued with a non-converged or non-finite one\\.'),
    ([e]) => `Örtük taşınım çözücüsü plazmayı ilerletemedi: ${e}. Atış, yakınsamamış ya da sonlu olmayan bir durumla sürdürülmek yerine son kabul edilen durumda durduruldu.`],

  // ---- disruption: the causes (diagnosis part) and the events
  [rx('n̄/n_G reached #'), ([x]) => `n̄/n_G oranı ${x} oldu`],
  [rx('β_N # > #'), ([x, l]) => `β_N ${x} > ${l}`],
  [rx('q95 = # < #'), ([x, l]) => `q95 = ${x} < ${l}`],
  [rx('c_W = # > #'), ([x, l]) => `c_W = ${x} > ${l}`],
  [rx('2/1 island w/a = # > 0\\.10 — mode locked to the wall'), ([x]) => `2/1 adası w/a = ${x} > 0,10 — mod duvara kilitlendi`],
  [rx('P_rad # MW > P_heat # MW, (⟨T_e⟩|T_e) fell to # keV'), ([r, h, te, x]) => `P_rad ${r} MW > P_heat ${h} MW, ${te} düştü: ${x} keV`],
  [rx('n/n_Sudo = # and P_rad > P_heat — radiative collapse \\(soft extinction, not a disruption\\)'),
    ([x]) => `n/n_Sudo = ${x} ve P_rad > P_heat — ışımalı çöküş (yumuşak sönme, disrupsiyon değil)`],
  [rx('n_e = # m⁻³ is below # % of the target # m⁻³, T_e # keV, T_i # keV, fuelling rate limit # × 10²⁰ s⁻¹'),
    ([n, f, tg, te, ti, fr]) => `n_e = ${n} m⁻³, hedef ${tg} m⁻³ değerinin %${f} eşiğinin altında, T_e ${te} keV, T_i ${ti} keV, yakıt besleme hızı sınırı ${fr} × 10²⁰ s⁻¹`],
  [rx(`(DISRUPTION|DENSITY COLLAPSE|RADIATIVE COLLAPSE): (${L}) — (.+)`), ([p, label, diag], tx) => `${PREFIX[p]}: ${lbl(label)} — ${tx(diag)}`],
  [rx('Thermal quench complete \\(# ms\\) → current quench starting'), ([x]) => `Termal sönme tamamlandı (${x} ms) → akım sönmesi başlıyor`],

  // ---- burn and confinement-mode events
  [rx('IGNITION: P_alpha # MW ≥ P_loss # MW'), ([a, l]) => `ATEŞLEME: P_alpha ${a} MW ≥ P_loss ${l} MW`],
  [rx('Ignition test: Q = # ≥ 5 — external heating ramping off over # s'), ([q, r]) => `Ateşleme testi: Q = ${q} ≥ 5 — dış ısıtma ${r} s içinde kapatılıyor`],
  [rx('L→H transition: P_L # MW > P_LH # MW'), ([a, b]) => `L→H geçişi: P_L ${a} MW > P_LH ${b} MW`],
  [rx('L→H transition: P_loss # MW > P_LH # MW — edge transport barrier forms'), ([a, b]) => `L→H geçişi: P_loss ${a} MW > P_LH ${b} MW — kenar taşınım bariyeri oluşuyor`],
  [rx('H→L back-transition: P_L # MW < 0\\.7·P_LH # MW — τ_E collapsed'), ([a, b]) => `H→L geri geçişi: P_L ${a} MW < 0,7·P_LH ${b} MW — τ_E çöktü`],
  [rx('H→L back-transition: P_loss # MW < 0\\.7·P_LH # MW — pedestal lost'), ([a, b]) => `H→L geri geçişi: P_loss ${a} MW < 0,7·P_LH ${b} MW — pedestal kayboldu`],

  // ---- ELM, sawtooth, NTM
  [rx('Type-I ELM: ΔW = # MJ'), ([x]) => `Tip-I ELM: ΔW = ${x} MJ`],
  [rx('Type-I ELM \\((p_ped/p_lim|α_ped/α_crit) = #\\): ΔW = # MJ(?:, # W_ped at ν\\*_ped = #(, capped)?)?'),
    ([c, cx, dw, f, nu, cap]) => `Tip-I ELM (${c} = ${cx}): ΔW = ${dw} MJ` + (f === undefined ? '' : `, ν*_ped = ${nu} iken ${f} W_ped${cap ? ', sınırlandı' : ''}`)],
  [rx('Sawtooth crash: ≈ #% of W redistributed from inside q = 1'), ([x]) => `Testere dişi çöküşü: W'nin ≈ %${x} kadarı q = 1 yüzeyinin içinden yeniden dağıldı`],
  [rx('Sawtooth crash \\(s₁ = #(?:, (.+?))?\\): ρ\\(q=1\\) = #, ρ_mix = #, T_e0 # → # keV(?:, q0 → #)?'),
    ([s1, why, r1, rm, t0, t1, q0]) => `Testere dişi çöküşü (s₁ = ${s1}${why ? `, ${why}` : ''}): ρ(q=1) = ${r1}, ρ_mix = ${rm}, T_e0 ${t0} → ${t1} keV${q0 ? `, q0 → ${q0}` : ''}`],
  [rx('Sawtooth-seeded NTM \\(3/2\\) started: thermal β_N = # — τ_E is degrading'), ([x]) => `Testere dişinin tohumladığı NTM (3/2) başladı: termal β_N = ${x} — τ_E bozuluyor`],
  [rx('NTM decayed: thermal β_N # below the marginal threshold'), ([x]) => `NTM söndü: termal β_N ${x} marjinal eşiğin altında`],
  [rx('NTM (3/2|2/1) island grew to w/a = # \\(thermal β_N = #\\) — local profile flattening, τ_E degrading'),
    ([m, w, b]) => `NTM ${m} adası w/a = ${w} değerine büyüdü (termal β_N = ${b}) — yerel profil düzleşmesi, τ_E bozuluyor`],
  [rx('NTM (3/2|2/1) island decayed'), ([m]) => `NTM ${m} adası söndü`],

  // ---- operating-limit warnings (events)
  [rx('Divertor heat flux # MW/m² > 10 MW/m² — material lifetime at risk'), ([x]) => `Divertör ısı akısı ${x} MW/m² > 10 MW/m² — malzeme ömrü risk altında`],
  // n_Sudo for the stellarator (the Sudo limit), n_G for the tokamak
  [rx('n̄/n_(G|Sudo) = # — approaching the density limit'), ([n, x]) => `n̄/n_${n} = ${x} — yoğunluk sınırına yaklaşılıyor`],
  [rx('β_N = # — approaching the Troyon limit'), ([x]) => `β_N = ${x} — Troyon sınırına yaklaşılıyor`],

  // ---- inertial and pinch methods
  [rx('Bang-time: IGNITION \\(χ_ig = # ≥ 1\\), hotspot # keV, ρR = # g/cm²'), ([x, t, r]) => `Bang-time: ATEŞLEME (χ_ig = ${x} ≥ 1), sıcak nokta ${t} keV, ρR = ${r} g/cm²`],
  [rx('Bang-time: NO ignition \\(χ_ig = # < 1\\) — low burn'), ([x]) => `Bang-time: ateşleme YOK (χ_ig = ${x} < 1) — düşük yanma`],
  [rx('Below the ignition threshold \\(χ_ig = # < 1\\): inadequate velocity, ρR, asymmetry, or roughness — low burn efficiency\\.'),
    ([x]) => `Ateşleme eşiğinin altında (χ_ig = ${x} < 1): yetersiz hız, ρR, asimetri ya da pürüzlülük — düşük yanma verimi.`],
  [rx('Low-mode asymmetry of #% is high — the hotspot degrades and yield drops\\.'), ([x]) => `Düşük modlu asimetri (%${x}) yüksek — sıcak nokta bozuluyor ve verim düşüyor.`],
  [rx('Stagnation: C = #, n = # m⁻³, T = # keV, B = # T'), ([c, n, t, b]) => `Durgunluk: C = ${c}, n = ${n} m⁻³, T = ${t} keV, B = ${b} T`],
  [rx('Instability reduced effective compression: CR # → # \\(jitter/flow shear\\)\\.'),
    ([a, b]) => `Kararsızlık etkin sıkıştırmayı azalttı: CR ${a} → ${b} (zamanlama sapması/akış kayması).`],

  // ---- report warnings (magnetic methods)
  [rx('TBR = # < 1\\.05 — this reactor cannot breed its own tritium\\.'), ([x]) => `TBR = ${x} < 1,05 — bu reaktör kendi trityumunu üretemez.`],
  [rx('Peak divertor heat flux # MW/m² > 10 MW/m² — target plates cannot withstand this; increase the divertor radiation fraction\\.'),
    ([x]) => `Divertörde tepe ısı akısı ${x} MW/m² > 10 MW/m² — hedef plakalar buna dayanamaz; divertör ışıma oranını artırın.`],
  [rx('TF coil stress # MPa > # MPa limit\\.'), ([x, l]) => `TF bobin gerilmesi ${x} MPa > ${l} MPa sınırı.`],
  [rx('CS flux swing # V s is # % of the # V s the pulse needs — the PF coils would have to supply more than # % of it; enlarge the solenoid, raise its field or give the PF flux \\(systems\\.cs\\.pfFlux_Vs\\)\\.'),
    ([sw, sh, req, max]) => `CS akı salınımı ${sw} V s; atışın ihtiyaç duyduğu ${req} V s akının %${sh} kadarı — PF bobinleri bunun %${max} değerinden fazlasını karşılamak zorunda kalır; solenoidi büyütün, alanını artırın ya da PF akısını verin (systems.cs.pfFlux_Vs).`],
  [rx('CS flux swing # V s is # % of the # V s the pulse needs, and with the # V s of the PF coils # % — enlarge the solenoid, raise its field or the PF flux \\(systems\\.cs\\.pfFlux_Vs\\)\\.'),
    ([sw, sh, req, pf, sh2]) => `CS akı salınımı ${sw} V s; atışın ihtiyaç duyduğu ${req} V s akının %${sh} kadarı, PF bobinlerinin ${pf} V s akısıyla birlikte %${sh2} kadarı — solenoidi büyütün, alanını ya da PF akısını artırın (systems.cs.pfFlux_Vs).`],
  [rx('Neutron damage # dpa/year — the first wall needs replacement within a few years\\.'), ([x]) => `Nötron hasarı ${x} dpa/yıl — birinci duvarın birkaç yıl içinde değiştirilmesi gerekir.`],
  [rx('Negative net electricity \\(# MW\\): Q_eng < 1, the plant draws power from the grid\\.'), ([x]) => `Net elektrik negatif (${x} MW): Q_eng < 1, santral şebekeden güç çeker.`],

  // ---- 1.5D model: equilibrium and step control
  [rx('Initial Grad–Shafranov equilibrium did not converge \\(residual # after # iterations\\) — used until the first accepted update'),
    ([r, n]) => `Başlangıç Grad–Shafranov dengesi yakınsamadı (kalıntı ${r}, ${n} yinelemeden sonra) — ilk kabul edilen güncellemeye kadar kullanıldı`],
  [rx('Initial Grad–Shafranov equilibrium did not converge \\(residual #\\) — it was used until the first accepted update( \\(there was none\\))?; geometry coefficients may be inaccurate\\.'),
    ([r, none]) => `Başlangıç Grad–Shafranov dengesi yakınsamadı (kalıntı ${r}) — ilk kabul edilen güncellemeye kadar kullanıldı${none ? ' (hiç güncelleme olmadı)' : ''}; geometri katsayıları yanlış olabilir.`],
  [rx('Grad–Shafranov update rejected \\((.+); # attempts\\) — geometry held at the equilibrium of t = # s, retried from t = # s'),
    ([why, n, t0, t1]) => `Grad–Shafranov güncellemesi reddedildi (${why}; ${n} deneme) — geometri t = ${t0} s dengesinde tutuldu, t = ${t1} s zamanından yeniden denenecek`],
  [rx('Grad–Shafranov update followed only # % of the change of the transport profiles: the equilibrium of the whole change did not converge \\(pressure and current tables at the limit of what the boundary can hold\\); the geometry lags the profiles by the rest — reported once, at t = # s'),
    ([f, t]) => `Grad–Shafranov güncellemesi taşınım profillerindeki değişimin yalnızca %${f} kadarını izledi: değişimin tamamının dengesi yakınsamadı (basınç ve akım tabloları sınırın taşıyabileceğinin eşiğinde); geometri kalanı kadar profillerin gerisinde — bir kez bildirildi, t = ${t} s`],
  [rx('Grad–Shafranov: # of # equilibrium updates were rejected \\(no equilibrium of the transport profiles was found, or its tables did not converge to its flux surfaces\\) — the transport geometry was held at the last accepted equilibrium in between\\.'),
    ([r, n]) => `Grad–Shafranov: ${n} denge güncellemesinden ${r} tanesi reddedildi (taşınım profillerinin dengesi bulunamadı ya da tabloları akı yüzeylerine yakınsamadı) — aradaki sürede taşınım geometrisi son kabul edilen dengede tutuldu.`],
  [rx('# transport step\\(s\\) exhausted the Δt retries and were forced at the smallest Δt without Picard convergence — accuracy is reduced around those times\\.'),
    ([n]) => `${n} taşınım adımı Δt denemelerini tüketti ve Picard yakınsaması olmadan en küçük Δt ile zorlandı — bu zamanlar çevresinde doğruluk düşük.`],
  [rx('Transport step at t = # s did not converge in # attempts; forced at Δt = # s \\(Picard not converged\\) — accuracy is reduced here'),
    ([t, n, dt]) => `t = ${t} s zamanındaki taşınım adımı ${n} denemede yakınsamadı; Δt = ${dt} s ile zorlandı (Picard yakınsamadı) — burada doğruluk düşük`],
  [rx('Numerical failure — (.+)'), ([e]) => `Sayısal hata — ${e}`],

  // ---- scenario triggers (info events)
  [rx("Scenario trigger '(.*?)' re-armed: (.+)"), ([l, rest]) => `Senaryo tetikleyicisi '${l}' yeniden kuruldu: ${rest}`],
  [rx("Scenario trigger '(.*?)': (.+)"), ([l, rest]) => `Senaryo tetikleyicisi '${l}': ${rest}`],
];

registerPhysicsRules('tr', { exact: EXACT, rules: RULES });
