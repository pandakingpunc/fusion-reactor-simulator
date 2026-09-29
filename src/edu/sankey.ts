/**
 * Layered Sankey layout (pure geometry, no DOM): nodes sit in columns (layers), each node is as tall as the
 * larger of its inflow and outflow, and each link is a band whose thickness is its value. The bands leave and
 * enter a node in the order of the nodes at the other end, which keeps crossings low for the shallow, bipartite
 * shapes the power balance has.
 */
export interface SankeyNodeIn { id: string; layer: number }
export interface SankeyLinkIn { source: string; target: string; value: number }

export interface SankeyNode { id: string; layer: number; x: number; y: number; w: number; h: number; value: number }
export interface SankeyLink {
  source: string; target: string; value: number;
  /** centre line of the band: start (x0, y0) and end (x1, y1); the band is `width` thick around it */
  x0: number; y0: number; x1: number; y1: number; width: number;
  /** SVG path of the centre line (draw it with stroke-width = width and no fill) */
  path: string;
}
export interface SankeyLayout { nodes: SankeyNode[]; links: SankeyLink[]; scale: number; width: number; height: number }

export interface SankeyOptions { width: number; height: number; nodeWidth?: number; nodePad?: number }

export function layoutSankey(nodesIn: readonly SankeyNodeIn[], linksIn: readonly SankeyLinkIn[], opt: SankeyOptions): SankeyLayout {
  const { width, height } = opt;
  const nodeW = opt.nodeWidth ?? 14, pad = opt.nodePad ?? 10;
  const ids = new Set(nodesIn.map((n) => n.id));
  const links = linksIn.filter((l) => l.value > 0 && Number.isFinite(l.value) && ids.has(l.source) && ids.has(l.target));

  const inSum = new Map<string, number>(), outSum = new Map<string, number>();
  for (const l of links) {
    outSum.set(l.source, (outSum.get(l.source) ?? 0) + l.value);
    inSum.set(l.target, (inSum.get(l.target) ?? 0) + l.value);
  }
  // nodes without any link are not drawn
  const live = nodesIn.filter((n) => (inSum.get(n.id) ?? 0) > 0 || (outSum.get(n.id) ?? 0) > 0);
  const value = (id: string) => Math.max(inSum.get(id) ?? 0, outSum.get(id) ?? 0);

  const layers = [...new Set(live.map((n) => n.layer))].sort((a, b) => a - b);
  const nLayers = Math.max(layers.length, 1);
  // one scale for all columns: the fullest column decides
  let scale = Infinity;
  for (const L of layers) {
    const col = live.filter((n) => n.layer === L);
    const total = col.reduce((s, n) => s + value(n.id), 0);
    const room = height - pad * (col.length - 1);
    if (total > 0) scale = Math.min(scale, room / total);
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 0;

  const nodes: SankeyNode[] = [];
  for (const L of layers) {
    const col = live.filter((n) => n.layer === L);
    const used = col.reduce((s, n) => s + value(n.id) * scale, 0) + pad * (col.length - 1);
    let y = (height - used) / 2;
    const x = nLayers === 1 ? 0 : (layers.indexOf(L) * (width - nodeW)) / (nLayers - 1);
    for (const n of col) {
      const h = value(n.id) * scale;
      nodes.push({ id: n.id, layer: L, x, y, w: nodeW, h, value: value(n.id) });
      y += h + pad;
    }
  }
  const at = new Map(nodes.map((n) => [n.id, n]));
  const order = new Map(nodes.map((n, i) => [n.id, i]));

  // where each band leaves its source and enters its target: stacked in the order of the other end
  const outOff = new Map<string, number>(), inOff = new Map<string, number>();
  const outLinks = [...links].sort((a, b) => order.get(a.target)! - order.get(b.target)!);
  const outY = new Map<SankeyLinkIn, number>(), inY = new Map<SankeyLinkIn, number>();
  for (const l of outLinks) {
    const s = at.get(l.source)!, off = outOff.get(l.source) ?? 0, w = l.value * scale;
    outY.set(l, s.y + off + w / 2);
    outOff.set(l.source, off + w);
  }
  const inLinks = [...links].sort((a, b) => order.get(a.source)! - order.get(b.source)!);
  for (const l of inLinks) {
    const t = at.get(l.target)!, off = inOff.get(l.target) ?? 0, w = l.value * scale;
    inY.set(l, t.y + off + w / 2);
    inOff.set(l.target, off + w);
  }

  const outLinksLaid: SankeyLink[] = links.map((l) => {
    const s = at.get(l.source)!, t = at.get(l.target)!;
    const x0 = s.x + s.w, x1 = t.x, y0 = outY.get(l)!, y1 = inY.get(l)!, xm = (x0 + x1) / 2;
    const f = (v: number) => +v.toFixed(2);
    return {
      source: l.source, target: l.target, value: l.value, x0, y0, x1, y1, width: l.value * scale,
      path: `M${f(x0)},${f(y0)}C${f(xm)},${f(y0)} ${f(xm)},${f(y1)} ${f(x1)},${f(y1)}`,
    };
  });
  return { nodes, links: outLinksLaid, scale, width, height };
}
