// A thing crossing the frame's edge stays drawn, part by part, until it has wholly left the frame. Put another way:
// what a layer draws on a world pixel does not depend on where the frame's edges fall. Each test here cuts frames out
// of a bigger view of the same land, at offsets that sweep all four edges across that view, and holds every cut to
// the bigger view's pixels at the same world pixels. The cuts come in three sizes: the flight page's, and two others,
// since the layers take their size from the frame.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MATERIAL as M } from "../look/materials.ts";
import type { ManifestWonder } from "../pack/manifest.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { drawStack, type Stack } from "../runtime/stack.ts";
import { cut, frameOf, land, levelFrame, levelPixel, manifest, seaFrame, shot, type Shot } from "../testing/liveShot.ts";
import { stamp } from "./art.ts";
import { lifeLayer, type Placed } from "./life.ts";
import type { Flier, LiveFrame, LiveLayer } from "./live.ts";
import { gardenWhere, momentsLayer, momentWindow } from "./moments.ts";
import { RARE, rareLayer, rareWindow, wakeLayer, type RareSeen } from "./rare.ts";
import { KITE_EVERY, NET_EVERY, sightsLayer, type Sight } from "./sights.ts";
import { drawSprite, worldRowAt, type LiveSprite } from "./sprites.ts";

const palette = buildPalette(MIDDAY);
const seed = manifest.seed;
const n = manifest.n;
const ctx = { seed, n, sites: manifest.sites, land };

/** Cut sizes: the flight page's frame, and two others. */
const SIZES: readonly (readonly [number, number])[] = [[400, 225], [304, 196], [236, 236]];

/** A Shot over a level frame (see liveShot.levelFrame) w × h, and the bake under it. */
function levelShot(f: LiveFrame): Shot {
  return { out: f.out, bake: f.bake, rect: f.rect, palette: f.palette, n: f.n, bakeSpace: f.bakeSpace };
}

/**
 * Cuts of `big` at each size: across in x, `step` pixels at a time, at the top, middle and bottom, and down in y at
 * the left, middle and right, so every edge of a cut passes over every part of `big`. Each cut is drawn by `layer`
 * at time t and compared with `big` drawn by it. Returns the cuts that differ, with how many pixels and the first.
 */
function sweep(big: Shot, layer: () => LiveLayer, t: number, flier?: Flier, step = 3): string[] {
  const ref = frameOf(big, t, flier);
  layer().draw(ref);
  const bw = big.rect.w, bh = big.rect.h;
  const bad: string[] = [];
  for (const [w, h] of SIZES) {
    const offsets: [number, number][] = [];
    for (let ox = 0; ox <= bw - w; ox += step) for (const oy of [0, (bh - h) >> 1, bh - h]) offsets.push([ox, oy]);
    for (let oy = 0; oy <= bh - h; oy += step) for (const ox of [0, (bw - w) >> 1, bw - w]) offsets.push([ox, oy]);
    for (const [ox, oy] of offsets) {
      const f = frameOf(cut(big, ox, oy, w, h), t, flier);
      layer().draw(f);
      let count = 0, first = -1;
      for (let r = 0; r < h; r++) {
        const from = (oy + r) * bw + ox;
        for (let c = 0; c < w; c++) {
          if (f.out[r * w + c] === ref.out[from + c]) continue;
          count++;
          if (first < 0) first = r * w + c;
        }
      }
      if (count > 0) bad.push(`${w}x${h} cut at +${ox},+${oy}: ${count} px differ, the first at ${first % w},${Math.floor(first / w)}`);
    }
  }
  return bad;
}

function noEdges(bad: string[], what: string): void {
  assert.equal(bad.length, 0, `${what}: ${bad.length} cuts draw differently from the view they were cut from:\n${bad.slice(0, 8).join("\n")}`);
}

/**
 * A flier that has just passed low over the resting gull nearest the middle of `s`, heading north a little east:
 * the gulls along its track are up and scattering, some of them across the edges of the cuts.
 */
function lowFlier(s: Shot): Flier {
  const life = lifeLayer(ctx);
  life.log = [];
  life.draw(frameOf(s, 0));
  let best: Placed | null = null, bestD = Infinity;
  for (const p of life.log) {
    if (p.kind !== "gull-resting") continue;
    const d = (p.px - s.rect.w / 2) ** 2 + (p.py - s.rect.h / 2) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  assert.ok(best, "a gull rests on the view's beaches");
  const f = frameOf(s, 0);
  const row = worldRowAt(f, best.px, best.py), ground = 0.8 * row - (s.rect.y + best.py);
  return { x: s.rect.x + best.px + 8, y: row - 30, alt: ground + 15, heading: -Math.PI / 2 + 0.3, speed: 60 };
}

// ── The primitives ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Flat sea-level land under a w × h frame at (rx, ry), as sprites.test.ts has it, running on past the frame. */
function flat(rx: number, ry: number, w: number, h: number): LiveFrame {
  return levelFrame(rx, ry, 0, new Uint32Array(65536), 1280, levelPixel(5, 9, 0), 0xff808080, w, h);
}

test("a sprite crossing any edge of the frame is drawn exactly as far as it overlaps the frame", () => {
  const sw = 7, sh = 5;
  const s: LiveSprite = { w: sw, h: sh, rgba: new Uint32Array(sw * sh).fill(0xffffffff), alpha: new Uint8Array(sw * sh).fill(255), ax: 3, ay: 4 };
  for (const [w, h] of SIZES) {
    for (let sx = -sw - 1; sx <= w + sw; sx++) for (const sy of [-sh - 1, -2, 0, 1, h >> 1, h - 2, h - 1, h, h + sh]) {
      for (const flip of [false, true]) {
        const f = flat(0, 0, w, h);
        // Anchor on frame pixel (sx, sy): world x = sx, ground row sy / 0.8 at height 0 … lifted so its bake row is sy.
        drawSprite(f, s, sx, 300 / 0.8, 300 - sy, flip);
        let drawn = 0;
        for (let i = 0; i < f.out.length; i++) if (f.out[i] === 0xffffffff) drawn++;
        const x0 = Math.max(0, sx - 3), x1 = Math.min(w, sx - 3 + sw), y0 = Math.max(0, sy - 4), y1 = Math.min(h, sy - 4 + sh);
        const want = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
        assert.equal(drawn, want, `${w}x${h}: a 7×5 sprite anchored at ${sx},${sy}${flip ? ", flipped" : ""}`);
      }
    }
  }
});

test("a stamp, and a stack such as the dragon is drawn with, cross every edge part by part", () => {
  const sw = 6, sh = 4;
  const s: LiveSprite = { w: sw, h: sh, rgba: new Uint32Array(sw * sh).fill(0xffffffff), alpha: new Uint8Array(sw * sh).fill(255), ax: 2, ay: 3 };
  const st: Stack = { w: 5, h: 3, layers: 4, rgba: new Uint32Array(60).fill(0xffffffff), alpha: new Uint8Array(60).fill(255) };
  // Unrotated, slices k = 0…3 lift one pixel each: the pile covers x − 2 … x + 2 and rows y − 1 − 3 … y + 1.
  const view = { depthAt: (_px: number, py: number) => py / 0.8 - 1e6 };
  for (const [w, h] of SIZES) {
    for (let x = -8; x <= w + 8; x++) for (const y of [-6, -1, 0, h >> 1, h - 1, h, h + 2, h + 4]) {
      const f = flat(0, 0, w, h);
      stamp(f, s, x, y, false);
      let drawn = 0;
      for (let i = 0; i < f.out.length; i++) if (f.out[i] === 0xffffffff) drawn++;
      const want = Math.max(0, Math.min(w, x - 2 + sw) - Math.max(0, x - 2)) * Math.max(0, Math.min(h, y - 3 + sh) - Math.max(0, y - 3));
      assert.equal(drawn, want, `${w}x${h}: stamp at ${x},${y}`);

      const g = new Uint32Array(w * h);
      drawStack(g, { x: 0, y: 0, w, h }, view, st, x, (y + 100) / 0.8, 100, 0, 1280);
      let piled = 0;
      for (let i = 0; i < g.length; i++) if (g[i] !== 0) piled++;
      const pile = Math.max(0, Math.min(w, x + 3) - Math.max(0, x - 2)) * Math.max(0, Math.min(h, y + 2) - Math.max(0, y - 4));
      assert.equal(piled, pile, `${w}x${h}: stack at ${x},${y}`);
    }
  }
});

// ── The layers ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("sheep, gulls, boats and smoke cross the frame's edges whole: a cut of the town draws what the town does", async () => {
  const big = await shot("town", 640, 400);
  const life = lifeLayer(ctx);
  const log: Placed[] = [];
  life.log = log;
  life.draw(frameOf(big, 20, lowFlier(big)));
  for (const kind of ["boat", "gull-resting", "gull-startled", "gull", "smoke"] as const) assert.ok(log.some((p) => p.kind === kind), `the town view has a ${kind}`);
  life.log = null;
  for (const t of [0, 20]) noEdges(sweep(big, () => life, t, lowFlier(big)), `life at t = ${t}`);
});

test("sheep on the pastures cross the frame's edges whole", async () => {
  const big = await shot("abbey", 640, 400);
  const life = lifeLayer(ctx);
  life.log = [];
  life.draw(frameOf(big, 5));
  assert.ok(life.log.filter((p) => p.kind === "sheep").length > 10, "the abbey view has flocks");
  life.log = null;
  noEdges(sweep(big, () => life, 5), "sheep");
});

test("the kite, the skeins and the fishing boats cross the frame's edges whole", async () => {
  const big = await shot("town", 640, 400);
  const sights = sightsLayer(ctx);
  // A time the kite is up.
  let kiteT = -1;
  for (let t = 0; t < KITE_EVERY && kiteT < 0; t += 5) {
    sights.log = [];
    sights.draw(frameOf(big, t));
    if (sights.log.some((p: Sight) => p.kind === "kite")) kiteT = t;
  }
  assert.ok(kiteT >= 0, "the kite flies over the town");
  sights.log = null;
  noEdges(sweep(big, () => sights, kiteT), "the kite");
  // Open sea with fishing boats, their nets out and in.
  const sea = levelShot(seaFrame(300, 500, 0, palette, n, M.sea, 640, 400));
  for (const t of [0, NET_EVERY / 4, NET_EVERY / 2]) {
    sights.log = [];
    sights.draw(frameOf(sea, t));
    assert.ok(sights.log.some((p) => p.kind === "fisher"), "fishing boats on the open sea");
    sights.log = null;
    noEdges(sweep(sea, () => sights, t), `fishers at t = ${t}`);
  }
  // A skein, wherever one is.
  const leader = sights.skeinsAt(40)[0];
  const sky = levelShot(seaFrame(Math.round(leader.x) - 320, Math.round(0.8 * leader.y) - 150 - 200, 40, palette, n, M.sea, 640, 400));
  noEdges(sweep(sky, () => sights, 40), "a skein");
});

/** When rare sight `k` first appears after time `from`, unforced. */
function begins(k: number, from = 0): number {
  for (let t = from; t < from + 2 * RARE[k].every; t += 1) {
    const at = rareWindow(seed, k, t);
    if (at >= 0 && rareWindow(seed, k, t - at - 0.5) < 0) return t - at;
  }
  throw new Error("no appearance");
}

test("the rare sights cross the frame's edges whole, wherever they stand and however far they travel", () => {
  const k = (kind: string): number => RARE.findIndex((r) => r.kind === kind);
  const cases: { kind: string; at: number[]; pixel: (by: number) => number }[] = [
    { kind: "whale", at: [4, 9.5, 13], pixel: levelPixel(M.sea, 12, 0) },
    { kind: "ship", at: [3, 35, 66], pixel: levelPixel(M.sea, 12, 0) },
    { kind: "fox", at: [3, 10, 21], pixel: levelPixel(M.meadowMid, 8, 20) },
    { kind: "balloon", at: [6, 35, 64], pixel: levelPixel(M.meadowMid, 8, 20) },
    {
      kind: "heron", at: [10, 37, 42],
      // Meadow crossed by a narrow river every 24 rows.
      pixel: (by) => {
        const v = levelPixel(M.meadowMid, 8, 20)(by);
        return ((by % 24) + 24) % 24 < 3 ? ((v & ~0xff) | M.river) >>> 0 : v;
      },
    },
  ];
  const rare = rareLayer(ctx);
  for (const c of cases) {
    const t0 = begins(k(c.kind));
    for (const at of c.at) {
      const big = levelShot(levelFrame(2000, 1000, t0 + at, palette, n, c.pixel, palette[(M.meadowMid << 8) | 8], 640, 400));
      rare.log = [];
      rare.draw(frameOf(big, t0 + at));
      assert.ok(rare.log.some((s: RareSeen) => s.kind === c.kind), `a ${c.kind} shows ${at} s in`);
      rare.log = null;
      noEdges(sweep(big, () => rare, t0 + at, undefined, 5), `the ${c.kind}, ${at} s in`);
    }
  }
});

test("the monk crosses the frame's edges whole", async () => {
  const big = await shot("abbey", 640, 400);
  const rare = rareLayer(ctx);
  const t = begins(RARE.findIndex((r) => r.kind === "monk")) + 20;
  rare.log = [];
  rare.draw(frameOf(big, t));
  assert.ok(rare.log.some((s) => s.kind === "monk"), "the monk walks by the abbey");
  rare.log = null;
  noEdges(sweep(big, () => rare, t, undefined, 4), "the monk");
});

test("the wake crosses the frame's edges whole", () => {
  const big = levelShot(seaFrame(3000, 2000, 0, palette, n, M.sea, 640, 400));
  const flier: Flier = { x: 3000 + 320, y: (2000 + 200) / 0.8, alt: 8, heading: 0.4, speed: 70 };
  const wake = wakeLayer();
  const ref = frameOf(big, 1, flier);
  wake.draw(ref);
  let foam = 0;
  for (let i = 0; i < ref.out.length; i++) if (ref.out[i] !== big.out[i]) foam++;
  assert.ok(foam > 10, "the wake is drawn");
  noEdges(sweep(big, () => wakeLayer(), 1, flier), "the wake");
});

test("the wonders' moments, their shadows, foam and ripples cross the frame's edges whole", () => {
  const X = 3200, Y = 2100;
  const wonder = (type: string, level: number, height: number, anchors: Record<string, [number, number]>): ManifestWonder =>
    ({ id: `${type}-0`, type, x: X, y: Y, level, height, anchors });
  const cases: { w: ManifestWonder; kind: string }[] = [
    { w: wonder("baths", 24, 22, { quay: [X, Y + 35], funicularTop: [X + 20, Y + 6], funicularFoot: [X + 20, Y + 30] }), kind: "ferry" },
    { w: wonder("railway", 0, 13, { shore: [X - 90, Y], halt: [X + 70, Y + 3] }), kind: "train" },
    { w: wonder("drowned-church", 4, 31, { tower: [X, Y] }), kind: "church" },
    { w: wonder("cove-hotel", 0, 31, { pontoon: [X, Y + 16], cove: [X, Y - 30] }), kind: "plane" },
    { w: wonder("marsh-house", 3.6, 19, { lamp: [X - 2, Y + 2], gate: [X, Y + 8], firm: [X + 36, Y + 28] }), kind: "marsh" },
    { w: wonder("airship-mast", 18, 46, { mast: [X, Y] }), kind: "airship" },
    { w: wonder("bridge-town", 1, 25, { west: [X - 22, Y], east: [X + 22, Y], upstream: [X, Y - 28], downstream: [X, Y + 28] }), kind: "bridge" },
    { w: wonder("great-oak", 12, 47, { crown: [X, Y], swing: [X + 11, Y], treehouse: [X - 11, Y], village: [X, Y + 40] }), kind: "oak" },
    { w: wonder("observatory", 40, 24, { dome: [X, Y] }), kind: "dome" },
  ];
  const big = levelShot(seaFrame(X - 320, Math.round(0.8 * Y) - 200, 0, palette, n, M.sea, 640, 400));
  for (const c of cases) {
    let t = 0;
    while (momentWindow(seed, c.kind, t) < 0) t++;
    // A few times through the appearance: coming, there, and going.
    for (const into of [1, 9, 17]) {
      const moments = momentsLayer({ seed, n, sites: [], wonders: [c.w] });
      noEdges(sweep(big, () => moments, t + into, undefined, 5), `${c.w.type}, ${into} s into its moment`);
    }
  }
});

test("the floating garden and its shadow cross the frame's edges whole", () => {
  let t = 0;
  while (momentWindow(seed, "garden", t) < 3) t++;
  const where = gardenWhere(seed, n, land, t);
  assert.ok(where);
  const big = levelShot(seaFrame(Math.round(where.x) - 320, Math.round(0.8 * where.y) - 120, t, palette, n, M.sea, 640, 400));
  const moments = momentsLayer({ seed, n, sites: [], land });
  moments.log = [];
  moments.draw(frameOf(big, t));
  assert.ok(moments.log.some((p) => p.kind === "garden"), "the garden floats over the sea");
  moments.log = null;
  noEdges(sweep(big, () => moments, t, undefined, 4), "the garden");
});

test("figures on the town clock cross the frame's edges whole", () => {
  const X = 3200, Y = 2100;
  const big = levelShot(seaFrame(X - 320, Math.round(0.8 * Y) - 200, 4, palette, n, M.sea, 640, 400));
  // A dial on the frame and in the land past it: three by three pixels at the town's ground, a little up.
  const at = (bx: number, by: number): boolean => Math.abs(bx - X) <= 1 && Math.abs(by - (Math.round(0.8 * Y) - 12)) <= 1;
  const under = big.bakeSpace!;
  big.bakeSpace = (bx, by) => (at(bx, by) ? ((under(bx, by) & ~255) | M.dial) >>> 0 : under(bx, by));
  for (let r = 0; r < big.rect.h; r++) for (let c = 0; c < big.rect.w; c++) big.bake[r * big.rect.w + c] = big.bakeSpace(big.rect.x + c, big.rect.y + r);
  const moments = momentsLayer({ seed, n, sites: [{ id: "town-0", type: "town", x: X, y: Y }] });
  moments.log = [];
  moments.draw(frameOf(big, 4));
  assert.ok(moments.log.some((p) => p.kind === "figures"), "the figures are out");
  moments.log = null;
  noEdges(sweep(big, () => moments, 4, undefined, 3), "the clock's figures");
});

