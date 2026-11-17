import assert from "node:assert/strict";
import { test } from "node:test";
import { applyStamps, applyStampsTo, type CoveStamp, coveAt, inCove, type Stamp, stampReach } from "./stamps.ts";

const cut: Stamp = { kind: "cut", x: 100, y: 100, r: 20, level: -2, fall: 0.1, cap: 12, slope: 0.8, reach: 40 };
const stack: Stamp = { kind: "stack", x: 60, y: 140, r: 6, top: 18, ux: 1, uy: 0, lobe: 0, apron: 3 };
// A cove with its mouth at (150, 90), running north (inland is −y) for 40 cells.
const cove: CoveStamp = { kind: "cove", x: 150, y: 90, ax: 0, ay: -1, len: 40, width: 14, neck: 0.45, tail: 12, sand: 0.35, depth: 2, seed: 77, base: 0.6, rise: 0.05 };
const beach: Stamp = { kind: "beach", x: 40, y: 40, land: 10, base: 0.6, rise: 0.05, shelf: 30, shelfSlope: 0.04 };
// An estuary with its mouth at (40, 170), the river coming from the east.
const estuary: Stamp = { kind: "estuary", x: 40, y: 170, ax: 1, ay: 0, len: 40, head: 2, sea: 8, depth: 1.2, seed: 5 };
// A delta built west into the sea from (40, 110).
const delta: Stamp = { kind: "delta", x: 40, y: 110, ax: -1, ay: 0, r: 30, spread: 1.2, top: 0.7, channels: [-0.6, 0.1, 0.6], channel: 1.5, seed: 9 };
const mouth: Stamp = { kind: "mouth", x: 10, y: 10, dx: 0, dy: 1, area: 5000, form: "plain" };
const ALL: Stamp[] = [stack, beach, cut, mouth, cove, estuary, delta];

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
  // Along a line across the fan, land is broken by three channels.
  let runs = 0;
  for (let y = 80, onLand = false; y < 140; y++) {
    const land = h[y * n + 22] > 0;
    if (land && !onLand) runs++;
    onLand = land;
  }
  assert.equal(runs, 4);
  // Silt: the sea just beyond the fan is shallow, and deep again farther out.
  assert.ok(at(h, n, 5, 110) > -4);
  assert.equal(at(h, n, 10, 20), -20);
  // Land behind the mouth is not touched.
  assert.equal(at(h, n, 60, 110), 3);
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
