import assert from "node:assert/strict";
import { test } from "node:test";
import { rngFor } from "../core/rng.ts";
import { NB8_DX, NB8_DY, torusDelta, wrapIndex } from "../core/torus.ts";
import { seamRatio } from "../testing/seam.ts";
import { sha256Hex } from "../testing/sha.ts";
import { coast, coastContext, type CoastResult, SHORE, shoreExposure } from "./coast.ts";
import { drown } from "./drown.ts";
import { runSchedule } from "./erode.ts";
import { glacial, glacialContext } from "./glacial.ts";
import { paramsFor, type WorldParams } from "./params.ts";
import { planWorld } from "./plan.ts";
import { applyStamps, applyStampsTo, inCove, type Stamp } from "./stamps.ts";

/** Full-size lengths (as on the 6400 world) on a small grid of 4-cell nodes. */
function fullScale(nodes: number): WorldParams {
  return { ...paramsFor(6400), n: nodes * 4, gN: nodes, cN: nodes / 2 };
}
const RANGE: readonly [number, number] = [0.1, 0.6];

function isShore(isSea: Uint8Array, n: number, i: number): boolean {
  if (isSea[i]) return false;
  const x = i % n, y = (i - x) / n;
  for (let k = 0; k < 8; k++) if (isSea[wrapIndex(x + NB8_DX[k], y + NB8_DY[k], n)]) return true;
  return false;
}

/** True when node i lies inside a stack stamp. */
function inStack(stamps: readonly Stamp[], i: number, n: number, cpn: number): boolean {
  const x = ((i % n) + 0.5) * cpn, y = (Math.floor(i / n) + 0.5) * cpn;
  for (const s of stamps) {
    if (s.kind !== "stack") continue;
    const dx = torusDelta(s.x, x, n * cpn), dy = torusDelta(s.y, y, n * cpn);
    if (dx * dx + dy * dy < (s.r * 1.5 + s.apron) * (s.r * 1.5 + s.apron)) return true;
  }
  return false;
}

/** True when node i lies in or beside a cove. */
function nearCove(stamps: readonly Stamp[], i: number, n: number, cpn: number): boolean {
  const x = ((i % n) + 0.5) * cpn, y = (Math.floor(i / n) + 0.5) * cpn;
  for (const s of stamps) if (s.kind === "cove" && inCove(s, x, y, n * cpn, 3)) return true;
  return false;
}

// ── Exposure ────────────────────────────────────────────────────────────────

test("exposure is 0 all round a closed lagoon and positive on the island's outer shore", () => {
  const n = 96, isSea = new Uint8Array(n * n).fill(1);
  for (let y = 30; y < 66; y++) for (let x = 30; x < 66; x++) if (!(x >= 44 && x < 52 && y >= 44 && y < 52)) isSea[y * n + x] = 0;
  const s = shoreExposure(isSea, n, 4, 160, 2, RANGE);
  let lagoon = 0, outer = 0;
  for (const i of s.nodes) {
    const x = i % n, y = (i - x) / n;
    if (x >= 43 && x <= 52 && y >= 43 && y <= 52) { lagoon++; assert.equal(s.e[i], 0, `lagoon shore (${x}, ${y})`); }
    else { outer++; assert.ok(s.e[i] > 0.2, `outer shore (${x}, ${y}) ${s.e[i]}`); }
  }
  assert.equal(lagoon, 36);
  assert.ok(outer > 100);
});

test("exposure is 1 on an islet in open water", () => {
  const n = 96, isSea = new Uint8Array(n * n).fill(1);
  isSea[48 * n + 48] = 0;
  const s = shoreExposure(isSea, n, 4, 160, 2, RANGE);
  assert.deepEqual([...s.nodes], [48 * n + 48]);
  assert.equal(s.e[48 * n + 48], 1);
  // With no stretch it is still exactly the full fetch on every ray.
  assert.equal(shoreExposure(isSea, n, 4, 160, 2, [0, 1]).e[48 * n + 48], 1);
});

test("a coastline mirrored in x has mirrored exposure when no quadrant is favoured", () => {
  // Nine discs of land scattered without symmetry.
  const n = 128, sea = new Uint8Array(n * n).fill(1), m = new Uint8Array(n * n), rng = rngFor(3, "mirror");
  for (let k = 0; k < 9; k++) {
    const cx = rng.int(n), cy = rng.int(n), r = 4 + rng.int(10);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) sea[wrapIndex(cx + dx, cy + dy, n)] = 0;
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) m[y * n + (n - 1 - x)] = sea[y * n + x];
  const a = shoreExposure(sea, n, 4, 160, 1, RANGE), b = shoreExposure(m, n, 4, 160, 1, RANGE);
  assert.equal(a.nodes.length, b.nodes.length);
  assert.ok(a.nodes.length > 200);
  let varied = 0;
  for (const i of a.nodes) {
    const x = i % n, y = (i - x) / n;
    assert.ok(Math.abs(a.e[i] - b.e[y * n + (n - 1 - x)]) < 1e-6, `(${x}, ${y}) ${a.e[i]} vs ${b.e[y * n + (n - 1 - x)]}`);
    if (a.e[i] > 0.05 && a.e[i] < 0.95) varied++;
  }
  assert.ok(varied > 50, "the fixture exercises the middle of the range");
});

test("the south-west quadrant counts double: south and west shores are more exposed than north and east", () => {
  const n = 256, isSea = new Uint8Array(n * n).fill(1);
  for (let y = 100; y < 140; y++) for (let x = 80; x < 180; x++) isSea[y * n + x] = 0;
  const raw = shoreExposure(isSea, n, 4, 192, 2, [0, 1]).e;
  const at = (x: number, y: number) => raw[y * n + x];
  // A straight shore sees seven of sixteen rays: 11/21 of the weight facing south or west, 7/21 north or east.
  assert.ok(Math.abs(at(130, 139) - 11 / 21) < 0.02);
  assert.ok(Math.abs(at(80, 120) - 11 / 21) < 0.02);
  assert.ok(Math.abs(at(130, 100) - 7 / 21) < 0.02);
  assert.ok(Math.abs(at(179, 120) - 7 / 21) < 0.02);
  assert.ok(at(80, 139) > at(130, 139), "the south-west corner is the most exposed");
  for (let i = 0; i < raw.length; i++) assert.ok(raw[i] >= 0 && raw[i] <= 1);
});

// ── Cliffs, the gate, stacks ────────────────────────────────────────────────

/** A square pyramid of hard rock: 1.5 units a cell on every side, so its shores face exactly N, E, S and W. */
const PYR = { n: 256, cx: 128, cy: 128, r: 44, rise: 6 };
function pyramid(ox = 0, oy = 0): Float64Array {
  const { n, cx, cy, r, rise } = PYR, h = new Float64Array(n * n).fill(-5);
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
    h[wrapIndex(x + ox, y + oy, n)] = rise * (r - d) + rise / 2;
  }
  return h;
}
let pyr: CoastResult | null = null;
const pp = fullScale(PYR.n);
const pyrRun = () => (pyr ??= coast(pyramid(), PYR.n, { rock: new Uint8Array(PYR.n * PYR.n), regions: null }, pp, 7));

test("south shores keep full cliffs, capped at 45", () => {
  const r = pyrRun(), { n, cx, cy } = PYR, c = pp.coast, tol = c.capSlope[1] * 1.5 * 4;
  let cliffs = 0, tallest = 0;
  for (let x = cx - 20; x <= cx + 20; x++) {
    for (let y = cy; y < cy + PYR.r + 2; y++) {
      const i = y * n + x;
      if (!isShore(r.isSea, n, i) || inStack(r.stamps, i, n, 4)) continue;
      assert.equal(r.shoreClass[i], SHORE.cliff);
      assert.ok(r.h[i] <= c.cliffCap + tol, `cliff of ${r.h[i]}`);
      tallest = Math.max(tallest, r.h[i]);
      cliffs++;
    }
  }
  assert.ok(cliffs >= 30);
  assert.ok(tallest > c.gateCap + tol, "a south cliff stands well above the gate's cap");
  // The shore retreated: the old shoreline is now platform.
  assert.ok(r.h[(cy + PYR.r) * n + cx] < 0);
});

test("no cliff stands over 12 on a shore facing east or west", () => {
  const r = pyrRun(), { n, cx, cy } = PYR, c = pp.coast, tol = c.capSlope[1] * 1.5 * 4;
  let west = 0, east = 0;
  for (let y = cy - 20; y <= cy + 20; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (!isShore(r.isSea, n, i) || inStack(r.stamps, i, n, 4)) continue;
      assert.ok(r.h[i] <= c.gateCap + tol, `${r.h[i]} at (${x}, ${y})`);
      assert.notEqual(r.shoreClass[i], SHORE.cliff);
      if (x < cx) west++; else east++;
    }
  }
  assert.ok(west >= 30 && east >= 30);
  // The west shore is exposed and was cut back; uncapped, the land behind it would stand far above 12.
  assert.ok(r.h[cy * n + (cx - PYR.r)] < 0, "the west shore retreated");
  assert.ok(r.base[cy * n + (cx - PYR.r + 6)] > 30);
  // Behind the cap the land climbs no faster than capSlope: no second wall.
  for (let x = cx - PYR.r; x < cx - 4; x++) {
    const a = r.h[cy * n + x], b = r.h[cy * n + x + 1];
    if (a > 0 && b > 0 && b < r.base[cy * n + x + 1]) assert.ok(b - a <= c.capSlope[1] * 4 + 1e-9);
  }
});

test("caps change gradually along the shore: no two neighbouring cuts differ by more than a few units", () => {
  // A round island of hard rock: its shore turns through every facing, from full cliffs in the south to the gate's cap.
  const n = 256, h = new Float64Array(n * n).fill(-5);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = 60 - Math.hypot(x - 128, y - 128);
    if (d > 0) h[y * n + x] = 6 * d;
  }
  const r = coast(h, n, { rock: new Uint8Array(n * n), regions: null }, pp, 7), c = pp.coast;
  const cuts = r.stamps.filter((s) => s.kind === "cut");
  let low = Infinity, high = 0, between = 0;
  for (const a of cuts) {
    if (a.kind !== "cut") continue;
    low = Math.min(low, a.cap);
    high = Math.max(high, a.cap);
    if (a.cap > c.gateCap + 3 && a.cap < c.cliffCap - 3) between++;
    assert.ok(a.slope >= c.capSlope[0] && a.slope <= c.capSlope[1]);
    for (const b of cuts) {
      if (b.kind !== "cut" || Math.hypot(a.x - b.x, a.y - b.y) > 6) continue;
      assert.ok(Math.abs(a.cap - b.cap) <= 7, `caps ${a.cap} and ${b.cap} side by side`);
      assert.ok(Math.abs(a.slope - b.slope) <= 0.06, `slopes ${a.slope} and ${b.slope} side by side`);
    }
  }
  assert.ok(low < c.gateCap + 1e-9 && high > c.cliffCap - 3, `caps run ${low}–${high}`);
  assert.ok(between >= 10, "the caps step from one to the other with nothing between");
});

test("stacks are 8–120 cells in area and within the height range", () => {
  const r = pyrRun(), c = pp.coast;
  const stacks = r.stamps.filter((s) => s.kind === "stack");
  assert.ok(stacks.length >= 2, `${stacks.length} stacks`);
  for (const s of stacks) {
    if (s.kind !== "stack") continue;
    const area = Math.PI * s.r * s.r;
    assert.ok(area >= c.stackArea[0] - 1e-9 && area <= c.stackArea[1] + 1e-9, `stack of ${area} cells`);
    assert.ok(s.top >= c.stackTop[0] && s.top <= c.stackTop[1]);
  }
});

test("the returned heights are the base with the stamps applied, and stamping again changes nothing", () => {
  const r = pyrRun(), again = new Float64Array(r.base);
  applyStamps(again, PYR.n, 4, r.stamps);
  assert.deepEqual(again, r.h);
  applyStamps(again, PYR.n, 4, r.stamps);
  assert.deepEqual(again, r.h);
  for (let i = 0; i < r.h.length; i++) assert.equal(r.isSea[i], r.h[i] <= 0 ? 1 : 0);
});

test("an island straddling the wrap gets the same coast as one in the middle", () => {
  // The slope behind a cap follows a noise fixed to the world; here it is held to one value, so the land can be compared to the node.
  const n = PYR.n, one: WorldParams = { ...pp, coast: { ...pp.coast, capSlope: [0.6, 0.6] } };
  const mid = coast(pyramid(), n, { rock: new Uint8Array(n * n), regions: null }, one, 7);
  const moved = coast(pyramid(128, 128), n, { rock: new Uint8Array(n * n), regions: null }, one, 7);
  let land = 0, same = 0, shoreNodes = 0, sameClass = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, j = wrapIndex(x + 128, y + 128, n);
    const a = mid.h[i], b = moved.h[j];
    if (a > 0 || b > 0) { land++; if (Math.abs(a - b) < 1e-9) same++; }
    if (mid.shoreClass[i] !== SHORE.none || moved.shoreClass[j] !== SHORE.none) { shoreNodes++; if (mid.shoreClass[i] === moved.shoreClass[j]) sameClass++; }
    // Stacks follow a noise fixed to the world; coves and the corners' stacks draw their shapes
    // in node order. Everything else is the same to the node.
    const corner = Math.abs(x - PYR.cx) >= 30 && Math.abs(y - PYR.cy) >= 30;
    const drawn = inStack(mid.stamps, i, n, 4) || inStack(moved.stamps, j, n, 4) || nearCove(mid.stamps, i, n, 4) || nearCove(moved.stamps, j, n, 4);
    if (!corner && !drawn) {
      // The sea bed's shelf follows a noise fixed to the world, so only the land is compared to the node.
      if (a > 0 || b > 0) assert.ok(Math.abs(a - b) < 1e-9, `(${x}, ${y}) ${a} vs ${b}`);
      assert.equal(mid.shoreClass[i], moved.shoreClass[j]);
    }
  }
  assert.ok(same >= 0.98 * land, `${land - same} of ${land} land nodes differ`);
  assert.ok(sameClass >= 0.8 * shoreNodes, `${shoreNodes - sameClass} of ${shoreNodes} shore nodes differ`);
  assert.ok(seamRatio(moved.h, n) <= 1);
  assert.ok(seamRatio(moved.exposure, n) <= 1);
});

// ── Beaches, dunes, saltmarsh ───────────────────────────────────────────────

/** Fixture rules: the shore is left as drawn, and sand does not wait on the sea's supply. */
function fixed(nodes: number, coastOver: Partial<WorldParams["coast"]> = {}): WorldParams {
  const q = fullScale(nodes), c = q.coast;
  return { ...q, coast: { ...c, even: { ...c.even, rock: [0, 0, 0] }, sandScore: { ...c.sandScore, supply: 0 }, ...coastOver } };
}
/** Sand wherever a shore may hold it, at full width. */
const SANDY = { bay: 0, shelter: 0, supply: 0, fed: 0, rock: [1, 1, 1], region: 0, mud: 0 } as const;

/** Land everywhere but an 80-cell strait that rings the world: both its shores are sheltered. Rising at `slope` a cell. */
function strait(n: number, slope: number): Float64Array {
  const h = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = y < 54 ? 53 - y : y >= 74 ? y - 74 : -1;
    h[y * n + x] = d < 0 ? -1 : slope * 4 * (d + 0.5);
  }
  return h;
}

test("a sheltered, gentle shore becomes a beach with a shelf no steeper than 0.04", () => {
  const n = 128, p = fixed(n, { sandScore: SANDY }), c = p.coast, h = strait(n, 0.1);
  const r = coast(h, n, { rock: new Uint8Array(n * n).fill(2), regions: null }, p, 3);
  assert.equal(r.stamps.filter((s) => s.kind === "cut" || s.kind === "stack").length, 0);
  const beaches = r.stamps.filter((s) => s.kind === "beach");
  assert.equal(beaches.length, 2 * n);
  let shelf = Infinity;
  for (const s of beaches) {
    if (s.kind !== "beach") continue;
    assert.ok(Math.abs(s.land - c.beachWidth[1]) < 1e-9, "a straight beach is as wide all along");
    assert.ok(Math.abs(s.base + s.rise * s.land - c.beachTop) < 1e-9, "the sand's back stands at beachTop");
    // The stamp sits on the waterline, half a node from the shore nodes' centres.
    assert.ok(Math.abs(s.y - 54 * 4) < 1e-4 || Math.abs(s.y - 74 * 4) < 1e-4, `beach at y = ${s.y}`);
    shelf = Math.min(shelf, s.shelf);
  }
  for (let x = 0; x < n; x++) {
    assert.equal(r.shoreClass[53 * n + x], SHORE.beach);
    assert.equal(r.shoreClass[74 * n + x], SHORE.beach);
    assert.ok(r.exposure[53 * n + x] < c.beachE);
    // Land is only lowered, never below the beach's base.
    assert.ok(r.h[53 * n + x] > 0 && r.h[53 * n + x] <= h[53 * n + x]);
    for (let row = 0; row < 10; row++) {
      const d = (row + 0.5) * 4, i = (54 + row) * n + x, j = (73 - row) * n + x;
      for (const k of [i, j]) {
        assert.ok(r.h[k] < 0);
        if (d <= 0.5 * shelf) {
          assert.ok(Math.abs(r.h[k] + c.shelfSlope * d) < 1e-6, `shelf depth ${r.h[k]} at ${d} cells`);
          assert.ok(r.base[k] <= r.h[k] + 1e-9, "the shelf is never below the open bathymetry");
        }
      }
      if (row > 0 && d <= 0.5 * shelf) assert.ok(Math.abs(r.h[i] - r.h[i - n]) <= c.shelfSlope * 4 + 1e-9);
    }
  }
  // The fields the bake samples: the sand's width at the shore, and the distance to the waterline.
  for (let x = 0; x < n; x++) {
    assert.ok(Math.abs(r.sandWidth[74 * n + x] - c.beachWidth[1]) < 1e-6);
    assert.equal(r.shoreDist[74 * n + x], 2);
    assert.equal(r.shoreDist[76 * n + x], 10);
    assert.equal(r.shoreDist[73 * n + x], -2);
    assert.equal(r.shoreDist[20 * n + x], c.shoreReach);
    assert.equal(r.sandWidth[20 * n + x], 0, "no width far from any shore");
  }
});

test("an exposed or a steep shore holds no beach", () => {
  const r = pyrRun();
  assert.equal(r.stamps.filter((s) => s.kind === "beach").length, 0);
  for (let i = 0; i < r.shoreClass.length; i++) assert.notEqual(r.shoreClass[i], SHORE.beach);
});

/** The strait with a round headland (6 nodes) on its south shore at x = 32 and a round bay (8 nodes) cut into it at x = 96. */
const HEAD = { x: 32, r: 6 }, BAY = { x: 96, r: 8 };
function bayAndHeadland(n: number): Float64Array {
  const sea = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let wet = y >= 54 && y < 74;
    if ((x - HEAD.x) * (x - HEAD.x) + (y - 74) * (y - 74) <= HEAD.r * HEAD.r) wet = false;
    if ((x - BAY.x) * (x - BAY.x) + (y - 73.5) * (y - 73.5) <= BAY.r * BAY.r) wet = true;
    sea[y * n + x] = wet ? 1 : 0;
  }
  // Land rises 0.1 a cell from the nearest water.
  const h = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (sea[y * n + x]) { h[y * n + x] = -1; continue; }
    let d = 14;
    for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) if (sea[wrapIndex(x + dx, y + dy, n)]) d = Math.min(d, Math.sqrt(dx * dx + dy * dy));
    h[y * n + x] = 0.1 * 4 * (d - 0.5);
  }
  return h;
}

test("sand is widest at a bay head, tapers along the bay, and a convex headland holds none", () => {
  const n = 128, p = fixed(n), c = p.coast;
  // Medium rock: with no help from the sea's supply a straight shore scores too little for sand.
  const r = coast(bayAndHeadland(n), n, { rock: new Uint8Array(n * n).fill(1), regions: null }, p, 3);
  const beaches = r.stamps.filter((s) => s.kind === "beach");
  const near = (x: number, y: number, reach: number) => beaches.filter((s) => Math.abs(s.x - x * 4) <= reach && Math.abs(s.y - y * 4) <= reach);
  // The headland: no sand on it, no beach class, and the width field is nothing there.
  assert.equal(near(HEAD.x + 0.5, 74 - HEAD.r, 20).length, 0, "a beach stamp on the headland's tip");
  for (let y = 74 - HEAD.r - 1; y <= 74 - HEAD.r + 3; y++) for (let x = HEAD.x - 3; x <= HEAD.x + 3; x++) {
    assert.notEqual(r.shoreClass[y * n + x], SHORE.beach, `beach at (${x}, ${y})`);
    assert.notEqual(r.shoreClass[y * n + x], SHORE.dune);
    assert.ok(r.sandWidth[y * n + x] < 0.5, `sand ${r.sandWidth[y * n + x]} wide on the tip`);
  }
  // The bay head: the widest sand of the whole shore, wider than half the range.
  const head = near(BAY.x + 0.5, 74 + BAY.r, 12);
  assert.ok(head.length >= 3, `${head.length} beach stamps at the bay head`);
  let widest = 0, headWidest = 0;
  for (const s of beaches) if (s.kind === "beach") widest = Math.max(widest, s.land);
  for (const s of head) if (s.kind === "beach") headWidest = Math.max(headWidest, s.land);
  assert.equal(headWidest, widest);
  assert.ok(widest > 0.5 * (c.beachWidth[0] + c.beachWidth[1]), `the widest sand is ${widest}`);
  // It tapers: the bay's mouth corners hold less sand than its head, and the straight north shore none.
  for (const s of near(BAY.x - BAY.r, 75, 8).concat(near(BAY.x + BAY.r + 1, 75, 8))) if (s.kind === "beach") assert.ok(s.land < 0.8 * widest, `${s.land} at the bay's corner`);
  assert.equal(beaches.filter((s) => s.y < 54 * 4 + 1).length, 0, "sand on the straight shore");
  for (const s of beaches) if (s.kind === "beach") assert.ok(s.land >= c.beachWidth[0] && s.land <= c.beachWidth[1]);
  // Every node of sand is classed beach, and only sand is.
  assert.equal(r.shoreClass[(74 + BAY.r) * n + BAY.x], SHORE.beach);
  for (let x = 0; x < n; x++) assert.notEqual(r.shoreClass[53 * n + x], SHORE.beach);
});

test("dunes stand only behind a wide beach that is exposed enough, on low ground", () => {
  const n = 128, rock = new Uint8Array(n * n).fill(2);
  const blown = fixed(n, { sandScore: SANDY, duneE: 0 }), c = blown.coast;
  const r = coast(strait(n, 0.03), n, { rock, regions: null }, blown, 3);
  let dunes = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, d = (y < 54 ? 53 - y : y - 74) * 4 + 2;
    if (r.shoreClass[i] !== SHORE.dune) continue;
    dunes++;
    // Behind the sand and within the band, never on the sand itself.
    assert.ok(d > c.beachWidth[1] && d <= c.beachWidth[1] + c.duneWidth[1] + 1e-9, `dune ${d} cells from the sea`);
    assert.ok(r.duneWidth[(y < 54 ? 53 : 74) * n + x] >= c.duneWidth[0] - 1e-6);
    assert.equal(r.shoreClass[(y < 54 ? y + 1 : y - 1) * n + x] === SHORE.beach || r.shoreClass[(y < 54 ? y + 1 : y - 1) * n + x] === SHORE.dune, true);
  }
  assert.ok(dunes >= 2 * n, `${dunes} dune nodes`);
  // Sand stays sand: the first nodes from the sea are beach.
  for (let x = 0; x < n; x++) assert.equal(r.shoreClass[75 * n + x], SHORE.beach);
  // Too sheltered for the wind, too narrow a beach, or ground too high: no dunes.
  for (const over of [{ duneE: 1 }, { duneE: 0, duneBeach: 2 * c.beachWidth[1] }, { duneE: 0, duneTop: 0 }]) {
    const none = coast(strait(n, 0.03), n, { rock, regions: null }, fixed(n, { sandScore: SANDY, ...over }), 3);
    for (let i = 0; i < n * n; i++) assert.notEqual(none.shoreClass[i], SHORE.dune);
    for (let i = 0; i < n * n; i++) if (over.duneTop === undefined) assert.equal(none.duneWidth[i], 0);
  }
});

/** An open sea across the north (rows 0–59), and to the south a narrow strait (rows 96–99) cut off from it; the land between is nearly flat. */
function lagoon(n: number): Float64Array {
  const h = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = y < 60 ? -1 : y < 96 ? Math.min(y - 60, 95 - y) : y < 100 ? -1 : Math.min(y - 100, n - 1 - y);
    h[y * n + x] = d < 0 ? -1 : 0.02 * 4 * (d + 0.5);
  }
  return h;
}

test("saltmarsh grows on sheltered flats only, as far as the ground stays low, with creeks the cells can see", () => {
  const n = 128, p = fixed(n), c = p.coast, before = lagoon(n);
  const r = coast(before, n, { rock: new Uint8Array(n * n).fill(2), regions: null }, p, 3);
  let marsh = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    if (r.shoreClass[i] !== SHORE.marsh) continue;
    marsh++;
    // Beside the still strait, within reach of it, on ground no higher than marshTop.
    const d = (y < 96 ? 95 - y : y - 100) * 4 + 2;
    assert.ok(y >= 82 && y <= 113 && d <= c.marshReach, `marsh at (${x}, ${y})`);
    assert.ok(r.h[i] > 0 && r.h[i] <= c.marshTop);
    assert.equal(r.exposure[i], 0);
    assert.ok(r.marsh[i] > 0, `marsh field ${r.marsh[i]}`);
  }
  for (let x = 0; x < n; x++) {
    for (const y of [95, 94, 91, 100, 101, 104]) assert.equal(r.shoreClass[y * n + x], SHORE.marsh, `(${x}, ${y})`);
    // The field the bake samples is whole at the water's edge and over the water against it.
    for (const y of [94, 95, 96, 99, 100, 101]) assert.ok(r.marsh[y * n + x] > 0.99, `marsh field ${r.marsh[y * n + x]} at (${x}, ${y})`);
    // The open sea's shores are not marsh, and far inland the field is nothing.
    assert.notEqual(r.shoreClass[60 * n + x], SHORE.marsh);
    assert.notEqual(r.shoreClass[(n - 1) * n + x], SHORE.marsh);
    assert.equal(r.marsh[75 * n + x], 0);
  }
  assert.ok(marsh > 8 * n);
  // Where the ground is too steep to flood, the same still water has no marsh.
  const steep = coast(strait(n, 0.1), n, { rock: new Uint8Array(n * n).fill(2), regions: null }, fixed(n, { marshE: 1 }), 3);
  for (let i = 0; i < n * n; i++) assert.notEqual(steep.shoreClass[i], SHORE.marsh);

  // Creeks: spaced along the marsh's shore, unseen on the generator's grid, water at cell size.
  const creeks = r.stamps.filter((s) => s.kind === "creek");
  assert.ok(creeks.length >= 8, `${creeks.length} creeks`);
  for (let a = 0; a < creeks.length; a++) for (let b = a + 1; b < creeks.length; b++) {
    const dx = torusDelta(creeks[a].x, creeks[b].x, 4 * n), dy = creeks[a].y - creeks[b].y;
    assert.ok(dx * dx + dy * dy >= c.creekSpacing * c.creekSpacing);
  }
  for (let x = 0; x < n; x++) assert.ok(r.h[94 * n + x] > 0 && r.h[101 * n + x] > 0);
  const w = 4 * n, top = 84 * 4, rows = 12 * 4, cells = new Float64Array(w * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) cells[y * w + x] = before[Math.floor((top + y) / 4) * n + Math.floor(x / 4)];
  applyStampsTo(cells, { w, h: rows, cellsPerNode: 1, x0: 0, y0: top, period: 4 * n }, r.stamps);
  let wet = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] <= 0) wet++;
  assert.ok(wet > 20 * creeks.length / 2 && wet < 0.2 * cells.length, `${wet} creek cells`);
});

// ── The mini-world ──────────────────────────────────────────────────────────

const p = paramsFor(1024);
const n = p.gN;
const nn = n * n;
interface World { before: Float64Array; ctx: ReturnType<typeof coastContext>; out: CoastResult }
let memo: World | null = null;
function world(): World {
  if (memo) return memo;
  const plan = planWorld(p, 42);
  const d = drown(runSchedule(plan, p, 42).g, n, p.drown.rise);
  const g = glacial(d.h, n, glacialContext(d.h, n, d.isSea, plan, p), p, 42);
  const ctx = coastContext(plan, n);
  return (memo = { before: g.h, ctx, out: coast(g.h, n, ctx, p, 42) });
}

test("the sea bed never goes below −24 and reaches it in open water", () => {
  const { out } = world();
  let lowest = 0;
  for (let i = 0; i < nn; i++) {
    assert.ok(Number.isFinite(out.h[i]) && Number.isFinite(out.base[i]));
    assert.ok(out.h[i] >= -p.coast.bathy.max);
    lowest = Math.min(lowest, out.h[i]);
  }
  assert.equal(lowest, -p.coast.bathy.max);
});

test("the sea deepens away from land: shallow at the shore, deeper a few nodes out", () => {
  const { out } = world();
  let near = 0, nearCount = 0, far = 0, farCount = 0;
  for (let i = 0; i < nn; i++) {
    if (!out.isSea[i]) continue;
    const x = i % n, y = (i - x) / n;
    let d = 99;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (!out.isSea[wrapIndex(x + dx, y + dy, n)]) d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dy)));
    if (d === 1) { near -= out.h[i]; nearCount++; } else if (d === 3) { far -= out.h[i]; farCount++; }
  }
  assert.ok(near / nearCount < far / farCount);
});

test("rock, cliff and cove sit only on shore nodes, the bands stay near the sea, and every kind of shore turns up", () => {
  const { out } = world();
  const c = p.coast, cpn = p.n / n;
  const seen = [0, 0, 0, 0, 0, 0, 0];
  let shoreNodes = 0, bare = 0;
  for (let i = 0; i < nn; i++) {
    assert.equal(out.isSea[i], out.h[i] <= 0 ? 1 : 0);
    assert.ok(out.exposure[i] >= 0 && out.exposure[i] <= 1);
    const k = out.shoreClass[i];
    assert.ok(k <= SHORE.marsh);
    seen[k]++;
    assert.ok(Math.abs(out.shoreDist[i]) <= c.shoreReach && (out.shoreDist[i] > 0) === (out.isSea[i] === 0));
    assert.ok(out.sandWidth[i] >= 0 && out.sandWidth[i] <= c.beachWidth[1] + 1e-6);
    assert.ok(out.duneWidth[i] >= 0 && out.duneWidth[i] <= c.duneWidth[1] + 1e-6);
    assert.ok(out.marsh[i] >= 0 && out.marsh[i] <= 1 + 1e-6);
    if (isShore(out.isSea, n, i)) { shoreNodes++; if (k === SHORE.none) bare++; }
    if (k === SHORE.none) continue;
    assert.equal(out.isSea[i], 0, "a class at sea");
    // Sand, dunes and marsh are bands with a width; a delta's fan, land that was sea, is sand or marsh all over.
    if (k === SHORE.rocky || k === SHORE.cliff || k === SHORE.cove) assert.ok(isShore(out.isSea, n, i), `class ${k} off the shore at ${i}`);
    else if (world().before[i] > 0) {
      const reach = k === SHORE.beach ? c.beachWidth[1] + 2 * cpn : k === SHORE.dune ? c.beachWidth[1] + c.duneWidth[1] + cpn : c.estuaryLen * 2;
      assert.ok(out.shoreDist[i] <= reach + 2 * cpn, `class ${k} is ${out.shoreDist[i]} cells inland`);
    }
    if (k === SHORE.dune) assert.ok(world().before[i] < c.duneTop);
    if (k === SHORE.marsh) assert.ok(out.h[i] <= Math.max(c.marshTop, c.deltaTop + 0.05) + 1e-9);
  }
  assert.ok(seen[SHORE.beach] > 20, "beaches");
  assert.ok(seen[SHORE.rocky] > 20, "rocky shores");
  assert.ok(seen[SHORE.cliff] > 20, "cliffs");
  // (This world's coves are narrower than a node, so whether one is classed is chance; their stamps are checked below.)
  // Many shores hold no sand at all: a good share of the shore is grass to the water or rock.
  assert.ok(bare > 0.15 * shoreNodes, `${bare} of ${shoreNodes} shore nodes are bare`);
});

test("the coast is varied: no class takes more than four fifths of the classed shore", () => {
  const { out } = world();
  const seen = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < nn; i++) if (isShore(out.isSea, n, i)) seen[out.shoreClass[i]]++;
  const classed = seen[1] + seen[2] + seen[3] + seen[4] + seen[5] + seen[6];
  for (let k = 1; k <= 6; k++) assert.ok(seen[k] <= 0.8 * classed, `class ${k} is ${seen[k]} of ${classed}`);
});

test("beaches come in many widths, and most beach stamps carry a berm", () => {
  const { out } = world();
  const c = p.coast;
  const bins = [0, 0, 0, 0];
  let beaches = 0, berms = 0;
  for (const s of out.stamps) {
    if (s.kind === "berm" && s.top < c.ledge.bank) berms++;
    if (s.kind !== "beach") continue;
    beaches++;
    assert.ok(s.land >= c.beachWidth[0] - 1e-9 && s.land <= c.beachWidth[1] + 1e-9);
    bins[Math.min(3, Math.floor((4 * (s.land - c.beachWidth[0])) / (c.beachWidth[1] - c.beachWidth[0])))]++;
  }
  assert.equal(berms, beaches);
  // Narrow beaches are the commonest and the widest the rarest, but every quarter of the range turns up.
  for (let k = 0; k < 3; k++) assert.ok(bins[k] > 0.05 * beaches, `width quarter ${k} holds ${bins[k]} of ${beaches}`);
  assert.ok(bins[3] > 0, "no beach of the widest kind");
});

test("cliffs keep to the cap and the coast eats little land", () => {
  const { out, before } = world();
  let landBefore = 0, landAfter = 0;
  for (let i = 0; i < nn; i++) {
    if (before[i] > 0) landBefore++;
    if (out.h[i] > 0) landAfter++;
    if (out.shoreClass[i] === SHORE.cliff) assert.ok(out.h[i] >= p.coast.minCliff && out.h[i] <= p.coast.cliffCap + p.coast.capSlope[1] * 6);
  }
  assert.ok(landAfter <= 1.03 * landBefore && landAfter >= 0.9 * landBefore, `${landBefore} → ${landAfter}`);
});

test("stamps are well formed: sizes in range, unit directions, positions inside the world", () => {
  const { out } = world();
  const c = p.coast;
  const count: Record<string, number> = {};
  for (const s of out.stamps) {
    count[s.kind] = (count[s.kind] ?? 0) + 1;
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
    assert.ok(s.x > -8 && s.x < p.n + 8 && s.y > -8 && s.y < p.n + 8);
    if (s.kind === "stack") {
      const area = Math.PI * s.r * s.r;
      assert.ok(area >= c.stackArea[0] - 1e-9 && area <= c.stackArea[1] + 1e-9);
    } else if (s.kind === "cove") {
      assert.ok(s.len >= 0.7 * c.coveLen[0] && s.len <= c.coveLen[1]);
      assert.ok(2 * s.width < 0.75 * s.len, "longer than wide");
      assert.ok(s.neck > 0.3 && s.neck < 0.65);
      assert.ok(s.sand === 0 || (s.sand >= 0.25 && s.sand <= 0.42));
      assert.ok(Math.abs(s.ax * s.ax + s.ay * s.ay - 1) < 1e-9);
    } else if (s.kind === "cut") {
      assert.ok(s.r > 0 && s.r <= c.retreat * (1 - c.cliffE));
      assert.ok(s.level <= -c.platform[0] && s.level >= -c.platform[1]);
      assert.ok(s.cap >= c.gateCap - 1e-9 && s.cap <= c.cliffCap + 1e-9);
      assert.ok(s.slope >= c.capSlope[0] && s.slope <= c.capSlope[1] && Math.abs(s.slope * (p.n / 6400) - 0.8) > 0.05, "a cap slope at the camera's row factor");
    } else if (s.kind === "mouth") {
      assert.ok(Math.abs(s.dx * s.dx + s.dy * s.dy - 1) < 1e-9);
      assert.ok(s.area >= c.channelArea);
      assert.ok(["delta", "estuary", "plain"].includes(s.form));
    } else if (s.kind === "beach") {
      assert.equal(s.shelfSlope, c.shelfSlope);
      assert.ok(s.shelf > 0.15 * c.shelf && s.shelf < 1.5 * c.shelf);
    } else if (s.kind === "ledge") {
      assert.equal(s.land, c.ledge.width);
      assert.ok(Math.abs(s.base + s.rise * s.land - c.ledge.top) < 1e-9);
    } else if (s.kind === "berm") {
      assert.ok(Math.abs(s.outer - s.inner - c.berm[0]) < 1e-9);
      assert.ok(s.top > c.beachTop);
    } else if (s.kind === "strand") {
      assert.ok(Math.abs(s.nx * s.nx + s.ny * s.ny - 1) < 1e-9);
      assert.ok(s.r > 0 && s.r < 2 * (p.n / n));
    } else if (s.kind === "creek") {
      assert.ok(s.len >= c.creekLen[0] && s.len <= c.creekLen[1]);
      assert.ok(Math.abs(s.ax * s.ax + s.ay * s.ay - 1) < 1e-9);
    } else if (s.kind === "estuary") {
      assert.ok(s.sea >= 3 * s.head, "an estuary widens at least threefold");
      assert.ok(Math.abs(s.ax * s.ax + s.ay * s.ay - 1) < 1e-9);
    } else {
      assert.ok(s.r >= c.deltaR[0] && s.r <= c.deltaR[1]);
      assert.ok(s.channels.length === 2 || s.channels.length === 3);
      for (const k of s.channels) assert.ok(Math.abs(k) < s.spread);
    }
  }
  for (const kind of ["cut", "stack", "cove", "beach", "berm", "strand", "mouth"]) assert.ok((count[kind] ?? 0) > 0, `no ${kind} stamps`);
});

test("no seam at the wrap", () => {
  const { out } = world();
  assert.ok(seamRatio(out.h, n) <= 1);
  assert.ok(seamRatio(out.base, n) <= 1);
  assert.ok(seamRatio(out.exposure, n) <= 1);
  assert.ok(seamRatio(out.shoreDist, n) <= 1);
  assert.ok(seamRatio(out.sandWidth, n) <= 1);
  assert.ok(seamRatio(out.duneWidth, n) <= 1);
  assert.ok(seamRatio(out.marsh, n) <= 1);
});

test("deterministic for a seed, and the seed matters", () => {
  const { out, before, ctx } = world();
  const again = coast(before, n, ctx, p, 42);
  for (const k of ["h", "base", "isSea", "exposure", "shoreClass", "shoreDist", "sandWidth", "duneWidth", "marsh"] as const) assert.equal(sha256Hex(again[k]), sha256Hex(out[k]), k);
  assert.deepEqual(again.stamps, out.stamps);
  const other = coast(before, n, ctx, p, 43);
  assert.notDeepEqual(other.stamps.filter((s) => s.kind === "stack"), out.stamps.filter((s) => s.kind === "stack"));
});
