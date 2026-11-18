import assert from "node:assert/strict";
import { test } from "node:test";
import { isBuilt, isWater, MATERIAL as M } from "../look/materials.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { differing, drawn, frameOf, manifest, seaFrame, shot, type Shot } from "../testing/liveShot.ts";
import type { Flier, LiveFrame } from "./live.ts";
import {
  HERON_LIFT, HILL, isField, isRoad, isSea, RARE, rareLayer, rareSlot, rareWindow, SHIP_DEEP, WAKE_LASTS, WAKE_LOW, wakeLayer,
  WHALE_DEEP, type RareKind, type RareSeen,
} from "./rare.ts";
import { makeLayers, type LayerContext } from "./registry.ts";
import { worldRowAt } from "./sprites.ts";

const ctx: LayerContext = { seed: manifest.seed, n: manifest.n, sites: manifest.sites };
const palette = buildPalette(MIDDAY);
const W = 400, H = 225;
const kindOf = (kind: RareKind): number => RARE.findIndex((r) => r.kind === kind);

/** Level country of one material, `height` units up, with the tone given; as seaFrame, which is the sea at tone 9. */
function country(rx: number, ry: number, t: number, material: number, tone: number, height: number): LiveFrame {
  const f = seaFrame(rx, ry, t, palette, ctx.n, material);
  for (let r = 0; r < H; r++) {
    const by = ry + r, cy = Math.floor(by / 256);
    const depth = Math.round(((by + height - 256 * cy) / 0.8) * 8);
    for (let c = 0; c < W; c++) f.bake[r * W + c] = (material | (tone << 8) | (depth << 16)) >>> 0;
  }
  return f;
}

/** Meadow crossed by a narrow river every 24 rows. */
function streams(rx: number, ry: number, t: number): LiveFrame {
  const f = country(rx, ry, t, M.meadowMid, 8, 20);
  for (let r = 0; r < H; r++) {
    if ((((ry + r) % 24) + 24) % 24 >= 3) continue;
    for (let c = 0; c < W; c++) f.bake[r * W + c] = (f.bake[r * W + c] & ~0xff) | M.river;
  }
  return f;
}

/** When sight `k` first appears after time `from`, unforced. */
function begins(k: number, from = 0): number {
  for (let t = from; t < from + 2 * RARE[k].every; t += 1) {
    const at = rareWindow(ctx.seed, k, t);
    if (at >= 0 && rareWindow(ctx.seed, k, t - at - 0.5) < 0) return t - at;
  }
  throw new Error("no appearance");
}

/**
 * Every sighting of `kind` over a tile of the lattice, `at` seconds into its next appearance, on frames `make` builds:
 * the frames step by less than a frame's inner size, so each candidate is well inside at least one.
 */
function sightings(kind: RareKind, at: number, make: (rx: number, ry: number, t: number) => LiveFrame): { f: LiveFrame; s: RareSeen }[] {
  const k = kindOf(kind);
  const t = begins(k) + at;
  const rare = rareLayer(ctx);
  const got: { f: LiveFrame; s: RareSeen }[] = [];
  for (let ry = 1000; ry < 1000 + 512; ry += 70) for (let rx = 2000; rx < 2000 + 640; rx += 140) {
    const f = make(rx, ry, t);
    rare.log = [];
    rare.draw(f);
    for (const s of rare.log) if (s.kind === kind) got.push({ f, s });
  }
  return got;
}

const matAt = (f: LiveFrame, s: RareSeen): number => f.bake[s.py * W + s.px] & 255;
const toneAt = (f: LiveFrame, s: RareSeen): number => (f.bake[s.py * W + s.px] >>> 8) & 15;

/** What the forced layer shows on a view at time t. */
async function forcedOn(view: string, t: number): Promise<{ s: Shot; log: RareSeen[]; out: Uint32Array; told: string[] }> {
  const s = await shot(view);
  const told: string[] = [];
  const rare = rareLayer({ ...ctx, forceSights: true, discover: (id) => told.push(id) });
  rare.log = [];
  const out = drawn(rare, s, t);
  return { s, log: rare.log, out, told };
}

// ── The clock ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("each sight appears, on average, once in ten to twenty minutes, for as long as it should", () => {
  const hours = 12;
  for (let k = 0; k < RARE.length; k++) {
    let starts = 0, shown = 0, was = false;
    for (let t = 0; t < hours * 3600; t += 1) {
      const on = rareWindow(ctx.seed, k, t) >= 0;
      if (on && !was) starts++;
      if (on) shown++;
      was = on;
    }
    const mean = (hours * 3600) / starts;
    assert.ok(mean >= 600 && mean <= 1200, `${RARE[k].kind}: every ${(mean / 60).toFixed(1)} minutes`);
    assert.ok(Math.abs(shown / starts - RARE[k].lasts) <= 2, `${RARE[k].kind}: lasts ${shown / starts} s`);
    assert.ok(shown / (hours * 3600) < 0.1, `${RARE[k].kind}: rare`);
  }
});

test("the clock is the seed's: the same seed agrees with itself, another seed differs, and the sights keep different hours", () => {
  const times = (seed: number, k: number): number[] => {
    const at: number[] = [];
    for (let t = 0; t < 4 * 3600; t += 1) if (rareWindow(seed, k, t) >= 0 && rareWindow(seed, k, t - 1) < 0) at.push(t);
    return at;
  };
  assert.deepEqual(times(ctx.seed, 0), times(ctx.seed, 0));
  assert.notDeepEqual(times(ctx.seed, 0), times(ctx.seed + 1, 0));
  assert.notDeepEqual(times(ctx.seed, 0), times(ctx.seed, 4));
  // An appearance keeps one number from its start to its end.
  const t0 = begins(0);
  assert.equal(rareSlot(0, t0 + 0.1), rareSlot(0, t0 + RARE[0].lasts - 0.1));
  assert.notEqual(rareSlot(0, t0), rareSlot(0, begins(0, t0 + RARE[0].lasts + 1)));
});

test("between appearances the layer draws nothing at all", async () => {
  const rare = rareLayer(ctx);
  let quiet = 0;
  for (const view of ["abbey", "sea"]) {
    const s = await shot(view);
    for (let t = 0; t < 3600; t += 37) {
      if (RARE.some((_, k) => rareWindow(ctx.seed, k, t) >= 0)) continue;
      quiet++;
      assert.equal(differing(drawn(rare, s, t), s.out), 0);
    }
  }
  assert.ok(quiet > 100);
});

// ── Where each may be ────────────────────────────────────────────────────────────────────────────────────────────────

test("the whale breaches only on deep sea", () => {
  const deepSea = (rx: number, ry: number, t: number) => country(rx, ry, t, M.sea, 12, 0);
  const up = sightings("whale", 4, deepSea);
  assert.ok(up.length > 0, "a whale on the open sea");
  for (const { f, s } of up) {
    assert.equal(isSea[matAt(f, s)], 1);
    assert.ok(toneAt(f, s) >= WHALE_DEEP);
  }
  assert.ok(up.some(({ s }) => s.inView), "its back is up four seconds in");
  assert.equal(sightings("whale", 4, (rx, ry, t) => country(rx, ry, t, M.sea, WHALE_DEEP - 1, 0)).length, 0, "not in the shallows");
  assert.equal(sightings("whale", 4, (rx, ry, t) => country(rx, ry, t, M.lake, 12, 0)).length, 0, "not on a lake");
  assert.equal(sightings("whale", 4, (rx, ry, t) => country(rx, ry, t, M.meadowMid, 8, 20)).length, 0, "not on land");
});

test("the ship sails only far out at sea", () => {
  const out = sightings("ship", 35, (rx, ry, t) => country(rx, ry, t, M.sea, 12, 0));
  assert.ok(out.length > 0, "a ship on the open sea");
  for (const { f, s } of out) assert.equal(isSea[matAt(f, s)], 1);
  assert.equal(sightings("ship", 35, (rx, ry, t) => country(rx, ry, t, M.sea, SHIP_DEEP - 1, 0)).length, 0, "not inshore");
  assert.equal(sightings("ship", 35, (rx, ry, t) => country(rx, ry, t, M.pastureMid, 8, 20)).length, 0, "not on land");
});

test("the fox crosses only fields", () => {
  for (const at of [3, 10, 18]) {
    const seen = sightings("fox", at, (rx, ry, t) => country(rx, ry, t, M.meadowMid, 8, 20));
    assert.ok(seen.length > 0, `a fox in the meadow ${at} s in`);
    for (const { f, s } of seen) assert.equal(isField[matAt(f, s)], 1);
  }
  assert.ok(sightings("fox", 10, (rx, ry, t) => country(rx, ry, t, M.wheat, 8, 20)).length > 0, "and in the wheat");
  for (const m of [M.sea, M.river, M.broadleafMid, M.rockHard, M.cobble, M.snow]) {
    assert.equal(sightings("fox", 10, (rx, ry, t) => country(rx, ry, t, m, 8, 20)).length, 0);
  }
});

test("the heron stands only in a river, a step from the bank, and lifts off at the end", () => {
  const standing = sightings("heron", 6, streams);
  assert.ok(standing.length > 0, "a heron in the stream");
  for (const { f, s } of standing) {
    assert.equal(matAt(f, s), M.river);
    const near = [f.bake[s.py * W + s.px - 2], f.bake[s.py * W + s.px + 2], f.bake[(s.py - 2) * W + s.px], f.bake[(s.py + 2) * W + s.px]];
    assert.ok(near.some((v) => isWater[v & 255] === 0), "the bank is beside it");
  }
  assert.equal(sightings("heron", 6, (rx, ry, t) => country(rx, ry, t, M.meadowMid, 8, 20)).length, 0, "not in a meadow");
  assert.equal(sightings("heron", 6, (rx, ry, t) => country(rx, ry, t, M.river, 8, 20)).length, 0, "not in midstream");
  assert.equal(sightings("heron", 6, (rx, ry, t) => country(rx, ry, t, M.sea, 12, 0)).length, 0, "not at sea");
  // Flying: off the water, higher and further each second.
  const a = sightings("heron", HERON_LIFT + 1, streams), b = sightings("heron", HERON_LIFT + 3, streams);
  assert.ok(a.length > 0 && b.length > 0);
  const from = standing[0].s, first = a[0].s, later = b[0].s;
  assert.ok(first.py < from.py && later.py < first.py, "it climbs");
  assert.ok(Math.abs(later.px - from.px) > Math.abs(first.px - from.px), "and goes");
});

test("the balloon drifts only over hills", () => {
  const hills = sightings("balloon", 35, (rx, ry, t) => country(rx, ry, t, M.moorMid, 8, HILL + 20));
  assert.ok(hills.length > 0, "a balloon over the moor");
  assert.equal(sightings("balloon", 35, (rx, ry, t) => country(rx, ry, t, M.moorMid, 8, HILL - 4)).length, 0, "not over the low ground");
  assert.equal(sightings("balloon", 35, (rx, ry, t) => country(rx, ry, t, M.sea, 12, 0)).length, 0, "not over the sea");
  assert.equal(sightings("balloon", 35, (rx, ry, t) => country(rx, ry, t, M.lake, 12, 60)).length, 0, "not over a tarn");
  assert.equal(sightings("balloon", 35, (rx, ry, t) => country(rx, ry, t, M.roofTile, 8, 60)).length, 0, "not over roofs");
  // It moves east with the wind.
  const one = sightings("balloon", 30, (rx, ry, t) => country(rx, ry, t, M.moorMid, 8, 40));
  const two = sightings("balloon", 40, (rx, ry, t) => country(rx, ry, t, M.moorMid, 8, 40));
  assert.ok(one.length > 0 && two.length > 0 && two[0].s.px - one[0].s.px > 20);
});

test("the monk walks the road by the abbey, and nowhere else", async () => {
  const k = kindOf("monk");
  const t0 = begins(k);
  const abbey = await shot("abbey");
  const rare = rareLayer(ctx);
  const at = new Set<number>();
  for (let t = t0 + 3; t < t0 + RARE[k].lasts - 3; t += 2) {
    rare.log = [];
    drawn(rare, abbey, t);
    const monks = rare.log.filter((s) => s.kind === "monk");
    assert.equal(monks.length, 1, "one monk");
    assert.equal(isRoad[abbey.bake[monks[0].py * W + monks[0].px] & 255], 1, "on the road");
    at.add(monks[0].py * W + monks[0].px);
  }
  assert.ok(at.size > 12, `he walks (${at.size} places)`);
  for (const view of ["town", "sea", "peak"]) {
    rare.log = [];
    drawn(rare, await shot(view), t0 + 20);
    assert.equal(rare.log.filter((s) => s.kind === "monk").length, 0, `no monk on the ${view} view`);
  }
});

// ── Telling the visitor ──────────────────────────────────────────────────────────────────────────────────────────────

test("a sight is reported once an appearance, and only once it is in view", () => {
  const k = kindOf("whale");
  const t0 = begins(k);
  // A frame the whale of this appearance is on.
  const found = sightings("whale", 4, (rx, ry, t) => country(rx, ry, t, M.sea, 12, 0)).find(({ s }) => s.inView);
  assert.ok(found);
  const told: [string, string][] = [];
  const rare = rareLayer({ ...ctx, discover: (id, label) => told.push([id, label]) });
  const at = (t: number): RareSeen[] => {
    rare.log = [];
    rare.draw(country(found.f.rect.x, found.f.rect.y, t, M.sea, 12, 0));
    return rare.log;
  };
  // Under the water it is not yet a sight.
  for (let t = t0; t < t0 + 1.5; t += 0.25) assert.ok(at(t).every((s) => !s.inView));
  assert.equal(told.length, 0, "nothing told while it is under");
  let firstUp = -1;
  for (let t = t0 + 1.5; t < t0 + RARE[k].lasts; t += 0.25) {
    const up = at(t).some((s) => s.inView);
    if (up && firstUp < 0) {
      firstUp = t;
      assert.equal(told.length, 1, "told the moment it shows");
    }
    if (firstUp < 0) assert.equal(told.length, 0);
  }
  assert.ok(firstUp > 0);
  assert.deepEqual(told, [[RARE[k].id, RARE[k].label]], "once, though it surfaced twice and was drawn many times");
  // Out of the frame it is never told: the same appearance over empty sea elsewhere.
  const elsewhere = rareLayer({ ...ctx, discover: (id) => told.push([id, "elsewhere"]) });
  for (let t = t0; t < t0 + RARE[k].lasts; t += 0.5) elsewhere.draw(country(found.f.rect.x, found.f.rect.y, t, M.meadowMid, 8, 20));
  assert.equal(told.length, 1);
  // The next appearance is told again, when it comes.
  const t1 = begins(k, t0 + RARE[k].lasts + 1);
  const next = sightings("whale", 4, (rx, ry, t) => country(rx, ry, t, M.sea, 12, 0));
  assert.ok(next.length >= 0);
  for (let ry = 1000; ry < 1000 + 512; ry += 70) for (let rx = 2000; rx < 2000 + 640; rx += 140) {
    for (let t = t1 + 3; t < t1 + 7; t += 0.5) rare.draw(country(rx, ry, t, M.sea, 12, 0));
  }
  assert.equal(told.length, 2, "and once more for the next");
  // Without a log to tell, it still draws.
  assert.doesNotThrow(() => rareLayer(ctx).draw(country(found.f.rect.x, found.f.rect.y, t0 + 4, M.sea, 12, 0)));
});

// ── The preview switch ───────────────────────────────────────────────────────────────────────────────────────────────

test("forced, every sight shows at once where the land allows, near the middle of the view", async () => {
  const sea = await forcedOn("sea", 0);
  assert.deepEqual(sea.log.map((s) => s.kind).sort(), ["ship", "whale"]);
  assert.deepEqual(sea.told.sort(), ["rare-ship", "rare-whale"]);
  const land = await forcedOn("abbey", 0);
  assert.deepEqual(land.log.map((s) => s.kind).sort(), ["balloon", "fox", "heron", "monk"]);
  assert.deepEqual(land.told.sort(), ["rare-balloon", "rare-fox", "rare-heron", "rare-monk"]);
  for (const { s, log, out } of [sea, land]) {
    assert.ok(differing(out, s.out) > 40, "they are drawn");
    for (const p of log) {
      if (p.kind === "monk") continue;
      assert.ok(Math.abs(p.px - 200) < 130 && Math.abs(p.py - 112) < 95, `${p.kind} at ${p.px}, ${p.py}`);
    }
  }
  // Each on its own land, on the real world.
  const on = (v: { s: Shot; log: RareSeen[] }, kind: RareKind): number => {
    const p = v.log.find((q) => q.kind === kind);
    assert.ok(p);
    return v.s.bake[p.py * W + p.px];
  };
  assert.ok(isSea[on(sea, "whale") & 255] === 1 && ((on(sea, "whale") >>> 8) & 15) >= WHALE_DEEP);
  assert.equal(isSea[on(sea, "ship") & 255], 1);
  assert.equal(isField[on(land, "fox") & 255], 1);
  assert.equal(on(land, "heron") & 255, M.river);
  assert.equal(isRoad[on(land, "monk") & 255], 1);
  // The balloon hangs over a hill: the ground it settled on is under it by its height.
  const stood = await forcedOn("abbey", RARE[kindOf("balloon")].lasts / 2 - RARE[kindOf("balloon")].lead);
  const b = stood.log.find((q) => q.kind === "balloon");
  assert.ok(b);
  let ground = -1;
  for (let py = b.py + 40; py < b.py + 80 && ground < 0; py++) {
    const v = stood.s.bake[py * W + b.px];
    const height = 0.8 * worldRowAt(frameOf(stood.s, 0), b.px, py) - (stood.s.rect.y + py);
    if (isWater[v & 255] === 0 && isBuilt[v & 255] === 0 && height >= HILL) ground = py;
  }
  assert.ok(ground > 0, "hill under the balloon");
  // And they go on appearing: at any time, most of them are showing.
  for (let t = 0; t < 400; t += 23) {
    let showing = 0;
    for (let k = 0; k < RARE.length; k++) if (rareWindow(ctx.seed, k, t, true) >= 0) showing++;
    assert.ok(showing >= 4, `${showing} showing at ${t}`);
  }
});

test("the registry passes the switch on, and leaves the sights rare without it", async () => {
  const s = await shot("sea");
  const quiet = makeLayers(ctx).find((l) => l.name === "rare");
  const forced = makeLayers({ ...ctx, forceSights: true }).find((l) => l.name === "rare");
  assert.ok(quiet && forced);
  assert.ok(RARE.every((_, k) => rareWindow(ctx.seed, k, 0) < 0), "nothing is due at time 0");
  assert.equal(differing(drawn(quiet, s, 0), s.out), 0);
  assert.ok(differing(drawn(forced, s, 0), s.out) > 40);
});

test("the same time gives the same frame, whatever was drawn before; another seed puts things elsewhere", async () => {
  for (const view of ["sea", "abbey"]) {
    const s = await shot(view);
    const a = rareLayer({ ...ctx, forceSights: true }), b = rareLayer({ ...ctx, forceSights: true });
    const first = drawn(a, s, 12.3);
    drawn(a, s, 40.7);
    drawn(a, s, 3.1);
    assert.deepEqual(drawn(a, s, 12.3), first);
    assert.deepEqual(drawn(b, s, 12.3), first);
  }
  const k = kindOf("fox");
  const meadow = (rx: number, ry: number, t: number) => country(rx, ry, t, M.meadowMid, 8, 20);
  const here = sightings("fox", 10, meadow).map(({ f, s }) => [f.rect.x + s.px, f.rect.y + s.py]);
  const again = sightings("fox", 10, meadow).map(({ f, s }) => [f.rect.x + s.px, f.rect.y + s.py]);
  assert.deepEqual(here, again);
  const other = rareLayer({ ...ctx, seed: ctx.seed + 1 });
  const there: number[][] = [];
  for (let ry = 1000; ry < 1000 + 512; ry += 70) for (let rx = 2000; rx < 2000 + 640; rx += 140) {
    other.log = [];
    other.draw(meadow(rx, ry, begins(k) + 10));
    for (const p of other.log) there.push([rx + p.px, ry + p.py]);
  }
  assert.notDeepEqual(here, there);
});

// ── The wake ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test("the wake trails only behind a low flier over water", async () => {
  const wake = wakeLayer();
  const rx = 3000, ry = 2000;
  const sea = (): LiveFrame => country(rx, ry, 5, M.sea, 12, 0);
  const flier = (alt: number, heading: number, speed = 60): Flier => ({ x: rx + 200, y: (ry + 112) / 0.8, alt, heading, speed });
  const changed = (f: LiveFrame, base: Uint32Array): number[] => {
    const at: number[] = [];
    for (let i = 0; i < base.length; i++) if (f.out[i] !== base[i]) at.push(i);
    return at;
  };

  for (const heading of [-Math.PI / 2, 0, 2.2, Math.PI]) {
    const f = sea();
    const base = new Uint32Array(f.out);
    f.flier = flier(10, heading);
    wake.draw(f);
    const foam = changed(f, base);
    assert.ok(foam.length > 30, `foam behind a flier heading ${heading}: ${foam.length} pixels`);
    const hx = Math.cos(heading), hy = Math.sin(heading);
    let left = 0, right = 0;
    for (const i of foam) {
      const dx = (i % W) - 200, dy = (Math.floor(i / W) - 112) / 0.8;
      const along = dx * hx + dy * hy, across = dx * hy - dy * hx;
      assert.ok(along < 2, "behind it, never ahead");
      assert.ok(-along <= 60 * WAKE_LASTS + 2, "no further back than the foam lasts");
      // A V: no wider than it is long.
      assert.ok(Math.abs(across) <= 3.5 + 0.45 * -along, `across ${across} at ${along}`);
      if (across > 0) left++;
      else right++;
      // Foam: paler than the water.
      assert.ok((f.out[i] & 255) > (base[i] & 255));
    }
    assert.ok(left > 10 && right > 10, "two arms");
  }

  // Fading: the foam is whiter near the flier than at the tail.
  const f = sea();
  const base = new Uint32Array(f.out);
  f.flier = flier(10, -Math.PI / 2);
  wake.draw(f);
  let near = 0, far = 0;
  for (const i of changed(f, base)) {
    const gain = (f.out[i] & 255) - (base[i] & 255);
    if (Math.floor(i / W) - 112 < 20) near = Math.max(near, gain);
    else if (Math.floor(i / W) - 112 > 50) far = Math.max(far, gain);
  }
  assert.ok(far > 0 && near > 2 * far, `near ${near}, far ${far}`);

  const none = (fl: Flier | undefined, g: LiveFrame, why: string): void => {
    const before = new Uint32Array(g.out);
    g.flier = fl;
    wake.draw(g);
    assert.equal(changed(g, before).length, 0, why);
  };
  none(undefined, sea(), "no flier, no wake");
  none(flier(WAKE_LOW + 1, 0), sea(), "none under a high flier");
  none(flier(90, 0), sea(), "none far below a soaring one");
  none(flier(10, 0, 0), sea(), "none behind a flier standing still");
  none(flier(30, 0), country(rx, ry, 5, M.meadowMid, 8, 20), "none over land, however low");
  // A lake in the hills: the wake lies on its surface, by the height over the water and not over the sea.
  const tarn = country(rx, ry, 5, M.lake, 12, 80);
  const tarnBase = new Uint32Array(tarn.out);
  tarn.flier = { ...flier(90, 0), y: (ry + 112 + 80) / 0.8 };
  wake.draw(tarn);
  assert.ok(changed(tarn, tarnBase).length > 30, "a wake on a high lake");

  // On the real world: over the sea view it shows; over the abbey's woods it does not; foam lies only on water.
  const open = await shot("sea");
  const low = { x: open.rect.x + 200, y: (open.rect.y + 130) / 0.8, alt: 12, heading: -Math.PI / 2, speed: 60 };
  const drawnSea = drawn(wake, open, 3, low);
  let onWater = 0;
  for (let i = 0; i < drawnSea.length; i++) {
    if (drawnSea[i] === open.out[i]) continue;
    onWater++;
    assert.equal(isWater[open.bake[i] & 255], 1);
  }
  assert.ok(onWater > 30);
  const abbey = await shot("abbey");
  const overLand = { x: abbey.rect.x + 200, y: (abbey.rect.y + 130) / 0.8, alt: 40, heading: 0.4, speed: 60 };
  assert.equal(differing(drawn(wake, abbey, 3, overLand), abbey.out), 0);
});

// ── Cost ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("the rare sights and the wake stay inside their budget, forced and at rest", async () => {
  const p95 = async (view: string, forceSights: boolean): Promise<[number, number]> => {
    const s = await shot(view);
    const layers = [rareLayer({ ...ctx, forceSights }), wakeLayer()];
    const f = frameOf(s, 0, { x: s.rect.x + 200, y: (s.rect.y + 130) / 0.8, alt: 12, heading: -Math.PI / 2, speed: 60 });
    const ms: number[] = [];
    for (let j = 0; j < 400; j++) {
      f.t = j / 20;
      const t0 = performance.now();
      for (const layer of layers) layer.draw(f);
      ms.push(performance.now() - t0);
    }
    const warm = ms.slice(80).sort((a, b) => a - b);
    return [warm[Math.floor(warm.length * 0.95)], warm[warm.length >> 1]];
  };
  for (const view of ["sea", "abbey", "town"]) {
    const [forced, forcedMid] = await p95(view, true);
    const [rest, restMid] = await p95(view, false);
    console.log(`rare + wake, ${view} view: forced median ${forcedMid.toFixed(3)} ms, p95 ${forced.toFixed(3)} ms; at rest median ${restMid.toFixed(3)} ms, p95 ${rest.toFixed(3)} ms`);
    assert.ok(forced < 0.8, `${view} forced: p95 ${forced.toFixed(3)} ms`);
    assert.ok(rest < 0.4, `${view} at rest: p95 ${rest.toFixed(3)} ms`);
  }
});
