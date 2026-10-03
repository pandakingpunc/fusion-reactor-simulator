/**
 * The keys of the shot report's `engineering` and `extras` blocks, with a label and a unit in English and Turkish.
 *
 * The physics writes those blocks as `Record<string, ...>` whose keys are English phrases with the unit inside ('B_coil (T)',
 * 'Cryo pulse length (s)'), and the run files, the JSON export, the CLI and the golden files carry them under exactly those
 * names, so the names stay as they are: this table is the one place where the interface looks them up. A key that is not in the
 * table (a new physics key) is shown as written, and src/ui/report/keys.test.ts fails when a key of the golden reports is
 * missing, so a lane that adds one adds its row here.
 *
 * `term` is the glossary entry (src/edu/glossary.ts) the label explains with an ⓘ popover.
 */
import type { Locale } from '../../i18n';

export interface ReportKeyInfo {
  /** label in English / Turkish (symbols are kept: they read the same in both) */
  en: string;
  tr: string;
  /** unit, empty for a dimensionless quantity */
  unit: string;
  /** unit in Turkish when it differs (dpa/year) */
  unitTr?: string;
  /** glossary term id */
  term?: string;
}

type Row = [key: string, en: string, tr: string, unit: string, extra?: { unitTr?: string; term?: string }];

const ROWS: Row[] = [
  // ---- magnet, first wall and economics (every magnetic configuration)
  ['B_coil (T)', 'Peak field at the coil, B_coil', 'Bobinde tepe alan, B_coil', 'T'],
  ['Technology B_max (T)', 'Field limit of the coil technology, B_max', 'Bobin teknolojisinin alan sınırı, B_max', 'T'],
  ['TF stress (MPa)', 'TF coil stress (inboard leg)', 'TF bobin gerilmesi (iç bacak)', 'MPa'],
  ['Stress limit (MPa)', 'Stress limit of the technology', 'Teknolojinin gerilme sınırı', 'MPa'],
  ['Magnetic energy (GJ)', 'Magnetic energy of the TF coils', 'TF bobinlerinin manyetik enerjisi', 'GJ'],
  ['Divertor q_max (MW/m²)', 'Divertor peak heat flux (prescribed radiation)', 'Divertör tepe ısı akısı (öngörülen ışınım)', 'MW/m²', { term: 'divertor' }],
  ['Neutron wall load (MW/m²)', 'Neutron wall load', 'Nötron duvar yükü', 'MW/m²', { term: 'wallLoad' }],
  ['dpa/year', 'Displacement damage rate', 'Yer değiştirme hasar hızı', 'dpa/year', { unitTr: 'dpa/yıl' }],
  ['TBR', 'Tritium breeding ratio (TBR)', 'Trityum üretim oranı (TBR)', ''],
  ['Tritium burn fraction', 'Tritium burn fraction', 'Trityum yanma oranı', ''],
  ['Avg. P_fusion (MW)', 'Mean fusion power', 'Ortalama füzyon gücü', 'MW'],
  ['P_thermal (MW)', 'Thermal power', 'Isıl güç', 'MW'],
  ['Gross P_electric (MW)', 'Gross electric power', 'Brüt elektrik gücü', 'MW'],
  ['P_recirculating (MW)', 'Recirculating power', 'Geri devirli güç', 'MW'],
  ['Net P_electric (MW)', 'Net electric power', 'Net elektrik gücü', 'MW', { term: 'qEng' }],
  ['Capital cost (M$)', 'Capital cost', 'Yatırım maliyeti', 'M$'],
  ['LCOE ($/MWh)', 'Levelised cost of electricity (LCOE)', 'Seviyelendirilmiş elektrik maliyeti (LCOE)', '$/MWh'],
  ['EROI', 'Energy return on investment (EROI)', 'Yatırılan enerjinin geri dönüşü (EROI)', ''],
  // ---- edge model (two-point divertor chain, tokamaks)
  ['P_sep/R (MW/m)', 'Separatrix power over major radius, P_sep/R', 'Ayrım yüzeyi gücü / büyük yarıçap, P_sep/R', 'MW/m', { term: 'divertor' }],
  ['Target T_e, two-point (eV)', 'Target electron temperature (two-point model)', 'Hedefte elektron sıcaklığı (iki nokta modeli)', 'eV', { term: 'divertor' }],
  ['Target q_peak, two-point (MW/m²)', 'Peak target heat flux (two-point model)', 'Hedefte tepe ısı akısı (iki nokta modeli)', 'MW/m²', { term: 'divertor' }],
  ['Detachment state', 'Divertor detachment', 'Divertör ayrılma durumu', '', { term: 'divertor' }],
  ['c_z for detachment, Lengyel upper bound (%)', 'Seed concentration for detachment (Lengyel upper bound)', 'Ayrılma için gereken katkı derişimi (Lengyel üst sınırı)', '%'],
  // ---- systems-lite (TF coil, central solenoid flux, radial build, cryoplant)
  ['TF coils', 'Number of TF coils', 'TF bobin sayısı', ''],
  ['TF winding pack J (MA/m²)', 'TF winding-pack current density', 'TF sargı paketi akım yoğunluğu', 'MA/m²'],
  ['TF case Tresca (MPa)', 'TF case, Tresca stress', 'TF kasası, Tresca gerilmesi', 'MPa'],
  ['TF winding pack Tresca (MPa)', 'TF winding pack, Tresca stress', 'TF sargı paketi, Tresca gerilmesi', 'MPa'],
  ['TF stress margin', 'TF stress margin', 'TF gerilme payı', ''],
  ['TF vertical tension per coil (MN)', 'TF vertical tension per coil', 'Bobin başına TF dikey çekme kuvveti', 'MN'],
  ['TF mass (t)', 'Mass of the TF coils', 'TF bobinlerinin kütlesi', 't'],
  ['CS flux swing (V s)', 'Central-solenoid flux swing', 'Merkezi solenoid akı salınımı', 'V·s'],
  ['CS flux budget', 'Central-solenoid flux budget', 'Merkezi solenoid akı bütçesi', ''],
  ['Flux required (V s)', 'Flux the pulse needs', 'Atımın gerektirdiği akı', 'V·s'],
  ['Flux margin', 'Flux margin', 'Akı payı', ''],
  ['Flux-limited flat top (s)', 'Flat-top length the flux allows', 'Akının izin verdiği düz tepe süresi', 's'],
  ['TF nuclear heating (kW)', 'Nuclear heating of the TF coils', 'TF bobinlerinin nükleer ısınması', 'kW'],
  ['Cryo heat load (kW)', 'Cryogenic heat load', 'Kriyojenik ısı yükü', 'kW'],
  ['Cryoplant power (MW)', 'Cryoplant electric power', 'Kriyojenik tesisin elektrik gücü', 'MW'],
  ['Cryo pulse length (s)', 'Pulse length used for the cryoplant', 'Kriyojenik tesis için alınan atım süresi', 's'],
  ['Inboard blanket (m)', 'Inboard blanket thickness', 'İç taraftaki blanket kalınlığı', 'm'],
  ['Inboard shield+vessel (m)', 'Inboard shield and vessel thickness', 'İç taraftaki zırh ve vakum kabı kalınlığı', 'm'],
  // ---- 1.5D profile model
  ['Model', 'Model', 'Model', ''],
  ['Bootstrap fraction (avg.)', 'Bootstrap current fraction (mean)', 'Bootstrap akım oranı (ortalama)', '', { term: 'bootstrap' }],
  ['Driven-current fraction (avg.)', 'Driven-current fraction (mean)', 'Sürülen akım oranı (ortalama)', ''],
  ['Loop voltage (avg., V)', 'Loop voltage (mean)', 'Çevrim gerilimi (ortalama)', 'V'],
  ['ℓ_i(3) (avg.)', 'Internal inductance ℓ_i(3) (mean)', 'İç indüktans ℓ_i(3) (ortalama)', ''],
  ['β_p (avg.)', 'Poloidal beta β_p (mean)', 'Poloidal beta β_p (ortalama)', ''],
  ['q(0) / q95 (final)', 'Safety factor q(0) / q95 (final)', 'Güvenlik çarpanı q(0) / q95 (son)', '', { term: 'q95' }],
  ['Shafranov shift (m)', 'Shafranov shift', 'Shafranov kayması', 'm'],
  ['GS updates accepted', 'Grad–Shafranov updates accepted', 'Kabul edilen Grad–Shafranov güncellemeleri', ''],
  ['GS updates needing a retry', 'Grad–Shafranov updates that needed a retry', 'Yeniden deneme gerektiren Grad–Shafranov güncellemeleri', ''],
  ['GS updates rejected', 'Grad–Shafranov updates rejected', 'Reddedilen Grad–Shafranov güncellemeleri', ''],
  ['Forced transport steps', 'Forced transport steps', 'Zorlanan taşınım adımları', ''],
  ['Transport steps (accepted / rejected by the error test)', 'Transport steps (accepted / rejected by the error test)', 'Taşınım adımları (kabul / hata sınamasında reddedilen)', ''],
  ['Newton iterations / Jacobians / Picard fallbacks', 'Newton iterations / Jacobians / Picard fallbacks', 'Newton yinelemeleri / Jacobian sayısı / Picard’a dönüşler', ''],
  // predictive transport (bgb, ifspppl): the confinement the closure arrives at, against the H-mode scalings
  ['Emergent τ_E (flat-top mean, s)', 'Emergent energy confinement time τ_E (flat-top mean)', 'Ortaya çıkan enerji hapsetme süresi τ_E (düz tepe ortalaması)', 's', { term: 'tauE' }],
  ['Emergent H98(y,2) (flat-top mean)', 'Emergent confinement factor H98(y,2) (flat-top mean)', 'Ortaya çıkan hapsetme çarpanı H98(y,2) (düz tepe ortalaması)', '', { term: 'h98' }],
  ['Emergent H(ITPA20) (flat-top mean)', 'Emergent confinement factor against ITPA20 (flat-top mean)', 'ITPA20 ölçeklemesine göre ortaya çıkan hapsetme çarpanı (düz tepe ortalaması)', ''],
  // profile-resolved impurities (impurityTransport)
  ['Impurity transport', 'Impurity transport', 'Safsızlık taşınımı', ''],
  ['He ash fraction n_He/n_e (avg.)', 'Helium ash fraction n_He/n_e (mean)', 'Helyum külü oranı n_He/n_e (ortalama)', '', { term: 'heAsh' }],
  ['He ash fraction on axis (final)', 'Helium ash fraction on axis (final)', 'Eksende helyum külü oranı (son)', '', { term: 'heAsh' }],
  // ---- extras of the magnetic reports
  ['He ash fraction (final)', 'Helium ash fraction (final)', 'Helyum külü oranı (son)', '', { term: 'heAsh' }],
  ['Z_eff (final)', 'Effective charge Z_eff (final)', 'Etkin yük Z_eff (son)', '', { term: 'zeff' }],
  ['ELM count', 'ELM count', 'ELM sayısı', '', { term: 'elm' }],
  ['Sawtooth count', 'Sawtooth count', 'Testere dişi sayısı', '', { term: 'sawtooth' }],
  ['T_e axis (final, keV)', 'Axis electron temperature T_e (final)', 'Eksende elektron sıcaklığı T_e (son)', 'keV'],
  ['T_ped (final, keV)', 'Pedestal-top temperature T_ped (final)', 'Kaide tepesi sıcaklığı T_ped (son)', 'keV', { term: 'pedestal' }],
  ['T_sep (final, keV)', 'Separatrix temperature T_sep (final)', 'Ayrım yüzeyi sıcaklığı T_sep (son)', 'keV'],
  ['ELM frequency (Hz)', 'ELM frequency', 'ELM sıklığı', 'Hz', { term: 'elm' }],
  ['Sawtooth period (s)', 'Sawtooth period', 'Testere dişi periyodu', 's', { term: 'sawtooth' }],
  ['ELM count (1.5D)', 'ELM count (1.5D model)', 'ELM sayısı (1.5D model)', '', { term: 'elm' }],
  // ---- inertial fusion
  ['Gain G', 'Target gain G', 'Hedef kazancı G', '', { term: 'icfGain' }],
  ['ρR (g/cm²)', 'Areal density ρR', 'Yüzey yoğunluğu ρR', 'g/cm²'],
  ['Ignition χ_ig', 'Ignition parameter χ_ig', 'Ateşleme parametresi χ_ig', ''],
  ['Hotspot T (keV)', 'Hotspot temperature', 'Sıcak nokta sıcaklığı', 'keV'],
  ['Coupling', 'Driver coupling', 'Sürücü eşleşmesi', '', { term: 'hohlraum' }],
  ['Laser (MJ)', 'Laser energy', 'Lazer enerjisi', 'MJ'],
  ['Ignited', 'Ignited', 'Ateşlendi mi', ''],
  ['Burn-up parameter H_B (g/cm²)', 'Burn-up parameter H_B', 'Yanma parametresi H_B', 'g/cm²'],
  ['Energy per reaction (MeV)', 'Energy released per reaction', 'Tepkime başına açığa çıkan enerji', 'MeV'],
  ['Convergence ratio (CR)', 'Convergence ratio (CR)', 'Yakınsama oranı (CR)', ''],
  ['Adiabat α', 'Fuel adiabat α', 'Yakıt adiyabatı α', '', { term: 'adiabat' }],
  ['Implosion velocity (km/s)', 'Implosion velocity', 'Çökme hızı', 'km/s'],
  // ---- field-reversed configuration, mirror
  ['Volume (m³)', 'Plasma volume', 'Plazma hacmi', 'm³'],
  ['External field B_e (T)', 'External field B_e', 'Dış alan B_e', 'T'],
  ['Final τ_E (ms)', 'Final energy confinement time τ_E', 'Son enerji hapsetme süresi τ_E', 'ms', { term: 'tauE' }],
  ['n_0 (1e20 m⁻³)', 'Initial density n_0', 'Başlangıç yoğunluğu n_0', '10²⁰ m⁻³'],
  ['NBI power (MW)', 'Neutral-beam power', 'Nötr demet gücü', 'MW', { term: 'nbi' }],
  ['β (FRC)', 'Beta of the FRC', 'FRC betası', ''],
  ['Central B (T)', 'Field at the centre', 'Merkezdeki alan', 'T'],
  ['Mirror ratio', 'Mirror ratio', 'Ayna oranı', ''],
  ['Tandem', 'Tandem mirror (end plugs)', 'Tandem ayna (uç tıkaçları)', ''],
  ['End loss dominant', 'End losses dominate', 'Baskın kayıp uçlardan', ''],
  ['Auxiliary power (MW)', 'Auxiliary heating power', 'Yardımcı ısıtma gücü', 'MW'],
  // ---- magnetised-target fusion
  ['Initial radius r0 (mm)', 'Initial radius r₀', 'Başlangıç yarıçapı r₀', 'mm'],
  ['Compression CR (nominal)', 'Compression ratio (nominal)', 'Sıkıştırma oranı (anma)', ''],
  ['Compression CR (effective)', 'Compression ratio (effective)', 'Sıkıştırma oranı (etkin)', ''],
  ['Driver current (MA)', 'Driver current', 'Sürücü akımı', 'MA'],
  ['Driver energy (MJ)', 'Driver energy', 'Sürücü enerjisi', 'MJ'],
  ['Preheat (kJ)', 'Laser preheat', 'Lazer ön ısıtması', 'kJ'],
  ['Compression time (µs)', 'Compression time', 'Sıkıştırma süresi', 'µs'],
  ['Flow shear', 'Sheared-flow fraction', 'Kayma akışı oranı', ''],
  // ---- muon-catalysed fusion
  ['Fusions / muon', 'Fusions per muon', 'Müon başına füzyon', ''],
  ['α-sticking probability', 'α-sticking probability', 'α-yapışma olasılığı', ''],
  ['Muon cost (GeV)', 'Energy cost of a muon', 'Bir müonun enerji maliyeti', 'GeV'],
  ['Operating temperature (K)', 'Operating temperature', 'Çalışma sıcaklığı', 'K'],
  ['Why Q<1?', 'Why Q < 1?', 'Neden Q < 1?', ''],
  ['Status', 'Status', 'Durum', ''],
];

const TABLE = new Map<string, ReportKeyInfo>(ROWS.map(([key, en, tr, unit, x]) => [key, { en, tr, unit, ...x }]));

/** Every key the table knows (tests compare it with the keys of the golden reports). */
export function knownReportKeys(): string[] { return [...TABLE.keys()]; }

/** The row of a report key, or undefined for a key the physics added and this table has not caught up with. */
export function reportKeyInfo(key: string): ReportKeyInfo | undefined { return TABLE.get(key); }

/** What the interface shows for a key: the label and the unit in the language, and the glossary term. An unknown key is its own label. */
export function describeReportKey(key: string, locale: Locale): { label: string; unit: string; term?: string } {
  const r = TABLE.get(key);
  if (!r) return { label: key, unit: '' };
  return { label: locale === 'tr' ? r.tr : r.en, unit: locale === 'tr' ? r.unitTr ?? r.unit : r.unit, ...(r.term ? { term: r.term } : {}) };
}

/** English phrases the physics writes as VALUES of the report (not numbers), with their Turkish text */
const VALUES_TR: Record<string, string> = {
  attached: 'bağlı',
  'partially detached': 'kısmen ayrılmış',
  detached: 'ayrılmış',
  'n/a': 'yok',
  'n/a (net<0)': 'yok (net < 0)',
  'n/a (> 100 %)': 'yok (> % 100)',
  '1.5D profiles + Grad–Shafranov': '1.5D profiller + Grad–Shafranov',
  'profiles, anomalous': 'profiller, anomal',
  'profiles, anomalous + FACIT neoclassical': 'profiller, anomal + FACIT neoklasik',
  'not evaluated: no systems.cs block (the solenoid of this design is not given)': 'değerlendirilmedi: systems.cs bloğu yok (bu tasarımın solenoidi verilmemiş)',
  '~1 (high-β configuration)': '~1 (yüksek-β konfigürasyonu)',
  'yes (loss cone)': 'evet (kayıp konisi)',
  'α-sticking consumes muons (~0.5%/cycle) + muon production is expensive (~5 GeV)': 'α-yapışması müonları tüketir (~%0,5/çevrim) ve müon üretimi pahalıdır (~5 GeV)',
  'No net energy production under known physics (easter egg)': 'Bilinen fizikle net enerji üretimi yok (sürpriz yumurta)',
};

/**
 * A string value of the report in the language: the exact phrases of the table, and the patterned ones ('hohlraum 15%', 'direct 80%',
 * '≥ 3.20 (> 100 % in 40 % of the flat top)'). Anything else (numbers written as text, 'q(0) / q95' pairs) is returned as it is.
 */
export function describeReportValue(value: string, locale: Locale): string {
  if (locale !== 'tr') return value;
  const exact = VALUES_TR[value];
  if (exact !== undefined) return exact;
  let m = /^(hohlraum|direct) (\d+)%$/.exec(value);
  if (m) return `${m[1] === 'hohlraum' ? 'hohlraum' : 'doğrudan'} %${m[2]}`;
  m = /^≥ ([\d.]+) \(> 100 % in (\d+) % of the flat top\)$/.exec(value);
  if (m) return `≥ ${m[1]} (düz tepenin %${m[2]}’sinde > %100)`;
  return value;
}
