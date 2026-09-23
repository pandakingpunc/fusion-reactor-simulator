# Füzyon Reaktörü Simülatörü

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22259861.svg)](https://doi.org/10.5281/zenodo.22259861)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Zaman-çözümlü füzyon reaktörü simülasyon motoru: **0D** güç dengesi ve (v3.0'da yeni)
> **1.5D radyal taşınım + Grad–Shafranov dengesi**. Tokamak, sferik tokamak, stellarator,
> lazer ICF, MTF/MagLIF/Z-pinch, FRC, manyetik ayna ve müon-katalizli füzyon; gerçek makine
> preset'leri (ITER, JET, SPARC, DEMO, W7-X, NIF, …). Tarayıcıda çalışır, bağımlılıksızdır.

*A time-resolved fusion reactor simulator in TypeScript: 0D power balance and — new in
v3.0 — a 1.5D transport model (T_e, T_i, n_e, poloidal flux on ρ_tor) coupled to a
fixed-boundary Grad–Shafranov equilibrium, with Sauter bootstrap current, NBI/RF sources,
beam–target fusion, sawteeth, ELMs and NTMs; verified against manufactured solutions and
validated against ITER, JET DTE2, SPARC, EU DEMO and NIF. Publication-quality SVG/PDF
figures and multi-core parameter scans are built in.*

<p align="center">
  <img src="docs/figures/fig01_equilibrium.svg" alt="Grad–Shafranov equilibrium" width="92%">
</p>

---

## v3.0'da neler yeni?

| Alan | Yenilik |
|---|---|
| **1.5D taşınım** | ρ̂ = √(Φ/Φ_b) üzerinde T_e, T_i, n_e, ψ; örtük sonlu hacim (geri Euler + Picard), T_e/T_i 2×2 blok üçlü-köşegen, Scharfetter–Gummel yoğunluk akısı, akım difüzyonu (I_p Neumann) |
| **Grad–Shafranov dengesi** | Sabit sınır (Miller), Shortley–Weller sonlu farklar, bantlı LU (bir kez), Picard; akı yüzeyi izleme, tam tuzaklı-parçacık oranı, q, ℓ_i, β_p, Shafranov kayması; taşınımla yarı-statik bağlaşım |
| **Neoklasik** | Sauter bootstrap akımı ve iletkenlik, Chang–Hinton iyon tabanı |
| **Kaynaklar** | 3-bileşenli NBI demet zayıflaması + demet-hedef füzyonu, ECRH/ICRH Gauss birikimi, NBCD/ECCD |
| **MHD** | Kadomtsev testere dişi (kayma tetikli), tip-I ELM (α_crit + KBM), modifiye Rutherford NTM, L–H histerezisi |
| **Sayısal doğrulama** | GS 2. derece (2.05), FV ısı 2. derece (1.94), geri Euler 1. derece (0.99), DP5 vs RK4/Euler iş–hassasiyet; 44 birim testi |
| **POPCON** | 0D modelle aynı fizik: seyrelme (Be/Ar/He külü), çizgi + senkrotron ışınımı, P_loss = P_heat − P_rad |
| **Figürler** | Bağımlılıksız çizim motoru → SVG + PDF (Times/Symbol, mini-TeX etiketler, Okabe–Ito paleti, dergi sütun genişlikleri); `npm run figures` |
| **Çok çekirdek** | `worker_threads` havuzu: doğrulama ve parametre taramaları paralel |
| **Arayüz** | Sihirbazda 0D/1.5D seçimi ve 1.5D ayarları, canlı radyal profil grafiği, GS akı yüzeyli kesit, rapordan SVG/PDF figür dışa aktarımı, 1.5D doğrulama testi |

## Hızlı başlangıç

Gereksinim: Node.js 18+.

```bash
npm install
npm run dev        # arayüz (Vite) → http://localhost:5173
npm test           # 44 birim testi (vitest)
npm run validate   # 25 preset, 19 literatür ölçütü, işçi havuzunda paralel (~45 s)
npm run figures    # makale figürleri → docs/figures/*.svg|pdf + captions.md (~1 MB, ~55 s)
npm run build      # tip denetimi + üretim derlemesi
```

`validate` seçenekleri: `--threads N`, `--only ITER15,JET15`.
`figures` seçenekleri: `--only popcon,mhd`, `--scan 7` (tarama ızgarası), `--formats pdf`, `--out DIR`.

## Doğrulama özeti

| Büyüklük | Referans | 0D | 1.5D |
|---|---|---|---|
| ITER Q (düz tepe) | 10 | 14.0 | **9.8** |
| ITER P_fus | 500 MW | 715 MW | **491 MW** |
| ITER f_bs / ℓ_i(3) / q95 | ≈0.2 / 0.85 / 3.0 | — | 0.22 / 0.73 / 3.5 |
| JET DTE2 E_fus | 59 MJ | 58 MJ | 85 MJ¹ |
| SPARC P_fus | 140 MW | 182 MW | 157 MW |
| EU DEMO P_fus | 2 GW | 2.2 GW | 1.95 GW |
| NIF N221204 kazanç | 1.54 | 1.49 | — |

¹ 1.5D'de füzyonun ≈ %60'ı NBI demet-hedef reaksiyonlarından gelir (TRANSP analizleriyle nitel
uyumlu); pay, hızlı iyon yavaşlama modeline duyarlıdır. Ayrıntılar: [teknik rapor](docs/technical-report.md) §7.

<p align="center">
  <img src="docs/figures/fig03_timetraces.svg" alt="ITER 1.5D time traces" width="92%">
</p>

## Modellenen fizik

| Alan | Model | Kaynak |
|---|---|---|
| Reaktivite ⟨σv⟩ | Bosch–Hale (D-T, D-D, D-³He), p-¹¹B sayısal Maxwell ortalaması | Bosch & Hale, *NF* **32** (1992) 611; Nevins & Swain (2000) |
| Hapsetme | IPB98(y,2), ITER89-P, ISS04, ST; L–H eşiği (Martin 2008) | ITER Physics Basis (1999) |
| 1.5D taşınım | τ_E-ölçekli χ (PI denetleyici) + kritik-gradyan sertliği, ETB, neoklasik taban; alternatif CGM | METIS (Artaud 2018); Garbet (2004) |
| Denge | Sabit-sınırlı Grad–Shafranov; Cerfon–Freidberg Solov'ev (doğrulama) | Cerfon & Freidberg (2010); Jeon (2015) |
| Bootstrap / iletkenlik | Sauter–Angioni–Lin-Liu | *Phys. Plasmas* **6** (1999) 2834 |
| MHD olayları | Kadomtsev, α_crit ELM, modifiye Rutherford NTM | Kadomtsev (1975); La Haye (2006) |
| Işınım | Bremsstrahlung (relativistik), Albajar senkrotron, Mavrin çizgi | Albajar (2001); Mavrin (2018) |
| Kenar | İki-nokta SOL, Eich λ_q | Stangeby (2000); Eich (2013) |
| Limitler / disruption | Greenwald, Troyon β_N, q95; TQ/CQ, halo, kaçak elektron | Greenwald (1988); Hender (2007) |
| Zaman entegrasyonu | 0D: Dormand–Prince RK5(4); 1.5D: örtük geri Euler + Picard | Hairer–Nørsett–Wanner |

Sabitler CODATA 2018, iç hesaplar SI; basitleştirmeler kodda `APPROXIMATION` etiketiyle işaretli.

## Proje yapısı

```
src/physics/
  confinement/        0D modeller (magnetic, icf, mtf, frc, mirror, muon) + ortak rapor
  profiles/           1.5D model: geometry1d, fvsolver, neoclassical, sources, beamtarget, mhd, model, defaults
  equilibrium/        Grad–Shafranov: miller (sınır), solovev (analitik), gs (çözücü), fluxsurface (ortalamalar)
  numerics/           linalg (Thomas, blok, bantlı LU), quadrature, interp (spline/PCHIP/bikübik), roots, rk4
  popcon.ts           Kararlı-durum POPCON (0D ile tutarlı fizik)
  integrator.ts       Dormand–Prince RK5(4)
  simulation.ts       Ortak sürücü (0D/1.5D seçimi, kayıt, geri sarma)
  validation.cli.ts   npm run validate (işçi havuzu)
src/cli/              pool (worker_threads), presetRunner.worker, figures.cli (npm run figures)
src/plot/             Çizim motoru: figure, svg, pdf, png, mathtext, fonts, ticks, contour, colors
  figures/            Makale figürleri (equilibrium, profiles, timetrace, popcon, validation, reactivity, verification, mhd, scan, generic)
src/worker/, src/ui/  Web-worker ve React arayüzü
docs/
  technical-report.md Teknik rapor (denklemler, sayısal yöntemler, doğrulama, figürler)
  figures/            Üretilmiş figürler (SVG + PDF) ve captions.md
```

## Kaynak kullanımı

Simülasyonlar ham veri veya log dosyası yazmaz; geçmiş kareleri düzenli çıktı aralığında
tutulur, profiller yalnız bu karelere eklenir. Tüm figür seti ≈ 1 MB'tır. İşçi havuzu varsayılan
olarak `çekirdek − 1` iş parçacığı kullanır (`--threads` ile sınırlandırılabilir).

> **Bilimsel doğruluk uyarısı:** Bu bir eğitim, ön-tasarım ve senaryo keşif aracıdır; tam bir
> serbest-sınır/türbülans/doğrusal-olmayan MHD kodu değildir. Sınırlamalar teknik raporun
> §11'inde listelenmiştir. Makine tasarımı için birincil kaynak olarak kullanılmamalıdır.

## Atıf

Bu projeyi kullanırsanız lütfen `CITATION.cff` dosyasındaki bilgiyle atıf yapın (GitHub'da
**"Cite this repository"**). Tüm sürümleri temsil eden kavram DOI'si:
[10.5281/zenodo.22259861](https://doi.org/10.5281/zenodo.22259861).

## Lisans

[MIT](LICENSE) © 2026 Mustafa Karatum
