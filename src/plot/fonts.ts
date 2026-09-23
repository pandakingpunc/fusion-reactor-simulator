/**
 * Yazı tipi metrikleri ve karakter eşlemeleri (PDF standart-14 yazı tipleri).
 *
 * Genişlikler 1000 birim/em (Adobe AFM: Times-Roman, Times-Italic, Symbol). İtalik ve bazı
 * nadir glifler yaklaşık değerlerdir — yalnız hizalama (ortalama/sağa yaslama) ve yerleşim
 * için kullanılır; PDF görüntüleyicisi gerçek genişliklerle çizer.
 */
export type FontKey = 'roman' | 'italic' | 'bold' | 'symbol';

// Times-Roman, ASCII 32…126
const ROMAN: number[] = [
  250, 333, 408, 500, 500, 833, 778, 333, 333, 333, 500, 564, 250, 333, 250, 278, // ␠ … /
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, // 0 … ?
  921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, // @ … O
  556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, // P … _
  333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, // ` … o
  500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541, // p … ~
];
// Times-Italic, ASCII 32…126 (AFM'ye yakın)
const ITALIC: number[] = [
  250, 333, 420, 500, 500, 833, 778, 333, 333, 333, 500, 675, 250, 333, 250, 278,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 675, 675, 675, 500,
  920, 611, 611, 667, 722, 611, 611, 722, 722, 333, 444, 667, 556, 833, 667, 722,
  611, 722, 611, 500, 556, 722, 611, 833, 611, 556, 556, 389, 278, 389, 422, 500,
  333, 500, 500, 444, 500, 444, 278, 500, 500, 278, 278, 444, 278, 722, 500, 500,
  500, 500, 389, 389, 278, 500, 444, 667, 444, 444, 389, 400, 275, 400, 541,
];
// Times-Bold, ASCII 32…126
const BOLD: number[] = [
  250, 333, 555, 500, 500, 1000, 833, 333, 333, 333, 500, 570, 250, 333, 250, 278,
  500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500,
  930, 722, 667, 722, 722, 667, 611, 778, 778, 389, 500, 778, 667, 944, 722, 778,
  611, 778, 722, 556, 667, 722, 722, 1000, 722, 722, 667, 333, 278, 333, 581, 500,
  333, 500, 556, 444, 556, 444, 333, 500, 556, 278, 333, 556, 278, 833, 556, 500,
  556, 556, 444, 389, 333, 556, 500, 722, 500, 500, 444, 394, 220, 394, 520,
];

/** Unicode → (Symbol yazı tipi kodu, genişlik) */
export const SYMBOL_MAP: Record<string, [number, number]> = {
  'α': [0x61, 631], 'β': [0x62, 549], 'χ': [0x63, 549], 'δ': [0x64, 494], 'ε': [0x65, 439], 'φ': [0x66, 521], 'γ': [0x67, 411],
  'η': [0x68, 603], 'ι': [0x69, 329], 'ϕ': [0x6a, 603], 'κ': [0x6b, 549], 'λ': [0x6c, 549], 'μ': [0x6d, 576], 'ν': [0x6e, 521],
  'ο': [0x6f, 549], 'π': [0x70, 549], 'θ': [0x71, 521], 'ρ': [0x72, 549], 'σ': [0x73, 603], 'τ': [0x74, 439], 'υ': [0x75, 576],
  'ω': [0x77, 686], 'ξ': [0x78, 493], 'ψ': [0x79, 686], 'ζ': [0x7a, 494], 'ϑ': [0x4a, 631],
  'Γ': [0x47, 603], 'Δ': [0x44, 612], 'Θ': [0x51, 741], 'Λ': [0x4c, 686], 'Ξ': [0x58, 645], 'Π': [0x50, 768], 'Σ': [0x53, 592],
  'Φ': [0x46, 763], 'Ψ': [0x59, 795], 'Ω': [0x57, 768],
  '−': [0x2d, 549], '±': [0xb1, 549], '×': [0xb4, 549], '÷': [0xb8, 549], '≈': [0xbb, 549], '≠': [0xb9, 549], '≤': [0xa3, 549],
  '≥': [0xb3, 549], '∝': [0xb5, 713], '∞': [0xa5, 713], '∂': [0xb6, 494], '∇': [0xd1, 713], '⟨': [0xe1, 329], '⟩': [0xf1, 329],
  '·': [0xd7, 250], '→': [0xae, 987], '←': [0xac, 987], '′': [0xa2, 247], '″': [0xb2, 411], '∫': [0xf2, 274], '√': [0xd6, 549],
  '∼': [0x7e, 549], '∈': [0xce, 713], '∑': [0xe5, 713], '∏': [0xd5, 823], '⋅': [0xd7, 250], '∘': [0xb0, 400], '|': [0x7c, 200],
};

/** WinAnsi (CP-1252) ile kodlanabilen Latin-1 dışı karakterler */
const WINANSI_EXTRA: Record<string, number> = {
  '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '€': 0x80, '‰': 0x89,
};

/** Bir karakterin (yazı tipi, kod, genişlik) çözümlemesi */
export function glyph(ch: string, font: FontKey): { font: FontKey; code: number; w: number } {
  if (font !== 'symbol') {
    const c = ch.charCodeAt(0);
    const table = font === 'italic' ? ITALIC : font === 'bold' ? BOLD : ROMAN;
    if (c >= 32 && c <= 126) return { font, code: c, w: table[c - 32] };
    // Latin-1 (× ± · ° µ ² ³ …) Times'ta WinAnsi ile mevcut — Symbol'e bağımlılığı azaltır
    if (c >= 0xa0 && c <= 0xff) return { font, code: c, w: ch === '×' || ch === '±' ? 564 : ch === '·' ? 250 : 500 };
    // eksi işareti: Times'ta WinAnsi en-dash (Symbol yazı tipi olmayan görüntüleyicilerde de görünür)
    if (ch === '−') return { font, code: 0x96, w: 500 };
    const wa = WINANSI_EXTRA[ch];
    if (wa !== undefined) return { font, code: wa, w: ch === '—' ? 1000 : 500 };
  }
  // ℓ (\ell): standart-14 yazı tiplerinde yok → italik l
  if (ch === 'ℓ') return { font: 'italic', code: 0x6c, w: ITALIC[0x6c - 32] };
  const s = SYMBOL_MAP[ch];
  if (s) return { font: 'symbol', code: s[0], w: s[1] };
  if (ch === '°') return { font: 'roman', code: 0xb0, w: 400 };
  return { font: font === 'symbol' ? 'roman' : font, code: 63 /* ? */, w: 444 };
}

/** Düz metin genişliği (pt) */
export function textWidth(s: string, size: number, font: FontKey = 'roman'): number {
  let w = 0;
  for (const ch of s) w += glyph(ch, font).w;
  return (w / 1000) * size;
}

/** Yazı tipi yükseklik metrikleri (em kesri) — Times */
export const ASCENT = 0.683, CAP = 0.662, DESCENT = 0.217, XHEIGHT = 0.45;
