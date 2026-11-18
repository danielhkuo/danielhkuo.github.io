import assert from "node:assert/strict";
import { test } from "node:test";
import { makeShapes, SHAPE_COUNTS, SHAPE_SIZES, type CloudShape } from "./shapes.ts";

let memo: CloudShape[] | null = null;
/** Built on first use, so the test runner can list these tests before the shapes exist. */
const all = (): CloudShape[] => (memo ??= makeShapes(7, SHAPE_COUNTS));
const of = (kind: CloudShape["kind"]) => all().filter((s) => s.kind === kind);
const solid = (s: CloudShape, x: number, y: number) => x >= 0 && y >= 0 && x < s.w && y < s.h && s.cover[y * s.w + x] === 1;

/** The cloud's bounding box. */
function extent(s: CloudShape): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = s.w, x1 = -1, y0 = s.h, y1 = -1;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (solid(s, x, y)) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1 };
}
/** Mean light over the cloud's pixels in a rectangle. */
function meanLight(s: CloudShape, x0: number, x1: number, y0: number, y1: number): number {
  let sum = 0, k = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (solid(s, x, y)) { sum += s.light[y * s.w + x]; k++; }
  return k ? sum / k : NaN;
}
/** Pixels reached from `starts` through pixels that pass `ok`, 4-connected. */
function flood(s: CloudShape, starts: number[], ok: (i: number) => boolean): Uint8Array {
  const seen = new Uint8Array(s.w * s.h);
  const stack: number[] = [];
  for (const i of starts) if (ok(i) && !seen[i]) { seen[i] = 1; stack.push(i); }
  while (stack.length) {
    const j = stack.pop()!, x = j % s.w, y = (j - x) / s.w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = ny * s.w + nx;
      if (nx >= 0 && ny >= 0 && nx < s.w && ny < s.h && !seen[k] && ok(k)) { seen[k] = 1; stack.push(k); }
    }
  }
  return seen;
}

test("the same seed gives the same shapes, another seed others", () => {
  assert.deepEqual(makeShapes(7, SHAPE_COUNTS), all());
  assert.notDeepEqual(makeShapes(8, SHAPE_COUNTS), all());
});

test("shapes come in the asked counts, ordered by kind", () => {
  const kinds = all().map((s) => s.kind);
  const want = [
    ...Array(SHAPE_COUNTS.heap).fill("heap"), ...Array(SHAPE_COUNTS.puff).fill("puff"),
    ...Array(SHAPE_COUNTS.wisp).fill("wisp"), ...Array(SHAPE_COUNTS.bank).fill("bank"),
  ];
  assert.deepEqual(kinds, want);
  assert.equal(makeShapes(1, { heap: 2, puff: 0, wisp: 0, bank: 1 }).length, 3);
});

test("sizes lie inside their ranges, and the cover is crisp: cloud or not, nothing between", () => {
  for (const s of all()) {
    const r = SHAPE_SIZES[s.kind];
    assert.ok(s.w >= r.w[0] && s.w <= r.w[1], `${s.kind} w ${s.w}`);
    assert.ok(s.h >= r.h[0] && s.h <= r.h[1], `${s.kind} h ${s.h}`);
    assert.deepEqual([s.cover.length, s.light.length, s.rim.length], [s.w * s.h, s.w * s.h, s.w * s.h]);
    for (let i = 0; i < s.cover.length; i++) {
      assert.ok(s.cover[i] === 0 || s.cover[i] === 1, `${s.kind} cover ${s.cover[i]}`);
      if (s.cover[i] === 0) assert.ok(s.light[i] === 0 && s.rim[i] === 0, `${s.kind} light or rim off the cloud`);
      assert.ok(Number.isFinite(s.light[i]));
    }
  }
});

test("clouds are big: heaps a third of the frame wide and more, banks taller still, puffs small", () => {
  const heaps = of("heap"), banks = of("bank");
  assert.ok(heaps.filter((s) => s.w >= 134).length >= heaps.length / 2, "half the heaps span a third of a 400-pixel frame");
  assert.ok(Math.max(...heaps.map((s) => s.w)) >= 180, "the widest heap");
  const mean = (list: CloudShape[], f: (s: CloudShape) => number) => list.reduce((a, s) => a + f(s), 0) / list.length;
  assert.ok(mean(banks, (s) => s.h) >= 1.3 * mean(heaps, (s) => s.h), "banks tower over heaps");
  for (const s of of("puff")) assert.ok(s.w <= 90, `puff ${s.w}`);
  // Variety: the heaps are not all one size.
  assert.ok(Math.max(...heaps.map((s) => s.w)) >= 1.4 * Math.min(...heaps.map((s) => s.w)));
});

test("nothing touches the box's edge, so no cloud is cut off square", () => {
  for (const s of all()) {
    for (let x = 0; x < s.w; x++) assert.equal(s.cover[x] + s.cover[(s.h - 1) * s.w + x], 0, `${s.kind} top/bottom`);
    for (let y = 0; y < s.h; y++) assert.equal(s.cover[y * s.w] + s.cover[y * s.w + s.w - 1], 0, `${s.kind} sides`);
  }
});

test("each cloud is one solid piece: no crumbs beside it, no pinholes through it", () => {
  for (const s of all()) {
    const first = s.cover.indexOf(1);
    assert.ok(first >= 0, `${s.kind} has cloud`);
    const body = flood(s, [first], (i) => s.cover[i] === 1);
    const border: number[] = [];
    for (let x = 0; x < s.w; x++) border.push(x, (s.h - 1) * s.w + x);
    for (let y = 0; y < s.h; y++) border.push(y * s.w, y * s.w + s.w - 1);
    const sky = flood(s, border, (i) => s.cover[i] === 0);
    for (let i = 0; i < s.cover.length; i++) {
      if (s.cover[i] === 1) assert.ok(body[i], `${s.kind} ${s.w}x${s.h}: a crumb at ${i % s.w},${Math.floor(i / s.w)}`);
      else assert.ok(sky[i], `${s.kind} ${s.w}x${s.h}: a hole at ${i % s.w},${Math.floor(i / s.w)}`);
    }
  }
});

test("heaps and banks are massed, not ragged: they fill their box and their outline is short", () => {
  for (const s of [...of("heap"), ...of("bank")]) {
    let k = 0, edge = 0;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      if (!solid(s, x, y)) continue;
      k++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!solid(s, x + dx, y + dy)) edge++;
    }
    assert.ok(k >= 0.4 * s.w * s.h, `${s.kind} ${s.w}x${s.h}: ${k} pixels of cloud`);
    assert.ok(edge <= 2.2 * 2 * (s.w + s.h), `${s.kind} ${s.w}x${s.h}: outline ${edge}`);
  }
});

test("heaps and banks billow: their tops rise in two or more crowns", () => {
  for (const s of [...of("heap"), ...of("bank")]) {
    const { x0, x1 } = extent(s);
    const top: number[] = [];
    for (let x = x0; x <= x1; x++) {
      let t = 0;
      while (!solid(s, x, t)) t++;
      top.push(t);
    }
    // A crown: the highest column within 6 either side, standing 2 rows clear of the dip between it and the last crown.
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
    assert.ok(lobes >= 2, `${s.kind} ${s.w}x${s.h}: ${lobes} crown(s) along the top`);
  }
});

test("one sun, north-west and above: crowns are lit, the undersides and the south-east flank are in shade", () => {
  for (const s of [...of("heap"), ...of("bank"), ...of("puff")]) {
    const { x0, x1, y0, y1 } = extent(s);
    const third = Math.max(1, Math.floor((y1 - y0 + 1) / 3)), mx = (x0 + x1) >> 1, my = (y0 + y1) >> 1;
    const top = meanLight(s, x0, x1, y0, y0 + third - 1), bottom = meanLight(s, x0, x1, y1 - third + 1, y1);
    assert.ok(top - bottom >= 0.25, `${s.kind} ${s.w}x${s.h}: top ${top.toFixed(2)}, bottom ${bottom.toFixed(2)}`);
    const nw = meanLight(s, x0, mx, y0, my), se = meanLight(s, mx + 1, x1, my + 1, y1);
    assert.ok(nw - se >= 0.25, `${s.kind} ${s.w}x${s.h}: north-west ${nw.toFixed(2)}, south-east ${se.toFixed(2)}`);
  }
});

test("the light falls in clean steps, not speckle: neighbours rarely differ much", () => {
  for (const s of all()) {
    // Lobes meet at creases, drawn a tone darker, so some neighbours do differ; noise would make most of them differ.
    let jumps = 0, pairs = 0;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w - 1; x++) {
      if (!solid(s, x, y) || !solid(s, x + 1, y)) continue;
      pairs++;
      if (Math.abs(s.light[y * s.w + x] - s.light[y * s.w + x + 1]) > 0.25) jumps++;
    }
    assert.ok(pairs === 0 || jumps <= 0.2 * pairs, `${s.kind} ${s.w}x${s.h}: ${jumps} jumps in ${pairs} pairs`);
  }
});

test("rims lie on the sunward edge of a lit crown", () => {
  for (const s of all()) {
    let rims = 0;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const r = s.rim[y * s.w + x];
      if (r === 0) continue;
      rims++;
      assert.ok(solid(s, x, y), "a rim is on the cloud");
      if (r === 1) assert.ok(!solid(s, x, y - 1) || !solid(s, x - 1, y), `${s.kind}: a sky rim at ${x},${y} with cloud above and to the left`);
      else assert.ok(solid(s, x, y - 1), `${s.kind}: an inner rim at ${x},${y} with nothing above`);
    }
    assert.ok(rims > 0, `${s.kind} ${s.w}x${s.h} has rims`);
    // Never on the base: the lowest row of the cloud has none.
    const { y1 } = extent(s);
    for (let x = 0; x < s.w; x++) if (solid(s, x, y1) && solid(s, x, y1 - 1)) assert.notEqual(s.rim[y1 * s.w + x], 1, `${s.kind}: a rim under the cloud`);
  }
});

test("the shadow is the cloud's footprint: about as wide, flatter, and at the level of the base or below", () => {
  for (const s of all()) {
    const sh = s.shadow;
    assert.equal(sh.mask.length, sh.w * sh.h);
    let k = 0;
    for (const m of sh.mask) { assert.ok(m === 0 || m === 1); k += m; }
    assert.ok(k >= 0.3 * sh.w * sh.h, `${s.kind}: shadow ${k} of ${sh.w}x${sh.h}`);
    const { x0, x1, y1 } = extent(s);
    const cw = x1 - x0 + 1;
    assert.ok(sh.w >= 0.6 * cw && sh.w <= 1.3 * cw + 8, `${s.kind}: shadow ${sh.w} wide for a cloud ${cw} wide`);
    assert.ok(sh.h <= 0.75 * sh.w, `${s.kind}: shadow ${sh.w}x${sh.h}`);
    // Its middle lies near the row of the base, never up by the crown.
    const mid = sh.dy + sh.h / 2;
    assert.ok(mid >= y1 - 0.5 * s.h && mid <= y1 + 0.6 * s.h + 12, `${s.kind} ${s.w}x${s.h}: shadow centred on row ${mid}, base ${y1}`);
    assert.ok(sh.dx >= x0 - 12 && sh.dx <= x0 + 0.5 * cw, `${s.kind}: shadow starts at ${sh.dx}, cloud at ${x0}`);
  }
});

test("streamers are long and low", () => {
  for (const s of of("wisp")) assert.ok(s.w >= 3 * s.h, `wisp ${s.w}x${s.h}`);
});

test("no two shapes of a kind are the same", () => {
  for (const kind of ["heap", "puff", "wisp", "bank"] as const) {
    const keys = of(kind).map((s) => `${s.w}x${s.h}:${Array.from(s.cover.subarray(0, 600)).join("")}`);
    assert.equal(new Set(keys).size, keys.length, kind);
  }
});
