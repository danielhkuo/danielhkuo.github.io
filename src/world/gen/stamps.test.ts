import assert from "node:assert/strict";
import { test } from "node:test";
import { applyStamps, applyStampsTo, type CirqueStamp, cirqueAt, type CoveStamp, coveAt, type CreekStamp, deltaAt, deltaChannel, type DeltaStamp, inCove, inCreek, spitAt, spitCentre, type SpitStamp, type Stamp, stampReach } from "./stamps.ts";

const cut: Stamp = { kind: "cut", x: 100, y: 100, r: 20, level: -2, fall: 0.1, cap: 12, slope: 0.8, reach: 40 };
const stack: Stamp = { kind: "stack", x: 60, y: 140, r: 6, top: 18, ux: 1, uy: 0, lobe: 0, apron: 3 };
// A cove with its mouth at (150, 90), running north (inland is −y) for 40 cells.
const cove: CoveStamp = { kind: "cove", x: 150, y: 90, ax: 0, ay: -1, len: 40, width: 14, neck: 0.45, tail: 12, sand: 0.35, depth: 2, seed: 77, base: 0.6, rise: 0.05 };
const beach: Stamp = { kind: "beach", x: 40, y: 40, land: 10, base: 0.6, rise: 0.05, shelf: 30, shelfSlope: 0.04 };
// An estuary with its mouth at (40, 170), the river coming from the east.
const estuary: Stamp = { kind: "estuary", x: 40, y: 170, ax: 1, ay: 0, len: 40, head: 2, sea: 8, depth: 1.2, seed: 5 };
// A delta built west into the sea from (40, 110).
const delta: DeltaStamp = { kind: "delta", x: 40, y: 110, ax: -1, ay: 0, r: 30, spread: 1.2, top: 0.7, channels: [-0.6, 0.1, 0.6], channel: 1.5, drift: 1, seed: 9 };
// A spit rooted on the shore at (40, 60), heading south-west and hooking back toward the land.
const spit: SpitStamp = { kind: "spit", x: 40, y: 60, ax: -0.6, ay: 0.8, hook: -1, len: 34, width: 4, top: 0.55, seed: 3 };
// A cirque whose tarn lies about (150, 160), open to the south.
const cirque: CirqueStamp = { kind: "cirque", x: 150, y: 160, ax: 0, ay: 1, len: 36, width: 13, level: 20, depth: 5, wall: 1.6, fall: 0.8, reach: 20, seed: 11 };
const mouth: Stamp = { kind: "mouth", x: 10, y: 10, dx: 0, dy: 1, area: 5000, form: "plain" };
const ALL: Stamp[] = [stack, beach, cut, mouth, cove, estuary, delta, spit, cirque];

/** A 200-cell world at one cell a node: land at `land`, with sea west of x = 40. */
function field(n: number, land: number): Float64Array {
  const h = new Float64Array(n * n).fill(land);
  for (let y = 0; y < n; y++) for (let x = 0; x < 40; x++) h[y * n + x] = -20;
  return h;
}
const at = (h: Float64Array, n: number, x: number, y: number): number => h[Math.floor(y) * n + Math.floor(x)];

test("a cut lowers ground within r to a platform that is `level` at the cliff foot, and caps the land behind", () => {
  const n = 200, h = field(n, 60);
  applyStamps(h, n, 1, [cut]);
  // Node (100, 100) is centred at (100.5, 100.5): 0.707 from the stamp.
  assert.ok(Math.abs(at(h, n, 100, 100) - (-2 * 0.7071 / 20 - 0.1 * (20 - 0.7071))) < 1e-3);
  assert.ok(Math.abs(at(h, n, 119, 100) - (-2 * (19.5 / 20) - 0.1 * 0.5)) < 0.01);
  // Just past r the land stands at the cap, then rises at the slope.
  assert.ok(Math.abs(at(h, n, 121, 100) - (12 + 0.8 * 1.5)) < 0.05);
  assert.ok(Math.abs(at(h, n, 140, 100) - (12 + 0.8 * 20.5)) < 0.05);
  assert.equal(at(h, n, 170, 100), 60);
  for (let i = 0; i < h.length; i++) assert.ok(h[i] <= 60);
});

test("a cut with no reach leaves the land behind it alone", () => {
  const n = 200, h = field(n, 60);
  applyStamps(h, n, 1, [{ ...cut, reach: 0 } as Stamp]);
  assert.ok(at(h, n, 110, 100) < 0);
  assert.equal(at(h, n, 121, 100), 60);
});

test("a stack is flat-topped with a wall at its foot, ringed by shoal, and only ever raises", () => {
  const n = 200, h = new Float64Array(n * n).fill(-5);
  applyStamps(h, n, 1, [stack]);
  assert.equal(at(h, n, 60, 140), 18);
  assert.equal(at(h, n, 62, 140), 18);
  const edge = at(h, n, 65, 140);
  assert.ok(edge > 0.15 * 18 && edge < 18, `the foot is a wall: ${edge}`);
  // The surf ring: shallow just outside the foot, the old bed beyond it.
  const ring = at(h, n, 67, 140);
  assert.ok(ring < 0 && ring > -1.2, `${ring}`);
  assert.equal(at(h, n, 71, 140), -5);
  let cells = 0;
  for (let i = 0; i < h.length; i++) {
    assert.ok(h[i] >= -5);
    if (h[i] > 0) cells++;
  }
  assert.ok(Math.abs(cells - Math.PI * 36) < 12, `${cells} cells`);
});

test("a lobed stack is not a disc, but covers about the same area", () => {
  const n = 200, round = new Float64Array(n * n).fill(-5), lobed = new Float64Array(n * n).fill(-5);
  applyStamps(round, n, 1, [stack]);
  applyStamps(lobed, n, 1, [{ ...stack, ux: 0.6, uy: 0.8, lobe: 0.28 } as Stamp]);
  let a = 0, b = 0, differ = 0;
  for (let i = 0; i < round.length; i++) {
    if (round[i] > 0) a++;
    if (lobed[i] > 0) b++;
    if (round[i] > 0 !== lobed[i] > 0) differ++;
  }
  assert.ok(differ > 10, "the outline moved");
  assert.ok(Math.abs(a - b) < 0.2 * a, `${a} vs ${b} cells`);
});

test("a beach lowers land to sand and raises the sea bed to a shelf no steeper than its slope", () => {
  const n = 200, h = field(n, 3);
  applyStamps(h, n, 1, [beach]);
  // Land east of the shore point at (40, 40).
  assert.ok(Math.abs(at(h, n, 45, 40) - (0.6 + 0.05 * Math.hypot(5.5, 0.5))) < 1e-9);
  assert.equal(at(h, n, 52, 40), 3);
  // Sea to the west: the bed is −0.04·d on the shelf.
  assert.ok(Math.abs(at(h, n, 30, 40) + 0.04 * Math.hypot(9.5, 0.5)) < 1e-9);
  for (let x = 12; x < 39; x++) {
    const a = at(h, n, x, 40), b = at(h, n, x + 1, 40);
    assert.ok(Math.abs(a - b) <= 0.04 + 1e-9);
  }
  // Past the shelf it falls away to the old bed.
  assert.equal(at(h, n, 39, 150), -20);
  assert.ok(at(h, n, 5, 40) < -1.2);
});

test("a cove is long, narrow at the mouth, wider within, and closed at the back", () => {
  const halfAt = (u: number): number => {
    // Half-width at u cells in: the widest |v| still inside, on the +v side.
    let w = 0;
    for (let v = 0; v < 40; v += 0.25) if (coveAt(cove, v, -u).q < 1) w = v;
    return w;
  };
  const mouthHalf = halfAt(0.5), belly = halfAt(22);
  assert.ok(mouthHalf > 2 && mouthHalf < 0.75 * cove.width, `mouth ${mouthHalf}`);
  assert.ok(belly > 1.3 * mouthHalf, `belly ${belly} vs mouth ${mouthHalf}`);
  assert.ok(halfAt(39.5) < 0.6 * belly, "it closes at the back");
  assert.equal(coveAt(cove, 0, -41).q, Infinity);
  assert.equal(coveAt(cove, 0, 13).q, Infinity);
  // Longer than wide: it follows its stream.
  assert.ok(cove.len > 2 * belly);
});

test("a cove holds water from the mouth, a crescent of sand only at the back, and cliffs beside it", () => {
  const n = 200, h = field(n, 25);
  applyStamps(h, n, 1, [cove]);
  let water = 0, sand = 0, sandFront = Infinity, waterBack = -Infinity;
  for (let y = 40; y < 110; y++) for (let x = 110; x < 190; x++) {
    const v = h[y * n + x], u = 90 - (y + 0.5);
    if (v === 25) continue;
    if (v < 0) { water++; waterBack = Math.max(waterBack, u); assert.ok(v <= -0.3 && v >= -2 - 1e-9); }
    else { sand++; sandFront = Math.min(sandFront, u); assert.ok(v >= 0.6 && v < 2.2, `sand at ${v}`); }
  }
  assert.ok(water > 150 && sand > 60, `${water} water, ${sand} sand`);
  assert.ok(sand < water, "sand is the smaller part");
  assert.ok(sandFront > 0.3 * cove.len, "no sand near the mouth");
  assert.ok(waterBack < 0.8 * cove.len, "no water at the very back");
  // The ground just outside the walls is untouched: cliffs flank the water.
  assert.equal(at(h, n, 150 + 2 * cove.width + 2, 70), 25);
  assert.equal(at(h, n, 150, 90 - cove.len - 3), 25);
});

test("a boulder cove has no sand: its back is a short rock ramp", () => {
  const n = 200, h = field(n, 25);
  applyStamps(h, n, 1, [{ ...cove, sand: 0 }]);
  let low = 0, ramp = 0;
  for (let i = 0; i < h.length; i++) {
    if (h[i] > 0 && h[i] < 1.2) low++;
    if (h[i] > 0 && h[i] < 25) ramp++;
  }
  assert.ok(ramp > 0 && ramp < 120, `${ramp} ramp cells`);
  assert.ok(low < 0.6 * ramp + 20, "the ramp climbs quickly");
});

test("two coves with different seeds have different outlines; inCove matches the stamp", () => {
  const n = 200, a = field(n, 25), b = field(n, 25);
  applyStamps(a, n, 1, [cove]);
  applyStamps(b, n, 1, [{ ...cove, seed: 78 }]);
  let differ = 0;
  for (let i = 0; i < a.length; i++) if (a[i] < 25 !== b[i] < 25) differ++;
  assert.ok(differ > 40, `${differ} cells differ`);
  for (let y = 40; y < 90; y += 3) for (let x = 110; x < 190; x += 3) {
    if (a[y * n + x] < 25) assert.ok(inCove(cove, x + 0.5, y + 0.5, n, 1));
  }
  assert.ok(!inCove(cove, 150.5, 20.5, n, 1.5));
});

test("an estuary is a funnel: wide at the sea, narrow upstream, with flats beside it", () => {
  const n = 200, h = field(n, 3);
  applyStamps(h, n, 1, [estuary]);
  const wet = (x: number): number => {
    let c = 0;
    for (let y = 140; y < 200; y++) if (h[y * n + x] < 0) c++;
    return c;
  };
  assert.ok(wet(42) >= 10, `mouth ${wet(42)} cells wide`);
  assert.ok(wet(75) >= 2 && wet(75) <= 7, `head ${wet(75)} cells wide`);
  assert.ok(wet(42) >= 2.4 * wet(75), "it widens about threefold");
  assert.equal(wet(82), 0);
  let flats = 0;
  for (let y = 140; y < 200; y++) for (let x = 40; x < 80; x++) if (h[y * n + x] > 0 && h[y * n + x] < 1.5) flats++;
  assert.ok(flats > 40, `${flats} cells of flats`);
});

test("a delta builds a low fan into the sea, split by its distributaries, with shoal water round it", () => {
  const n = 200, h = field(n, 3);
  applyStamps(h, n, 1, [delta]);
  let fan = 0, tallest = 0;
  for (let y = 60; y < 160; y++) for (let x = 0; x < 40; x++) {
    const v = h[y * n + x];
    if (v > 0) { fan++; tallest = Math.max(tallest, v); }
  }
  assert.ok(fan > 400, `${fan} cells of fan`);
  assert.ok(tallest <= 0.8, "the fan is low");
  // Silt: the sea just beyond the fan is shallow, and deep again farther out.
  assert.ok(at(h, n, 2, 110) > -4.5);
  assert.equal(at(h, n, 10, 20), -20);
  // Land behind the mouth is not touched.
  assert.equal(at(h, n, 60, 110), 3);
});

/** Greatest distance of a line's points from the chord between its ends. */
function bow(points: [number, number][]): number {
  const [x0, y0] = points[0], [x1, y1] = points[points.length - 1];
  const len = Math.hypot(x1 - x0, y1 - y0);
  let most = 0;
  for (const [x, y] of points) most = Math.max(most, Math.abs((x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)) / len);
  return most;
}

test("a delta's distributaries: two or three, split from one trunk, each one curved and none on a line with another", () => {
  for (const d of [delta, { ...delta, seed: 10, channels: [-0.5, 0.6] }, { ...delta, seed: 4321, r: 80, channels: [-0.7, 0, 0.75], channel: 3 }] as DeltaStamp[]) {
    const count = d.channels.length;
    assert.ok(count === 2 || count === 3);
    // One trunk at the mouth; at the front each has gone its own way, in the order given.
    for (let i = 1; i < count; i++) {
      assert.ok(Math.abs(deltaChannel(d, i, 0.05 * d.r) - deltaChannel(d, 0, 0.05 * d.r)) < 1e-9, "one trunk");
      assert.ok(deltaChannel(d, i, 0.9 * d.r) - deltaChannel(d, i - 1, 0.9 * d.r) > 0.2 * d.r, "they part");
    }
    for (let i = 0; i < count; i++) {
      const line: [number, number][] = [];
      for (let u = 0; u <= d.r; u += d.r / 40) line.push([u, deltaChannel(d, i, u)]);
      assert.ok(bow(line) > 0.04 * d.r, `distributary ${i} bows ${bow(line).toFixed(2)} of ${d.r}`);
      // Not a ray from the mouth: its bearing from the apex changes along it.
      const k1 = deltaChannel(d, i, 0.45 * d.r) / 0.45, k2 = deltaChannel(d, i, 0.9 * d.r) / 0.9;
      assert.ok(Math.abs(k1 - k2) > 0.03 * d.r, `distributary ${i} is radial`);
    }
    // Across the fan four fifths of the way out, the water lies in as many runs as there are distributaries.
    let runs = 0;
    for (let v = -1.5 * d.r, wet = false; v <= 1.5 * d.r; v += 0.25) {
      // With the stamp's axis (−1, 0): u = −dx and v = −dy, before the warp.
      const a = deltaAt(d, -0.8 * d.r, -v);
      const now = a.e < 1 && a.wet === 1;
      if (now && !wet) runs++;
      wet = now;
    }
    assert.equal(runs, count);
  }
});

test("a delta's front is lobed, not an arc or a wedge, and a bar of sand lies off it", () => {
  const n = 200, h = field(n, 3);
  applyStamps(h, n, 1, [delta]);
  // Reach of the fan's land along rays from the mouth.
  const reach: number[] = [];
  for (let k = -6; k <= 6; k++) {
    const dy = k / 8, dl = Math.hypot(1, dy);
    let far = 0;
    for (let d = 2; d < 50; d += 0.5) {
      const a = deltaAt(delta, (-d * 1) / dl, (d * dy) / dl);
      if (a.e < 1) far = d;
    }
    reach.push(far);
  }
  const lo = Math.min(...reach), hi = Math.max(...reach);
  assert.ok(lo > 0.5 * delta.r && hi < 1.7 * delta.r, `${lo} to ${hi}`);
  assert.ok(hi - lo > 0.15 * delta.r, "the front is one arc");
  // It turns in and out along the front: more than one change of direction.
  let turns = 0;
  for (let i = 2; i < reach.length; i++) if ((reach[i] - reach[i - 1]) * (reach[i - 1] - reach[i - 2]) < 0) turns++;
  assert.ok(turns >= 2, `${turns} turns`);
  // Bars: sand off the front, low, parted from the fan by water.
  let bar = 0;
  for (let y = 40; y < 180; y++) for (let x = 0; x < 40; x++) {
    const a = deltaAt(delta, x + 0.5 - 40, y + 0.5 - 110);
    if (a.e < 1 || a.bar <= 0) continue;
    bar++;
    assert.ok(Math.abs(h[y * n + x] - a.bar) < 1e-9 && a.bar <= 0.45);
  }
  assert.ok(bar > 20, `${bar} cells of bar`);
});

test("a spit is curved, tapers to a point, and recurves at its tip toward the land", () => {
  const n = 200, h = field(n, 3), before = h.slice();
  applyStamps(h, n, 1, [spit]);
  const line: [number, number][] = [];
  for (let u = 0; u <= spit.len; u += spit.len / 40) line.push([u, spitCentre(spit, u)]);
  // Bowed: well off the chord from root to tip.
  assert.ok(bow(line) > 0.08 * spit.len, `bow ${bow(line)}`);
  // Recurved: the heading at the tip has turned more than 45° from the root's, to the hook's side.
  const m0 = (spitCentre(spit, 2) - spitCentre(spit, 0)) / 2, m1 = (spitCentre(spit, spit.len) - spitCentre(spit, spit.len - 2)) / 2;
  assert.ok(Math.abs(m0) < 0.2, `root ${m0}`);
  assert.ok(m1 * spit.hook > 1, `tip ${m1}`);
  // Tapering: sand across the spit near the root is wider than near the tip, and the end is a point.
  const across = (u: number): number => {
    let cells = 0;
    const c = spitCentre(spit, u);
    for (let v = c - 12; v <= c + 12; v += 0.25) if (spitAt(spit, spit.ax * u - spit.ay * v, spit.ay * u + spit.ax * v) < 0) cells++;
    return cells / 4;
  };
  // (Measured square to the heading, so the hooked tip reads wider than it is.)
  assert.ok(across(0.1 * spit.len) > 1.5 * across(0.85 * spit.len), `${across(0.1 * spit.len)} then ${across(0.85 * spit.len)}`);
  assert.ok(across(0.99 * spit.len) < 1.5);
  // No straight edge: each side's outline bows too.
  const edge: [number, number][] = [];
  for (let u = 2; u <= spit.len - 2; u += 1) {
    const c = spitCentre(spit, u);
    let v = c;
    while (spitAt(spit, spit.ax * u - spit.ay * v, spit.ay * u + spit.ax * v) < 0) v += 0.1;
    edge.push([u, v]);
  }
  assert.ok(bow(edge) > 0.06 * spit.len);
  // In the field: low sand in the sea, shoal water round it, and it only ever raises.
  let sand = 0;
  for (let i = 0; i < h.length; i++) {
    assert.ok(h[i] >= before[i]);
    if (before[i] < 0 && h[i] > 0) { sand++; assert.ok(h[i] <= spit.top); }
  }
  assert.ok(sand > 80 && sand < 400, `${sand} cells of sand`);
});

/** A slope that falls to the south at 0.3 a cell, 40 high at y = 160. */
function hillside(n: number): Float64Array {
  const h = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = 40 - 0.3 * (y + 0.5 - 160);
  return h;
}

test("a cirque is an armchair: a headwall behind and beside the tarn, open downslope over a low lip", () => {
  const n = 320;
  const c: CirqueStamp = { ...cirque, x: 160, y: 160, level: 40 - 0.3 * 18 + 0.3, reach: 40 };
  const h = hillside(n), before = h.slice();
  applyStamps(h, n, 1, [c]);
  let water = 0;
  const rim = { back: Infinity, front: Infinity, frontAt: 0, wall: 0 };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = cirqueAt(c, x + 0.5 - c.x, y + 0.5 - c.y), v = h[y * n + x];
    if (a.d < 0) {
      water++;
      assert.ok(v < c.level && v >= c.level - 0.15 - c.depth - 1e-9, `bed ${v}`);
      continue;
    }
    // Ground at the water's edge: the lowest of it is the outlet.
    if (a.d < 2) {
      if (a.t < 0.6) rim.back = Math.min(rim.back, v);
      else if (v < rim.front) { rim.front = v; rim.frontAt = a.off; }
    }
    // The headwall: behind the lake the ground climbs steeply to the old slope.
    if (a.t < 0.2 && a.d > 3 && a.d < 6) rim.wall = Math.max(rim.wall, v - c.level);
    if (a.d < 6) assert.ok(v >= c.level + 0.1, `dry ground below the water at (${x}, ${y})`);
  }
  assert.ok(water > 500 && water < 1400, `${water} cells of water`);
  assert.ok(rim.front < rim.back - 0.25, `the lip (${rim.front}) is lower than the back (${rim.back})`);
  assert.ok(rim.front <= c.level + 0.3 && rim.frontAt < 0.5, "the water spills on the axis");
  assert.ok(rim.wall > 3, `headwall ${rim.wall}`);
  // The back is cut into the slope and the front is banked up from it.
  assert.ok(at(h, n, 160, 137) < at(before, n, 160, 137) - 3, "cut behind");
  assert.ok(at(h, n, 160, 182) > at(before, n, 160, 182), "banked in front");
  assert.equal(at(h, n, 160, 60), at(before, n, 160, 60));
  assert.equal(at(h, n, 160, 250), at(before, n, 160, 250));
});

test("a tarn is no circle and no quad: widest toward its back, narrow at the outlet, with a ragged shore", () => {
  const span = (c: CirqueStamp, t: number): number => {
    let cells = 0;
    for (let v = -40; v <= 40; v += 0.25) if (cirqueAt(c, -v, (t - 0.5) * c.len).d < 0) cells++;
    return cells / 4;
  };
  for (const seed of [11, 12, 13, 14]) {
    const c = { ...cirque, seed };
    // The stamp opens south: across is x, along is y.
    assert.ok(span(c, 0.35) > 1.2 * c.width, `belly ${span(c, 0.35)}`);
    assert.ok(span(c, 0.35) > 2 * span(c, 0.95), `belly ${span(c, 0.35)}, outlet ${span(c, 0.95)}`);
    assert.ok(span(c, 0.95) >= 1, "the outlet is open");
    // The shore: its distance from the middle, taken round the back half, is no constant (a circle) and no two straight runs (a quad).
    const r: number[] = [];
    for (let k = 0; k <= 48; k++) {
      const dx = (k - 24) / 24, dy = -Math.sqrt(1 - dx * dx) * 0.999 - 0.001;
      let d = 0;
      while (d < 60 && cirqueAt(c, dx * d, dy * d).d < 0) d += 0.25;
      r.push(d);
    }
    // Changes of direction, flat runs aside.
    let turns = 0;
    for (let i = 1, last = 0; i < r.length; i++) {
      const step = Math.sign(r[i] - r[i - 1]);
      if (step === 0) continue;
      if (last !== 0 && step !== last) turns++;
      last = step;
    }
    assert.ok(Math.max(...r) - Math.min(...r) > 2, "round");
    // A smooth oval's back turns once, at its far point.
    assert.ok(turns >= 2, `${turns} turns`);
  }
  assert.notDeepEqual(cirqueAt({ ...cirque, seed: 12 }, 9, 3).d, cirqueAt(cirque, 9, 3).d);
});

// ── The low shore: strand, berm, ledge, creek ───────────────────────────────

// The waterline through (60, 100), sea to the west.
const strand: Stamp = { kind: "strand", x: 60, y: 100, nx: -1, ny: 0, r: 5, slope: 0.04 };
const berm: Stamp = { kind: "berm", x: 40, y: 40, inner: 10, outer: 15, top: 1.45 };
const ledge: Stamp = { kind: "ledge", x: 40, y: 150, land: 3, base: 0.45, rise: 0.5 / 3, shelf: 8, shelfSlope: 0.04 };
// A creek with its mouth at (40, 100), winding east.
const creek: CreekStamp = { kind: "creek", x: 40, y: 100, ax: 1, ay: 0, len: 40, width: 1.4, top: 1.6, seed: 31 };
const LOW: Stamp[] = [creek, beach, strand, ledge, berm];

test("a strand cuts the land seaward of its line to shallow water and nothing else", () => {
  const n = 200, h = field(n, 5);
  applyStamps(h, n, 1, [strand]);
  for (let y = 90; y < 110; y++) for (let x = 45; x < 75; x++) {
    const dx = x + 0.5 - 60, dy = y + 0.5 - 100, v = at(h, n, x, y);
    if (dx < 0 && dx * dx + dy * dy <= 25) assert.ok(v < 0 && v > -0.3 && Math.abs(v + 0.03 - 0.04 * dx) < 1e-9, `(${x}, ${y}) ${v}`);
    else assert.equal(v, 5, `(${x}, ${y})`);
  }
  // Water is left alone.
  const sea = new Float64Array(n * n).fill(-7);
  applyStamps(sea, n, 1, [strand]);
  for (let i = 0; i < sea.length; i++) assert.equal(sea[i], -7);
});

test("a berm ends the sand on a ring where the land behind lies as low as the beach", () => {
  const n = 200, h = field(n, 0.5);
  // A second beach along the shore: its sand overlaps the first one's berm.
  const next: Stamp = { ...beach, y: 52 };
  applyStamps(h, n, 1, [berm, beach, next]);
  let ring = 0;
  for (let y = 20; y < 75; y++) for (let x = 40; x < 60; x++) {
    const d = Math.hypot(x + 0.5 - 40, y + 0.5 - 40), d2 = Math.hypot(x + 0.5 - 40, y + 0.5 - 52), v = at(h, n, x, y);
    if (d <= 10 || d2 <= 10) assert.ok(v >= 0.5 && v < 1.1, `sand at (${x}, ${y}) stands at ${v}`);
    else if (d <= 15) { assert.equal(v, 1.45, `berm at (${x}, ${y})`); ring++; }
    else assert.equal(v, 0.5);
  }
  assert.ok(ring > 30);
  // Ground that already stands higher, and the sea, are left alone.
  const high = field(n, 9);
  applyStamps(high, n, 1, [berm]);
  assert.deepEqual(high, field(n, 9));
});

test("a ledge is a narrow strand of shingle: cut like a beach, three cells wide", () => {
  const n = 200, h = field(n, 6);
  applyStamps(h, n, 1, [ledge]);
  assert.ok(Math.abs(at(h, n, 41, 150) - (0.45 + (0.5 / 3) * Math.hypot(1.5, 0.5))) < 1e-9);
  assert.ok(at(h, n, 42, 150) < 0.95);
  assert.equal(at(h, n, 44, 150), 6);
  assert.ok(at(h, n, 38, 150) > -0.04 * 2 && at(h, n, 38, 150) < 0, "a shelf off the strand");
});

test("a creek winds inland from its mouth and branches, cut only into low ground", () => {
  const n = 200, h = field(n, 0.8);
  applyStamps(h, n, 1, [creek]);
  let wet = 0;
  const rows = new Set<number>();
  for (let y = 0; y < n; y++) for (let x = 40; x < n; x++) {
    if (at(h, n, x, y) > 0) continue;
    wet++;
    rows.add(y);
    assert.ok(inCreek(creek, x + 0.5 - 40, y + 0.5 - 100));
    assert.ok(x < 40 + 40 && Math.abs(y - 100) < 30, `creek water at (${x}, ${y})`);
  }
  assert.ok(wet > 60 && wet < 400, `${wet} creek cells`);
  assert.ok(rows.size >= 12, "branches reach to either side of the stem");
  // The stem does not break: every column of its length holds water.
  for (let x = 40; x < 78; x++) {
    let any = false;
    for (let y = 80; y < 120 && !any; y++) any = at(h, n, x, y) < 0;
    assert.ok(any, `the creek breaks at x = ${x}`);
  }
  // Another seed, another creek.
  const other = field(n, 0.8);
  applyStamps(other, n, 1, [{ ...creek, seed: 32 }]);
  assert.notDeepEqual(other, h);
  // Ground above its top is not cut: the creek ends where the marsh does.
  const high = field(n, 2);
  applyStamps(high, n, 1, [creek]);
  assert.deepEqual(high, field(n, 2));
});

test("creeks and berms are finer than a node: only a grid of cells takes them", () => {
  const coarse = new Float64Array(50 * 50).fill(0.8), before = coarse.slice();
  applyStamps(coarse, 50, 4, [creek, berm]);
  assert.deepEqual(coarse, before);
});

test("the low shore's stamps are idempotent, keep within reach, and do not depend on list order", () => {
  const n = 200, once = field(n, 0.8), twice = field(n, 0.8), shuffled = field(n, 0.8);
  applyStamps(once, n, 1, LOW);
  applyStamps(twice, n, 1, LOW);
  applyStamps(twice, n, 1, LOW);
  applyStamps(shuffled, n, 1, [...LOW].reverse());
  assert.deepEqual(twice, once);
  assert.deepEqual(shuffled, once);
  for (const s of LOW) {
    const land = new Float64Array(n * n).fill(0.8), sea = new Float64Array(n * n).fill(-20);
    const moved = { ...s, x: 100, y: 100 } as Stamp;
    applyStamps(land, n, 1, [moved]);
    applyStamps(sea, n, 1, [moved]);
    const reach = stampReach(moved);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (land[y * n + x] === 0.8 && sea[y * n + x] === -20) continue;
      assert.ok(Math.hypot(x + 0.5 - 100, y + 0.5 - 100) <= reach + 1e-9, `${s.kind} reaches (${x}, ${y})`);
    }
  }
});

test("a mouth changes nothing", () => {
  const n = 200, h = field(n, 7), before = h.slice();
  applyStamps(h, n, 1, [mouth]);
  assert.deepEqual(h, before);
  assert.equal(stampReach(mouth), 0);
});

test("stamps are idempotent and do not depend on list order", () => {
  const n = 200, once = field(n, 30), twice = field(n, 30), shuffled = field(n, 30);
  applyStamps(once, n, 1, ALL);
  applyStamps(twice, n, 1, ALL);
  applyStamps(twice, n, 1, ALL);
  applyStamps(shuffled, n, 1, [...ALL].reverse());
  assert.deepEqual(twice, once);
  assert.deepEqual(shuffled, once);
  for (let i = 0; i < once.length; i++) assert.ok(Number.isFinite(once[i]));
});

test("no stamp reaches past stampReach", () => {
  const n = 400;
  for (const s of ALL) {
    const land = new Float64Array(n * n).fill(30), sea = new Float64Array(n * n).fill(-20);
    const moved = { ...s, x: 200, y: 200 } as Stamp;
    applyStamps(land, n, 1, [moved]);
    applyStamps(sea, n, 1, [moved]);
    const reach = stampReach(moved);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (land[y * n + x] === 30 && sea[y * n + x] === -20) continue;
      assert.ok(Math.hypot(x + 0.5 - 200, y + 0.5 - 200) <= reach + 1e-9, `${s.kind} reaches (${x}, ${y})`);
    }
  }
});

test("stamps wrap: a stack on the corner lands on all four corners", () => {
  const n = 64, h = new Float64Array(n * n).fill(-3);
  applyStamps(h, n, 4, [{ kind: "stack", x: 0, y: 0, r: 5, top: 9, ux: 1, uy: 0, lobe: 0, apron: 0 }]);
  for (const [x, y] of [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]]) assert.equal(h[y * n + x], 9);
  let raised = 0;
  for (let i = 0; i < h.length; i++) if (h[i] > 0) raised++;
  assert.equal(raised, 4);
});

test("the same stamps cut the same shapes at 4 cells a node and at 1", () => {
  const coarse = new Float64Array(50 * 50);
  for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) coarse[y * 50 + x] = x < 10 ? -20 : 30;
  applyStamps(coarse, 50, 4, ALL);
  let land = 0;
  for (let i = 0; i < coarse.length; i++) if (coarse[i] > 0) land++;
  const fine = field(200, 30);
  applyStamps(fine, 200, 1, ALL);
  let fineLand = 0;
  for (let i = 0; i < fine.length; i++) if (fine[i] > 0) fineLand++;
  assert.ok(Math.abs(land / coarse.length - fineLand / fine.length) < 0.015, `${land / coarse.length} vs ${fineLand / fine.length}`);
});

test("a window of the world gets exactly the crop of the whole, across the wrap", () => {
  const n = 200, whole = field(n, 30);
  const edge: Stamp[] = [
    ...ALL,
    { kind: "stack", x: 199, y: 2, r: 6, top: 14, ux: 0, uy: 1, lobe: 0.2, apron: 3 },
    { kind: "cut", x: 3, y: 198, r: 12, level: -2, fall: 0.1, cap: 12, slope: 0.8, reach: 10 },
    { ...cove, x: 198, y: 195 },
  ];
  applyStamps(whole, n, 1, edge);
  const x0 = 170, y0 = 180, w = 70, hgt = 50;
  const win = new Float64Array(w * hgt);
  const src = field(n, 30);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) win[y * w + x] = src[((y0 + y) % n) * n + ((x0 + x) % n)];
  applyStampsTo(win, { w, h: hgt, cellsPerNode: 1, x0, y0, period: n }, edge);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    assert.equal(win[y * w + x], whole[((y0 + y) % n) * n + ((x0 + x) % n)], `(${x}, ${y})`);
  }
});
