# Füzyon Reaktörü Simülatörü — Teknik rapor (v4.0.0)

**Yazar:** Mustafa Karatum, Independent researcher (bağımsız araştırmacı)
**Yayın tarihi:** 2026-10-01
**Lisans:** MIT
**Kavram DOI:** [10.5281/zenodo.22259861](https://doi.org/10.5281/zenodo.22259861)
**Sürüm DOI (4.0.0):** [10.5281/zenodo.23100241](https://doi.org/10.5281/zenodo.23100241)
**Sürüm DOI (4.1.0):** [10.5281/zenodo.23121818](https://doi.org/10.5281/zenodo.23121818)
**English:** [technical-report.md](../technical-report.md)

## 1. Kapsam ve model katmanları

Simülatör, zamana bağlı senaryo incelemesi için indirgenmiş bir araştırma ve eğitim aracıdır. Tarayıcıda, başsız TypeScript kütüphanesiyle, `fusion-sim` komut satırından ve Python alt süreç sarmalayıcısıyla çalışır. Manyetik 0D model, hacim ortalamalı enerji, bileşim ve akımı uyarlanır Dormand–Prince yöntemiyle ilerletir. Ayrı indirgenmiş 0D aileler stellarator, ataletsel füzyon, manyetize hedef, FRC, ayna ve müon katalizli füzyonu kapsar. Radyal 1.5D model yalnız tokamak ve küresel tokamakta kullanılabilir.

1.5D `ProfileModel`, elektron/iyon sıcaklıklarını, elektron yoğunluğunu ve poloidal akıyı; ayrıca skaler envanterleri ve isteğe bağlı safsızlık/hızlı iyon alanlarını ilerletir. `Simulation`, adımları, olay geçmişini, kontrolleri, kontrol noktalarını ve yeniden oynatmayı yönetir. Kaynak, taşınım ve olay modülleri ortak bağlamı kullanır ve kontrol noktalarına katılır. Bu bir reaktör tasarım kodu, serbest sınırlı denge çözücüsü veya bütünleşik türbülans/MHD hesabı değildir. Tasarım değerleri deney ölçümü değil, karşılaştırma hedefidir. Kodun dışarıdan verilmiş bir plazma fiziği onayı yoktur.

## 2. Sıfır boyutlu güç dengesi

Depolanan ısıl enerji `W = (3/2) ∫ (n_e T_e + n_i T_i) dV` biçimindedir; enerji hesabında sıcaklıklar keV'den joule'e çevrilir. Elektron/iyon alışverişi toplam dengede birbirini götürür. Füzyon kanalları Bosch–Hale reaktivitelerini, kanala özgü yakıt çift yoğunluklarını ve reaksiyon enerjilerini kullanır. Alfa ve enjekte edilen demet hızlı iyon enerjileri ayrı havuzlardır: demet gücü alfa gücü olarak yazılmaz. D-D, D-T ve D-3He ürünleri, yakıt tüketimi ve helyum külü ayrı hesaplanır.

```
dW/dt = P_heat − P_rad − P_transport − P_event
P_L = P_heat − P_rad,core − dW/dt
tau_E = W / P_L
Q = P_fusion / P_external
```

Hapsetme ve L–H eşiği bağıntıları çizgi ortalamalı yoğunluğu, parçacık envanteri hacim ortalamalı yoğunluğu kullanır. IPB98(y,2), ITER89-P ve stellarator ISS04 kendi geçerlilik alanları olan deneysel ölçeklemelerdir. Radyasyon bremsstrahlung, çizgi soğuması ve senkrotron yaklaşımlarını birleştirir. NBI yavaşlaması ve demet-hedef füzyonu indirgenmiştir; RF birikimi ışın izlemez. Isıtma programı ve tutuşma testi, dışarıdan sürdürülen yanmayı alfa ısıtmasıyla sürdürülen yanmadan ayırır.

Yoğunluk denetleyicisinde ileri besleme, geri besleme, sonlu eyleyici yanıtı ve integral doyum önleme vardır. Greenwald sınırı yakınında tohumlu stokastik sınırlayıcı etkindir. Yoğunluk hedefi bir girdidir; parçacık taşınımının öngörüsü değildir ve sınır yakınındaki sonuç tohuma bağlıdır. Kaynaklar hesaplanmadan yakıt oranları ve yük nötrlüğü uygulanır. Bağıntıların türetimleri [yapılandırma başvurusundan](../config-reference.md) ve modül başlıklarından izlenebilir.

## 3. Radyal taşınım, zaman integrasyonu ve akım difüzyonu

Radyal koordinat `rho = sqrt(Phi/Phi_b)`, dönüşüm `dPhi = 2 pi q dpsi` biçimindedir. Akı yüzeyi geometrisi `V' = dV/drho`, gradyan metrikleri ve tuzaklı parçacık oranını sağlar. Korunumlu parçacık denklemi:

```
∂n_e/∂t = −(1/V') ∂Γ/∂rho + S_n
Γ = V' (−g1 D ∂n_e/∂rho + <|∇rho|> v n_e)
```

Isı iletimi yüzeylerde `V' g1 n_s chi_s ∂T_s/∂rho`, taşınan entalpi parçacık akısını kullanır. Yerel kaynaklar elektron/iyon alışverişi, ohmik ısıtma, füzyon ürünleri, zayıflayan çok enerjili NBI, Gauss RF birikimi ve radyasyondur. Eksen simetrisi sıfır akı verir. İndirgenmiş iki nokta SOL modeli separatriks sıcaklığını, belirlenen kenar bağıntısı yoğunluğu verir. Kenar akı gradyanı programlanan plazma akımını taşır.

Sonlu hacim hücreleri pedestal yönünde sıklaştırılır. Yüzey gradyanında gerçek uzaklıklar, integrallerde hücre hacimleri, interpolasyonda komşu ağırlıkları kullanılır; sıklaştırılmış yolda düzgün ızgara aralığı kullanılamaz. Varsayılan ölçekleme taşınımı, difüzivitesini PI denetleyicisiyle `W = tau_scal P_L` hedefine çeker. Dolayısıyla hapsetme ölçeklemesiyle uyum kısmen dayatılmıştır. İsteğe bağlı öngörücü kapanışlar bu normalizasyonu kaldırır ve ortaya çıkan H98'i raporlar.

Isı ve akım aşamaları ikinci dereceden L-kararlı TR-BDF2, yoğunluk aşaması Scharfetter–Gummel akılı geri Euler kullanır. Bağlı aşamalar Anderson hızlandırmalı Picard veya öngörücü kapanışlar için renklendirilmiş Jacobian ile sönümlü Newton çözümü kullanır. Ölçekli gömülü hata tahmini adımı denetler; sayısal sorunlarda daha küçük adım denenir. Yeniden deneme dizisi sonundaki sonlu zorlanmış kabul işaretlenir; çözülmeyen sorun atışı bitirir. Programlama istisnaları atomik geri alma sonrasında üst katmana iletilir. ELM ve testere dişi eşik geçişleri adım içinde konumlandırılır; olaylar çıktı çerçevesine ertelenmez.

Akım difüzyonu hareketli koordinat terimini içeren Hinton–Hazeltine biçimindedir; eski sabit metrik yaklaşımı değildir. Sauter iletkenlik/bootstrap katsayıları varsayılan, Redl isteğe bağlıdır. Her aşamanın sonundaki plazma akımı kenar koşulunu verir. Sınır döngü gerilimi, dirençsel ve endüktif akı ayrı kaydedilir. Tam ayrık denklemler, çözücü sabitleri ve başarısızlık davranışı [profiles/README.md](../../src/physics/profiles/README.md) içindedir.

## 4. Sabit sınırlı denge ve korunumlu bağlaşım

```
Δ*psi = R ∂R(R⁻¹ ∂Rpsi) + ∂²Zpsi = −mu0 R² p'(psi) − F F'(psi)
R_LCFS(theta) = R0 + a cos(theta + asin(delta) sin(theta))
Z_LCFS(theta) = kappa a sin(theta)
```

Grad–Shafranov çözücüsü Miller sınırı, Shortley–Weller sınır uzaklıklarıyla sonlu farklar, bantlı LU ve gevşetmeli Picard kullanır. Biçim kipinde parametrik kaynaklar; tablo kipinde taşınımdan basınç ve akım kullanılır. Toplam plazma akımı `FF'` kaynağıyla eşlenirken basınç katkısı korunur. Yüzey izleme hacim, akı, q, manyetik ortalamalar ve tuzaklı oranı sağlar. Denge sabit sınırlı ve yarı statiktir; dış bobinler ve düşey kontrol dinamiği çözülmez.

Güncellemeler geçen benzetim süresine ve basınç, iç endüktans veya plazma akımı değişimine yanıt verir. Dış tutarlılık döngüsü geometri ile kaynak profillerini uzlaştırır. Yeni denge kabulünde türler ve ısıl/hızlı iyon enerji envanterleri hücre hacimleriyle eşlenir; geometri yalnız bütün güncelleme başarıyla bitince benimsenir. Akı hesabının anlamı korunur. Başarısız veya iptal edilen askıdaki iş, durumu, bağlaşım önbelleklerini, modülleri ve RNG'yi geri alır. [Şekil 1](../figures/fig01_equilibrium.svg) kendi şekil koşusundaki dengeyi gösterir; küresel değerleri golden düz tepe ortalamasıyla aynı olmak zorunda değildir. [Şekil 2](../figures/fig02_profiles.svg) radyal profilleri gösterir. G-EQDSK dışa aktarımı sabit sınırlı çözümü taşır.

## 5. MHD olayları ve geçerlilik sınırları

Testere dişi karışımı `psi*(rho) ∝ ∫ (1/q − 1) 2 rho drho` helisel akı integralini kullanır. Karışım yarıçapı, en dış q<1 aralığının ardından integral pozitifse eksen referansına ilk dönüşüdür. Karışım yarıçapı yok işareti sınırlıdır ve ızgara boyutuna bağlı değildir. Sıcaklık/yoğunluk düzleşmesi ilgili enerji ve parçacıkları korur.

Kadomtsev yeniden bağlanması q0<1 çekirdeği ve tek q=1 yüzeyini varsayar. Çukur q çekirdeğinde integral yarıçapı fiziksel yeniden bağlanma çözümü değil, model uzlaşımıdır. Helisel akı sıfırlaması böyle profilleri reddeder; Porcelli tetikli çöküş eski q yeniden kurma yoluna dönebilir. Temel ITER15 çöküşlerinin tamamı çukur çekirdekte oluşur; MASTU15-saw'ın bir kısmı da yedek yolu kullanır. Bu zamanlamalar doğrulanmış değildir. Çok küçük pozitif helisel akı lobu bile tam model çöküşü verebilir.

ELM indirgenmiş pedestal gradyanıyla tetiklenir. İsteğe bağlı Loarte kapanışı kaybı çöküş öncesi bileşimden hesaplar; deneme değerlendirmesi durumu değiştirmez ve kabul edilen kayıp gerçek envanterden ölçülür. NTM modifiye Rutherford denklemini izler ve ada boyunca taşınımı düzleştirir. Yüzey kontrol aralığı örtüşme ağırlıkları düzleşen fiziksel genişliği radyal çözünürlükten bağımsız tutar. ECCD bastırması indirgenmiştir; doğrusal olmayan dirençsel MHD değildir. [Şekil 8](../figures/fig08_mhd.svg) olayları gösterir; karışım bölgesi yukarıdaki uzlaşımla ve [şekil açıklamalarıyla](../figures/captions.md) birlikte okunmalıdır.

## 6. İsteğe bağlı fizik modülleri

<!-- table: modules -->
| Anahtar | Varsayılan / isteğe bağlı | Örnek golden |
| --- | --- | --- |
| `transportModel` | `scaling` / `cgm`, `bgb`, `ifspppl` | ITER15-bgb, JET15-ifspppl |
| `neoclassicalModel` | `sauter` / `redl` | SPARC15-redl |
| `pedestalModel`, `elmLoss` | `fixed` / `eped1`, `loarte` | ITER15-EPED |
| `impurityTransport` | `legacy` / `anomalous`, `facit` | ITER15-impurity, ITER15-impurity-neo |
| `fastIonModel`, `cdModel` | `scalar`, `legacy` / `profile`, `physics` | JET15-fast, DIIID15-eccd |
| `sawtoothTrigger`, `sawtoothReconnection` | `shear`, `legacy` / `porcelli`, `kadomtsev` | MASTU15-saw |

Bu anahtarlar varsayılan olarak etkin değildir. Golden durumları ve bütünleşme testleri, temsilî birleşimlerde etkinleşme ve hesap tutarlılığını gösterir; tüm birleşimlerde fiziksel öngörü doğruluğunu göstermez. EPED1 türü başlangıç ve sıcaklık belirtilen hedefi kaçırır. Bohm/gyro-Bohm ve IFS-PPPL kapanışları çoğu testte amaçlanan H98 bandının dışındadır. FACIT indirgenmiştir; analitik/iç kontrolleri vardır fakat dış katsayı karşılaştırması doğruluğunu ortaya koymamıştır. Profil hızlı iyon momentleri, yörünge yayılması, NBCD/ECCD ve Porcelli için tutarlılık testleri bulunur; JET ısıl/demet-hedef ayrımı açık kalır. Türetimler ve boşluklar [modül README'sindedir](../../src/physics/profiles/README.md).

## 7. Kenar, sistemler, belirsizlik ve optimizasyon

Kenar modülü SOL gücü, Eich ısı akısı genişliği, iki nokta sıcaklığı ve divertor yükünü tahmin eder; ELM enerjisi güç hesabına dahildir. Ayrılma, radyasyon bölüşümü ve geometri indirgenmiş kapanışlardır. Systems-lite, verilen mühendislik girdilerinden bobin gerilimi, nötron yükü, enerji dönüşümü ve darbe/merkez solenoidi büyüklüklerini raporlar. Plazma akı gereksinimi solenoid tasarımı olmadan raporlanabilir; kullanılabilir salınım ve marj tasarım ister. Bunlar bileşen yapılabilirliği, yorulma ömrü, zırhlama yeterliliği veya ayrıntılı trityum çevrimi kanıtı değildir.

Taramalar ve POPCON işletim uzayını inceler; görünen POPCON yaklaşımı nitel olup tam zamana bağlı koşudan farklıdır. UQ, yapılandırılan belirsizlikleri tohumlu akışlarla örnekler; işçi dağılımı sonucu değiştirmez. Optimizasyon senaryoya bağlı hedef ve Pareto cepheleri sunar; eksik fizik doğruluğunu tamamlamaz veya küresel optimumu kanıtlamaz. [Şekil 4](../figures/fig04_popcon.svg) POPCON, [Şekil 9](../figures/fig09_scan.svg) tam model taramasıdır. CSV, JSON, NetCDF, IMAS biçimli veri ve G-EQDSK desteklenir; IMAS dışa aktarımı tam IDS uyumluluğu iddiası değildir.

## 8. Belirlenimcilik ve yazılım doğrulaması

Sabit çalışma ortamı ve yapılandırmada doğrudan adımlar, parçalı oynatma ve sürdürülebilir dilimler bit düzeyinde aynı kabul edilmiş durumu üretir. Duvar saati yalnız bırakma noktalarını seçer, fizik denklemine girmez. Kontrol noktası RNG ve modül durumunu içerir; geri sarma kayıtlı çerçeveleri interpolasyonla birleştirmek yerine hesabı geri yükler. Senaryo olayları, kontroller, yapılandırma özeti ve tamamlanma parmak izi denetlenebilir tekrar sağlar. Matematik fonksiyonları Node ana sürümleri veya platformlar arasında değişebilir; golden toleransı farklı ana sürümlerde gevşetilir. Her JavaScript ortamında aynı baytlar vaat edilmez.

Birim/bileşen/CLI testleri analitik çözümler, korunum, hata yolları, işçi kapanması, veri aktarımı, dil ve erişilebilirliği kapsar. Gerçek olay birleşim testleri Loarte ELM, Porcelli/Kadomtsev, denge kabulü, parçalama ve geri sarmayı birlikte yürütür. Golden regresyon skalerleri, geçmişi, olayları ve profil/denge özetini kaydeder; kasıtlı değişim eklemeli neden günlüğüne yazılır. Mutasyon kontrolleri sayısal/mühendislik yollarını kasıtlı bozar; bir durum zaman aşımıyla yakalanır. Kapsama eşikleri ve sıkı tür denetimi ölçülmüş kapılardır, doğruluk kanıtı değildir. Kullanıcı bu yayın için ek son bağımsız denetimi kaldırmıştır; yayın kontrolleri yine çalıştırılır.

Yeniden üretim komutları: `npm run ci:local`, `npm run coverage`, `npm run coverage:levels`, `npm run typecheck:strict`, `npm run build:lib`, `npm run paper:check`, `npm run release:check -- --no-allow-unreleased`. Kayıtlı golden ve şekiller için Node 24 kullanılır. `src/docs` testleri rapor/README/makale sayılarını ve kasıtlı yanlış iddiaların reddini denetler.

## 9. Sayısal doğrulama ve yakınsama

[Şekil 7](../figures/fig07_verification.svg), Grad–Shafranov, silindirik sonlu hacim difüzyonu ve geri Euler doğrulamasını ölçer. Geri Euler'in birinci derecesi TR-BDF2 derecesini ölçmez; ayrı TR-BDF2 testleri aşama formülü, katı limit ve hata denetimini kapsar.

<!-- table: verification -->
| İşleç | Gözlenen derece | Beklenen derece |
| --- | --- | --- |
| Grad–Shafranov / Solov’ev | <!--num:VER.GS-->2.05<!--/num--> | 2 |
| Finite-volume / cylindrical diffusion | <!--num:VER.FV-->1.94<!--/num--> | 2 |
| Backward Euler | <!--num:VER.BE-->0.99<!--/num--> | 1 |

Ada genişliği düzeltmesi sonrasındaki ITER15 serisi tam temel atıştır; varsayılan ızgara `test/golden/ITER15.json` ile aynıdır. Bütün büyüklükler düz tepe ortalaması, T_ped birimi keV'dir. [Yakınsama kaydı](../../bench/records/convergence-iter15-v4.json) zaman toleransı ve en büyük adım çalışmalarını da içerir.

<!-- table: convergence -->
| Parameter | Value | Q | f_bs | li(3) | T_ped (keV) | Steps | ELMs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nRho | 25 | 10.1629 | 0.230293 | 0.713831 | 3.50614 | 20568 | 1309 |
| nRho | 50 | 10.4503 | 0.230607 | 0.719487 | 3.54873 | 20903 | 1317 |
| nRho | 100 | 10.5094 | 0.231067 | 0.721273 | 3.50977 | 22710 | 1322 |
| rtol | 0.01 | 10.4503 | 0.230607 | 0.719487 | 3.54873 | 20903 | 1317 |
| rtol | 0.001 | 10.4758 | 0.231218 | 0.719483 | 3.53475 | 28491 | 1320 |
| rtol | 0.0001 | 10.4859 | 0.23127 | 0.719675 | 3.53776 | 37604 | 1321 |
| dtMax | 0.5 | 10.4503 | 0.230607 | 0.719487 | 3.54873 | 20903 | 1317 |
| dtMax | 0.05 | 10.4524 | 0.230818 | 0.71965 | 3.53805 | 21885 | 1319 |
| dtMax | 0.01 | 10.488 | 0.231239 | 0.719809 | 3.53802 | 45791 | 1325 |

Radyal hücre sayısı <!--num:CONV.cells.base-->50<!--/num--> → <!--num:CONV.cells.fine-->100<!--/num-->: Q değişimi +<!--num:CONV.Q-->0.57<!--/num--> %, T_ped değişimi −<!--num:CONV.Tped-->1.10<!--/num--> %; hedef <!--num:CONV.target-->1<!--/num--> %.

Q iyileştirme hedefini karşılar; T_ped karşılamaz. Pedestal örneklemesi değiştikçe ızgara etkisi salınır. Varsayılanın altında daha düşük Q rejimi vardır; kaba ızgara eşdeğer varsayılan değildir. Bu, olaylı tek yörüngenin deneysel yakınsamasıdır; her preset ve anahtar için düzgün yakınsama kanıtı değildir. Üretilmiş çözümler tekil işleçleri sınar, indirgenmiş fizik kapanışlarını doğrulamaz.

## 10. Referans karşılaştırması (validation v2)

<!--num:VAL.checks-->46<!--/num--> kontrol: <!--num:VAL.inrange-->38<!--/num--> aralık içinde, <!--num:VAL.known-->8<!--/num--> bilinen sapma, beklenmeyen başarısızlık yok. İfadeler: <!--num:VAL.validated-->16<!--/num--> validated, <!--num:VAL.benchmarked-->16<!--/num--> benchmarked, <!--num:VAL.calibrated-->1<!--/num--> calibrated, <!--num:VAL.sanity-->13<!--/num--> sanity bound. Sapma eşiği <!--num:VAL.threshold-->20<!--/num--> %.

Kabul aralıkları yayımlanmış belirsizlik, belgelenmiş indirgenmiş model toleransı veya `references.ts` içindeki açık sınırdan gelir; modele uysun diye genişletilmez. "Validated", sapma eşiği içindeki karşılaştırmaya verilen araç etiketidir; "benchmarked" geniş aralık geçse bile daha büyük sapmayı söyler. Tasarım hedefleri ve yaklaşık fizik sınırları bu rollerini korur. ICF_CAL yalnız NIF N210808 ile kalibre edilir; N221204/N230729 yalnız bu sabit açısından kördür. Diğer seçimler ve girdiler bu atışlar bilinmeden yapılmış değildir. Model atışları ayıran bir girdiye sahip olmadığı için hepsine yaklaşık kalibrasyon verimini öngörür.

Tablo her referans kontrolünü içerir: metrik biriminde referans ve model, oran, durum, ifade ve kalibrasyon rolü. DEMO karşılaştırması tam preset'tir; DEMO golden durumları kısaltılmıştır. Kaynak erişim sınırlamaları tablo altında korunur. [Şekil 5](../figures/fig05_validation.svg) karşılaştırmaları, [Şekil 6](../figures/fig06_reactivity_lawson.svg) reaktivite ve Lawson bağlamını gösterir.

<!-- table: validation -->
| ID / unit | Reference | Model | Ratio | Accepted | Status | Wording | Role | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ITER.Q | 10 | 10.084 | 1.0084 | 5..20 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| ITER.Pfus (MW) | 500 | 516.638 | 1.03328 | 300..800 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| ITER.H98 | 1 | 1.09088 | 1.09088 | 0.748..1.34 | pass | sanity bound | comparison | [ITER Physics Basis 1999](https://doi.org/10.1088/0029-5515/39/12/302) |
| ITER.nG | 0.85 | 0.848315 | 0.998018 | 0.6..1 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| ITER.alphaShare | 0.2 | 0.207343 | 1.03671 | 0..0.213 | pass | sanity bound | comparison | [ITER Physics Basis ch. 1, 1999](https://doi.org/10.1088/0029-5515/39/12/301) |
| JET.Efus (MJ) | 59 | 66.6361 | 1.12943 | 40..80 | pass | validated | comparison | [Maslov 2023](https://doi.org/10.1088/1741-4326/ace2d8) |
| JET.alphaShare | 0.2 | 0.202824 | 1.01412 | 0..0.213 | pass | sanity bound | comparison | [ITER Physics Basis ch. 1, 1999](https://doi.org/10.1088/0029-5515/39/12/301) |
| SPARC.Q | 11 | 7.84251 | 0.712955 | 2..20 | pass | benchmarked (deviation -29 %) | comparison | [Creely 2020](https://doi.org/10.1017/S0022377820001257) |
| SPARC.alphaShare | 0.2 | 0.203735 | 1.01868 | 0..0.213 | pass | sanity bound | comparison | [ITER Physics Basis ch. 1, 1999](https://doi.org/10.1088/0029-5515/39/12/301) |
| DIIID.H98 | 1 | 0.882597 | 0.882597 | 0.748..1.34 | pass | sanity bound | comparison | [ITER Physics Basis 1999](https://doi.org/10.1088/0029-5515/39/12/302) |
| DIIID.Palpha (MW) | 0.0225 | 0.00255145 | 0.113398 | 0..0.0225 | pass | sanity bound | comparison | [Lazarus 1997](https://doi.org/10.1088/0029-5515/37/1/I11) |
| JT60SA.W (MJ) | 22 | 20.3793 | 0.926331 | 15.8..31.2 | pass | validated | comparison | [Garzotti 2018](https://doi.org/10.1088/1741-4326/aa9e15) |
| JT60SA.tauE (s) | 0.64 | 0.478671 | 0.747924 | 0.389..0.856 | pass | benchmarked (deviation -25 %) | comparison | [Garzotti 2018](https://doi.org/10.1088/1741-4326/aa9e15) |
| MASTU.H98 | 1.15 | 0.915382 | 0.795984 | 0.748..1.74 | pass | benchmarked (deviation -20.4 %) | comparison | [Harrison 2024](https://doi.org/10.1088/1741-4326/ad6011) |
| MASTU.q95 | 7.5 | 6.39329 | 0.852438 | 5..10 | pass | sanity bound | comparison | [Berkery 2023](https://doi.org/10.1088/1361-6587/acb464) |
| W7X.Ti0 (keV) | 1.5 | 2.00395 | 1.33597 | 0.91..2.21 | pass | benchmarked (deviation +34 %) | comparison | [Beurskens 2021](https://doi.org/10.1088/1741-4326/ac1653) |
| W7X.HISS04 | 0.65 | 0.8068 | 1.24123 | 0.448..0.869 | pass | benchmarked (deviation +24 %) | comparison | [Beurskens 2021](https://doi.org/10.1088/1741-4326/ac1653) |
| DEMO.Pfus (MW) | 2000 | 1903.35 | 0.951673 | 1000..3000 | pass | validated | comparison | [Federici 2019](https://doi.org/10.1088/1741-4326/ab1178) |
| DEMO.alphaShare | 0.2 | 0.209192 | 1.04596 | 0..0.213 | pass | sanity bound | comparison | [ITER Physics Basis ch. 1, 1999](https://doi.org/10.1088/0029-5515/39/12/301) |
| ITER15.Q | 10 | 10.4503 | 1.04503 | 5..20 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| ITER15.Pfus (MW) | 500 | 525.615 | 1.05123 | 300..800 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| ITER15.fbs | 0.2 | 0.230607 | 1.15303 | 0.1..0.4 | pass | validated | comparison | [Sips 2005](https://doi.org/10.1088/0741-3335/47/5A/003) |
| ITER15.li | 0.85 | 0.719487 | 0.846455 | 0.6..1.1 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| ITER15.q95 | 3 | 3.50345 | 1.16782 | 2.7..4 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| ITER15.Tped (keV) | 4.5 | 3.54873 | 0.788606 | 2..7 | pass | benchmarked (deviation -21 %) | comparison | [Snyder 2011](https://doi.org/10.1088/0029-5515/51/10/103016) |
| ITER15.nG | 0.85 | 0.799974 | 0.941146 | 0.6..1 | pass | validated | comparison | [Shimada 2007](https://doi.org/10.1088/0029-5515/47/6/S01) |
| JET15.Efus (MJ) | 59 | 81.8445 | 1.3872 | 40..80 | known-fail | benchmarked (deviation +39 %) | comparison | [Maslov 2023](https://doi.org/10.1088/1741-4326/ace2d8) |
| JET15.Ti0 (keV) | 10 | 10.1998 | 1.01998 | 6..15 | pass | validated | comparison | [Maslov 2023](https://doi.org/10.1088/1741-4326/ace2d8) |
| SPARC15.Q | 11 | 6.28916 | 0.571742 | 2..20 | pass | benchmarked (deviation -43 %) | comparison | [Creely 2020](https://doi.org/10.1017/S0022377820001257) |
| DEMO15.Pfus (MW) | 2000 | 2007.49 | 1.00375 | 1000..3000 | pass | validated | comparison | [Federici 2019](https://doi.org/10.1088/1741-4326/ab1178) |
| DEMO15.fbs | 0.35 | 0.374528 | 1.07008 | 0.2..0.6 | pass | validated | comparison | [Siccinio 2020](https://doi.org/10.1016/j.fusengdes.2020.111603) |
| NIF210808.G | 0.72 | 0.714783 | 0.992754 | 0.36..1.44 | pass | calibrated (deviation -0.7 %) | calibration | [Abu-Shawareb 2022](https://doi.org/10.1103/PhysRevLett.129.075001) |
| NIF210808.Ti (keV) | 9.55 | 1.32155 | 0.138383 | 6.3..13.2 | known-fail | benchmarked (deviation -86 %) | comparison | [Pak 2024](https://doi.org/10.1103/PhysRevE.109.025203) |
| NIF.G | 1.5 | 0.668409 | 0.445606 | 1..3 | known-fail | benchmarked (deviation -55 %) | blind | [Abu-Shawareb 2024](https://doi.org/10.1103/PhysRevLett.132.065102) |
| NIF.G_N230729 | 1.89 | 0.668409 | 0.353656 | 1..3.78 | known-fail | benchmarked (deviation -65 %) | blind | [Kritcher 2024](https://doi.org/10.1063/5.0210904) |
| DIRECT.G | 0.74 | 0.390571 | 0.527799 | 0.3..1.76 | pass | benchmarked (deviation -47 %) | comparison | [Gopalaswamy 2024](https://doi.org/10.1038/s41567-023-02361-4) |
| Z.yield | 11000000000000 | 199972000000000 | 18.1793 | 3660000000000..33000000000000 | known-fail | benchmarked (deviation +1718 %) | comparison | [Gomez 2020](https://doi.org/10.1103/PhysRevLett.125.155002) |
| Z.Ti (keV) | 3.1 | 3.1687 | 1.02216 | 2.17..4.03 | pass | validated | comparison | [Gomez 2020](https://doi.org/10.1103/PhysRevLett.125.155002) |
| GF.Tmax (keV) | 6.463 | 1.41172 | 0.218431 | 0.3..6.463 | pass | sanity bound | comparison | [Lindemuth 1983](https://doi.org/10.1088/0029-5515/23/3/001) |
| FRXL.Tmax (keV) | 6.463 | 1.43028 | 0.221303 | 0.3..6.463 | pass | sanity bound | comparison | [Lindemuth 1983](https://doi.org/10.1088/0029-5515/23/3/001) |
| ZAP.Te (keV) | 2 | 1 | 0.5 | 0.7..3.9 | pass | sanity bound | comparison | [Levitt 2024](https://doi.org/10.1103/PhysRevLett.132.155101) |
| TAE.Te (keV) | 0.5 | 0.606066 | 1.21213 | 0.25..1 | pass | benchmarked (deviation +21 %) | comparison | [Gota 2021](https://doi.org/10.1088/1741-4326/ac2521) |
| TAE.Ttot (keV) | 3 | 1.21213 | 0.404044 | 1.5..6 | known-fail | benchmarked (deviation -60 %) | comparison | [Gota 2021](https://doi.org/10.1088/1741-4326/ac2521) |
| MIRROR.Te (keV) | 0.66 | 9.53177 | 14.4421 | 0.33..1.8 | known-fail | sanity bound | comparison | [Bagryansky 2015](https://doi.org/10.1103/PhysRevLett.114.205001) |
| MUON.Yf | 150 | 106.462 | 0.709745 | 109..191 | known-fail | benchmarked (deviation -29 %) | comparison | [Jones 1986](https://doi.org/10.1103/PhysRevLett.56.588) |
| MUON.Q | 0.528 | 0.374511 | 0.709301 | 0..0.99 | pass | sanity bound | comparison | [Jones 1986](https://doi.org/10.1103/PhysRevLett.56.588) |

Bilinen başarısızlıkların nedenleri (kaynak tablosunun İngilizce açıklamaları):

- **JET15.Efus:** the 1.5D model over-predicts the record pulse by about 40 % (preset note "1.5D: +40 %"): beam-target fusion from the 3-component NBI deposition and a T_i(0) near 10 keV together over-predict the neutron rate of the record pulse
- **NIF210808.Ti:** the model puts N210808 below its own ignition threshold (χ_ig = 0.951 with ICF_CAL = 0.03931, fitted to the yield only), so no α heating raises the hot spot: its temperature is the kinematic one of the compression, 1.32 keV, a factor 7 below the experiment, while the calibrated yield (1.37 MJ) is reproduced. The temperature is the clearest sign that the calibration matches the yield with a wrong hot spot: the ignition-cliff constants, set when ICF_CAL was 0.07, are not part of it
- **NIF.G:** the model has no input for what separates N221204 from the calibration shot N210808 (an ablator 6 µm thicker, 7 % more laser energy, better low-mode symmetry and capsule quality), so it runs the same capsule and predicts the calibration yield, 1.37 MJ: G = 0.67 against 1.5 (model/published 0.45, yield ratio 0.43). The 2.3-fold increase of the yield between the two shots lies above the ignition cliff, which a model calibrated at one point on the cliff does not resolve; the cliff constants were not re-tuned. Before v4.0 ICF_CAL = 0.07 was tuned to N221204 itself and the check read G = 1.49, a fit that looked like a prediction
- **NIF.G_N230729:** as for N221204 the model predicts the calibration yield, 1.37 MJ, for every shot of the platform: G = 0.67 against 1.89 (model/published 0.35). The capsule quality that raised the yield of N230729 above that of N221204 (fewer high-Z inclusions and defects) enters the model only through the surface roughness, which acts on the ignition parameter and not on the burn-up of an ignited or marginal shot
- **Z.yield:** the 0D MagLIF model over-predicts the yield by more than an order of magnitude (2.0 × 10¹⁴ against 1.1 × 10¹³, since v4.0 with a burn of ≈ 2 ns instead of ≈ 30 ns): its ideal compression to CR = 30 has no liner–fuel mix, end losses, preheat losses or Be radiation, which limit the experiments
- **TAE.Ttot:** the single-temperature FRC model has T_i = T_e ≈ 0.6 keV, so T_e + T_i ≈ 1.2 keV; the hot beam-driven ion population of C-2W (T_i several times T_e) is not modelled
- **MIRROR.Te:** the single-temperature mirror model sets T_e = T_i ≈ 9.5 keV (with the Pastukhov plug factor of v4.0); mirror electrons are cooled by axial heat loss to the end walls, which limits every open trap built so far to T_e ≲ 1 keV and is not modelled
- **MUON.Yf:** Y_f = 1/(ω_s + 1/(λ_c τ_µ)) with the preset's ω_s = 0.56 % and λ_c = 1.2 × 10⁸ s⁻¹ gives 106 fusions per muon; the measured ≈150 implies a lower effective sticking (reactivation) or a faster cycling rate

Kaynak erişim sınırlamaları (kaynak tablosunun İngilizce açıklamaları):

- **MASTU.q95:** the 5 < q95 < 10 band is quoted from Berkery et al. 2023 (PPCF 65 045001), whose text could not be read when the check was reviewed (IOPscience stands behind a bot check and the OSTI record has no full text): what was verified is its abstract (operation stayed out of the low-q, low-density region of the Hugill diagram), the open slides of the same authors (ISTW 2022: plasma currents 400–750 kA, MAST-U yet to reach the low-q95 region) and, in the open text of Harrison et al. 2024 (PPCF 66 065019), the ranges 450–1000 kA, 0.42–0.64 T and κ 2.0–2.2; the EFIT q95 of 6.3–6.7 and the discharge shapes of Imada et al. 2024 (table 1) could not be re-read. The primary text of Sauter 2016 could not be read either (the EPFL copy resets the connection, Infoscience holds the record without the full text)
- **W7X.HISS04:** the ISS04 prefactor and exponents are those of a secondary quotation (Warmer et al., EUROfusion WPS2-PR(15)02, eq. 1, with f_ren in front); Yamada et al. 2005 (doi:10.1088/0029-5515/45/12/024) was not read, nor was the W7-X value of ι_2/3 behind the preset's 0.9
- **ITER15.Tped:** the 4.5 ± 0.5 keV (T_ped ≈ 4–5 keV) was not found as a printed number in the readable sources: the text of Snyder et al. 2011 (Nucl. Fusion 51 103016) could not be read (IOPscience stands behind a bot check, the OSTI record has no full text); the temperature above is derived from β_N,ped and n_ped of the authors' slides, and the abstract (only a summary of it was seen) quotes no temperature
- **NIF210808.Ti:** read in the accepted manuscript of the paper (OSTI 2377242, LLNL-JRNL-856035, 2026-10-01), not in the typeset article: the 10.1 keV is printed in its conclusion without an uncertainty, the 9 keV in section V as an approximate value for two shots, and the manuscript quotes N210808 as 1.33 ± 0.13 MJ where Abu-Shawareb et al. 2022 (table I) give 1.37 MJ
- **NIF.G_N230729:** verified: the abstract of Kritcher et al. 2024 (the Crossref record of doi:10.1063/5.0210904, read 2026-10-01) gives the maximum fusion energy of the platform to date as 3.88 MJ from 2.05 MJ of incident laser energy, and 3.15 MJ for N221204. Not verified: the full text of the paper, so no uncertainty of the 3.88 MJ is known (none is used), and the shot label and date, which the abstract does not state and which come from the facility record of LLNL (N230729, 30 July 2023)

## 11. Başarım ve duraklatma gecikmesi

Bunlar kayıtlı ölçümlerdir; son belge commit'i için süre garantisi değildir. `bench/perf-baseline.json`, v4 geliştirmesinde Windows x64, Node v24.19.0, AMD Ryzen 5 5600 üzerinde üç koşunun ortancasını verir. ITER15 temel atışı, DEMO15 tam preset'i kapsar. Süre CPU, çalışma ortamı ve diğer işlere bağlıdır.

<!-- table: performance -->
| Preset | Ortanca (s) |
| --- | --- |
| ITER | 1.999 |
| JET | 0.217 |
| ITER15 | 23.762 |
| JET15 | 4.114 |
| DEMO15 | 139.505 |
| NIF | 0.003 |

Aşağıdaki duraklatma istek-yanıt ölçümleri [pause-latency-v4.json](../../bench/records/pause-latency-v4.json) kaydından, satır başına yaklaşık otuz istek içeren tek kısa koşudan gelir. Makine başka işlerle paylaşılmıştır; denetimli boşta ölçüm değildir. p99 bu küçük örneklemin yaklaşık en büyük değeridir. Kontrol veya geri sarma öncesi işçi askıdaki adımı tamamlar ya da geri alır; rastgele komutu anında kesmez.

<!-- table: pause -->
| Preset | Speed | Requests | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| DEMO15 | 1x | 32 | 0.8 | 6.2 | 6.3 | 6.3 |
| DEMO15 | 30x | 31 | 3 | 9.6 | 10.6 | 10.6 |
| DEMO15 | 100x | 31 | 4.7 | 10 | 14.7 | 14.7 |
| ITER15 | 1x | 34 | 0.4 | 6 | 6.4 | 6.4 |
| ITER15 | 30x | 32 | 4.5 | 8.1 | 11.7 | 11.7 |
| ITER15 | 100x | 30 | 3.5 | 7 | 7.4 | 7.4 |

## 12. Sınırlamalar, açık işler ve köken

- EPED başlangıç basıncı +<!--num:EPED.p-->21.1<!--/num--> %, sıcaklığı +<!--num:EPED.T-->15.4<!--/num--> %; hedef <!--num:EPED.target-->15<!--/num--> % karşılanmadı.
- Öngörücü kapanışlarda H98 hedefi <!--num:H98.lo-->0.8<!--/num-->–<!--num:H98.hi-->1.2<!--/num-->; yalnız bir vaka <!--num:H98.jet15-->1.02<!--/num--> ile bant içinde; diğerleri <!--num:H98.min-->0.29<!--/num-->–<!--num:H98.max-->0.70<!--/num-->.
- JET15 füzyon enerjisi <!--num:JET15.Efus-->81.8<!--/num--> MJ; referans <!--num:JET15.Efus.ref-->59<!--/num--> ± <!--num:JET15.Efus.unc-->6<!--/num--> MJ: +<!--num:JET15.Efus.dev-->39<!--/num--> %. Isıl pay <!--num:JET.thermal-->36.7<!--/num--> %; yaklaşık eğilim <!--num:JET.trend-->50<!--/num--> %. #99971 ayrımı açık.
- NIF kör kazanç oranları: N221204 <!--num:NIF.N221204.ratio-->0.45<!--/num-->, N230729 <!--num:NIF.N230729.ratio-->0.35<!--/num-->; atış ayrımı girdisi yok.
- FACIT dış kıyaslaması yok; çukur çekirdek Kadomtsev davranışı uzlaşım ve yedek yoldur.
- T_ped radyal değişimi −<!--num:CONV.Tped-->1.10<!--/num--> % ile <!--num:CONV.target-->1<!--/num--> % hedefini kaçırır.
- Greenwald sınırının yaklaşık <!--num:NG.band-->2<!--/num--> % yakınında yoğunluk stokastiktir; bilinen sapmalar başarı olarak sunulmaz.

Diğer sınırlar: sabit sınırlı denge, deneysel hapsetme, yaklaşık RF/NBI ve SOL/divertor kapanışları, basitleştirilmiş mühendislik, eksik safsızlık atomik kinetiği ve tümünü kapsamayan anahtar birleşimleri. Şekil özetleri desteklenen ortamda yeniden üretimi sınar; dış fizik öngörüsünü kanıtlamaz. [v3–v4 sayı uzlaştırması](../v4-numbers-diff.md) değişimleri güç hesabı, geometri/preset girdileri, ayrıklaştırma, yeniden eşleme, ada düzleşmesi ve ICF kalibrasyonuna bağlar. Yayın kapanışında katsayılar veya literatür aralıkları yeniden ayarlanmadı.

Yazılım ve belgeler Mustafa Karatum'un yönlendirmesiyle Claude Code (Anthropic), Codex (OpenAI) ve MiMo'nun önemli yardımıyla geliştirilmiştir. Otomatik testler ve AI destekli inceleme bağımsız uzman incelemesinin yerini tutmaz. `paper/` JOSS paketi hazırlanmıştır, gönderilmemiştir. Finansman, gönderim ve gelecekteki kullanım iddiaları yazar incelemesi gerektirir.

## Kaynaklar ve yeniden üretim verileri

- Fusion Reactor Simulator. [10.5281/zenodo.22259861](https://doi.org/10.5281/zenodo.22259861).
- ``PROCESS'': A systems code for fusion power plants---Part 1: Physics. [10.1016/j.fusengdes.2014.09.018](https://doi.org/10.1016/j.fusengdes.2014.09.018).
- ``PROCESS'': A systems code for fusion power plants---Part 2: Engineering. [10.1016/j.fusengdes.2016.01.007](https://doi.org/10.1016/j.fusengdes.2016.01.007).
- cfspopcon: a Python package for plasma operating contours. [10.5281/zenodo.10054879](https://doi.org/10.5281/zenodo.10054879).
- Contour analysis of fusion reactor plasma performance. [10.1088/0029-5515/22/7/006](https://doi.org/10.1088/0029-5515/22/7/006).
- FreeGS: a free-boundary Grad--Shafranov solver. [freegs](https://github.com/freegs-plasma/freegs).
- FreeGSNKE: A Python-based dynamic free-boundary toroidal plasma equilibrium solver. [10.1063/5.0188467](https://doi.org/10.1063/5.0188467).
- TORAX: A Fast and Differentiable Tokamak Transport Simulator in JAX. [10.48550/arXiv.2406.06718](https://doi.org/10.48550/arXiv.2406.06718).
- METIS: a fast integrated tokamak modelling tool for scenario design. [10.1088/1741-4326/aad5b1](https://doi.org/10.1088/1741-4326/aad5b1).
- Improved formulas for fusion cross-sections and thermal reactivities. [10.1088/0029-5515/32/4/I07](https://doi.org/10.1088/0029-5515/32/4/I07).
- Chapter 2: Plasma confinement and transport. [10.1088/0029-5515/39/12/302](https://doi.org/10.1088/0029-5515/39/12/302).
- Power requirement for accessing the H-mode in ITER. [10.1088/1742-6596/123/1/012033](https://doi.org/10.1088/1742-6596/123/1/012033).
- Transient simulation of silicon devices and circuits. [10.1109/TCAD.1985.1270142](https://doi.org/10.1109/TCAD.1985.1270142).
- Theory of plasma transport in toroidal confinement systems. [10.1103/RevModPhys.48.239](https://doi.org/10.1103/RevModPhys.48.239).
- Neoclassical conductivity and bootstrap current formulas for general axisymmetric equilibria and arbitrary collisionality regime. [10.1063/1.873240](https://doi.org/10.1063/1.873240).
- Noncircular, finite aspect ratio, local equilibrium model. [10.1063/1.872666](https://doi.org/10.1063/1.872666).
- Neoclassical tearing modes and their control. [10.1063/1.2180747](https://doi.org/10.1063/1.2180747).
- A first-principles predictive model of the pedestal height and width: development, testing and ITER optimization with the EPED model. [10.1088/0029-5515/51/10/103016](https://doi.org/10.1088/0029-5515/51/10/103016).
- Chapter 1: Overview and summary. [10.1088/0029-5515/47/6/S01](https://doi.org/10.1088/0029-5515/47/6/S01).
- JET D-T scenario with optimized non-thermal fusion. [10.1088/1741-4326/ace2d8](https://doi.org/10.1088/1741-4326/ace2d8).
- Overview of interpretive modelling of fusion performance in JET DTE2 discharges with TRANSP. [10.1088/1741-4326/ad0310](https://doi.org/10.1088/1741-4326/ad0310).
- Lawson criterion for ignition exceeded in an inertial fusion experiment. [10.1103/PhysRevLett.129.075001](https://doi.org/10.1103/PhysRevLett.129.075001).
- Achievement of target gain larger than unity in an inertial fusion experiment. [10.1103/PhysRevLett.132.065102](https://doi.org/10.1103/PhysRevLett.132.065102).
- Design of first experiment to achieve fusion target gain $>$ 1. [10.1063/5.0210904](https://doi.org/10.1063/5.0210904).

Tam kaynakça [paper.bib](../../paper/paper.bib) dosyasındadır. Her doğrulama satırı birincil kaynağa bağlanır; kabul türetimleri ve erişim sınırlamaları [references.ts](../../src/physics/validation/references.ts) içindedir. Şekil açıklamaları/manifesti, golden JSON ve neden günlüğü kaynakla commit edilmiştir. Arşivlenmiş şekilleri değiştirmeden kontrol etmek için `npm run figures:check -- --threads 2` çalıştırılır.
