# Füzyon Reaktörü Simülatörü

> 0-boyutlu (0D), zaman-çözümlü füzyon reaktörü güç-dengesi simülasyon motoru.
> Manyetik hapsetme (tokamak, sferik tokamak, stellarator) başta olmak üzere birden
> çok hapsetme yöntemini; gerçek makine preset'leriyle (ITER, JET, SPARC, DEMO, W7-X, …)
> açık literatürdeki ölçekleme yasaları ve reaksiyon verileri üzerinden modeller.

*A 0-D, time-resolved fusion reactor power-balance simulation engine written in
TypeScript. Models magnetic confinement (tokamak, spherical tokamak, stellarator)
and other schemes using published scaling laws and reaction data, with real-machine
presets (ITER, JET, SPARC, DEMO, W7-X, …).*

---

## Ne yapar?

Bir reaktör konfigürasyonu (geometri, manyetik alan, plazma akımı, yakıt, ısıtma,
besleme, safsızlık, mıknatıs teknolojisi vb.) alır ve plazmanın zaman içindeki
enerji/parçacık dengesini adaptif adımlı bir ODE entegratörüyle çözer. Çıktı olarak
sıcaklık, yoğunluk, füzyon gücü, **Q (kazanç)**, hapsetme süresi, radyasyon kayıpları,
işletme limitleri (Greenwald, β_N, q95) ve disruption olaylarını içeren bir zaman
serisi üretir.

### Modellenen fizik (özet)

| Alan | Model | Kaynak |
|---|---|---|
| Füzyon reaktivitesi `⟨σv⟩(T)` | Maxwell ortalaması, D-T / D-D / D-³He / p-¹¹B | Bosch & Hale, *Nucl. Fusion* **34** (1994) 611 |
| Enerji hapsetme `τ_E` | IPB98(y,2), ITER89-P, ISS04, ST, Bohm | ITER Physics Basis, *Nucl. Fusion* **39** (1999) 2175 |
| Bremsstrahlung + relativistik düzeltme | `n²√T` + Rider/Nevins terimleri | NRL Formulary; Rider (1995) |
| Senkrotron radyasyonu | Albajar–Johner–Granata | *Nucl. Fusion* (2001) |
| β limiti | Troyon `β_N` | Troyon *et al.*, *PPCF* **26** (1984) 209 |
| Yoğunluk limiti | Greenwald | Greenwald *et al.*, *Nucl. Fusion* **28** (1988) 2199 |
| Direnç / ohmik ısıtma | Spitzer + neoklasik düzeltme | Wesson, *Tokamaks* |
| Disruption | termal/akım quench, halo, kaçak elektron | Hender *et al.* (2007); Rosenbluth–Putvinski (1997) |
| Zaman entegrasyonu | Dormand–Prince RK5(4) adaptif | Hairer, Nørsett & Wanner |

Sabitler CODATA 2018. Tüm iç hesaplar SI birimindedir; birim dönüşümleri tek
dosyada (`units.ts`) toplanmıştır. Basitleştirmeler kod içinde `APPROXIMATION`
etiketiyle açıkça işaretlidir.

### Hazır preset'ler

ITER, JET (DTE2), SPARC, DIII-D, JT-60SA, MAST-U, Wendelstein 7-X, EU DEMO,
NIF, doğrudan-tahrik ICF, Z Machine (MagLIF), General Fusion, FRX-L, Zap FuZE-Q,
TAE Norman (FRC), tandem ayna, müon-katalizli füzyon. Değerler açık literatürdeki
tasarım/nominal parametrelerdir (kaynaklar `presets.ts` içinde).

## Proje yapısı

```
src/physics/
  constants.ts      Fiziksel sabitler (CODATA 2018)
  units.ts          Birim dönüşümleri (tek yer)
  geometry.ts       Toroidal geometri, profiller
  reactivity.ts     Bosch–Hale ⟨σv⟩(T)
  transport.ts      τ_E ölçeklemeleri, L–H eşiği
  radiation.ts      Bremsstrahlung, senkrotron, çizgi radyasyonu
  heating.ts        Ohmik, NBI, ICRH, ECRH, hızlı iyon paylaşımı
  limits.ts         Greenwald, β_N, q95 işletme limitleri
  disruption.ts     Termal/akım quench, halo, kaçak elektron
  engineering.ts    Mıknatıs, divertör, TBR, ekonomi
  integrator.ts     Dormand–Prince RK5(4) adaptif entegratör
  rng.ts            Deterministik PRNG (mulberry32)
  presets.ts        Gerçek makine konfigürasyonları
  simulation.ts     Simülasyon çalıştırıcı
  validation.cli.ts Doğrulama aracı (npm run validate)
  confinement/
    common.ts       Ortak altyapı (PulsedBase) + füzyon hız yardımcıları
    magnetic.ts     Manyetik hapsetme (tokamak/ST/stellarator)
    icf.ts          Eylemsizlik hapsetme (lazer ICF, ns)
    mtf.ts          Manyetize hedef füzyon / MagLIF / Z-pinch (µs)
    frc.ts          Alan-tersinmiş konfigürasyon (FRC)
    mirror.ts       Manyetik ayna (uç kaybı)
    muon.ts         Müon-katalizli füzyon (easter egg)
src/worker/         Web-worker (protokol + simülasyon çalıştırıcı)
src/ui/             React arayüzü (sihirbaz, grafikler, animasyon, rapor)
src/App.tsx, src/main.tsx   Uygulama girişi
docs/
  technical-report.md   Teknik rapor
```

## Kurulum ve çalıştırma

Gereksinim: Node.js 18+.

```bash
npm install
npm run dev        # geliştirme sunucusu (Vite)
npm run build      # tip kontrolü + üretim derlemesi
npm test           # birim testler (vitest)
```

## Durum / yol haritası

- ✅ Çekirdek fizik modülleri ve **tüm hapsetme modelleri** tamamlandı: manyetik
  (tokamak/ST/stellarator), ICF, MTF/MagLIF/Z-pinch, FRC, manyetik ayna, müon-katalizli.
- ✅ Fizik motoru tip-güvenli (`tsc` temiz) ve `npm run validate` ile 17 preset
  literatüre karşı doğrulanıyor (JET 58 MJ, NIF G≈1.5, ITER Q≈16 vb.).
- ✅ Web arayüzü tamamlandı (`npm run build` temiz): kurulum sihirbazı
  (Yöntem → Geometri → Yakıt → Mıknatıs/Sürücü → Isıtma & Besleme → Çalıştır),
  17 gerçek makine preseti, web-worker'da koşan canlı simülasyon (oynat/duraklat,
  0.1×–100×, geri sarma, canlı müdahale kaydırıcıları), yakınlaştırılabilir
  zaman grafikleri, canlı POPCON, poloidal kesit, ICF/MTF implozyon animasyonu,
  rapor ekranı (CSV/JSON dışa aktarma), yan yana atış karşılaştırma ve
  **Doğrulama** sekmesi (ITER / JET DTE2 / NIF tarayıcı içinde koşar).
- Arayüz dosyaları: `src/worker/` (protokol + worker), `src/ui/` (wizard, charts,
  viz, run, report), `src/App.tsx`, `src/main.tsx`.

> **Bilimsel doğruluk uyarısı:** Bu bir 0D mühendislik/eğitim aracıdır, tam bir
> transport/MHD kodu değildir. Sonuçlar mertebe-doğruluğundadır ve makine tasarımı
> için birincil kaynak olarak kullanılmamalıdır.

## Atıf

Bu projeyi kullanırsanız lütfen `CITATION.cff` dosyasındaki bilgiyle atıf yapın
(GitHub sağ menüsündeki **"Cite this repository"**). Zenodo DOI'si yayımlandıktan
sonra buraya eklenecektir.

## Lisans

[MIT](LICENSE) © 2026 Mustafa Karatum
