import { describe, expect, it } from 'vitest';
import { Simulation } from '../physics/simulation';
import { SPARC, SPARC_15D } from '../physics/presets';
import { averageDiag, balanceTotals, pickDiag, powerBalance, powerFlowGraph } from './powerFlow';
import { layoutSankey } from './sankey';

const D = { P_aux: 30, P_oh: 1, P_alpha: 20, P_rad: 10, P_brems: 4, P_sync: 2, P_line: 4, P_transport: 40, P_cond: 28, P_ELM: 12, dWdt: 1 };

describe('power balance of a diagnostic record', () => {
  it('splits transport into conduction and ELM losses and closes the ledger with the remainder', () => {
    const pb = powerBalance(D)!;
    expect(pb).toMatchObject({ aux: 30, ohmic: 1, alpha: 20, brems: 4, sync: 2, line: 4, conduction: 28, elm: 12, stored: 1 });
    // 51 in, 10 + 40 + 1 out
    expect(pb.other).toBeCloseTo(0, 12);
    expect(pb.radOther).toBeCloseTo(0, 12);
    const t = balanceTotals(pb);
    expect(t.in).toBeCloseTo(t.out, 12);
  });

  it('shows what the model does not itemise as its own bar, on either side', () => {
    const short = powerBalance({ ...D, P_aux: 36 })!; // 6 MW injected but not accounted for by the sinks
    expect(short.other).toBeCloseTo(6, 12);
    const over = powerBalance({ ...D, P_aux: 24 })!; // 6 MW more leaving than entering: released energy
    expect(over.other).toBeCloseTo(-6, 12);
    for (const pb of [short, over]) { const t = balanceTotals(pb); expect(t.in).toBeCloseTo(t.out, 12); }
    const g = powerFlowGraph(over);
    expect(g.links.find((l) => l.source === 'release' && l.target === 'plasma')?.value).toBeCloseTo(6, 12);
  });

  it('a heating-up plasma has its stored energy as a sink and a cooling one as a source', () => {
    expect(balanceTotals(powerBalance({ ...D, dWdt: 5, P_aux: 34 })!).in).toBeCloseTo(55, 12);
    const cooling = powerFlowGraph(powerBalance({ ...D, dWdt: -3, P_aux: 26 })!);
    expect(cooling.links.some((l) => l.target === 'stored')).toBe(false);
    expect(cooling.links.find((l) => l.source === 'release')?.value).toBeCloseTo(3, 12);
  });

  it('works for a record without the ELM and split-radiation channels (1.5D style)', () => {
    const pb = powerBalance({ P_aux: 25, P_oh: 1, P_alpha: 30, P_rad: 8, P_cond: 47, dWdt_s: 1 })!;
    expect(pb.elm).toBe(0);
    expect(pb.conduction).toBe(47);
    expect(pb.stored).toBe(1);
    // radiation that is not split shows up as its own band
    expect(pb.radOther).toBe(8);
    expect(powerFlowGraph(pb).links.some((l) => l.target === 'radMisc')).toBe(true);
  });

  it('has no balance for a record without power channels (a pulsed device)', () => {
    expect(powerBalance({ Ti: 5, rho: 1 })).toBeNull();
    expect(powerBalance({})).toBeNull();
  });

  it('closes on real runs: the 0D flat-top within a few per cent of the heating, the 1.5D one too', () => {
    const zero = new Simulation({ ...SPARC, t_end: 6 }); zero.runAll();
    const one = new Simulation({ ...SPARC_15D, t_end: 4 }); one.runAll();
    for (const sim of [zero, one]) {
      const pb = powerBalance(pickDiag(sim.history, 'flat'))!;
      const t = balanceTotals(pb);
      expect(Math.abs(pb.other) / t.in).toBeLessThan(0.08);
      expect(t.in).toBeCloseTo(t.out, 9);
      expect(pb.alpha).toBeGreaterThan(0);
    }
  }, 60_000);
});

describe('choosing the part of a run', () => {
  const frames = [0, 1, 2, 3, 4].map((t) => ({ t, d: { P_aux: 10 * t, Q: [0, 1, 5, 2, 1][t] } }));

  it('averages over a window with time weights, and returns one record for a single frame', () => {
    expect(averageDiag(frames, 0, 4).P_aux).toBeCloseTo(20, 12);
    expect(averageDiag(frames, 3, 4).P_aux).toBeCloseTo(35, 12);
    expect(averageDiag(frames, 2, 2)).toEqual({ P_aux: 20, Q: 5 });
    expect(averageDiag(frames, 10, 12)).toEqual({});
    // non-uniform spacing: the long interval counts more
    const uneven = [{ t: 0, d: { x: 0 } }, { t: 1, d: { x: 10 } }, { t: 9, d: { x: 10 } }];
    expect(averageDiag(uneven, 0, 9).x).toBeGreaterThan(8);
    // non-finite values are skipped
    expect(averageDiag([{ t: 0, d: { x: 1 } }, { t: 1, d: { x: NaN } }, { t: 2, d: { x: 3 } }], 0, 2).x).toBeCloseTo(2, 12);
  });

  it('flat = the last 30 %, shot = all, peak = the frame of the highest Q, or the frame nearest a time', () => {
    expect(pickDiag(frames, 'shot').P_aux).toBeCloseTo(20, 12);
    expect(pickDiag(frames, 'flat').P_aux).toBeCloseTo(35, 12);
    expect(pickDiag(frames, 'peak')).toEqual({ P_aux: 20, Q: 5 });
    expect(pickDiag(frames, { t: 2.9 }).P_aux).toBe(30);
    expect(pickDiag([], 'flat')).toEqual({});
  });
});

describe('Sankey layout', () => {
  const nodes = [{ id: 'a', layer: 0 }, { id: 'b', layer: 0 }, { id: 'm', layer: 1 }, { id: 'x', layer: 2 }, { id: 'y', layer: 2 }, { id: 'unused', layer: 2 }];
  const links = [{ source: 'a', target: 'm', value: 30 }, { source: 'b', target: 'm', value: 10 }, { source: 'm', target: 'x', value: 25 }, { source: 'm', target: 'y', value: 15 }];

  it('makes a node as tall as its flow and keeps everything inside the drawing', () => {
    const L = layoutSankey(nodes, links, { width: 400, height: 200, nodePad: 10 });
    const node = (id: string) => L.nodes.find((n) => n.id === id)!;
    expect(L.nodes.map((n) => n.id)).not.toContain('unused');
    expect(node('m').h).toBeCloseTo(40 * L.scale, 9);
    expect(node('a').h).toBeCloseTo(30 * L.scale, 9);
    for (const n of L.nodes) {
      expect(n.y).toBeGreaterThanOrEqual(-1e-9);
      expect(n.y + n.h).toBeLessThanOrEqual(200 + 1e-9);
      expect(n.x + n.w).toBeLessThanOrEqual(400 + 1e-9);
    }
    // one scale for all columns: the columns with two nodes lose a padding of 10 to the gap, and decide it
    expect(node('m').h).toBeCloseTo(190, 6);
  });

  it('keeps the bands of a node inside it, one band per link, thickness = value', () => {
    const L = layoutSankey(nodes, links, { width: 400, height: 200 });
    expect(L.links).toHaveLength(4);
    for (const l of L.links) {
      expect(l.width).toBeCloseTo(l.value * L.scale, 9);
      const s = L.nodes.find((n) => n.id === l.source)!, t = L.nodes.find((n) => n.id === l.target)!;
      expect(l.y0 - l.width / 2).toBeGreaterThanOrEqual(s.y - 1e-6);
      expect(l.y0 + l.width / 2).toBeLessThanOrEqual(s.y + s.h + 1e-6);
      expect(l.y1 - l.width / 2).toBeGreaterThanOrEqual(t.y - 1e-6);
      expect(l.y1 + l.width / 2).toBeLessThanOrEqual(t.y + t.h + 1e-6);
      expect(l.path.startsWith('M')).toBe(true);
    }
    // bands entering one node do not overlap
    const into = L.links.filter((l) => l.target === 'm').sort((p, q) => p.y1 - q.y1);
    expect(into[0].y1 + into[0].width / 2).toBeLessThanOrEqual(into[1].y1 - into[1].width / 2 + 1e-6);
  });

  it('drops zero, negative and non-finite links and copes with an empty diagram', () => {
    const L = layoutSankey(nodes, [...links, { source: 'a', target: 'y', value: 0 }, { source: 'a', target: 'x', value: -3 }, { source: 'a', target: 'x', value: NaN }, { source: 'q', target: 'x', value: 4 }], { width: 100, height: 100 });
    expect(L.links).toHaveLength(4);
    const empty = layoutSankey(nodes, [], { width: 100, height: 100 });
    expect(empty.nodes).toEqual([]);
    expect(empty.links).toEqual([]);
    expect(empty.scale).toBe(0);
  });

  it('lays out the real power-flow graph, and the flow through the plasma node is the total power', () => {
    const pb = powerBalance(D)!;
    const g = powerFlowGraph(pb);
    const L = layoutSankey(g.nodes, g.links, { width: 600, height: 300 });
    const total = balanceTotals(pb).in;
    expect(L.nodes.find((n) => n.id === 'plasma')!.value).toBeCloseTo(total, 9);
    expect(L.nodes.find((n) => n.id === 'radiation')!.value).toBeCloseTo(10, 9);
    expect(L.nodes.map((n) => n.layer)).toContain(3);
  });
});
