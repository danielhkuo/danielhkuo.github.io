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
import { applyStamps, inCove, type Stamp } from "./stamps.ts";

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
  const r = pyrRun(), { n, cx, cy } = PYR, c = pp.coast, tol = c.capSlope * 1.5 * 4;
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
  const r = pyrRun(), { n, cx, cy } = PYR, c = pp.coast, tol = c.capSlope * 1.5 * 4;
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
    if (a > 0 && b > 0 && b < r.base[cy * n + x + 1]) assert.ok(b - a <= c.capSlope * 4 + 1e-9);
  }
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
  const mid = pyrRun(), n = PYR.n;
  const moved = coast(pyramid(128, 128), n, { rock: new Uint8Array(n * n), regions: null }, pp, 7);
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

// ── Beaches ─────────────────────────────────────────────────────────────────

test("a sheltered, gentle shore becomes a beach with a shelf no steeper than 0.04", () => {
  // Soft land everywhere but an 80-cell strait that rings the world: both its shores are sheltered.
  const n = 128, p = fullScale(n), c = p.coast, h = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = y < 54 ? 53 - y : y >= 74 ? y - 74 : -1;
    h[y * n + x] = d < 0 ? -1 : 0.1 * 4 * (d + 0.5);
  }
  const r = coast(h, n, { rock: new Uint8Array(n * n).fill(2), regions: null }, p, 3);
  assert.equal(r.stamps.filter((s) => s.kind === "cut" || s.kind === "stack").length, 0);
  assert.equal(r.stamps.filter((s) => s.kind === "beach").length, 2 * n);
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
        if (d <= 0.5 * c.shelf) {
          assert.ok(Math.abs(r.h[k] + c.shelfSlope * d) < 1e-9, `shelf depth ${r.h[k]} at ${d} cells`);
          assert.ok(r.base[k] <= r.h[k] + 1e-9, "the shelf is never below the open bathymetry");
        }
      }
      if (row > 0 && d <= 0.5 * c.shelf) assert.ok(Math.abs(r.h[i] - r.h[i - n]) <= c.shelfSlope * 4 + 1e-9);
    }
  }
});

test("an exposed or a steep shore holds no beach", () => {
  const r = pyrRun();
  assert.equal(r.stamps.filter((s) => s.kind === "beach").length, 0);
  for (let i = 0; i < r.shoreClass.length; i++) assert.notEqual(r.shoreClass[i], SHORE.beach);
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

test("classes sit only on shore nodes, exposure is within [0, 1], and every kind of shore turns up", () => {
  const { out } = world();
  const seen = [0, 0, 0, 0, 0];
  for (let i = 0; i < nn; i++) {
    assert.equal(out.isSea[i], out.h[i] <= 0 ? 1 : 0);
    assert.ok(out.exposure[i] >= 0 && out.exposure[i] <= 1);
    assert.ok(out.shoreClass[i] <= SHORE.cove);
    // Off the shore only a delta's fan, land that was sea, carries a class.
    if (out.shoreClass[i] !== SHORE.none) assert.ok(isShore(out.isSea, n, i) || world().before[i] <= 0, `class off the shore at ${i}`);
    seen[out.shoreClass[i]]++;
  }
  assert.ok(seen[SHORE.beach] > 20, "beaches");
  assert.ok(seen[SHORE.rocky] > 20, "rocky shores");
  assert.ok(seen[SHORE.cliff] > 20, "cliffs");
  assert.ok(seen[SHORE.cove] > 0, "coves");
});

test("the coast is varied: no class takes more than two thirds of the classed shore", () => {
  const { out } = world();
  const seen = [0, 0, 0, 0, 0];
  for (let i = 0; i < nn; i++) seen[out.shoreClass[i]]++;
  const classed = seen[1] + seen[2] + seen[3] + seen[4];
  for (let k = 1; k <= 4; k++) assert.ok(seen[k] <= (2 * classed) / 3, `class ${k} is ${seen[k]} of ${classed}`);
});

test("cliffs keep to the cap and the coast eats little land", () => {
  const { out, before } = world();
  let landBefore = 0, landAfter = 0;
  for (let i = 0; i < nn; i++) {
    if (before[i] > 0) landBefore++;
    if (out.h[i] > 0) landAfter++;
    if (out.shoreClass[i] === SHORE.cliff) assert.ok(out.h[i] >= p.coast.minCliff && out.h[i] <= p.coast.cliffCap + p.coast.capSlope * 6);
  }
  assert.ok(landAfter <= landBefore + 200 && landAfter >= 0.9 * landBefore, `${landBefore} → ${landAfter}`);
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
      assert.ok(s.cap === c.cliffCap || s.cap === c.gateCap);
    } else if (s.kind === "mouth") {
      assert.ok(Math.abs(s.dx * s.dx + s.dy * s.dy - 1) < 1e-9);
      assert.ok(s.area >= c.channelArea);
      assert.ok(["delta", "estuary", "plain"].includes(s.form));
    } else if (s.kind === "beach") {
      assert.equal(s.shelfSlope, c.shelfSlope);
      assert.ok(s.shelf > 0.15 * c.shelf && s.shelf < 1.5 * c.shelf);
    } else if (s.kind === "estuary") {
      assert.ok(s.sea >= 3 * s.head, "an estuary widens at least threefold");
      assert.ok(Math.abs(s.ax * s.ax + s.ay * s.ay - 1) < 1e-9);
    } else {
      assert.ok(s.r >= c.deltaR[0] && s.r <= c.deltaR[1]);
      assert.ok(s.channels.length === 2 || s.channels.length === 3);
      for (const k of s.channels) assert.ok(Math.abs(k) < s.spread);
    }
  }
  for (const kind of ["cut", "stack", "cove", "beach", "mouth"]) assert.ok((count[kind] ?? 0) > 0, `no ${kind} stamps`);
});

test("no seam at the wrap", () => {
  const { out } = world();
  assert.ok(seamRatio(out.h, n) <= 1);
  assert.ok(seamRatio(out.base, n) <= 1);
  assert.ok(seamRatio(out.exposure, n) <= 1);
});

test("deterministic for a seed, and the seed matters", () => {
  const { out, before, ctx } = world();
  const again = coast(before, n, ctx, p, 42);
  for (const k of ["h", "base", "isSea", "exposure", "shoreClass"] as const) assert.equal(sha256Hex(again[k]), sha256Hex(out[k]), k);
  assert.deepEqual(again.stamps, out.stamps);
  const other = coast(before, n, ctx, p, 43);
  assert.notDeepEqual(other.stamps.filter((s) => s.kind === "stack"), out.stamps.filter((s) => s.kind === "stack"));
});
