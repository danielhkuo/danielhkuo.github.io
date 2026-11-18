import assert from "node:assert/strict";
import { test } from "node:test";
import { makeShapes, SHAPE_COUNTS, SHAPE_SIZES, type CloudShape } from "./shapes.ts";

let memo: CloudShape[] | null = null;
/** Built on first use, so the test runner can list these tests before the shapes exist. */
const all = (): CloudShape[] => (memo ??= makeShapes(7, SHAPE_COUNTS));
const of = (kind: CloudShape["kind"]) => all().filter((s) => s.kind === kind);
/** Pixels per row with cover over 0.5. */
const rowWidths = (s: CloudShape) => Array.from({ length: s.h }, (_, y) => {
  let k = 0;
  for (let x = 0; x < s.w; x++) if (s.cover[y * s.w + x] > 0.5) k++;
  return k;
});

test("the same seed gives the same shapes, another seed others", () => {
  assert.deepEqual(makeShapes(7, SHAPE_COUNTS), all());
  assert.notDeepEqual(makeShapes(8, SHAPE_COUNTS), all());
});

test("shapes come in the asked counts, ordered by kind", () => {
  const kinds = all().map((s) => s.kind);
  const want = [
    ...Array(SHAPE_COUNTS.heap).fill("heap"), ...Array(SHAPE_COUNTS.wisp).fill("wisp"),
    ...Array(SHAPE_COUNTS.bank).fill("bank"), ...Array(SHAPE_COUNTS.streak).fill("streak"),
  ];
  assert.deepEqual(kinds, want);
  assert.equal(makeShapes(1, { heap: 2, wisp: 0, bank: 1, streak: 0 }).length, 3);
});

test("sizes lie inside their ranges, and every value is 0–1", () => {
  for (const s of all()) {
    const r = SHAPE_SIZES[s.kind];
    assert.ok(s.w >= r.w[0] && s.w <= r.w[1], `${s.kind} w ${s.w}`);
    assert.ok(s.h >= r.h[0] && s.h <= r.h[1], `${s.kind} h ${s.h}`);
    assert.equal(s.cover.length, s.w * s.h);
    assert.equal(s.dome.length, s.w * s.h);
    for (let i = 0; i < s.cover.length; i++) {
      assert.ok(s.cover[i] >= 0 && s.cover[i] <= 1 && s.dome[i] >= 0 && s.dome[i] <= 1);
    }
  }
});

test("nothing touches the box's edge, so no cloud is cut off square", () => {
  for (const s of all()) {
    for (let x = 0; x < s.w; x++) assert.equal(s.cover[x] + s.cover[(s.h - 1) * s.w + x], 0, `${s.kind} top/bottom`);
    for (let y = 0; y < s.h; y++) assert.equal(s.cover[y * s.w] + s.cover[y * s.w + s.w - 1], 0, `${s.kind} sides`);
  }
});

test("heaps and banks are solid enough to read as cloud", () => {
  for (const s of [...of("heap"), ...of("bank")]) {
    let k = 0;
    for (const c of s.cover) if (c > 0.5) k++;
    assert.ok(k >= 0.25 * s.w * s.h, `${s.kind} ${s.w}x${s.h}: ${k} solid pixels`);
  }
});

const solid = (s: CloudShape, x: number, y: number) => x >= 0 && y >= 0 && x < s.w && y < s.h && s.cover[y * s.w + x] > 0.5;
/** The solid region's bounding box. */
function extent(s: CloudShape): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = s.w, x1 = -1, y0 = s.h, y1 = -1;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (solid(s, x, y)) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1 };
}
/** Share of solid pixels in a rectangle of the shape. */
function solidShare(s: CloudShape, x0: number, x1: number, y0: number, y1: number): number {
  let k = 0, n = 0;
  for (let y = Math.max(0, y0); y <= Math.min(s.h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(s.w - 1, x1); x++) {
    n++;
    if (solid(s, x, y)) k++;
  }
  return n ? k / n : 0;
}
/** First solid row in each column of the extent, or −1. */
function topEdge(s: CloudShape, x0: number, x1: number): number[] {
  const out: number[] = [];
  for (let x = x0; x <= x1; x++) {
    let t = -1;
    for (let y = 0; y < s.h && t < 0; y++) if (solid(s, x, y)) t = y;
    out.push(t);
  }
  return out;
}

test("a heap sits on a flat base under a rounded top", () => {
  for (const s of of("heap")) {
    const widths = rowWidths(s);
    const widest = Math.max(...widths);
    const filled = widths.map((w, y) => (w > 0 ? y : -1)).filter((y) => y >= 0);
    const top = filled[0], bottom = filled[filled.length - 1];
    assert.ok(widths[bottom] >= 0.4 * widest, `base ${widths[bottom]} of ${widest}`);
    assert.ok(widths[top] < 0.5 * widest, `top ${widths[top]} of ${widest}`);
    // Flat: across the middle of the base, the cloud's lowest pixel is on the same row give or take 2.
    const { x0, x1 } = extent(s);
    const lows: number[] = [];
    for (let x = Math.round(x0 + 0.3 * (x1 - x0)); x <= Math.round(x1 - 0.3 * (x1 - x0)); x++) {
      let b = -1;
      for (let y = s.h - 1; y >= 0 && b < 0; y--) if (solid(s, x, y)) b = y;
      if (b >= 0) lows.push(b);
    }
    assert.ok(Math.max(...lows) - Math.min(...lows) <= 2, `${s.w}x${s.h}: base rows ${Math.min(...lows)}–${Math.max(...lows)}`);
  }
});

test("heaps and banks have rounded ends, not the square sides of a slab", () => {
  for (const s of [...of("heap"), ...of("bank")]) {
    const { x0, x1, y0, y1 } = extent(s);
    const cw = Math.max(2, Math.round(0.15 * (x1 - x0 + 1))), ch = Math.max(2, Math.round(0.3 * (y1 - y0 + 1)));
    // The lower corners curve in from the sides; the upper corners are the shoulders of the outer lobes.
    const corners = [
      solidShare(s, x0, x0 + cw - 1, y1 - ch + 1, y1), solidShare(s, x1 - cw + 1, x1, y1 - ch + 1, y1),
      solidShare(s, x0, x0 + cw - 1, y0, y0 + ch - 1), solidShare(s, x1 - cw + 1, x1, y0, y0 + ch - 1),
    ];
    // A lopsided crown may fill a shoulder; the base corners are where a slab gives itself away.
    for (const [k, share] of corners.entries()) assert.ok(share < (k < 2 ? 0.5 : 0.65), `${s.kind} ${s.w}x${s.h}: corner ${k} is ${(100 * share).toFixed(0)} % solid`);
  }
});

test("each cloud is one solid piece with a clean, soft edge, not a speckled halo", () => {
  for (const s of all()) {
    // One piece: flood the solid pixels from the first one found.
    const seen = new Uint8Array(s.w * s.h);
    let pieces = 0, total = 0;
    for (let i = 0; i < seen.length; i++) {
      if (s.cover[i] <= 0.5) continue;
      total++;
      if (seen[i]) continue;
      pieces++;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop()!, x = j % s.w, y = (j - x) / s.w;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = (y + dy) * s.w + x + dx;
          if (solid(s, x + dx, y + dy) && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
    }
    assert.ok(total > 0 && pieces <= (s.kind === "streak" || s.kind === "wisp" ? 3 : 1), `${s.kind} ${s.w}x${s.h}: ${pieces} pieces`);
    // The soft edge is narrow: every faint pixel lies within 3 pixels of solid cloud.
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const c = s.cover[y * s.w + x];
      if (c <= 0 || c > 0.5) continue;
      let near = false;
      for (let dy = -3; dy <= 3 && !near; dy++) for (let dx = -3; dx <= 3 && !near; dx++) near = solid(s, x + dx, y + dy);
      assert.ok(near, `${s.kind} ${s.w}x${s.h}: faint pixel at ${x},${y} far from the cloud`);
    }
    // A billowing edge, not a ragged one: the outline is at most 1.8 times the box around it.
    if (s.kind === "heap" || s.kind === "bank") {
      let edge = 0;
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
        if (!solid(s, x, y)) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!solid(s, x + dx, y + dy)) edge++;
      }
      const { x0, x1, y0, y1 } = extent(s);
      const box = 2 * (x1 - x0 + 1 + y1 - y0 + 1);
      assert.ok(edge <= 1.8 * box, `${s.kind} ${s.w}x${s.h}: outline ${edge} against box ${box}`);
    }
  }
});

test("heaps and banks billow: their tops rise in two or more lobes", () => {
  for (const s of [...of("heap"), ...of("bank")]) {
    const { x0, x1 } = extent(s);
    if (x1 - x0 < 60) continue;
    const top = topEdge(s, x0, x1).filter((t) => t >= 0);
    // Count crowns: a column that is the highest within 6 columns either side, and stands 2 rows above the lowest point
    // between it and the next crown.
    const crowns: number[] = [];
    for (let i = 0; i < top.length; i++) {
      let peak = true;
      for (let j = Math.max(0, i - 6); j <= Math.min(top.length - 1, i + 6) && peak; j++) if (top[j] < top[i]) peak = false;
      if (peak && (crowns.length === 0 || i - crowns[crowns.length - 1] > 6)) crowns.push(i);
    }
    let lobes = crowns.length ? 1 : 0;
    for (let k = 1; k < crowns.length; k++) {
      let dip = -1;
      for (let i = crowns[k - 1]; i <= crowns[k]; i++) dip = Math.max(dip, top[i]);
      if (dip - Math.max(top[crowns[k - 1]], top[crowns[k]]) >= 2) lobes++;
    }
    assert.ok(lobes >= 2, `${s.kind} ${s.w}x${s.h}: ${lobes} lobe(s) along the top`);
  }
});

test("the dome is smooth, so light falls across it evenly", () => {
  for (const s of all()) {
    // Away from the edge, each dome value sits close to the mean of its 3×3 neighbours: curved, not noisy.
    let sum = 0, k = 0;
    for (let y = 2; y < s.h - 2; y++) for (let x = 2; x < s.w - 2; x++) {
      let inside = true;
      for (let dy = -2; dy <= 2 && inside; dy++) for (let dx = -2; dx <= 2 && inside; dx++) inside = solid(s, x + dx, y + dy);
      if (!inside) continue;
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m += s.dome[(y + dy) * s.w + x + dx];
      sum += Math.abs(s.dome[y * s.w + x] - m / 9);
      k++;
    }
    assert.ok(k === 0 || sum / k <= 0.02, `${s.kind} ${s.w}x${s.h}: roughness ${(sum / Math.max(1, k)).toFixed(4)}`);
  }
});

test("wisps taper to thin ends", () => {
  for (const s of of("wisp")) {
    const { x0, x1 } = extent(s);
    const height = (x: number) => { let k = 0; for (let y = 0; y < s.h; y++) if (solid(s, x, y)) k++; return k; };
    let mid = 0;
    for (let x = x0; x <= x1; x++) mid = Math.max(mid, height(x));
    const end = Math.max(2, Math.round(0.12 * (x1 - x0 + 1)));
    for (let x = x0; x < x0 + end; x++) assert.ok(height(x) <= 0.5 * mid, `wisp ${s.w}x${s.h}: column ${x} is ${height(x)} of ${mid}`);
    for (let x = x1 - end + 1; x <= x1; x++) assert.ok(height(x) <= 0.5 * mid, `wisp ${s.w}x${s.h}: column ${x} is ${height(x)} of ${mid}`);
  }
});

test("wisps and streaks are long and thin", () => {
  for (const s of [...of("wisp"), ...of("streak")]) assert.ok(s.w >= 4 * s.h, `${s.kind} ${s.w}x${s.h}`);
});

test("the dome is zero off the cloud and peaks inside it", () => {
  for (const s of all()) {
    let peak = -1, at = -1;
    for (let i = 0; i < s.dome.length; i++) {
      if (s.cover[i] === 0) assert.equal(s.dome[i], 0, `${s.kind} dome off the cloud`);
      if (s.dome[i] > peak) { peak = s.dome[i]; at = i; }
    }
    assert.ok(peak > 0, `${s.kind} has a dome`);
    assert.ok(s.cover[at] > 0.5, `${s.kind} peaks on solid cloud`);
  }
});

test("no two shapes of a kind are the same", () => {
  for (const kind of ["heap", "wisp", "bank", "streak"] as const) {
    const keys = of(kind).map((s) => `${s.w}x${s.h}:${Array.from(s.cover.subarray(0, 400)).join(",")}`);
    assert.equal(new Set(keys).size, keys.length, kind);
  }
});
