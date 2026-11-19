import assert from "node:assert/strict";
import { test } from "node:test";
import { torusDelta } from "../core/torus.ts";
import { manifestWonders, wondersOf } from "../pack/manifest.ts";
import { paramsFor } from "./params.ts";
import { makeTerrain, settleWorld, type Terrain } from "./pipeline.ts";
import { siteFieldsOf } from "./settle.ts";
import { siteContext } from "./sites.ts";
import { placeWonders, WONDER_ORDER, type WonderLand, wonderRules, wonderScale } from "./wonders.ts";
import {
  airshipMast, BRIDGE_TALL, bathLevels, bridgeTown, coveHotel, drownedChurch, greatOak, MAST_TALL, marshCauseway, marshHouse,
  OAK_TALL, OBS_TALL, observatory, thermalBaths, tideHalt, tideTrack,
} from "./wonderworks.ts";

const N = 1280, SEED = 7;
let land: Terrain | null = null;
const terrain = (): Terrain => (land ??= makeTerrain(paramsFor(N), SEED));

/** The land as wonder siting reads it, with nothing built on it. */
function bare(t: Terrain): WonderLand {
  const c = siteContext(siteFieldsOf(t));
  const coves: WonderLand["coves"][number][] = [];
  for (const s of t.land.stamps) if (s.kind === "cove") coves.push({ x: s.x, y: s.y, ax: s.ax, ay: s.ay, len: s.len, width: s.width });
  return { c, g: c.h, seed: t.land.seed, lakes: t.hydro.lakes, coves, busy: new Uint8Array(c.gN * c.gN), villages: [] };
}

test("lengths scale with the world up to 6400 and no further", () => {
  assert.equal(wonderScale(3200), 0.5);
  assert.equal(wonderScale(6400), 1);
  assert.equal(wonderScale(10240), 1);
  assert.equal(wonderRules(3200).spacing, 300);
  assert.equal(wonderRules(10240).spacing, 600);
  assert.deepEqual(wonderRules(10240), wonderRules(6400));
});

test("siting is deterministic: the same land gives the same wonders and the same structures", () => {
  const a = settleWorld(terrain()).settlement, b = settleWorld(terrain()).settlement;
  assert.ok(a.wonders.length >= 2, `${a.wonders.length} wonders placed: ${a.wonderSkips}`);
  assert.deepEqual(a.wonders, b.wonders);
  assert.deepEqual(a.wonderSkips, b.wonderSkips);
  assert.deepEqual(a.built.structures, b.built.structures);
  assert.deepEqual(a.built.conforms, b.built.conforms);
});

test("wonders keep their spacing from every landmark and from each other, and each is placed or named as skipped", () => {
  const s = settleWorld(terrain()).settlement, spacing = wonderRules(N).spacing;
  assert.ok(spacing > 0);
  for (const w of s.wonders) {
    assert.ok(w.x >= 0 && w.x < N && w.y >= 0 && w.y < N);
    assert.ok(w.level + w.height <= wonderRules(N).heightCap);
    for (const o of [...s.sites, ...s.wonders]) {
      if (o === w) continue;
      const d = Math.hypot(torusDelta(w.x, o.x, N), torusDelta(w.y, o.y, N));
      assert.ok(d >= spacing - 1e-6, `${w.id} is ${d.toFixed(0)} cells from ${o.id}`);
    }
  }
  for (const type of WONDER_ORDER) {
    const stands = s.wonders.some((w) => w.type === type), named = s.wonderSkips.some((line) => line.startsWith(`${type}: `));
    assert.ok(stands !== named, `${type}: placed ${stands}, skipped ${named}`);
  }
});

test("a wonder is never placed within the spacing of a landmark", () => {
  const l = bare(terrain());
  const free = placeWonders(l, []);
  assert.ok(free.wonders.length > 0);
  // Every place a wonder took becomes a landmark: none may stand within the spacing of them now.
  const again = placeWonders(l, free.wonders);
  for (const w of again.wonders) for (const o of free.wonders) {
    assert.ok(Math.hypot(torusDelta(w.x, o.x, N), torusDelta(w.y, o.y, N)) >= wonderRules(N).spacing - 1e-6, `${w.id} by ${o.id}`);
  }
});

test("a wonder whose land is missing is skipped and named, never forced", () => {
  const l = bare(terrain());
  const dry: WonderLand = { ...l, lakes: [], coves: [] };
  const r = placeWonders(dry, []);
  assert.ok(!r.wonders.some((w) => w.type === "drowned-church" || w.type === "cove-hotel"));
  assert.ok(r.skipped.some((line) => /^drowned-church: 0 of 1 placed: nowhere has a lake/.test(line)), r.skipped.join("; "));
  assert.ok(r.skipped.some((line) => /^cove-hotel: 0 of 1 placed: nowhere has a cove that opens south/.test(line)), r.skipped.join("; "));
  // Land that is all built on hosts nothing.
  const full = placeWonders({ ...l, busy: new Uint8Array(l.busy.length).fill(1) }, []);
  assert.equal(full.wonders.length, 0);
  assert.equal(full.skipped.length, WONDER_ORDER.length);
  // Only the types asked for are sited or reported.
  const one = placeWonders(l, [], wonderRules(N), { only: ["railway"] });
  assert.ok(one.wonders.every((w) => w.type === "railway") && one.skipped.every((line) => line.startsWith("railway: ")));
});

test("a world without wonders is built exactly as before: wonders only add to the end of what is built", () => {
  const off = settleWorld(terrain(), { wonders: false }).settlement;
  const none = settleWorld(terrain(), { wonders: [] }).settlement;
  const on = settleWorld(terrain()).settlement;
  assert.deepEqual(off.wonders, []);
  assert.deepEqual(none.built, off.built);
  assert.deepEqual(none.ground, off.ground);
  assert.deepEqual(on.sites, off.sites);
  assert.deepEqual(on.hamlets, off.hamlets);
  assert.deepEqual(on.built.roads, off.built.roads);
  assert.ok(on.built.structures.length > off.built.structures.length);
  assert.deepEqual(on.built.structures.slice(0, off.built.structures.length), off.built.structures);
  assert.deepEqual(on.built.conforms.slice(0, off.built.conforms.length), off.built.conforms);
  // The ground moves only under a wonder's own conforms.
  const gN = paramsFor(N).gN, added = on.built.conforms.slice(off.built.conforms.length);
  for (let i = 0; i < on.ground.length; i++) {
    if (on.ground[i] === off.ground[i]) continue;
    const x = 4 * (i % gN) + 2, y = 4 * Math.floor(i / gN) + 2;
    assert.ok(added.some((c) => Math.abs(torusDelta(c.x, x, N)) <= c.rx + c.skirt + 4 && Math.abs(torusDelta(c.y, y, N)) <= c.ry + c.skirt + 4), `ground moved at ${x}, ${y}`);
  }
});

test("the manifest lists each wonder with its anchors inside the world, and reads back what it wrote", () => {
  const s = settleWorld(terrain()).settlement;
  const list = manifestWonders(s.wonders, N);
  assert.equal(list.length, s.wonders.length);
  for (const w of list) {
    assert.ok(w.x >= 0 && w.x < N && w.y >= 0 && w.y < N);
    for (const [x, y] of Object.values(w.anchors)) assert.ok(x >= 0 && x < N && y >= 0 && y < N, `${w.id}: ${x}, ${y}`);
  }
  assert.deepEqual(wondersOf({ wonders: structuredClone(list) }), list);
  assert.deepEqual(wondersOf({}), []);
});

test("the builders are pure and stay under their stated heights; the track is unbroken", () => {
  const tallest = (s: { top: Float32Array; marks: number[] }): number => {
    let hi = 0;
    for (const t of s.top) if (t > hi) hi = t;
    for (let k = 2; k < s.marks.length; k += 5) if (s.marks[k] > hi) hi = s.marks[k];
    return hi;
  };
  assert.deepEqual(thermalBaths(24, 9), thermalBaths(24, 9));
  assert.deepEqual(drownedChurch(5), drownedChurch(5));
  assert.deepEqual(coveHotel(5, 10, 14), coveHotel(5, 10, 14));
  assert.ok(tallest(thermalBaths(35, 1)) <= 35 + 22);
  assert.ok(tallest(drownedChurch(1)) <= 31);
  assert.ok(tallest(coveHotel(1, 10, 14)) <= 31);
  assert.ok(tallest(tideHalt(true)) <= 13);
  // The baths step down from the cliff top to the quay.
  const lv = bathLevels(20);
  assert.ok(lv.court > lv.pools[0] && lv.pools[0] > lv.pools[1] && lv.pools[1] > lv.pools[2] && lv.pools[2] > lv.quay && lv.quay > 0);
  // The halt's two hands are mirror images.
  const e = tideHalt(true), w = tideHalt(false);
  for (let y = 0; y < e.h; y++) for (let x = 0; x < e.w; x++) assert.equal(w.top[y * e.w + (e.w - 1 - x)], e.top[y * e.w + x]);
  // The track comes in pieces no bake window has to carry whole, with no gap between them.
  const pieces = tideTrack(100, 50, 300, 90, 6);
  assert.ok(pieces.length >= 5);
  const cols = new Set<number>();
  for (const p of pieces) {
    assert.ok(p.w <= 60 && p.h <= 40, `${p.w} × ${p.h}`);
    for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) if (p.top[j * p.w + i] > 0) cols.add(p.x + i);
  }
  for (let x = 101; x < 299; x++) assert.ok(cols.has(x), `gap at ${x}`);
});

test("the second round's builders are pure and stay under their stated heights", () => {
  const tallest = (s: { top: Float32Array; marks: number[] }): number => {
    let hi = 0;
    for (const t of s.top) if (t > hi) hi = t;
    for (let k = 2; k < s.marks.length; k += 5) if (s.marks[k] > hi) hi = s.marks[k];
    return hi;
  };
  assert.deepEqual(marshHouse(5, 1, 0.4), marshHouse(5, 1, 0.4));
  assert.deepEqual(airshipMast(5), airshipMast(5));
  assert.deepEqual(bridgeTown(44, 5, 7, 5), bridgeTown(44, 5, 7, 5));
  assert.deepEqual(greatOak(5), greatOak(5));
  assert.deepEqual(observatory(5), observatory(5));
  for (let seed = 1; seed <= 12; seed++) {
    assert.ok(tallest(marshHouse(seed, seed - 6, 3)) <= 19);
    assert.ok(tallest(airshipMast(seed)) <= MAST_TALL);
    assert.ok(tallest(greatOak(seed)) <= OAK_TALL);
    assert.ok(tallest(observatory(seed)) <= OBS_TALL);
    for (const len of [40, 46, 52]) assert.ok(tallest(bridgeTown(len, 4, 6.5 + seed / 4, seed)) <= 6.5 + seed / 4 + BRIDGE_TALL, `bridge ${len}, ${seed}`);
  }
  // The garden wall opens where the causeway leaves, whichever way that is.
  for (const [ux, uy] of [[1, 0], [1, 1], [0, 1], [-1, 0.3]]) {
    const s = marshHouse(3, ux, uy), l = Math.sqrt(ux * ux + uy * uy);
    const wall = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < s.w && y < s.h && s.top[y * s.w + x] > 0 && s.top[y * s.w + x] < 2;
    const ex = ux / l / 15, ey = uy / l / 10, el = Math.sqrt(ex * ex + ey * ey);
    assert.ok(!wall(Math.floor(16.5 + (15 * ex) / el), Math.floor(11.5 + (10 * ey) / el)), `wall across the gate at ${ux}, ${uy}`);
  }
  // The causeway comes in pieces with no gap between them.
  const cols = new Set<number>();
  for (const p of marshCauseway(40, 20, 160, 44, 4)) for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) if (p.top[j * p.w + i] > 0) cols.add(p.x + i);
  for (let x = 41; x < 159; x++) assert.ok(cols.has(x), `gap at ${x}`);
});
