import { beforeAll, describe, expect, it } from 'vitest';
import { PopconGrid, computePopcon } from '../../physics/popcon';
import { ITER, SPARC, W7X } from '../../physics/presets';
import { deviceTmax, popconAxes } from '../../worker/popconHost';
import { canvasRecorder } from '../testing/canvasRecorder';
import { FrameColumns } from './lod';
import { POPCON_PAD, PopconView, cellAt, cellColor, contourSegments, drawPopcon, fromPx, inPlot, niceTicks, plotRect, readoutAt, toPx, trajectoryOf } from './popconRender';

let iterGrid: PopconGrid, iterView: PopconView;
beforeAll(() => {
  const Tmax = deviceTmax(ITER);
  iterGrid = computePopcon(ITER, { nx: 16, ny: 16, Tmax });
  iterView = { width: 400, height: 280, ...popconAxes(iterGrid, Tmax) };
});

describe('coordinates', () => {
  it('the plot rectangle is the canvas less the padding', () => {
    const v: PopconView = { width: 400, height: 280, nMax: 2e20, Tmax: 50 };
    expect(plotRect(v)).toEqual({ x: POPCON_PAD.l, y: POPCON_PAD.t, w: 400 - POPCON_PAD.l - POPCON_PAD.r, h: 280 - POPCON_PAD.t - POPCON_PAD.b });
    expect(plotRect({ ...v, width: 10, height: 10 }).w).toBe(1); // never zero
  });

  it('toPx and fromPx are inverse; the origin is the bottom-left corner, (nMax, Tmax) the top-right', () => {
    const v: PopconView = { width: 400, height: 280, nMax: 2e20, Tmax: 50 };
    const r = plotRect(v);
    expect(toPx(v, 0, 0)).toEqual({ x: r.x, y: r.y + r.h });
    expect(toPx(v, 2e20, 50)).toEqual({ x: r.x + r.w, y: r.y });
    for (const [n, T] of [[0.3e20, 4], [1.9e20, 49], [1e20, 25]]) {
      const p = toPx(v, n, T), q = fromPx(v, p.x, p.y);
      expect(q.n / n).toBeCloseTo(1, 12);
      expect(q.T / T).toBeCloseTo(1, 12);
    }
    expect(inPlot(v, r.x, r.y)).toBe(true);
    expect(inPlot(v, r.x - 1, r.y)).toBe(false);
    expect(inPlot(v, r.x + r.w + 1, r.y + 3)).toBe(false);
    expect(inPlot(v, r.x + 5, r.y + r.h + 1)).toBe(false);
  });
});

describe('niceTicks', () => {
  it('gives 0 and 1-2-5 multiples up to the maximum, about five of them', () => {
    expect(niceTicks(50)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(niceTicks(8)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(1.73)).toEqual([0, 0.5, 1, 1.5]);
    expect(niceTicks(300)).toEqual([0, 100, 200, 300]);
    expect(niceTicks(0.03)).toEqual([0, 0.01, 0.02, 0.03]);
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(NaN)).toEqual([0]);
  });
  it('never has more than about twice as many ticks as asked, whatever the range', () => {
    for (let e = -3; e <= 4; e++) for (const m of [1, 1.3, 2.2, 3.7, 6.1, 9.9]) expect(niceTicks(m * 10 ** e, 5).length).toBeLessThanOrEqual(11);
  });
});

describe('cellAt / readoutAt', () => {
  it('finds the cell that holds a point: uniform in density, cell edges half-way between the temperatures', () => {
    const g = iterGrid, { nMax, Tmax } = iterView;
    expect(cellAt(g, nMax, Tmax, -1, 5)).toBeNull();
    expect(cellAt(g, nMax, Tmax, 1e19, Tmax * 1.01)).toBeNull();
    expect(cellAt(g, nMax, Tmax, nMax * 1.01, 5)).toBeNull();
    // every grid node is in its own cell; a point just inside the nMax / Tmax edge is in the last cell
    for (let i = 0; i < g.nx; i++) for (let j = 0; j < g.ny; j++) expect(cellAt(g, nMax, Tmax, g.n[i], g.T[j])).toEqual({ i, j });
    expect(cellAt(g, nMax, Tmax, nMax, Tmax)).toEqual({ i: g.nx - 1, j: g.ny - 1 });
    expect(cellAt(g, nMax, Tmax, 0, 0)).toEqual({ i: 0, j: 0 });
    // half-way between two temperatures: the boundary; just below belongs to the lower cell
    const mid = (g.T[4] + g.T[5]) / 2;
    expect(cellAt(g, nMax, Tmax, g.n[3], mid * (1 - 1e-9))!.j).toBe(4);
    expect(cellAt(g, nMax, Tmax, g.n[3], mid * (1 + 1e-9))!.j).toBe(5);
  });

  it('reads the values of the cell and flags the limits', () => {
    const g = iterGrid, { nMax, Tmax } = iterView;
    let checked = 0, selfHeated = 0, betaLimited = 0, belowLH = 0;
    for (let i = 0; i < g.nx; i++) for (let j = 0; j < g.ny; j++) {
      const k = i * g.ny + j;
      const ro = readoutAt(g, ITER, nMax, Tmax, g.n[i], g.T[j])!;
      expect(ro.Paux_MW).toBe(g.Paux[k] / 1e6);
      expect(ro.Pfus_MW).toBe(g.Pfus[k] / 1e6);
      expect(ro.Q).toBe(g.Q[k]);
      expect(ro.betaN).toBe(g.betaN[k]);
      expect(ro.selfHeated).toBe(g.Paux[k] <= 0);
      expect(ro.aboveBetaLimit).toBe(g.betaN[k] > ITER.limits.betaN_limit);
      expect(ro.belowLH).toBe(!g.PLH_ok[k]);
      expect(ro.aboveGreenwald).toBe(g.n[i] > g.nG * ITER.limits.greenwald_limit);
      checked++; selfHeated += +ro.selfHeated; betaLimited += +ro.aboveBetaLimit; belowLH += +ro.belowLH;
    }
    expect(checked).toBe(256);
    // the ITER map has the two limit regions (and, as the technical report says, no self-heated one): not a degenerate field
    expect(selfHeated).toBe(0);
    expect(betaLimited).toBeGreaterThan(0);
    expect(betaLimited).toBeLessThan(256);
    expect(belowLH).toBeGreaterThan(0);
    expect(belowLH).toBeLessThan(256);
    expect(readoutAt(g, ITER, nMax, Tmax, -1, 3)).toBeNull();
  });

  it('a cell that needs no auxiliary power is flagged as heating itself, and its Q is infinite', () => {
    const g = { ...iterGrid, Paux: Float64Array.from(iterGrid.Paux), Q: Float64Array.from(iterGrid.Q) };
    const k = 5 * g.ny + 9;
    g.Paux[k] = -12e6; g.Q[k] = Infinity;
    const ro = readoutAt(g, ITER, iterView.nMax, iterView.Tmax, g.n[5], g.T[9])!;
    expect(ro.selfHeated).toBe(true);
    expect(ro.Paux_MW).toBe(-12);
    expect(ro.Q).toBe(Infinity);
  });

  it('a stellarator has no L-H threshold and no Greenwald limit', () => {
    const Tmax = deviceTmax(W7X), g = computePopcon(W7X, { nx: 12, ny: 12, Tmax });
    const { nMax } = popconAxes(g, Tmax);
    for (let i = 0; i < g.nx; i++) for (let j = 0; j < g.ny; j++) {
      const ro = readoutAt(g, W7X, nMax, Tmax, g.n[i], g.T[j])!;
      expect(ro.belowLH).toBe(false);
      expect(ro.aboveGreenwald).toBe(false);
    }
  });
});

describe('contourSegments', () => {
  const lin = (nx: number, ny: number): PopconGrid => ({
    n: Array.from({ length: nx }, (_, i) => i + 0.5), T: Array.from({ length: ny }, (_, j) => (j + 0.5) * 2), nx, ny,
    Paux: new Float64Array(nx * ny), Pfus: new Float64Array(nx * ny), Q: new Float64Array(nx * ny), betaN: new Float64Array(nx * ny), PLH_ok: new Uint8Array(nx * ny), fHe: new Float64Array(nx * ny), nG: 1,
  });

  it('every segment endpoint lies on the level set of a linear field, and the line crosses the whole grid', () => {
    const g = lin(10, 8);
    const f = (i: number, j: number) => 3 * g.n[i] + 0.5 * g.T[j]; // 3n + T/2
    const level = 20;
    const seg = contourSegments(g, f, level);
    expect(seg.length % 4).toBe(0);
    expect(seg.length).toBeGreaterThan(0);
    for (let s = 0; s < seg.length; s += 4) {
      expect(3 * seg[s] + 0.5 * seg[s + 1]).toBeCloseTo(level, 9);
      expect(3 * seg[s + 2] + 0.5 * seg[s + 3]).toBeCloseTo(level, 9);
    }
    // the segments are connected end to start from the left edge to the top edge
    const xs = seg.filter((_, k) => k % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo((level - 0.5 * g.T[g.ny - 1]) / 3, 9); // n where the line meets the top row of nodes
    expect(Math.max(...xs)).toBeCloseTo((level - 0.5 * g.T[0]) / 3, 9); // and the bottom row
  });

  it('is empty when the level is outside the field, and skips cells with a node that has no value', () => {
    const g = lin(6, 6);
    const f = (i: number, j: number) => i + j;
    expect(contourSegments(g, f, -1)).toEqual([]);
    expect(contourSegments(g, f, 100)).toEqual([]);
    const full = contourSegments(g, f, 5.5).length;
    const holed = contourSegments(g, (i, j) => (i === 3 && j === 2 ? NaN : f(i, j)), 5.5).length;
    expect(holed).toBeLessThan(full);
  });
});

describe('trajectoryOf', () => {
  const run = (n: number, f: (i: number) => { ne: number; Ti: number }) => FrameColumns.from(Array.from({ length: n }, (_, i) => ({ t: i * 0.5, d: f(i) })));

  it('converts the density to m⁻³ and keeps the first and the last frame', () => {
    const tr = trajectoryOf(run(20, (i) => ({ ne: 0.5 + i * 0.01, Ti: 2 + i })));
    expect(tr.n[0] / 0.5e20).toBeCloseTo(1, 12);
    expect(tr.T[0]).toBe(2);
    expect(tr.n[tr.n.length - 1] / 0.69e20).toBeCloseTo(1, 12);
    expect(tr.T[tr.T.length - 1]).toBe(21);
    expect(tr.n).toHaveLength(20); // short: every frame
    expect(trajectoryOf(new FrameColumns())).toEqual({ n: [], T: [] });
  });

  it('a long run is thinned to a bounded number of points and a one-frame crash stays a corner of the path', () => {
    const n = 30_000;
    const tr = trajectoryOf(run(n, (i) => ({ ne: 0.8 + 0.1 * Math.sin(i / 900), Ti: i === 12_345 ? 0.5 : 10 + 2 * Math.sin(i / 1500) })), 240);
    expect(tr.n.length).toBeLessThanOrEqual(2 * 7 * 240);
    expect(tr.n.length).toBeLessThan(n / 10);
    expect(Math.min(...tr.T)).toBe(0.5);
    expect(tr.n[0] / 0.8e20).toBeCloseTo(1, 12);
  });

  it('skips a frame without a temperature or a density', () => {
    const tr = trajectoryOf(run(30, (i) => (i === 10 ? { ne: NaN, Ti: 4 } : { ne: 1, Ti: i === 20 ? NaN : 5 })));
    expect(tr.n).toHaveLength(28);
    expect(tr.T.every(Number.isFinite)).toBe(true);
  });
});

describe('cellColor', () => {
  it('self-heated points are green, the rest run from blue (little power) to red (much)', () => {
    expect(cellColor(-5)).toMatch(/^rgba\(6,214,160,/);
    expect(cellColor(0)).toMatch(/^rgba\(6,214,160,/);
    const low = cellColor(0.5).match(/\d+/g)!.map(Number), high = cellColor(900).match(/\d+/g)!.map(Number);
    expect(low[2]).toBeGreaterThan(high[2]); // blue channel falls
    expect(low[0]).toBeLessThan(high[0]); // red channel rises
  });
});

describe('drawPopcon', () => {
  it('fills every cell, strokes the Q contours and the frame, and starts with one clearRect', () => {
    const rec = canvasRecorder();
    drawPopcon(rec.ctx, iterGrid, iterView, ITER);
    const d = rec.lastDraw();
    expect(rec.draws()).toBe(1);
    expect(rec.calls[0].name).toBe('clearRect');
    // 256 cells, each with its P_aux colour (some with the β_N or L-H overlay on top)
    const cellFills = d.filter((c) => c.name === 'fillRect');
    expect(cellFills.length).toBeGreaterThanOrEqual(256);
    expect(cellFills.length).toBeLessThanOrEqual(3 * 256);
    // the cells cover the plot rectangle: the extremes of the fills are its edges
    const r = plotRect(iterView);
    const xs = cellFills.flatMap((c) => [c.args[0] as number, (c.args[0] as number) + (c.args[2] as number)]);
    expect(Math.min(...xs)).toBeCloseTo(r.x, 6);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(r.x + r.w);
    expect(d.filter((c) => c.name === 'strokeRect')).toHaveLength(1);
    // labelled axes and a legend
    expect(d.filter((c) => c.name === 'fillText').map((c) => c.args[0])).toEqual(expect.arrayContaining(['n̄_e [10²⁰ m⁻³]', 'Q=10', 'P_aux<0', 'β_N>lim']));
    // Q contours in their four colours
    const contourColors = new Set(d.filter((c) => c.name === 'stroke' && ['#ffd166', '#f8961e', '#f72585', '#e0aaff'].includes(String(c.strokeStyle))).map((c) => c.strokeStyle));
    expect(contourColors.size).toBeGreaterThanOrEqual(3);
  });

  it('draws the Greenwald line for a tokamak and not for a stellarator', () => {
    const rec = canvasRecorder();
    const wide = { ...iterView, nMax: iterView.nMax };
    drawPopcon(rec.ctx, iterGrid, wide, ITER);
    expect(rec.lastDraw().some((c) => c.name === 'fillText' && c.args[0] === 'n_G')).toBe(true);
    rec.reset();
    const Tmax = deviceTmax(W7X), g = computePopcon(W7X, { nx: 10, ny: 10, Tmax });
    drawPopcon(rec.ctx, g, { width: 400, height: 280, ...popconAxes(g, Tmax) }, W7X);
    expect(rec.lastDraw().some((c) => c.name === 'fillText' && c.args[0] === 'n_G')).toBe(false);
  });

  it('draws the operating point where toPx puts it, the steering target, the hover cross-hair and the start of the path', () => {
    const rec = canvasRecorder();
    const point = { n: 0.9e20, T: 8 }, target = { n: 1.2e20, T: 15 }, hover = { n: 0.4e20, T: 30 };
    drawPopcon(rec.ctx, iterGrid, iterView, ITER, { point, target, hover, trajectory: { n: [0.2e20, 0.5e20, 0.9e20], T: [1, 4, 8] } });
    const arcs = rec.lastDraw().filter((c) => c.name === 'arc');
    const at = (p: { n: number; T: number }) => toPx(iterView, p.n, p.T);
    const near = (a: number[], p: { x: number; y: number }) => Math.abs(a[0] - p.x) < 1e-9 && Math.abs(a[1] - p.y) < 1e-9;
    expect(arcs.some((c) => c.strokeStyle === '#ffffff' && near(c.args as number[], at(point)) && c.args[2] === 5)).toBe(true);
    expect(arcs.some((c) => c.strokeStyle === '#f8961e' && near(c.args as number[], at(target)))).toBe(true);
    expect(arcs.some((c) => near(c.args as number[], at({ n: 0.2e20, T: 1 })) && c.args[2] === 3)).toBe(true); // the start
    // the hover lines run across the whole plot at the hover point
    const r = plotRect(iterView);
    const hv = rec.lastDraw().filter((c) => c.name === 'moveTo' && Math.abs((c.args[0] as number) - at(hover).x) < 1e-9 && c.args[1] === r.y);
    expect(hv.length).toBeGreaterThan(0);
  });

  it('without overlays nothing but the map is drawn; a point outside the map is held at its edge', () => {
    const rec = canvasRecorder();
    drawPopcon(rec.ctx, iterGrid, iterView, ITER);
    expect(rec.lastDraw().filter((c) => c.name === 'arc')).toHaveLength(0);
    rec.reset();
    drawPopcon(rec.ctx, iterGrid, iterView, ITER, { point: { n: 9e20, T: 500 } });
    const [arc] = rec.lastDraw().filter((c) => c.name === 'arc');
    expect(arc.args[0]).toBeCloseTo(toPx(iterView, iterView.nMax, iterView.Tmax).x, 9);
    expect(arc.args[1]).toBeCloseTo(toPx(iterView, iterView.nMax, iterView.Tmax).y, 9);
  });

  it('the applied-heating contour is a dashed line, and only when there is heating to show', () => {
    const rec = canvasRecorder();
    const pMid = iterGrid.Paux[8 * iterGrid.ny + 6] / 1e6;
    expect(pMid).toBeGreaterThan(0);
    drawPopcon(rec.ctx, iterGrid, iterView, ITER, { heatingMW: pMid });
    expect(rec.lastDraw().some((c) => c.name === 'setLineDash' && (c.args[0] as number[]).join() === '3,3')).toBe(true);
    rec.reset();
    drawPopcon(rec.ctx, iterGrid, iterView, ITER, { heatingMW: 0 });
    expect(rec.lastDraw().some((c) => c.name === 'setLineDash' && (c.args[0] as number[]).join() === '3,3')).toBe(false);
  });

  it('works for another device on its own axes', () => {
    const rec = canvasRecorder();
    const Tmax = deviceTmax(SPARC), g = computePopcon(SPARC, { nx: 16, ny: 16, Tmax });
    drawPopcon(rec.ctx, g, { width: 320, height: 260, ...popconAxes(g, Tmax) }, SPARC, { point: { n: 3e20, T: 10 } });
    const ticks = rec.lastDraw().filter((c) => c.name === 'fillText' && c.args[2] !== undefined).map((c) => c.args[0]);
    expect(ticks).toContain(String(Tmax)); // the top of the temperature axis is labelled
  });
});
