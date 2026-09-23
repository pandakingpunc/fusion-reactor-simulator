/**
 * Kontur çizgileri: yürüyen kareler (marching squares) + parçaları çoklu çizgilere birleştirme.
 * Eyer hücrelerinde merkez değeri (4 köşe ortalaması) ile belirsizlik çözülür.
 * Z: ny × nx (satır j, sütun i), x[i], y[j] artan.
 */
export type Polyline = { x: number[]; y: number[] };

export function contourLines(x: ArrayLike<number>, y: ArrayLike<number>, Z: ArrayLike<number>, level: number, mask?: (i: number, j: number) => boolean): Polyline[] {
  const nx = x.length, ny = y.length;
  const segs: [number, number, number, number][] = [];
  const val = (i: number, j: number) => Z[j * nx + i];
  const lerp = (a: number, b: number, fa: number, fb: number) => a + ((level - fa) / (fb - fa)) * (b - a);
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    if (mask && !mask(i, j)) continue;
    const f0 = val(i, j), f1 = val(i + 1, j), f2 = val(i + 1, j + 1), f3 = val(i, j + 1);
    if (![f0, f1, f2, f3].every(Number.isFinite)) continue;
    const c = (f0 > level ? 1 : 0) | (f1 > level ? 2 : 0) | (f2 > level ? 4 : 0) | (f3 > level ? 8 : 0);
    if (c === 0 || c === 15) continue;
    const x0 = x[i], x1 = x[i + 1], y0 = y[j], y1 = y[j + 1];
    // kenar kesişim noktaları: e0 alt (0-1), e1 sağ (1-2), e2 üst (3-2), e3 sol (0-3)
    const e = [
      () => [lerp(x0, x1, f0, f1), y0],
      () => [x1, lerp(y0, y1, f1, f2)],
      () => [lerp(x0, x1, f3, f2), y1],
      () => [x0, lerp(y0, y1, f0, f3)],
    ];
    const add = (a: number, b: number) => { const p = e[a](), q = e[b](); segs.push([p[0], p[1], q[0], q[1]]); };
    switch (c) {
      case 1: case 14: add(3, 0); break;
      case 2: case 13: add(0, 1); break;
      case 3: case 12: add(3, 1); break;
      case 4: case 11: add(1, 2); break;
      case 6: case 9: add(0, 2); break;
      case 7: case 8: add(3, 2); break;
      case 5: case 10: {
        const center = 0.25 * (f0 + f1 + f2 + f3);
        const hi = center > level;
        if ((c === 5) === hi) { add(3, 2); add(0, 1); } else { add(3, 0); add(1, 2); }
        break;
      }
    }
  }
  return joinSegments(segs);
}

function joinSegments(all: [number, number, number, number][]): Polyline[] {
  const key = (x: number, y: number) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;
  // seviyeye tam eşit düğümlerde oluşan sıfır uzunluklu parçaları at (yoksa ayrık "noktalar" kalır)
  const segs = all.filter((s) => key(s[0], s[1]) !== key(s[2], s[3]));
  const ends = new Map<string, number[]>();
  segs.forEach((s, k) => {
    for (const kk of [key(s[0], s[1]), key(s[2], s[3])]) { const a = ends.get(kk); if (a) a.push(k); else ends.set(kk, [k]); }
  });
  const used = new Uint8Array(segs.length);
  const lines: Polyline[] = [];
  for (let k0 = 0; k0 < segs.length; k0++) {
    if (used[k0]) continue;
    used[k0] = 1;
    const xs = [segs[k0][0], segs[k0][2]], ys = [segs[k0][1], segs[k0][3]];
    // iki yöne uzat
    for (const dir of [1, -1]) {
      for (;;) {
        const ex = dir === 1 ? xs[xs.length - 1] : xs[0], ey = dir === 1 ? ys[ys.length - 1] : ys[0];
        const cand = ends.get(key(ex, ey))?.find((k) => !used[k]);
        if (cand === undefined) break;
        used[cand] = 1;
        const s = segs[cand];
        const fwd = key(s[0], s[1]) === key(ex, ey);
        const nxp = fwd ? s[2] : s[0], nyp = fwd ? s[3] : s[1];
        if (dir === 1) { xs.push(nxp); ys.push(nyp); } else { xs.unshift(nxp); ys.unshift(nyp); }
      }
    }
    lines.push({ x: xs, y: ys });
  }
  return lines;
}
