import assert from "node:assert/strict";
import { test } from "node:test";
import { MATERIAL as M } from "../look/materials.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { differing, frameOf, land, manifest, seaFrame, shot } from "../testing/liveShot.ts";
import type { ManifestWonder } from "../pack/manifest.ts";
import type { LiveFrame } from "./live.ts";
import {
  CLOCK_LASTS,
  clockWindow,
  gardenWhere,
  MOMENT_KINDS,
  momentSpan,
  momentWindow,
  momentsLayer,
  PLACE_LABEL,
  widestSands,
  WORLD_HOUR,
  type MomentSeen,
} from "./moments.ts";
import { makeLayers } from "./registry.ts";

const palette = buildPalette(MIDDAY);
const seed = manifest.seed;
const n = manifest.n;
const X = 3200;
const Y = 2100;

function seaAt(x: number, y: number, t: number, material: number = M.sea): LiveFrame {
  const rx = Math.round(x) - 200;
  const ry = Math.round(0.8 * y) - 112;
  return seaFrame(rx, ry, t, palette, n, material);
}

function wonder(type: string, x: number, y: number, level: number, height: number, anchors: Record<string, [number, number]>): ManifestWonder {
  return { id: `${type}-0`, type, x, y, level, height, anchors };
}

const baths = (x = X, y = Y): ManifestWonder => wonder("baths", x, y, 24, 22, {
  quay: [x, y + 35], funicularTop: [x + 20, y + 6], funicularFoot: [x + 20, y + 30],
});

test("each moment keeps its own seeded clock, once every three to eight minutes for twenty to sixty seconds", () => {
  for (const kind of MOMENT_KINDS) {
    for (const s of [1, seed, 99]) {
      const span = momentSpan(s, kind);
      assert.ok(span.every >= 180 && span.every <= 480, `${kind} every ${span.every}`);
      assert.ok(span.lasts >= 20 && span.lasts <= 60, `${kind} lasts ${span.lasts}`);
      assert.ok(span.lead >= 2 && span.lead < span.lasts, `${kind} lead ${span.lead}`);
    }
    const span = momentSpan(seed, kind);
    let t = 0;
    while (t < span.every && momentWindow(seed, kind, t, false) >= 0) t++;
    let runs = 0;
    const horizon = t + span.every * 3;
    while (t < horizon) {
      if (momentWindow(seed, kind, t, false) < 0) { t++; continue; }
      runs++;
      const began = t;
      while (t < horizon + span.lasts && momentWindow(seed, kind, t, false) >= 0) t++;
      assert.ok(Math.abs(t - began - span.lasts) <= 1, `${kind} ran ${t - began}s, lasts ${span.lasts}`);
    }
    assert.ok(runs >= 2 && runs <= 4, `${kind} appears ${runs} times`);
  }
  let differ = 0;
  for (let t = 0; t < 900; t += 5) if ((momentWindow(1, "train", t) >= 0) !== (momentWindow(2, "train", t) >= 0)) differ++;
  assert.ok(differ > 0, "another seed keeps different hours");
  assert.equal(momentWindow(seed, "train", 12.5), momentWindow(seed, "train", 12.5));
});

test("the town clock strikes on the world hour, and a preview forces every moment on", () => {
  assert.equal(WORLD_HOUR, 240);
  assert.ok(CLOCK_LASTS >= 20 && CLOCK_LASTS <= 60);
  assert.ok(clockWindow(3) >= 0 && clockWindow(3) < CLOCK_LASTS);
  assert.equal(clockWindow(WORLD_HOUR / 2), -1);
  assert.ok(clockWindow(WORLD_HOUR + 2) >= 0);
  for (const kind of MOMENT_KINDS) assert.ok(momentWindow(seed, kind, 0, true) >= 0, kind);
  assert.ok(clockWindow(0, true) >= 0);
  assert.equal(momentWindow(seed, "ferry", -5), -1);
});

test("the moments layer sits with the other live layers", () => {
  const names = makeLayers({ seed, n, sites: manifest.sites }).map((l) => l.name);
  assert.ok(names.indexOf("sights") < names.indexOf("moments"));
  assert.ok(names.indexOf("moments") < names.indexOf("rare"));
});

/** A time when the ferry is quiet for the next few seconds, so the place can be logged on its own. */
function ferryQuiet(): number {
  for (let t = 0; t < 4000; t++) {
    let quiet = true;
    for (let d = 0; d <= 6; d++) if (momentWindow(seed, "ferry", t + d) >= 0) quiet = false;
    if (quiet) return t;
  }
  return 0;
}

test("a wonder on screen for about a second is logged once, with its caption", () => {
  const t0 = ferryQuiet();
  const told: string[] = [];
  const layer = momentsLayer({
    seed, n, sites: [], wonders: [baths()],
    discover: (id, label) => told.push(`${id}|${label}`),
  });
  const f = seaAt(X, Y, t0);
  layer.draw(f);
  f.t = t0 + 0.6;
  layer.draw(f);
  assert.deepEqual(told, []);
  f.t = t0 + 1.7;
  layer.draw(f);
  assert.deepEqual(told, [`baths-0|${PLACE_LABEL.baths}`]);
  f.t = t0 + 4;
  layer.draw(f);
  assert.equal(told.length, 1);
  // Looking away starts the second again.
  const again: string[] = [];
  const away = momentsLayer({ seed, n, sites: [], wonders: [baths()], discover: (id) => again.push(id) });
  const g = seaAt(X, Y, t0);
  away.draw(g);
  g.t = t0 + 0.5;
  away.draw(g);
  g.rect = { ...g.rect, x: g.rect.x + 4000 };
  g.t = t0 + 0.9;
  away.draw(g);
  g.rect = { ...g.rect, x: g.rect.x - 4000 };
  g.t = t0 + 1.3;
  away.draw(g);
  assert.deepEqual(again, [], "a gap resets the wait");
  g.t = t0 + 2.5;
  away.draw(g);
  assert.deepEqual(again, ["baths-0"]);
});

test("a moment is logged when it is witnessed, and only while its wonder is in view", () => {
  const told: string[] = [];
  let open = 0;
  for (let t = 0; t < 2000; t++) if (momentWindow(seed, "ferry", t) >= 4) { open = t; break; }
  const layer = momentsLayer({
    seed, n, sites: [], wonders: [baths()],
    discover: (id, label) => told.push(`${id}|${label}`),
  });
  layer.log = [];
  const f = seaAt(X, Y, open);
  const before = f.out.slice();
  layer.draw(f);
  assert.ok(layer.log.some((p) => p.kind === "ferry"), "the ferry is there");
  assert.ok(differing(f.out, before) > 0);
  assert.ok(told.includes("moment:baths-0|A ferry at the quay"));
  // The same appearance is not logged again; the place still waits out its second.
  told.length = 0;
  f.t = open + 0.2;
  layer.draw(f);
  assert.deepEqual(told, []);
  // Off screen, the moment draws nothing.
  const far = momentsLayer({ seed, n, sites: [], wonders: [baths(X + 2500, Y)], forceSights: true });
  far.log = [];
  const g = seaAt(X, Y, 0);
  far.draw(g);
  assert.ok(!far.log.some((p) => p.kind === "ferry" || p.kind === "steam"));
});

test("steam rises whenever the baths are in view, and the ferry only on its clock", () => {
  let closed = 0;
  for (let t = 0; t < 2000; t++) if (momentWindow(seed, "ferry", t) < 0) { closed = t; break; }
  const layer = momentsLayer({ seed, n, sites: [], wonders: [baths()] });
  layer.log = [];
  const f = seaAt(X, Y, closed);
  const before = f.out.slice();
  layer.draw(f);
  assert.ok(layer.log.some((p) => p.kind === "steam"));
  assert.ok(!layer.log.some((p) => p.kind === "ferry"));
  assert.ok(differing(f.out, before) > 8, "steam shows");
});

test("each wonder's moment draws when the wonder is in view", () => {
  const cases: { type: string; level: number; height: number; anchors: (x: number, y: number) => Record<string, [number, number]>; kinds: string[] }[] = [
    { type: "baths", level: 24, height: 22, anchors: (x, y) => ({ quay: [x, y + 35], funicularTop: [x + 20, y + 6], funicularFoot: [x + 20, y + 30] }), kinds: ["steam", "ferry"] },
    { type: "railway", level: 0, height: 13, anchors: (x, y) => ({ shore: [x - 90, y], halt: [x + 70, y + 3] }), kinds: ["train"] },
    { type: "drowned-church", level: 4, height: 31, anchors: (x, y) => ({ tower: [x, y] }), kinds: ["ripples", "flock"] },
    { type: "cove-hotel", level: 0, height: 31, anchors: (x, y) => ({ pontoon: [x, y + 16], cove: [x, y - 30] }), kinds: ["plane"] },
    { type: "marsh-house", level: 3.6, height: 19, anchors: (x, y) => ({ lamp: [x - 2, y + 2], gate: [x, y + 8], firm: [x + 36, y + 28] }), kinds: ["lamp", "cart"] },
    { type: "airship-mast", level: 18, height: 46, anchors: (x, y) => ({ mast: [x, y] }), kinds: ["airship"] },
    { type: "bridge-town", level: 1, height: 25, anchors: (x, y) => ({ west: [x - 22, y], east: [x + 22, y], upstream: [x, y - 28], downstream: [x, y + 28] }), kinds: ["cart", "boat"] },
    { type: "great-oak", level: 12, height: 47, anchors: (x, y) => ({ crown: [x, y], swing: [x + 11, y], treehouse: [x - 11, y], village: [x, y + 40] }), kinds: ["leaves"] },
    { type: "observatory", level: 40, height: 24, anchors: (x, y) => ({ dome: [x, y] }), kinds: ["dome"] },
  ];
  for (const c of cases) {
    const w = wonder(c.type, X, Y, c.level, c.height, c.anchors(X, Y));
    const layer = momentsLayer({ seed, n, sites: [], wonders: [w], forceSights: true });
    layer.log = [];
    const f = seaAt(X, Y, 0);
    const before = f.out.slice();
    layer.draw(f);
    for (const kind of c.kinds) assert.ok(layer.log.some((p) => p.kind === kind), `${c.type} draws ${kind}`);
    assert.ok(differing(f.out, before) > 0, `${c.type} changes the frame`);
  }
});

test("figures file out of the town clock on the hour and are still between hours", () => {
  const paint = (f: LiveFrame): void => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = (112 + dy) * 400 + (200 + dx);
      f.bake[i] = (f.bake[i] & ~255) | M.dial;
    }
  };
  const told: string[] = [];
  const layer = momentsLayer({
    seed, n, sites: [{ id: "town-0", type: "town", x: X, y: Y }],
    discover: (id, label) => told.push(`${id}|${label}`),
  });
  const f = seaAt(X, Y, 4);
  paint(f);
  layer.log = [];
  const before = f.out.slice();
  layer.draw(f);
  assert.ok(layer.log.some((p) => p.kind === "figures"));
  assert.ok(told.includes("moment:clock|Figures on the hour"));
  let changed = 0;
  for (let i = 0; i < f.out.length; i++) if (f.out[i] !== before[i]) changed++;
  assert.ok(changed >= 8, `the figures are drawn, ${changed} pixels`);
  const g = seaAt(X, Y, WORLD_HOUR / 2);
  paint(g);
  layer.log = [];
  layer.draw(g);
  assert.ok(!layer.log.some((p) => p.kind === "figures"));
  const forced = momentsLayer({ seed, n, sites: [{ id: "town-0", type: "town", x: X, y: Y }], forceSights: true });
  const h = seaAt(X, Y, WORLD_HOUR / 2);
  paint(h);
  forced.log = [];
  forced.draw(h);
  assert.ok(forced.log.some((p) => p.kind === "figures"), "a preview forces the hour");
});

test("the floating garden shows over open sea, with a shadow, and not over land", () => {
  const where = gardenWhere(seed, n, land, 30);
  assert.ok(where, "the garden has a drift");
  const cell = n / land.gN;
  const gx = Math.floor(((where.x % n) + n) % n / cell);
  const gy = Math.floor(((where.y % n) + n) % n / cell);
  assert.ok(land.ground[gy * land.gN + gx] < -1, `drift over height ${land.ground[gy * land.gN + gx]}`);

  const told: string[] = [];
  const layer = momentsLayer({ seed, n, sites: [], land, forceSights: true, discover: (id, label) => told.push(`${id}|${label}`) });
  layer.log = [];
  const sea = seaAt(4000, 2500, 0);
  const before = sea.out.slice();
  layer.draw(sea);
  assert.ok(layer.log.some((p) => p.kind === "garden"));
  let darker = 0;
  const seaPx = before[0];
  for (let i = 0; i < sea.out.length; i++) if (sea.out[i] !== seaPx && sea.out[i] !== before[i]) darker++;
  assert.ok(darker > 20, `garden and shadow: ${darker} pixels`);
  // A second of watching logs it once.
  sea.t = 1.2;
  layer.draw(sea);
  assert.ok(told.includes("floating-garden|The floating garden"));

  const meadow = momentsLayer({ seed, n, sites: [], land, forceSights: true });
  meadow.log = [];
  const field = seaAt(4000, 2500, 0, M.meadowMid);
  meadow.draw(field);
  assert.ok(!meadow.log.some((p) => p.kind === "garden"));
});

test("the land-ship runs the widest sands, and only on sand", () => {
  const gN = 128;
  const worldN = 512;
  const ground = new Float32Array(gN * gN).fill(9);
  for (let y = 30; y < gN; y++) for (let x = 0; x < gN; x++) ground[y * gN + x] = -4;
  for (let x = 0; x < 6; x++) ground[29 * gN + x] = 0.3;
  for (let y = 22; y <= 29; y++) for (let x = 16; x < 40; x++) ground[y * gN + x] = 0.45;
  const run = widestSands({ gN, ground }, worldN);
  assert.ok(run.length >= 6, `run ${run.length / 2}`);
  const cell = worldN / gN;
  for (let i = 0; i < run.length; i += 2) {
    const gx = Math.floor(run[i] / cell);
    assert.ok(gx >= 14 && gx < 42, `sand x ${gx}`);
  }
  const mid = run.length >> 2 << 1;
  const sx = run[mid];
  const sy = run[mid + 1];
  let open = 0;
  for (let t = 0; t < 2000; t++) if (momentWindow(seed, "land-ship", t) >= 2) { open = t; break; }
  const layer = momentsLayer({ seed, n: worldN, sites: [], land: { gN, ground } });
  layer.log = [];
  const rx = Math.round(sx) - 200;
  const ry = Math.round(0.8 * sy) - 112;
  const sand = seaFrame(rx, ry, open, palette, worldN, M.sand);
  layer.draw(sand);
  assert.ok(layer.log.some((p: MomentSeen) => p.kind === "land-ship"), "on the sand");
  const grass = momentsLayer({ seed, n: worldN, sites: [], land: { gN, ground }, forceSights: true });
  grass.log = [];
  const field = seaFrame(rx, ry, 0, palette, worldN, M.meadowMid);
  grass.draw(field);
  assert.ok(!grass.log.some((p) => p.kind === "land-ship"));
});

test("the same time draws the same frame", () => {
  const wonders = [baths()];
  const a = momentsLayer({ seed, n, sites: [], wonders, forceSights: true });
  const b = momentsLayer({ seed, n, sites: [], wonders, forceSights: true });
  const first = seaAt(X, Y, 3);
  a.draw(first);
  a.draw(seaAt(X, Y, 40));
  a.draw(seaAt(X, Y, 1));
  const again = seaAt(X, Y, 3);
  a.draw(again);
  const other = seaAt(X, Y, 3);
  b.draw(other);
  assert.deepEqual(again.out, first.out);
  assert.deepEqual(other.out, first.out);
});

test("moments stay inside half a millisecond a frame", async () => {
  const s = await shot("sea");
  const x = s.rect.x + 200;
  const y = (s.rect.y + 112) / 0.8;
  const wonders = [
    baths(x, y),
    wonder("drowned-church", x + 24, y + 8, 4, 31, { tower: [x + 24, y + 8] }),
    wonder("great-oak", x - 16, y - 10, 12, 47, { crown: [x - 16, y - 10] }),
  ];
  const p95 = (force: boolean, t0: number): number => {
    const layer = momentsLayer({ seed, n, sites: manifest.sites, land, wonders, forceSights: force });
    const f = frameOf(s, t0);
    const ms: number[] = [];
    for (let i = 0; i < 160; i++) {
      f.t = t0 + i * 0.05;
      f.out.set(s.out);
      const t = performance.now();
      layer.draw(f);
      ms.push(performance.now() - t);
    }
    const warm = ms.slice(30).sort((a, b) => a - b);
    return warm[Math.floor(warm.length * 0.95)];
  };
  let quiet = 10;
  for (let t = 0; t < 4000; t++) {
    if (momentWindow(seed, "ferry", t) < 0 && momentWindow(seed, "church", t) < 0 && momentWindow(seed, "oak", t) < 0 && clockWindow(t) < 0) {
      quiet = t;
      break;
    }
  }
  const forced = p95(true, 0);
  const rest = p95(false, quiet);
  console.log(`moments, sea view: forced p95 ${forced.toFixed(3)} ms; at rest p95 ${rest.toFixed(3)} ms`);
  assert.ok(forced < 0.5, `forced p95 ${forced.toFixed(3)} ms`);
  assert.ok(rest < 0.5, `at rest p95 ${rest.toFixed(3)} ms`);
});
