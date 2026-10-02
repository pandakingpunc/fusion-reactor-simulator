# Füzyon Reaktörü Simülatörü (Fusion Reactor Simulator)

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22259861.svg)](https://doi.org/10.5281/zenodo.22259861)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md) | Türkçe

> Araştırma ve eğitim için zaman çözümlemeli bir füzyon reaktörü simülatörü: <!--n:methods-->12 hapsetme yöntemi için sıfır boyutlu (0D) güç dengesi;
> tokamaklar ve küresel tokamaklar için Grad–Shafranov dengesine bağlı 1.5D radyal taşınım modeli. Tokamak, küresel tokamak, stellaratör,
> lazer ICF, MTF/MagLIF/Z-pinç, FRC, manyetik ayna ve müon katalizli füzyon; <!--n:presets-->22 yerleşik preset (ITER, JET, SPARC, DEMO, W7-X, NIF, ...).
> Belirlenimci (deterministik) ve yeniden üretilebilir; sayılarının yayımlanmış değerlerden nerede ayrıldığı konusunda açık sözlü.

Tarayıcıda (React dışında çalışma zamanı bağımlılığı yok), Node.js kütüphanesi olarak, komut satırından (`fusion-sim`; NetCDF, IMAS benzeri JSON ve CSV çıktısıyla)
ve Python'dan çalışır.

<p align="center">
  <img src="docs/figures/fig01_equilibrium.svg" alt="ITER 1.5D deşarjının Grad–Shafranov dengesi" width="92%">
</p>

## Ne olduğu ve ne olmadığı

- **İndirgenmiş bir modeldir.** 0D model, hacim ortalamalı bir güç ve parçacık dengesidir. 1.5D model T_e, T_i, n_e ve poloidal akıyı
  ρ̂ = √(Φ/Φ_b) üzerinde evrimleştirir ve yarı-durağan olarak sabit sınırlı bir Grad–Shafranov dengesine bağlanır. Taşınım, pedestal,
  ELM'ler, testere dişleri ve NTM'ler birkaç sabiti olan, birçoğu deneysel kapanışlardır; basitleştirmeler kodda `APPROXIMATION` ile işaretlidir.
- **Tasarım kodu değildir.** Araştırma, öğretim, kavramsal öncesi tasarım ve senaryo keşfi için bir araçtır. Serbest sınırlı, türbülans ya da
  doğrusal olmayan MHD kodu değildir, bobin takımı yoktur ve makine tasarımı için birincil kaynak olarak kullanılmamalıdır. Sınırları
  [Bilinen sınırlar](#bilinen-sınırlar-ve-karşılanmayan-hedefler) bölümünde sıralanmıştır.
- **Referanslarla uyumu konusunda açık sözlüdür.** Yayımlanmış bir değerin %20 içindeki model değerine *doğrulandı*, %20'nin ötesindekine sapmasıyla
  birlikte *kıyaslandı* denir. Bazı kontroller başarısız olur ve bilinen başarısızlık olarak belgelenir; ICF modelinin tek ayarlı sabiti tek bir atışa
  uydurulmuştur, dolayısıyla o atış bir sınama sayılmaz. Bkz. [Doğrulama özeti](#doğrulama-özeti).

<!-- table: glance -->

| Depoda yerleşik | Adet |
|---|---|
| Hapsetme yöntemi (`method`) | 12 |
| Preset | 22 |
| Altın (golden) regresyon durumu (`test/golden`) | 40 |
| `npm run validate` literatür kontrolü | 46 |
| Makale şekli (`docs/figures`) | 9 |
| Öğren görevi | 10 |

## v4'te yeni olanlar

**Belirlenimci çekirdek ve tam geri sarma.** Herhangi bir `advance()` çağrı dizisi, `runAll()` ile bit düzeyinde aynı kareleri, olayları ve raporu verir;
`rewindTo()` 0D ve 1.5D'de model durumunu birebir geri yükler, böylece geri sarılan bir koşu bit bit yeniden oynar; her canlı kontrol değişikliği
kaydedilir ve bit düzeyinde yeniden oynar; `runFingerprint()` (kanonik bir serileştirmenin SHA-256 özeti) bir koşuyu girdileriyle adlandırır.
Tüm rastgele sayılar tohumludur.

**1.5D çözücü.** Kenara sıkıştırılmış radyal ızgarada örtük sonlu hacimler; hata denetimli TR-BDF2 (ikinci mertebe, L-kararlı) ile ilerletilir.
Olaylar (L–H geçişi, ELM, testere dişi çöküşü, NTM başlangıcı) üzerinden adımlanarak geçilmez, kök bulucuyla zamanda konumlandırılır. Her aşama,
Anderson ivmeli Picard yinelemesi ya da blok-üçlü-köşegen Jacobiyenli Newton–Raphson ile çözülür; akım difüzyonu, sınır koşulu I_p olan
Hinton–Hazeltine biçimindedir. Çözücünün yakınsaması ölçülmüştür ve bir sayısı hedefini tutturamaz: bkz. [Kod doğrulaması](#kod-doğrulaması-ve-yakınsama).

**Öz-tutarlı Grad–Shafranov bağlaşımı.** Denge çözücünün tablo kipi I_p'yi sağlamak için yalnızca FF′'yi ölçekler; böylece raporlanan basınç, β_p ve
depolanan enerji kuvvet dengesinde kalır; yüzey tablosu kenara doğru sıklaştırılmıştır; yeni bir denge benimsendiğinde durum korunumlu biçimde yeniden
eşlenir (parçacık sayısı, enerji ve çevrelenen akım korunur); çevrim gerilimi, dirençsel ve endüktif akı ile merkezi solenoid bütçesi için akı defterleri vardır.

**0D modelinin düzeltmeleri.** Ayrı alfa ve demet hızlı-iyon havuzları (NBI açıkken sahte ateşleme yok), kayıp gücü
P_L = P_heat − P_rad,core − dW/dt, ölçeklemeler ve Greenwald sınırı çizgi-ortalama yoğunlukta, D-D ve D-³He yan kanalları, tam D-T enerjileri,
Miller hacmi ve yüzeyi ve ileri beslemeli bir yoğunluk denetleyicisi.

**1.5D modelinin isteğe bağlı fizik modülleri (WS6).** Her biri `profiles.*` altında bir anahtarın arkasındadır ve varsayılan olarak kapalıdır; yani onu
adlandırmayan bir yapılandırma eskisi gibi davranır. `fidelity` değerinin `"1.5D"` olması gerekir.

<!-- table: modules -->

| Modül | Anahtar | Varsayılan | Açma değerleri |
|---|---|---|---|
| Öngörücü taşınım | `profiles.transportModel` | `"scaling"` | `"cgm"`, `"bgb"`, `"ifspppl"` |
| EPED1 tipi pedestal | `profiles.pedestalModel` | `"fixed"` | `"eped1"` |
| ELM enerji kaybı (Loarte) | `profiles.elmLoss` | `"fixed"` | `"loarte"` |
| Safsızlık ve helyum külü taşınımı | `profiles.impurityTransport` | `"legacy"` | `"anomalous"`, `"facit"` |
| Hızlı iyon enerji profilleri | `profiles.fastIonModel` | `"scalar"` | `"profile"` |
| NBCD ve ECCD akım sürümü | `profiles.cdModel` | `"legacy"` | `"physics"` |
| Porcelli testere dişi tetikleyicisi | `profiles.sawtoothTrigger` | `"shear"` | `"porcelli"` |
| Kadomtsev yeniden bağlanması | `profiles.sawtoothReconnection` | `"legacy"` | `"kadomtsev"` |
| Redl bootstrap katsayıları | `profiles.neoclassicalModel` | `"sauter"` | `"redl"` |
| T_sep için iki noktalı kenar modeli | `profiles.edgeModel` | `"legacy"` | `"twoPoint"` |

Modüller, yayımlandığı gibi uygulanmış ve kendi sınırlarına karşı sınanmış indirgenmiş kapanışlardır. Birim ve bütünleşik testlerle, çoğu için ayrıca altın
durumlarla korunurlar; öngörücü model olarak doğrulanmış değildirler ve karşılanmayan hedeflerinin birkaçı
[Bilinen sınırlar](#bilinen-sınırlar-ve-karşılanmayan-hedefler) altında belirtilmiştir. Her alan [yapılandırma başvurusunda](docs/config-reference.md) açıklanmıştır.

**Kenar, sistem mühendisliği, belirsizlik ve eniyileme.** 0D modeli, 1.5D sınırı ve POPCON'un paylaştığı iki noktalı bir diverter modeli (Stangeby kayıp
çarpanları, diverter yayılmalı Eich λ_q, Lengyel tohum-safsızlık ışıması, bir ayrışma niteleyicisi); bir sistem-lite paketi (TF bobini sargı paketi ve
gerilimi, merkezi solenoid akı bütçesi, kriyo tesis, radyal yapı, trityum üretimi, PROCESS 1990 maliyet hesapları); tohumlu belirsizlik nicemlemesi
(Sobol' / Latin hiperküp / Monte Carlo toplulukları, P(Q ≥ 10), P(disruption), önyükleme aralıklı Sobol' indisleri); kararlı hal güç dengesi üzerinde
tasarım eniyilemesi (Nelder–Mead veya CMA-ES ile artırılmış Lagrange, NSGA-II Pareto cepheleri). Mühendislik ve eniyileme sonuçları bir "eğitsel" uyarı
taşır: arkalarındaki modeller sezgiseldir.

**Başsız kütüphane, komut satırı, veri biçimleri, Python.** `src/physics/index.ts` genel API'dir (`@public` ve `@experimental` etiketli bir barrel); her
yapılandırma çalışma zamanında yola özgü hata iletileriyle doğrulanır ve bir JSON Şeması vardır; `fusion-sim` koşar, tarar, preset'leri listeler,
yapılandırmaları denetler ve G-EQDSK (COCOS 11) yazar; koşular JSON, CSV, NDJSON, NetCDF-3 (CF öznitelikleri) ve IMAS benzeri JSON olarak dışa aktarılır, her
birinde aynı yapılandırma için bayt bayt aynı olan bir kaynak (provenance) bloğu bulunur; `python/fusion_sim` komut satırını sarar.

**Web uygulaması.** Bir senaryo düzenleyici (her kontrol için programlı dalga biçimleri ve tetikleyiciler, şablonlar, canlı bir koşunun kaydı); paylaşım
bağlantıları, gömme görünümleri ve hash rotaları; tarayıcıda saklanan koşular ve içe aktarılırken yeniden benzetimi yapılan, doğrulanmış-yeniden-üretim
rozeti gösteren koşu dosyaları; ana iş parçacığı dışında hesaplanan, koşu yörüngesi, tıkla-yönlendir ve diverter-kenar haritaları olan bir POPCON
haritası; ELM ve disruption etkileriyle bir 3B görünüm (ham WebGL2, istenince yüklenir); <!--n:missions-->10 görevli bir Öğren sekmesi, bir sözlük ve bir güç akışı
diyagramı; radar, bindirme ve yapılandırma farkı olan Karşılaştır; yer yer sabit kodlanmış metin ve erişilebilirlik için sınanmış, yerel biçimli sayılarla
İngilizce ve Türkçe arayüz (bkz. [arayüz dili ve erişilebilirlik](docs/interface-language-and-accessibility.md); testlerin neyi denetleyemediğini de söyler).

**Doğrulama v2 ve yayın motoru.** DOI'li literatür başvuruları ve kabul aralıkları tablosu, kontrol rolleri (kalibrasyon, kör) ve doğrulandı / kıyaslandı
ifadesi; gömülü STIX Two yazı tipleriyle PDF şekiller ve `npm run figures:check` ile bit bit yeniden üretilen bir kaynak bildirimi (manifest).

## Hızlı başlangıç

Gereksinim: Node.js 20 veya üstü (`.nvmrc`, altın dosyaların kaydedildiği ana sürümü sabitler).

### Web uygulaması

```bash
npm ci
npm run dev        # http://localhost:5173
npm run build      # tür denetimi ve üretim derlemesi (statik dosyalar, base './')
```

### Komut satırı

```bash
npx tsx src/cli/fusion-sim.ts presets
npx tsx src/cli/fusion-sim.ts run --preset JET --series Q,P_fus,Ti --format csv > jet.csv
npx tsx src/cli/fusion-sim.ts run --preset SPARC --set fuel=DD --format text
npx tsx src/cli/fusion-sim.ts run --preset ITER15 --format netcdf --out iter15.nc
npx tsx src/cli/fusion-sim.ts scan --preset ITER --param heating.P_NBI_MW=10:50:10 --param H98=0.9,1.0,1.1 --metric flatTop.Q --out scan.csv
npx tsx src/cli/fusion-sim.ts export-eqdsk --preset ITER15 --out iter15.geqdsk
npx tsx src/cli/fusion-sim.ts schema --check my.reactor.json
npm run -s uq -- --preset ITER --n 128 --json uq-iter.json
npm run -s optimize -- --preset ITER --objective major-radius --json opt.json
```

`npm run build:lib` sonrasında aynı program `node build/lib/fusion-sim.js <komut>` olur. Her komut `--help` kabul eder, bilinmeyen ya da hatalı biçimli
bayrakları 2 çıkış koduyla reddeder ve paralel çalıştığı yerde `--threads N` alır. Komutlar [`src/cli/fusionSim/README.md`](src/cli/fusionSim/README.md)
içinde, biçimler [`src/io/README.md`](src/io/README.md) içinde anlatılmıştır.

### Kütüphane

Paket npm'de yayımlanmamıştır (`package.json` `private`); derleyip paketi içe aktarın ya da kaynaktan `tsx` ile çalıştırın.

```ts
import { presets, validateConfig, runShot } from './build/lib/index.js';   // npm run build:lib

const cfg = { ...presets.find((p) => p.id === 'JET')!.cfg, t_end: 2 };
const check = validateConfig(cfg);                    // { ok: true, config } veya { ok: false, issues }
const { report, flatTop, events, sim } = runShot(cfg);
console.log(report.E_fusion_MJ, flatTop.Q, sim.fingerprint('4.0.0'));
```

### Python

```python
import fusion_sim as fs

doc = fs.run("ITER", set={"heating.P_NBI_MW": 20}, t_end=100)   # sözlük: report, flatTop, burn, events, config, provenance
doc["report"]["Q_sci_max"], doc["flatTop"]["Q"]
fs.scan({"heating.P_NBI_MW": "10:50:10"}, preset="ITER", metrics=["flatTop.Q"])["points"]
```

Sarmalayıcı, komut satırının standart kütüphane tabanlı bir alt-süreç ön yüzüdür ([`python/README.md`](python/README.md)).

### Denetimler

```bash
npm test               # birim, bileşen, CLI ve hızlı altın testler (vitest)
npm run validate       # tüm preset'ler literatür tablosuna karşı; birkaç dakika
npm run golden         # altın regresyon: her durum 1e-9'da; birkaç dakika sürer
npm run figures:check  # docs/figures, figures.manifest.json ile eşleşir ve aynen yeniden üretilir
npm run ci:local       # tür denetimleri, şema denetimleri, testler, validate, golden, şekil denetimi, derleme, paket bütçesi; ilk hatada durur
```

`npm run validate -- --json` makine okunur sonucu (şema 3) yazar; `npm run -s validate -- --json > results.json` ile yakalayın (düz `npm run` başlık satırını
stdout'a yazar). `npm run validate -- --markdown` kontrol tablosunu basar.

## Doğrulama özeti

`npm run validate` her preset'i koşar ve <!--n:checks-->46 model çıktısını yayımlanmış değerlerle karşılaştırır. Bir kontrolün belirsizliğiyle birlikte yayımlanmış bir
değeri, DOI'li bir kaynağı, bir kabul aralığı ve bir türü vardır: *validation* (aygıtın ölçülmüş bir değeri), *benchmark* (yayımlanmış bir tasarım ya da
modelleme değeri) veya *sanity* (fiziksel bir sınır). Kabul aralığı literatürden ve belirtilmiş bir indirgenmiş-model toleransından türetilir, hiçbir zaman modele
uydurulmaz. Her sonuç ayrıca model değerini yayımlanmışla karşılaştıran bir ifade taşır: %20 içinde *doğrulandı*, %20'nin ötesinde *kıyaslandı (sapma X %)* (yayımlanmış
değerden uzak bir model onunla karşılaştırılır, ona karşı doğrulanmış sayılmaz), bir model sabitinin uydurulduğu tek atış için *kalibre* (geçişi yapı gereğidir) ve sanity
türündeki bir kontrol için *makullük sınırı* (sınır bir ölçüm değildir). *Kör* rolündeki bir kontrol, o kalibrasyondan sonra sabit yeniden uydurulmadan yapılmış bir öngörüdür.

<!-- table: validation-counts -->

| `npm run validate` sonucu | Kontrol |
|---|---|
| Koşulan kontrol | 46 |
| Kabul aralığı içinde | 38 |
| Belgelenmiş bilinen başarısızlık | 8 |
| Beklenmeyen başarısızlık | 0 |
| İfade *doğrulandı* (%20 içinde) | 16 |
| İfade *kıyaslandı* (%20'nin ötesinde) | 16 |
| İfade *kalibre* | 1 |
| İfade *makullük sınırı* | 13 |
| Tür *validation* | 15 |
| Tür *benchmark* | 18 |
| Tür *sanity* | 13 |

Aralık denetiminden geçmek referansla uyuşmakla aynı şey değildir: kabul aralıkları geniştir ve <!--n:checks-->46 sonucun yalnızca <!--n:validated-->16 tanesi *doğrulandı* ifadesini taşır.
Başlıca büyüklükler, yayımlanmış değerlere karşı (düz tepe ortalamaları; oran = model / yayımlanmış):

<!-- table: headline -->

| Büyüklük | Yayımlanmış | 0D | 0D / yay. | 1.5D | 1.5D / yay. | İfade |
|---|---|---|---|---|---|---|
| ITER Q | 10 | 10,08 | 1,01 | 10,45 | 1,05 | doğrulandı / doğrulandı |
| ITER P_fus (MW) | 500 | 516,6 | 1,03 | 525,6 | 1,05 | doğrulandı / doğrulandı |
| ITER n_e,line / n_G | 0,85 | 0,848 | 1,00 | 0,800 | 0,94 | doğrulandı / doğrulandı |
| ITER q95 | 3,0 | 3,00 | 1,00 | 3,50 | 1,17 | doğrulandı / doğrulandı |
| ITER f_bs | 0,2 ± 0,05 | — | — | 0,231 | 1,15 | doğrulandı |
| ITER ℓ_i(3) | 0,85 ± 0,15 | — | — | 0,719 | 0,85 | doğrulandı |
| ITER T_e,ped (keV) | 4,5 ± 0,5 | — | — | 3,55 | 0,79 | kıyaslandı |
| JET E_fus (MJ) | 59 ± 6 | 66,6 | 1,13 | 81,8 | 1,39 | doğrulandı / kıyaslandı |
| SPARC Q | 11 | 7,84 | 0,71 | 6,29 | 0,57 | kıyaslandı / kıyaslandı |
| SPARC P_fus (MW) | 140 | 205,0 | 1,46 | 161,5 | 1,15 | kıyaslandı / doğrulandı |
| DEMO P_fus (MW) | 2000 | 1903 | 0,95 | 2007 | 1,00 | doğrulandı / doğrulandı |
| NIF N221204 G (kör) | 1,5 ± 0,1 | 0,668 | 0,45 | — | — | kıyaslandı |
| NIF N230729 G (kör) | 1,89 | 0,668 | 0,35 | — | — | kıyaslandı |
| NIF N210808 G (kalibrasyon) | 0,72 | 0,715 | 0,99 | — | — | kalibre |

ICF satırları 0D modellerdir. DEMO satırı 2000 s'lik tam preset'tir, yani `npm run validate`'in yaptığı koşudur (altın DEMO durumları kısaltılmıştır). SPARC P_fus referansı
Creely vd. 2020'nin tasarım değeridir ve `npm run validate`'te bir kontrolü yoktur. Bu sayıların önceki sürüme göre öncesi-sonrası, her değişimin nedeniyle birlikte
[docs/v4-numbers-diff.md](docs/v4-numbers-diff.md) içindedir.

<p align="center">
  <img src="docs/figures/fig05_validation.svg" alt="0D ve 1.5D modeller için benzetilen / yayımlanmış değer oranı" width="80%">
</p>

Belgelenmiş <!--n:known-->8 bilinen başarısızlık (model kabul aralığının dışına düşer; her biri [`references.ts`](src/physics/validation/references.ts) içinde
açıklanmıştır ve hiçbiri bir aralık oynatılarak kapatılmamıştır):

<!-- table: known-failures -->

| Kontrol | Model | Yayımlanmış | Kabul | Model / yayımlanmış | Neden |
|---|---|---|---|---|---|
| `JET15.Efus` | 81,8 MJ | 59 ± 6 MJ | 40–80 | 1,39 | 3 bileşenli NBI birikiminin 1.5D'deki demet-hedef füzyonu; demet-demet füzyonu ya da hızlı iyon kaybı modeli yok |
| `NIF210808.Ti` | 1,32 keV | 9,55 keV | 6,3–13,2 | 0,14 | model, kalibrasyon atışında kendi ateşleme eşiğinin altında kalır: verim tutturulur, sıcak nokta 7 kat fazla soğuktur |
| `NIF.G` (kör) | 0,668 | 1,5 ± 0,1 | 1–3 | 0,45 | N221204: hiçbir model girdisi onu N210808'den ayırmaz, bu yüzden kalibrasyon verimi yeniden öngörülür |
| `NIF.G_N230729` (kör) | 0,668 | 1,89 | 1–3,78 | 0,35 | N230729: N221204 ile aynı öngörü |
| `Z.yield` | 2,0e14 | 1,1e13 | 3,66e12–3,3e13 | 18,18 | astar-yakıt karışımı, uç ya da ön-ısıtma kaybı olmayan ideal MagLIF sıkıştırması |
| `TAE.Ttot` | 1,21 keV | 3 keV | 1,5–6 | 0,40 | tek sıcaklıklı FRC; demetle sürülen sıcak iyonlar modellenmemiştir |
| `MIRROR.Te` | 9,53 keV | 0,66 ± 0,05 keV | 0,33–1,8 | 14,44 | tek sıcaklıklı ayna; eksenel kayıpla soğuyan elektronlar modellenmemiştir |
| `MUON.Yf` | 106 | 150 ± 20,4 | 109–191 | 0,71 | preset'in yapışma ve çevrim hızı müon başına 106 füzyon verir |

v4'e kadar ICF sabiti N221204'ün kendisine göre ayarlanmıştı; bu da o atışı bir doğrulama gibi gösteriyordu. Şimdi yalnızca N210808 üzerinde kalibre edilir,
N221204 ve N230729 ise ıskalayan kör öngörülerdir. Doğrudan sürüş preset'i (`DIRECT.G`) aralığından geçer ve -%47 sapmayla kıyaslanmıştır; kapsülü hiçbir zaman
kalibre edilmemiştir.

## Kod doğrulaması ve yakınsama

Tam çözümlere karşı kod doğrulaması (şekil [fig07_verification](docs/figures/fig07_verification.svg)):

<!-- table: orders -->

| Sınama | Gözlenen mertebe | Beklenen mertebe |
|---|---|---|
| Grad–Shafranov çözücüsü, tam Solov'ev çözümüne karşı | 2,05 | 2 |
| Sonlu hacim ısı çözücüsü, düzgün kaynaklı kararlı difüzyon | 1,94 | 2 |
| Bir Bessel özkipinin geri-Euler sönümü (öz-yakınsama) | 0,99 | 1 |

TR-BDF2'nin kendi mertebesi birim testlerinde skaler problemler üzerinde denetlenir. 1.5D deşarjın yakınsaması ITER15 üzerinde (400 s, düz tepe ortalamaları;
<!--n:nrho-->50 hücre, `rtol` <!--n:rtol-->1e-2 ve `dtMax` <!--n:dtmax-->0,5 s varsayılandır) `npm run bench:convergence` ile ölçülür. Değişim, en ince koşunun ortadakine göredir:

<!-- table: convergence -->

| Çalışma | Ölçüt | Kaba | Orta | İnce | Değişim | Hedef | Durum |
|---|---|---|---|---|---|---|---|
| Radyal hücre 25 / 50 / 100 | Q | 10,16 | 10,45 | 10,51 | +0,57 % | < 1 % | sağlandı |
| Radyal hücre 25 / 50 / 100 | f_bs | 0,2303 | 0,2306 | 0,2311 | +0,20 % | < 1 % | sağlandı |
| Radyal hücre 25 / 50 / 100 | ℓ_i(3) | 0,7138 | 0,7195 | 0,7213 | +0,25 % | < 1 % | sağlandı |
| Radyal hücre 25 / 50 / 100 | T_ped (keV) | 3,506 | 3,549 | 3,510 | -1,10 % | < 1 % | **sağlanmadı** |
| Tolerans `rtol` 1e-2 / 1e-3 / 1e-4 | Q | 10,45 | 10,48 | 10,49 | +0,10 % | < 1 % | sağlandı |
| Tolerans `rtol` 1e-2 / 1e-3 / 1e-4 | f_bs | 0,2306 | 0,2312 | 0,2313 | +0,02 % | < 1 % | sağlandı |
| Tolerans `rtol` 1e-2 / 1e-3 / 1e-4 | ℓ_i(3) | 0,7195 | 0,7195 | 0,7197 | +0,03 % | < 1 % | sağlandı |
| Tolerans `rtol` 1e-2 / 1e-3 / 1e-4 | T_ped (keV) | 3,549 | 3,535 | 3,538 | +0,09 % | < 1 % | sağlandı |
| Adım sınırı `dtMax` 0,5 / 0,05 / 0,01 s | ELM sayısı | 1317 | 1319 | 1325 | +0,45 % | < 2 % | sağlandı |

T_ped hedefini tutturamaz: ızgarayla salınır (50 ile 100 hücre arasında <!--n:tped_change-->-1,10 %; 25 hücre pedestal boyunca yalnızca <!--n:cells25-->5 hücre koyar ve Q'yu
<!--n:q25_lower-->2,75 % düşük okur), dolayısıyla pedestal sıcaklığı %1'e yakınsamış değildir; varsayılan ızgarada pedestal boyunca <!--n:cells50-->10 hücre vardır. Radyal hücre sayısı ve
tolerans çözücünün ayrıklaştırma parametreleridir, fizik girdisi değildir. q(0) ve testere dişi çöküşü sayısı tabloda yer almaz ve 1.5D modelin en az yakınsamış sayılarıdır:
bunları asla yakınsamış fizik olarak aktarmayın.

400 s'lik bir ITER 1.5D atışı onlarca saniye, 2000 s'lik DEMO 1.5D atışı birkaç dakika sürer (boşta bir 6 çekirdekli masaüstünde `npm run bench:perf` ortanca duvar süreleri,
`bench/perf-baseline.json`; 1.5D çözücü birleştirildiğinde kaydedilmiştir; sonraki fizik düzeltmeleri adım sayılarını değiştirdi, bu yüzden paylaşılan bir makine daha yüksek okur):

<!-- table: runtime -->

| Preset | Ortanca duvar süresi (s) |
|---|---|
| ITER (0D, 400 s) | 2,0 |
| ITER15 (1.5D, 400 s) | 23,8 |
| DEMO15 (1.5D, 2000 s) | 139,5 |

## Bilinen sınırlar ve karşılanmayan hedefler

Bunlar açıkça belirtilmiştir, çünkü yeşil bir yazılım kapısı (`npm run ci:local`: kod testlerin söylediğini yapar ve altın dosyalar değişmemiştir) hiçbir kapanışın
gerçek bir plazmayı öngördüğünü göstermez. Sayılar [docs/v4-wave2b-report.md](docs/v4-wave2b-report.md) belgesindendir (bölüm 8.1; T_ped'in ızgara yakınsaması bölüm 11'dedir).

<!-- table: limits -->

| Hedef | Ölçülen | Durum |
|---|---|---|
| EPED1 pedestal'ı yayımlanmış EPED öngörüsünün %15'i içinde (ITER15, ELM başlangıcında) | basınç +21,1 %, T_ped +15,4 % | **karşılanmadı** (kabul testi, indirgenmiş bir kapanışın dürüstçe iddia edebileceği %25'i uygular); 50 ile 100 hücre arasındaki ızgara yakınsaması sağlandı |
| Bohm/gyro-Bohm kapanışının ortaya çıkan H98(y,2) değeri 0,8–1,2 içinde | ITER15 0,701, JET15 1,024, SPARC15 0,644 | yalnızca JET15'te karşılandı |
| IFS-PPPL kapanışının ortaya çıkan H98(y,2) değeri 0,8–1,2 içinde | ITER15 0,287, JET15 0,442, SPARC15 0,304 | **karşılanmadı** (ITER15 bu kapanışla L-kipinde kalır); hiçbir katsayı ayarlanmadı |
| JET DTE2 #99971 termal / demet-hedef bölünmesi yayımlanmış eğilimin %15'i içinde | termal oran %36,7; eğilim yaklaşık %50 | **açık**: makale #99971 için bir bölünme vermez, yalnızca temel şema için bir eğilim verir; demet-demet füzyonu ve hızlı iyon kayıpları modellenmemiştir |

Diğer sınırlar:

- **ITER15 testere dişi çöküşleri, içi boş çekirdekli bir Kadomtsev kuralına dayanır.** Kapı ölçümünde her ITER15 çöküşü q(0)'ın 1'in üzerinde olduğu anda gerçekleşti
  (NTM-düzleşme düzeltmesinden önce ölçüldü, sonra yinelenmedi); oysa çöküş modeli eksenden başlayan bir q = 1 yüzeyi için yazılmıştı; içi boş bir çekirdeğin karışım yarıçapı,
  sarmal akıyla tanımlanan ve doğrulanmamış bir kurala uyar; çöküş sıklığı ve tetikleyici eşikleri de doğrulanmamıştır. Çöküşlerin tohumladığı NTM bunu devralır.
- **Yoğunluk denetleyicisi Greenwald sınırı yakınında bir güvenlik iddiası değildir.** Bir yoğunluk rampasının sistematik aşımı küçüktür; ancak n_G'nin yaklaşık %2'si içinde
  kalan, rastgele ve tekdüze olmayan bir bantta bir atış disruption yapabilir de yapmayabilir de, sonuç tohuma ve `t_end` değerine bağlıdır. "n_G altında güvenli" biçiminde
  koşulsuz bir ifade yapılmaz.
- **ICF modelinin ayarlı tek bir sabiti vardır** ve üç NIF atışını ayıran hiçbir girdisi yoktur; N221204 ve N230729 öngörüleri ıskalar (yukarıdaki tablo) ve kalibrasyon
  atışının sıcak noktası fazla soğuktur.
- **FACIT ile pedestal ve ELM kapanışları indirgenmiş biçimlerdir**; kaynaklarıyla terim terim ya da yayımlanmış bir uydurmayla karşılaştırılmıştır, yukarıda belirtilenin ötesinde
  NEO, Aurora ya da EPED çıktılarına karşı kıyaslanmamıştır.
- **Fizik katmanının yazdığı cümleler** Türkçe arayüzde de İngilizce kalır (olaylar, uyarılar, sonlanma nedenleri, rapor notları).
- **1.5D model, hata denetimli ve olay konumlandırmalı TR-BDF2 çözücüden önceye göre yaklaşık <!--n:slower-->5 kat yavaştır**: yukarıdaki yakınsamanın bedeli
  ([docs/v4-numbers-diff.md](docs/v4-numbers-diff.md), bölüm 6).

## Başlıca fizik modelleri

<!-- table: models -->

| Alan | Model | Kaynak |
|---|---|---|
| Reaktivite ⟨σv⟩ | Bosch–Hale (D-T, D-D, D-³He), p-¹¹B için sayısal Maxwell ortalaması | Bosch & Hale, *NF* **32** (1992) 611; Nevins & Swain (2000) |
| Hapsetme | IPB98(y,2), ITPA20 ve ITPA20-IL, ITER89-P, ISS04, ST; L–H eşiği (Martin 2008, Ryter 2014 düşük yoğunluk kolu) | ITER Physics Basis (1999); Verdoolaege (2021) |
| 1.5D taşınım | τ_E ölçekli χ (PI denetleyici); kritik gradyan sertliği, ETB ve neoklasik taban; kritik gradyan, Bohm/gyro-Bohm ve IFS-PPPL kapanışları | METIS (Artaud 2018); Erba (1997); Kotschenreuther (1995) |
| Denge | Sabit sınırlı Grad–Shafranov (Miller sınırı, Shortley–Weller şablonları); doğrulama için Cerfon–Freidberg Solov'ev | Cerfon & Freidberg (2010) |
| Bootstrap ve iletkenlik | Sauter–Angioni–Lin-Liu; seçenek olarak Redl vd. | *Phys. Plasmas* **6** (1999) 2834; Redl (2021) |
| MHD olayları | Kadomtsev ve Porcelli testere dişleri, α_crit ve EPED1 tipi ELM'ler, değiştirilmiş Rutherford NTM | Kadomtsev (1975); Porcelli (1996); La Haye (2006) |
| Işıma | Bremsstrahlung (göreli), Albajar sinkrotron, Mavrin çizgi ışıması | Albajar (2001); Mavrin (2018) |
| Kenar | İki noktalı diverter modeli, Eich λ_q, Lengyel ışıması, ayrışma niteleyicisi | Stangeby (2018); Eich (2013); Kallenbach (2018) |
| Sınırlar ve disruption | Greenwald, Troyon β_N, q95; termal ve akım sönümü, halo akımları, kaçak elektronlar | Greenwald (1988); Hender (2007) |
| Zaman integrasyonu | 0D: Dormand–Prince RK5(4); 1.5D: hata denetimli ve olay konumlandırmalı TR-BDF2 | Hairer–Nørsett–Wanner |

Sabitler CODATA 2018'dir ve tüm iç hesaplar SI birimlerini kullanır. Kapanışların tam listesi, denklemler ve sayısal yöntemlerle birlikte [teknik raporda](docs/technical-report.md) yer alır.

## Şekiller

<!--n:figures-->9 makale şekli `npm run figures` ile üretilir (web için SVG, dergiler için gömülü STIX Two alt kümeli PDF 1.4); başlıklar
[`docs/figures/captions.md`](docs/figures/captions.md) içinde, her dosyanın kaynağı (sürüm, commit, yapılandırma özeti, tohumlar, SHA-256)
[`figures.manifest.json`](docs/figures/figures.manifest.json) içindedir. `npm run figures:check` onları yeniden üretir ve özetleri karşılaştırır.

<p align="center">
  <img src="docs/figures/fig03_timetraces.svg" alt="ITER 1.5D deşarjının zaman izleri" width="92%">
</p>

1. [Denge](docs/figures/fig01_equilibrium.svg) ([PDF](docs/figures/fig01_equilibrium.pdf))
2. [Radyal profiller](docs/figures/fig02_profiles.svg) ([PDF](docs/figures/fig02_profiles.pdf))
3. [Zaman izleri](docs/figures/fig03_timetraces.svg) ([PDF](docs/figures/fig03_timetraces.pdf))
4. [POPCON](docs/figures/fig04_popcon.svg) ([PDF](docs/figures/fig04_popcon.pdf))
5. [Doğrulama](docs/figures/fig05_validation.svg) ([PDF](docs/figures/fig05_validation.pdf))
6. [Reaktivite ve Lawson diyagramı](docs/figures/fig06_reactivity_lawson.svg) ([PDF](docs/figures/fig06_reactivity_lawson.pdf))
7. [Kod doğrulaması](docs/figures/fig07_verification.svg) ([PDF](docs/figures/fig07_verification.pdf))
8. [MHD olayları](docs/figures/fig08_mhd.svg) ([PDF](docs/figures/fig08_mhd.pdf))
9. [İşletme uzayı taraması](docs/figures/fig09_scan.svg) ([PDF](docs/figures/fig09_scan.pdf))

## Regresyon testi

Fiziği iki bağımsız güvenlik ağı korur. **Literatür doğrulaması** (`npm run validate`) her preset'in seçilmiş çıktılarını yayımlanmış aralıklarla karşılaştırır; büyüklük
mertebesi ve tutarlılık hatalarını yakalar. **Altın regresyon** (`npm run golden`) her sayısal kaymayı yakalar: <!--n:cases-->40 durum için (tüm preset'ler, ayrıca diğer yakıtlar,
çoğu isteğe bağlı modül ve 1.5D DIII-D ile MAST-U için varyantlar) `test/golden/<durum>.json` içinde belirlenimci bir anlık görüntü saklar (kaydın her sonlu skaleri, düz tepe
ortalamaları, her tanılamanın tüm koşu istatistikleri, olay sayıları, anahtar zaman izleri, geometri ve 1.5D'de her radyal profil ile son dengenin özeti) ve onu 1e-9 göreli
toleransla karşılaştırır (Node.js ana sürümleri arasında 1e-6). Uzun deşarjlar altın durumlarda kısaltılır (her dosyada kayıtlıdır). Bir değişikliğin sayıları oynatması
amaçlandığında, onları yeniden kaydedin ve nedenini söyleyin:

```bash
npm run golden:update -- --reason "switch the ELM model to ..."
npm run golden:update -- --reason "..." --only ITER15,DEMO15
```

Neden, her durumun oynayan anahtarlarıyla birlikte, yalnızca eklenen [`test/golden/CHANGES.md`](test/golden/CHANGES.md) günlüğüne eklenir.
Bu README'nin (ve README.tr.md'nin) sayıları, [`src/docs/readme.test.ts`](src/docs/readme.test.ts) tarafından altın dosyalara, literatür tablosuna ve kıyaslama kayıtlarına
bağlanır; böylece sessizce bayatlayamazlar.

## Proje yapısı

```text
src/physics/          fizik çekirdeği (tarayıcı güvenli, DOM ya da Node API'si yok)
  confinement/        0D modeller (magnetic, icf, mtf, frc, mirror, muon) ve ortak atış raporu
  profiles/           1.5D model: ızgara, sonlu hacim çözücüsü, TR-BDF2, kaynaklar, taşınım kapanışları, pedestal, safsızlıklar, hızlı iyonlar, olaylar
  equilibrium/        Grad–Shafranov: Miller sınırı, çözücü, akı yüzeyi ortalamaları, Solov'ev, serbest sınır yapı taşları
  edge/  systems/     iki noktalı diverter modeli; TF, merkezi solenoid, kriyo tesis, radyal yapı, maliyetler
  kernel/             parmak izi, kanonik serileştirme, SHA-256, hatalar
  config/             çalışma zamanı doğrulaması, JSON Şeması, noktalı yollar, runShot
  validation/         references.ts (literatür tablosu), metrikler, değerlendirme
  index.ts            genel kütüphane API'si
src/cli/              validate, golden, figures, missions, uq, scan, optimize ve fusion-sim; işçi havuzu
src/io/               CSV, NDJSON, NetCDF-3, IMAS benzeri JSON ve G-EQDSK yazıcıları ve okuyucuları
src/analysis/         belirsizlik nicemlemesi ve eniyileme
src/regression/       altın anlık görüntüler, karşılaştırıcı, numbers-diff testi
src/docs/             README'lerin sayılarını kaynaklarına bağlayan test
src/plot/             çizim motoru (SVG, PDF, yazı tipleri) ve makale şekilleri
src/ui/  src/worker/  React arayüzü ve benzetim işçileri
src/i18n/  src/edu/   İngilizce ve Türkçe metinler; Öğren görevleri ve sözlük
schema/               yapılandırma ve senaryo JSON Şemaları (üretilmiş)
python/               fusion_sim, komut satırının standart kütüphane tabanlı sarmalayıcısı
test/golden/          altın anlık görüntüler ve değişiklik günlüğü
bench/  scripts/      yakınsama ve başarım kıyaslamaları; ci:local, build:lib, release:check ve üreteçler
docs/                 config-reference.md, technical-report.md, v4-numbers-diff.md, dalga raporları, figures/
```

## Belgeler

- [Yapılandırma başvurusu](docs/config-reference.md): bir reaktör yapılandırmasının ve bir senaryonun her alanı, JSON Şemalarından üretilmiştir.
- [Teknik rapor](docs/technical-report.md): denklemler, sayısal yöntemler, kod doğrulaması ve doğrulama.
- [Sayıların öncesi ve sonrası](docs/v4-numbers-diff.md): başlıca sayılar önceki sürüme göre, her değişimin nedeniyle birlikte.
- v4 geliştirmesinin kapı raporları: [dalga 1](docs/v4-wave1-report.md), [dalga 2A](docs/v4-wave2a-report.md), [dalga 2B](docs/v4-wave2b-report.md).
- [Arayüz dili ve erişilebilirlik](docs/interface-language-and-accessibility.md), [CHANGELOG](CHANGELOG.md), [sürüm yayımlama](docs/RELEASING.md).

## Katkı, güvenlik, davranış kuralları

Katkılar memnuniyetle karşılanır: bkz. [CONTRIBUTING.md](CONTRIBUTING.md) (kurulum, denetimler, altın regresyon ve doğrulama politikaları, çeviriler).
Güvenlik sorunları özel olarak bildirilir: [SECURITY.md](SECURITY.md). Katılan herkes [Davranış Kuralları'na](CODE_OF_CONDUCT.md) uyar.

## Atıf

Bu yazılımı kullanıyorsanız, lütfen [`CITATION.cff`](CITATION.cff) içindeki bilgiyle atıf yapın (GitHub'da "Cite this repository").

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22259861.svg)](https://doi.org/10.5281/zenodo.22259861)

> Karatum, M. *Fusion Reactor Simulator*. Zenodo. [10.5281/zenodo.22259861](https://doi.org/10.5281/zenodo.22259861)

Rozet ve yukarıdaki satır, tüm sürümleri kapsayan ve her zaman en son sürüme çözülen kavram DOI'sini verir. 4.0.1 sürümünün DOI'si [10.5281/zenodo.23109193](https://doi.org/10.5281/zenodo.23109193) (4.0.0: [10.5281/zenodo.23100241](https://doi.org/10.5281/zenodo.23100241)); her sürümün DOI'si Zenodo'da listelenir.

## Yapay zeka yardımı

Yazılım, bağımsız araştırmacı olan yazar tarafından, yazarın yönlendirmesi ve incelemesi altında, yapay zeka kodlama asistanlarının (Anthropic'ten Claude Code,
OpenAI'den Codex ve MiMo) önemli yardımıyla geliştirilmiştir. Sayıların kanıtı testler, altın regresyon ve literatür tablosudur; asistanların ifadeleri değildir.

## Lisans

[MIT](LICENSE) © 2026 Mustafa Karatum
