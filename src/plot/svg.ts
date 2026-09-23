/**
 * SVG arka ucu: görüntü listesi → bağımsız SVG belgesi (web, README, Inkscape → PDF/EPS).
 * Metin: serif yazı tipi yığını, alt/üst simgeler <tspan dy> ile; görüntüler gömülü PNG.
 */
import { DisplayList, PathCmd, Style, baselineOffset, hex } from './canvas';
import { Deflate, base64, encodePNG } from './png';

const FONT = "'STIX Two Text','Times New Roman',Times,serif";
const f = (x: number) => (Math.abs(x) < 1e-9 ? '0' : (Math.round(x * 100) / 100).toString());
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function pathD(d: PathCmd[]): string {
  let s = '';
  for (const c of d) {
    if (c[0] === 'Z') s += 'Z';
    else if (c[0] === 'C') s += `C${f(c[1])} ${f(c[2])} ${f(c[3])} ${f(c[4])} ${f(c[5])} ${f(c[6])}`;
    else s += `${c[0]}${f(c[1])} ${f(c[2])}`;
  }
  return s;
}

function styleAttrs(s: Style): string {
  const a: string[] = [];
  a.push(`fill="${s.fill ? hex(s.fill) : 'none'}"`);
  if (s.stroke) {
    a.push(`stroke="${hex(s.stroke)}"`, `stroke-width="${f(s.lw ?? 1)}"`);
    if (s.dash?.length) a.push(`stroke-dasharray="${s.dash.map(f).join(' ')}"`);
    if (s.cap && s.cap !== 'butt') a.push(`stroke-linecap="${s.cap}"`);
    if (s.join && s.join !== 'miter') a.push(`stroke-linejoin="${s.join}"`);
    else a.push('stroke-miterlimit="4"');
  }
  if (s.alpha !== undefined && s.alpha < 1) a.push(`opacity="${f(s.alpha)}"`);
  return a.join(' ');
}

export function toSVG(dl: DisplayList, o: { deflate?: Deflate; background?: string | null; title?: string } = {}): string {
  const W = dl.width, H = dl.height;
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${f(W / 72)}in" height="${f(H / 72)}in" viewBox="0 0 ${f(W)} ${f(H)}">`);
  if (o.title) out.push(`<title>${esc(o.title)}</title>`);
  if (o.background !== null) out.push(`<rect width="${f(W)}" height="${f(H)}" fill="${o.background ?? '#ffffff'}"/>`);
  let clipId = 0;
  // kimlik öneki: aynı HTML sayfasına gömülen SVG'lerin clipPath kimlikleri çakışmasın (deterministik)
  const pre = (o.title ?? 'fig').replace(/[^A-Za-z0-9]+/g, '').slice(0, 16) || 'fig';
  for (const p of dl.prims) {
    switch (p.t) {
      case 'path': out.push(`<path d="${pathD(p.d)}" ${styleAttrs(p.s)}/>`); break;
      case 'clip': {
        const id = `${pre}_c${clipId++}`;
        out.push(`<clipPath id="${id}"><rect x="${f(p.x)}" y="${f(p.y)}" width="${f(p.w)}" height="${f(p.h)}"/></clipPath><g clip-path="url(#${id})">`);
        break;
      }
      case 'unclip': out.push('</g>'); break;
      case 'image': {
        const png = encodePNG(p.rgb, p.w, p.h, o.deflate);
        const uri = `data:image/png;base64,${base64(png)}`;
        out.push(`<image x="${f(p.x)}" y="${f(p.y)}" width="${f(p.dw)}" height="${f(p.dh)}" preserveAspectRatio="none"${p.smooth ? '' : ' style="image-rendering:pixelated"'} href="${uri}" xlink:href="${uri}"/>`);
        break;
      }
      case 'text': {
        const y = p.y + baselineOffset(p.baseline, p.size);
        const tr = p.rotate ? ` transform="rotate(${f(-p.rotate)} ${f(p.x)} ${f(p.y)})"` : '';
        let s = `<text x="${f(p.x)}" y="${f(y)}" font-family="${FONT}" font-size="${f(p.size)}" fill="${hex(p.color)}" text-anchor="${p.anchor}"${tr}>`;
        let prevRise = 0;
        for (const r of p.runs) {
          const dy = -(r.rise - prevRise) * p.size;
          prevRise = r.rise;
          const at: string[] = [];
          if (Math.abs(dy) > 1e-6) at.push(`dy="${f(dy)}"`);
          if (r.scale !== 1) at.push(`font-size="${f(p.size * r.scale)}"`);
          if (r.font === 'italic') at.push('font-style="italic"');
          if (r.font === 'bold') at.push('font-weight="bold"');
          s += at.length ? `<tspan ${at.join(' ')}>${esc(r.text)}</tspan>` : `<tspan>${esc(r.text)}</tspan>`;
        }
        s += '</text>';
        out.push(s);
        break;
      }
    }
  }
  out.push('</svg>');
  return out.join('\n');
}
