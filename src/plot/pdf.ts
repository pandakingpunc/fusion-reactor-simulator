/**
 * PDF arka ucu: görüntü listesi → tek sayfalık vektör PDF 1.4 (dergi/LaTeX için).
 * Yazı tipleri: standart-14 Type1 (Times-Roman/Italic/Bold, Symbol) — gömülmez; derginin gömülü
 * yazı tipi istemesi halinde: gs -dNOPAUSE -dBATCH -sDEVICE=pdfwrite -dEmbedAllFonts=true ...
 * Görüntüler FlateDecode (deflate verilmezse sıkıştırmasız "stored" zlib blokları).
 */
import { DisplayList, PathCmd, Style, baselineOffset } from './canvas';
import { Deflate, zlibStored } from './png';
import { FontKey, glyph } from './fonts';
import { runsWidth } from './mathtext';

const n = (x: number) => (Math.abs(x) < 1e-9 ? '0' : (Math.round(x * 1000) / 1000).toString());
const FONT_RES: Record<FontKey, string> = { roman: 'F1', italic: 'F2', bold: 'F3', symbol: 'F4' };

function pdfString(codes: number[]): string {
  let s = '(';
  for (const c of codes) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s + ')';
}

class Bytes {
  private parts: Uint8Array[] = [];
  length = 0;
  str(s: string): void { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; this.bin(b); }
  bin(b: Uint8Array): void { this.parts.push(b); this.length += b.length; }
  concat(): Uint8Array { const o = new Uint8Array(this.length); let p = 0; for (const b of this.parts) { o.set(b, p); p += b.length; } return o; }
}

export function toPDF(dl: DisplayList, o: { deflate?: Deflate; title?: string; creator?: string } = {}): Uint8Array {
  const W = dl.width, H = dl.height;
  const Y = (y: number) => H - y;
  const c: string[] = [];
  const alphas = new Map<number, string>();
  const images: { name: string; w: number; h: number; rgb: Uint8Array; smooth: boolean }[] = [];
  const gsFor = (a: number) => { const k = Math.round(a * 1000) / 1000; if (!alphas.has(k)) alphas.set(k, `GS${alphas.size + 1}`); return alphas.get(k)!; };
  const pathOps = (d: PathCmd[]) => d.map((q) => q[0] === 'Z' ? 'h' : q[0] === 'M' ? `${n(q[1])} ${n(Y(q[2]))} m` : q[0] === 'L' ? `${n(q[1])} ${n(Y(q[2]))} l`
    : `${n(q[1])} ${n(Y(q[2]))} ${n(q[3])} ${n(Y(q[4]))} ${n(q[5])} ${n(Y(q[6]))} c`).join(' ');
  const styleOps = (s: Style) => {
    const a: string[] = [];
    if (s.stroke) a.push(`${n(s.stroke[0])} ${n(s.stroke[1])} ${n(s.stroke[2])} RG`, `${n(s.lw ?? 1)} w`, `[${(s.dash ?? []).map(n).join(' ')}] 0 d`,
      `${s.cap === 'round' ? 1 : s.cap === 'square' ? 2 : 0} J`, `${s.join === 'round' ? 1 : s.join === 'bevel' ? 2 : 0} j`);
    if (s.fill) a.push(`${n(s.fill[0])} ${n(s.fill[1])} ${n(s.fill[2])} rg`);
    if (s.alpha !== undefined && s.alpha < 1) a.push(`/${gsFor(s.alpha)} gs`);
    return a.join(' ');
  };
  for (const p of dl.prims) {
    switch (p.t) {
      case 'path': {
        const paint = p.s.fill && p.s.stroke ? 'B' : p.s.fill ? 'f' : p.s.stroke ? 'S' : 'n';
        c.push(`q ${styleOps(p.s)} ${pathOps(p.d)} ${paint} Q`);
        break;
      }
      case 'clip': c.push(`q ${n(p.x)} ${n(Y(p.y + p.h))} ${n(p.w)} ${n(p.h)} re W n`); break;
      case 'unclip': c.push('Q'); break;
      case 'image': {
        const name = `Im${images.length + 1}`;
        images.push({ name, w: p.w, h: p.h, rgb: p.rgb, smooth: p.smooth });
        c.push(`q ${n(p.dw)} 0 0 ${n(p.dh)} ${n(p.x)} ${n(Y(p.y + p.dh))} cm /${name} Do Q`);
        break;
      }
      case 'text': {
        const w = runsWidth(p.runs, p.size);
        const dx = p.anchor === 'middle' ? -w / 2 : p.anchor === 'end' ? -w : 0;
        const dy = -baselineOffset(p.baseline, p.size); // metin uzayında (y yukarı)
        const th = (p.rotate * Math.PI) / 180, co = Math.cos(th), si = Math.sin(th);
        const ops: string[] = [`q ${n(p.color[0])} ${n(p.color[1])} ${n(p.color[2])} rg BT`];
        ops.push(`${n(co)} ${n(si)} ${n(-si)} ${n(co)} ${n(p.x)} ${n(Y(p.y))} Tm ${n(dx)} ${n(dy)} Td`);
        let curFont = '', curSize = -1;
        for (const r of p.runs) {
          const size = p.size * r.scale;
          ops.push(`${n(r.rise * p.size)} Ts`);
          // çalıştırmayı çözümlenmiş yazı tipi parçalarına böl (ör. roman içinde Yunan harfi → Symbol)
          let seg: number[] = [], segFont: FontKey | null = null;
          const flush = () => {
            if (!seg.length || !segFont) return;
            const res = FONT_RES[segFont];
            if (res !== curFont || size !== curSize) { ops.push(`/${res} ${n(size)} Tf`); curFont = res; curSize = size; }
            ops.push(`${pdfString(seg)} Tj`);
            seg = [];
          };
          for (const ch of r.text) {
            const g = glyph(ch, r.font);
            if (g.font !== segFont) { flush(); segFont = g.font; }
            seg.push(g.code);
          }
          flush();
        }
        ops.push('ET Q');
        c.push(ops.join(' '));
        break;
      }
    }
  }
  // belge
  const content = c.join('\n');
  const contentBytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) contentBytes[i] = content.charCodeAt(i) & 255;
  const b = new Bytes();
  const offsets: number[] = [];
  const obj = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = b.length;
    b.str(`${id} 0 obj\n${body}\n`);
    if (stream) { b.str('stream\n'); b.bin(stream); b.str('\nendstream\n'); }
    b.str('endobj\n');
  };
  b.str('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const fontIds = { F1: 5, F2: 6, F3: 7, F4: 8 };
  let next = 9;
  const gsIds = [...alphas.entries()].map(([a, name]) => ({ a, name, id: next++ }));
  const imgIds = images.map((im) => ({ ...im, id: next++ }));
  const infoId = next++;
  const res = `<< /Font << /F1 ${fontIds.F1} 0 R /F2 ${fontIds.F2} 0 R /F3 ${fontIds.F3} 0 R /F4 ${fontIds.F4} 0 R >>` +
    (gsIds.length ? ` /ExtGState << ${gsIds.map((g) => `/${g.name} ${g.id} 0 R`).join(' ')} >>` : '') +
    (imgIds.length ? ` /XObject << ${imgIds.map((g) => `/${g.name} ${g.id} 0 R`).join(' ')} >>` : '') + ' /ProcSet [/PDF /Text /ImageC] >>';
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(W)} ${n(H)}] /Resources ${res} /Contents 4 0 R >>`);
  const stream = o.deflate ? o.deflate(contentBytes) : contentBytes;
  obj(4, `<< /Length ${stream.length}${o.deflate ? ' /Filter /FlateDecode' : ''} >>`, stream);
  obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>');
  obj(6, '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>');
  obj(7, '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>');
  obj(8, '<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>');
  for (const g of gsIds) obj(g.id, `<< /Type /ExtGState /CA ${n(g.a)} /ca ${n(g.a)} >>`);
  for (const im of imgIds) {
    const data = o.deflate ? o.deflate(im.rgb) : zlibStored(im.rgb);
    obj(im.id, `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate ${im.smooth ? 'true' : 'false'} /Filter /FlateDecode /Length ${data.length} >>`, data);
  }
  const t = (s: string) => `(${s.replace(/[()\\]/g, (m) => '\\' + m).replace(/[^\x20-\x7e]/g, '?')})`;
  obj(infoId, `<< /Title ${t(o.title ?? 'figure')} /Creator ${t(o.creator ?? 'Fusion Reactor Simulator plot engine')} /Producer ${t('fusion-reactor-simulator/src/plot')} >>`);
  const xref = b.length;
  b.str(`xref\n0 ${infoId + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= infoId; i++) b.str(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  b.str(`trailer\n<< /Size ${infoId + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return b.concat();
}
