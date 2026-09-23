# Changelog

Biçim [Keep a Changelog](https://keepachangelog.com/) esinlidir; sürümler [SemVer](https://semver.org/) izler.

## [3.0.0] — 2026-09-23

### Eklendi
- **1.5D profil modeli** (`fidelity: '1.5D'`, tokamak ve sferik tokamak): ρ̂ = √(Φ/Φ_b) üzerinde
  T_e, T_i, n_e ve poloidal akı için örtük sonlu-hacim çözücüleri (geri Euler + Picard, T_e/T_i
  2×2 blok üçlü-köşegen, Scharfetter–Gummel yoğunluk akısı, I_p sınır koşullu akım difüzyonu),
  uyarlanır zaman adımı; τ_E-ölçekli taşınım (PI denetleyici) ve kritik-gradyan alternatifi;
  ETB/KBM pedestal, neoklasik iyon tabanı, NTM ada taşınımı.
- **Grad–Shafranov denge çözücüsü** (`src/physics/equilibrium/`): Miller sınırı, Shortley–Weller
  sonlu farklar, bantlı LU, Picard; 'shape' ve 'table' profil modları; akı yüzeyi izleme, tam
  tuzaklı-parçacık oranı, q, ℓ_i(3), β_p, β_N; Cerfon–Freidberg Solov'ev analitik çözümleri
  (simetrik ve tek-null X-noktalı) ile doğrulama.
- Sauter bootstrap akımı/iletkenliği, 3-bileşenli NBI demet zayıflaması + demet-hedef füzyonu
  tablosu, ECRH/ICRH birikimi, NBCD/ECCD; iki-nokta SOL (Eich λ_q) sınır sıcaklığı.
- MHD olayları: Kadomtsev testere dişi (kayma tetikli, korunumlu düzleştirme), tip-I ELM
  (α_crit, bekleme süresi), modifiye Rutherford NTM (testere dişi tohumlu), L–H histerezisi;
  `crashHook` ile çöküş öncesi/sonrası profil anlık görüntüleri.
- 1.5D preset'ler: ITER, JET DTE2, SPARC, EU DEMO.
- **Sayısal kütüphane** (`src/physics/numerics/`): Thomas, 2×2 blok üçlü-köşegen, bantlı LU,
  Gauss–Legendre, kübik spline, PCHIP, bikübik (Hermite), Brent; sabit adımlı RK4/Euler (karşılaştırma).
- **Çizim motoru** (`src/plot/`): SVG ve PDF 1.4 çıktısı, mini-TeX etiketler, kontur, renk
  haritaları, Okabe–Ito paleti; **makale figürleri** (`npm run figures`, 9 figür + altyazılar).
- **Çok çekirdekli yürütme**: `worker_threads` havuzu; `npm run validate` paralel (`--threads`,
  `--only`), 19 literatür ölçütü (8'i 1.5D).
- Arayüz: sihirbazda model seçimi ve 1.5D ayarları, canlı radyal profil grafiği, GS akı yüzeyli
  poloidal kesit, rapordan SVG/PDF figür dışa aktarımı (tembel yüklenir), ITER 1.5D doğrulama testi.
- Testler: 44 birim testi (numerics, equilibrium, profiles, plot/POPCON, report).
- `CHANGELOG.md`; teknik rapor v3.0 (denklemler, sayısal yöntemler, doğrulama, figürler).

### Değişti
- **POPCON** artık 0D modelle aynı fiziği kullanır (yakıt seyrelmesi, öz-tutarlı He külü, çizgi
  ve senkrotron ışınımı, P_loss = P_heat − P_rad); eski basit sürüm ITER'de gerçekçi olmayan
  geniş bir ateşlenmiş bölge gösteriyordu. Arayüz ve figür aynı hesabı paylaşır.
- 0D manyetik modelin rapor üretimi `confinement/magneticReport.ts`'e taşındı (0D/1.5D ortak).
- `Simulation`, kendi zaman adımlayıcısı olan modelleri (`model.step`) destekler; profiller
  yalnız düzenli çıktı karelerine eklenir (bellek sınırı).
- Shafranov kayması, LCFS'nin geometrik merkezine (R_max + R_min)/2 göre tanımlanır.

### Düzeltildi
- Sihirbazdaki desteklenmeyen safsızlık seçenekleri (N, Fe) kaldırıldı — fizik modülü yalnız
  Be, C, Ne, Ar, W (tohum: Ne, Ar) içeriyordu ve bu seçimler çökmeye yol açıyordu.
- Kontur birleştirmede sıfır uzunluklu parçalar; eksen işaretlerinde kayan nokta birikimi.
- Bosch–Hale kaynak künyesi (*Nucl. Fusion* **32** (1992) 611).

## [2.0.0] — 2026-09-05
- İngilizce arayüz ve rapor düzeltmeleri.

## [0.1.0] — 2026-09-02
- İlk yayın: 0D fizik motoru + web arayüzü.
