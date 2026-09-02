# Füzyon Reaktörü Simülatörü — Teknik Rapor

**Yazar:** Mustafa Karatum  <!-- TODO: ismini/ORCID'ini doğrula -->
**Sürüm:** 0.1.0
**Tarih:** 2 Eylül 2026
**Lisans:** MIT (kod), CC-BY-4.0 (bu rapor önerilir)

---

## Özet

Bu rapor, açık kaynaklı bir **0-boyutlu (0D), zaman-çözümlü füzyon reaktörü güç-dengesi
simülasyon motorunu** tanımlar. Motor, plazmanın hacim-ortalamalı enerji ve parçacık
dengesini adaptif adımlı bir Dormand–Prince RK5(4) entegratörüyle çözer ve zaman içinde
sıcaklık, yoğunluk, füzyon gücü, enerji kazancı *Q*, hapsetme süresi, radyasyon kayıpları,
işletme limitleri ve disruption olaylarını üretir. Tüm ilişkiler açık literatürdeki
ölçekleme yasaları, reaksiyon verileri ve sistem-kodu düzeyindeki mühendislik bağıntılarına
dayanır. Manyetik hapsetme (tokamak, sferik tokamak, stellarator) yolu tamamlanmış olup
ITER, JET, SPARC, EU DEMO ve Wendelstein 7-X gibi gerçek makinelerin nominal
parametreleriyle karşılaştırma preset'leri içerir.

**Anahtar kelimeler:** nükleer füzyon, tokamak, plazma fiziği, güç dengesi, hapsetme
ölçeklemesi, reaktör simülasyonu.

---

## 1. Giriş

Manyetik ve eylemsizlik hapsetmeli füzyon reaktörlerinin başarımı, füzyon güç kazancının
kaynak (ısıtma) ve kayıp (taşınım, radyasyon) mekanizmalarına karşı dengesiyle belirlenir.
Tam 3B transport/MHD kodları (ör. TRANSP, JINTRAC) yüksek doğruluk sağlar ancak
hesaplama açısından pahalıdır ve kurulum gerektirir. Buna karşılık **0D güç-dengesi
modelleri**, tasarım uzayının hızlı taranması, eğitim ve mertebe-doğruluğunda fizibilite
analizi için yaygın olarak kullanılır (ör. Sheffield, PROCESS sistem kodları).

Bu çalışma, tarayıcıda çalışabilen, bağımlılığı düşük, tamamen tip-güvenli (TypeScript)
bir 0D motorunu sunar. Tasarım ilkeleri:

1. **İzlenebilirlik:** Her bağıntının literatür kaynağı kod içinde belirtilir.
2. **Birim disiplini:** İç hesaplar tümüyle SI'dır; dönüşümler tek dosyada toplanır.
3. **Şeffaf basitleştirme:** Yaklaşımlar `APPROXIMATION` etiketiyle işaretlenir.
4. **Belirlenimcilik:** Sabit tohumlu (seed) PRNG ile stokastik olaylar (ELM, jitter)
   yeniden üretilebilir.

## 2. Model mimarisi

Plazma, hacim-ortalamalı tek bir bölge olarak ele alınır; radyal profiller sabit
şekilli varsayılır ve profil-tepe (peaking) düzeltmeleri katsayılara dahil edilir.
Manyetik model için durum vektörü **y**:

| İndis | Değişken | Birim | Açıklama |
|---|---|---|---|
| 0 | `W_e` | J | Elektron termal enerjisi |
| 1 | `W_i` | J | İyon termal enerjisi |
| 2 | `n_a` | m⁻³ | Yakıt a (ör. D) yoğunluğu |
| 3 | `n_b` | m⁻³ | Yakıt b (T / D / ³He / ¹¹B) yoğunluğu |
| 4 | `n_He` | m⁻³ | Kül (⁴He) yoğunluğu |
| 5 | `n_Z` | m⁻³ | Safsızlık yoğunluğu |
| 6 | `W_f` | J | Hızlı iyon (alfa + NBI) enerjisi |
| 7 | `I_p` | A | Plazma akımı |
| 8 | `E_fus` | J | Kümülatif füzyon enerjisi |
| 9–13 | — | — | Enerji/parçacık muhasebesi (T yakıt yanması vb.) |

### 2.1 Yönetici denklemler

Elektron ve iyon kanalları için hacim-ortalamalı enerji dengesi:

```
dW_e/dt = P_oh + P_aux,e + P_f,e − P_brems − P_sync − P_line − P_ei − W_e/τ_E
dW_i/dt = P_aux,i + P_f,i + P_ei − W_i/τ_E
```

Burada `P_oh` ohmik ısıtma, `P_aux` yardımcı ısıtma (kanallara pay edilmiş),
`P_f` füzyon ürünlerinin (alfa) termalizasyonuyla aktarılan güç, `P_ei` elektron–iyon
eşitlenme gücü, `P_brems`/`P_sync`/`P_line` radyasyon kayıpları ve `W/τ_E` taşınım
kaybıdır. Parçacık dengeleri yakıt tüketimi, kül birikimi, besleme kaynağı ve
`τ_p`, `τ_He` kaçış sürelerini içerir.

## 3. Fizik modülleri

### 3.1 Füzyon reaktivitesi ⟨σv⟩(T)

Maxwell dağılımı üzerinden ısıl reaktivite, Bosch–Hale parametrizasyonuyla hesaplanır
[1]:

```
⟨σv⟩ = C1 · θ · sqrt(ξ / (m_r c² T³)) · exp(−3ξ)      [cm³/s],  T [keV]
θ = T / (1 − T(C2 + T(C4 + T·C6)) / (1 + T(C3 + T(C5 + T·C7))))
ξ = (B_G² / (4θ))^(1/3)
```

D–T, D–D (her iki dal), D–³He katsayıları Bosch–Hale Tablo VII'den; p–¹¹B için
Nevins & Swain [2] bağıntısı kullanılır. Reaksiyon enerjileri Bosch–Hale Tablo I ve
NRL Formulary'den alınır.

### 3.2 Enerji hapsetme süresi τ_E

Birden çok ölçekleme desteklenir. Referans, ITER IPB98(y,2) ELMy H-modu
ölçeklemesidir [3]:

```
τ_E,th = 0.0562 · I^0.93 · B^0.15 · n19^0.41 · P^−0.69 · R^1.97 · κ_a^0.78 · ε^0.58 · M^0.19
```

(I: MA, B: T, n₁₉: 10¹⁹ m⁻³, P: MW, R: m, κ_a: alan elongasyonu, ε=a/R, M: amu).
Ayrıca ITER89-P (L-modu), stellaratorlar için ISS04, sferik tokamaklar için Valovič-tipi
ölçekleme, ve Bohm/Pastukhov limitleri mevcuttur. Bir H-faktörü (H98) çarpanı
uygulanır ve L–H güç eşiği kontrol edilir.

### 3.3 Radyasyon kayıpları

**Bremsstrahlung** (relativistik düzeltmeli) [4]:

```
P_br = 5.35e-37 · n_e² · √T_e · [ Z_eff(1 + 0.7936 t + 1.874 t²) + (3/√2) t ]   [W/m³],   t = T_e / m_e c²
```

Yüksek sıcaklık düzeltmesi özellikle ileri yakıtlar (p–¹¹B) için kritiktir.
**Senkrotron** kayıpları Albajar–Johner–Granata bağıntısıyla; **çizgi radyasyonu**
safsızlık türüne bağlı soğutma oranlarıyla hesaplanır.

### 3.4 Isıtma ve direnç

Spitzer paralel direnci, neoklasik (tuzaklı-parçacık) düzeltmeyle [5]:

```
η_∥ = 1.65e-9 · Z_eff · lnΛ / T_e^1.5 ,   η_neo = η_Sp / (1 − √ε)²
```

Ohmik güç `P_oh = η · j²` üzerinden; NBI, ICRH ve ECRH yardımcı ısıtma güçleri
elektron/iyon kanallarına fiziksel oranlarla pay edilir. Hızlı iyon yavaşlama gecikmesi
birinci-derece bir lag ile modellenir.

### 3.5 İşletme limitleri

- **Greenwald yoğunluk limiti** [6]: `n_G [10²⁰ m⁻³] = I_p[MA] / (π a²)`
- **Normalize beta (Troyon)** [7]: `β_N = β_T[%] · a · B / I_p`; ideal MHD sınırı
  ≈ 2.8 (duvarsız), 3.5–4 (şekilli/duvarlı).
- **q95 güvenlik faktörü** alt sınırı.

Bu limitler her adımda kontrol edilir ve aşımda disruption tetiklenebilir.

### 3.6 Disruption fiziği

Termal quench, akım quench, halo akımı, kaçak (runaway) elektron üretimi ve duvar ısı
yükü, Hender *et al.* [8] ve Rosenbluth–Putvinski [9] çerçevesinde modellenir. Halo
akımı × toroidal tepe faktörü çarpımı ITER tasarım sınırıyla (≈0.75) kıyaslanır.

### 3.7 Mühendislik ve ekonomi

Mıknatıs teknolojileri (Cu, NbTi, Nb₃Sn, REBCO) iletken tepe alanı ve yapısal gerilme
sınırlarıyla; divertör ısı akısı, nötron duvar yükü, trityum üretim oranı (TBR) ve
basit bir maliyet/kullanılabilirlik modeli sistem-kodu düzeyinde (Sheffield, PROCESS
benzeri) ele alınır. Bu ilişkiler `APPROXIMATION` etiketlidir.

## 4. Sayısal yöntem

Zaman entegrasyonu, gömülü hata tahminli **Dormand–Prince RK5(4)** çiftiyle yapılır
[10]. Adım boyutu `dt`, bağıl/mutlak tolerans (rtol/atol) hedefine göre otomatik
ayarlanır; disruption gibi hızlı geçişlerde küçülür. Negatif olmayan bileşenler
(yoğunluk, enerji) kenetlenir. Stokastik olaylar (ELM, sawtooth, jitter) belirlenimci
bir mulberry32 PRNG'den beslenir; böylece aynı tohum aynı zaman serisini üretir.

## 5. Preset'ler ve doğrulama

Motor, açık literatürdeki tasarım/nominal parametrelerle 20'den fazla makine preset'i
içerir. Örnek beklenen çıktılar:

| Preset | Parametreler | Beklenen |
|---|---|---|
| ITER | R=6.2 m, B=5.3 T, I_p=15 MA, 50 MW | Q ≈ 10, T_i ≈ 8–20 keV, P_fus ≈ 500 MW |
| JET DTE2 | R=2.96 m, B=3.7 T, I_p=3.5 MA, 5 s | E_fus ≈ 59 MJ |
| SPARC | REBCO 12.2 T, R=1.85 m, 25 MW | Q ≈ 2–11 |
| EU DEMO | R=9.07 m, B=5.86 T, I_p=17.75 MA | P_fus ≈ 2 GW |

> **Not:** Doğrulama, yayımlanmış tasarım hedeflerine karşı mertebe/tutarlılık
> düzeyindedir. Otomatik regresyon testleri geliştirme aşamasındadır.

## 6. Sınırlamalar

- **0D varsayımı:** Radyal profiller çözülmez; profil etkileri sabit katsayılarla
  yaklaşıklanır.
- **MHD ve türbülans** ayrıntılı modellenmez; kararlılık limitleri ampirik eşiklerle
  temsil edilir.
- **Safsızlık taşınımı** basitleştirilmiştir.
- Sonuçlar **eğitim ve ön-tasarım** amaçlıdır; makine mühendisliği kararları için
  birincil kaynak değildir.

## 7. Yeniden üretilebilirlik

Kaynak kod ve bu rapor açık lisansla yayımlanmıştır. Kurulum:

```bash
npm install
npm test        # birim testler
npm run dev     # etkileşimli çalıştırma
```

Her simülasyon, konfigürasyon + tohum ile tam olarak yeniden üretilebilir.

## Kaynakça

[1] H.-S. Bosch, G. M. Hale, "Improved formulas for fusion cross-sections and thermal
reactivities," *Nuclear Fusion* **34** (1994) 611.

[2] W. M. Nevins, R. Swain, "The thermonuclear fusion rate coefficient for p–¹¹B
reactions," *Nuclear Fusion* **40** (2000) 865.

[3] ITER Physics Expert Groups, "ITER Physics Basis, Chapter 2: Plasma confinement and
transport," *Nuclear Fusion* **39** (1999) 2175.

[4] NRL Plasma Formulary; S. Atzeni, J. Meyer-ter-Vehn, *The Physics of Inertial
Fusion*; ilgili relativistik Bremsstrahlung düzeltmeleri (Rider 1995; Nevins 1998).

[5] J. Wesson, *Tokamaks*, 4. baskı, Oxford University Press.

[6] M. Greenwald *et al.*, "A new look at density limits in tokamaks," *Nuclear Fusion*
**28** (1988) 2199.

[7] F. Troyon *et al.*, "MHD-limits to plasma confinement," *Plasma Physics and
Controlled Fusion* **26** (1984) 209.

[8] T. C. Hender *et al.*, "Chapter 3: MHD stability, operational limits and
disruptions," *Nuclear Fusion* **47** (2007) S128.

[9] M. N. Rosenbluth, S. V. Putvinski, "Theory for avalanche of runaway electrons in
tokamaks," *Nuclear Fusion* **37** (1997) 1355.

[10] E. Hairer, S. P. Nørsett, G. Wanner, *Solving Ordinary Differential Equations I:
Nonstiff Problems*, Springer.

---

*Bu rapor, ilgili yazılım deposuyla birlikte arşivlenmek üzere hazırlanmıştır. Yazılım
DOI'si ve depo bağlantısı yayımlandığında bu belgeye eklenecektir.*
