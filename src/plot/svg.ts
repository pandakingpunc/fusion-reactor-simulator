/**
 * SVG back end: display list → standalone SVG 1.1 document (web, README, Inkscape → PDF/EPS).
 *
 * Text stays text (searchable, editable) in the font stack "'STIX Two Text', 'STIX Two Math',
 * 'Times New Roman', serif"; sub/superscripts and pen moves are <tspan dy/dx>, fraction and overbar
 * rules are paths placed with the same STIX Two metrics the PDF back end uses. Images are embedded PNG
 * referenced by a single xlink:href (SVG 1.1; no duplicate href). Optional <metadata> records the
 * software version and configuration hash only.
 */
import { DisplayList, PathCmd, Style, baselineOffset, hex, layoutRuns } from './canvas';
import { SVG_FONT_FAMILY } from './fonts';
import { Deflate, base64, encodePNG } from './png';

export interface SvgOptions {
  deflate?: Deflate;
  background?: string | null;
  title?: string;
  /** software version (in <metadata>) */
  version?: string;
  /** SHA-256 of the canonical figure configuration (in <metadata>); never a git SHA */
  configHash?: string;
}

/** Namespace of the provenance element in <metadata> (the project's concept DOI) */
export const SVG_META_NS = 'https://doi.org/10.5281/zenodo.22259861';

const f = (x: number) => (Math.abs(x) < 1e-9 ? '0' : (Math.round(x * 100) / 100).toString());
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FONT_ATTR = esc(SVG_FONT_FAMILY);

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

export function toSVG(dl: DisplayList, o: SvgOptions = {}): string {
  const W = dl.width, H = dl.height;
  const fonts = dl.fonts;
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${f(W / 72)}in" height="${f(H / 72)}in" viewBox="0 0 ${f(W)} ${f(H)}">`);
  if (o.title) out.push(`<title>${esc(o.title)}</title>`);
  if (o.version || o.configHash) {
    const at = [o.version ? ` version="${esc(o.version)}"` : '', o.configHash ? ` config-sha256="${esc(o.configHash)}"` : ''].join('');
    out.push(`<metadata><frs:provenance xmlns:frs="${SVG_META_NS}" generator="fusion-reactor-simulator"${at}/></metadata>`);
  }
  if (o.background !== null) out.push(`<rect width="${f(W)}" height="${f(H)}" fill="${o.background ?? '#ffffff'}"/>`);
  let clipId = 0;
  // id prefix: clipPath ids of several SVGs inlined in one HTML page must not collide (deterministic)
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
        out.push(`<image x="${f(p.x)}" y="${f(p.y)}" width="${f(p.dw)}" height="${f(p.dh)}" preserveAspectRatio="none"${p.smooth ? '' : ' style="image-rendering:pixelated"'} xlink:href="data:image/png;base64,${base64(png)}"/>`);
        break;
      }
      case 'text': {
        const y = p.y + baselineOffset(p.baseline, p.size, fonts.metrics);
        const tr = p.rotate ? ` transform="rotate(${f(-p.rotate)} ${f(p.x)} ${f(p.y)})"` : '';
        const keepSpace = p.runs.some((r) => /^\s|\s$|\s\s/.test(r.text));
        let s = `<text x="${f(p.x)}" y="${f(y)}" font-family="${FONT_ATTR}" font-size="${f(p.size)}" fill="${hex(p.color)}" text-anchor="${p.anchor}"${tr}${keepSpace ? ' xml:space="preserve"' : ''}>`;
        let prevRise = 0, pendingDx = 0;
        for (const r of p.runs) {
          pendingDx += (r.dx ?? 0) * p.size;
          // rules are drawn as paths below; the pen moves over them (dx on an empty tspan would be lost)
          if (r.rule) { pendingDx += r.rule.w * p.size; continue; }
          if (!r.text) continue;
          const dy = -(r.rise - prevRise) * p.size;
          prevRise = r.rise;
          const at: string[] = [];
          if (Math.abs(pendingDx) > 1e-6) { at.push(`dx="${f(pendingDx)}"`); pendingDx = 0; }
          if (Math.abs(dy) > 1e-6) at.push(`dy="${f(dy)}"`);
          if (r.scale !== 1) at.push(`font-size="${f(p.size * r.scale)}"`);
          if (r.font === 'italic') at.push('font-style="italic"');
          if (r.font === 'bold') at.push('font-weight="bold"');
          s += at.length ? `<tspan ${at.join(' ')}>${esc(r.text)}</tspan>` : `<tspan>${esc(r.text)}</tspan>`;
        }
        s += '</text>';
        out.push(s);
        if (p.runs.some((r) => r.rule)) {
          const lay = layoutRuns(p.runs, p.size, fonts);
          const x0 = p.x - (p.anchor === 'middle' ? lay.width / 2 : p.anchor === 'end' ? lay.width : 0);
          let d = '';
          for (const pr of lay.placed) {
            if (!pr.run.rule) continue;
            const t = pr.run.rule.t * p.size, w = pr.run.rule.w * p.size;
            d += `M${f(x0 + pr.x)} ${f(y - pr.run.rise * p.size - t / 2)}h${f(w)}v${f(t)}h${f(-w)}Z`;
          }
          out.push(`<path d="${d}" fill="${hex(p.color)}"${tr}/>`);
        }
        break;
      }
    }
  }
  out.push('</svg>');
  return out.join('\n');
}
