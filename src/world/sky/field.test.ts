import assert from "node:assert/strict";
import { test } from "node:test";
import { ALT, cloudAt, makeField, type Cloud, type SkyField } from "./field.ts";
import { makeShapes, SHAPE_COUNTS, type CloudShape } from "./shapes.ts";

const N = 6400, KY = 0.8, W = 400, H = 225;
/** A start like the shipped world's: offshore, the town to the north-east. */
const START = { x: 5726.1, y: 3784.3 };
/** The page's first view: the flier at its centre, 18 over the sea. */
const OPEN = { x: Math.floor(START.x) - W / 2, y: Math.floor(KY * START.y) - 18 - (H >> 1) };
interface Fix { shapes: CloudShape[]; field: SkyField; opened: SkyField }
let memo: Fix | null = null;
/** Built on first use, so the test runner can list these tests before the field exists. */
function fix(): Fix {
  if (!memo) {
    const shapes = makeShapes(3, SHAPE_COUNTS);
    memo = { shapes, field: makeField(3, N, shapes), opened: makeField(3, N, shapes, START) };
  }
  return memo;
}

/** A small LCG for the test's own sampling. */
function sampler(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Offset of `v` from `origin` on a ring of `period`, taking the image of v nearest the window [origin, origin + span). */
function near(v: number, origin: number, period: number, span: number): number {
  let d = (((v - origin) % period) + period) % period;
  if (d > span + 400) d -= period;
  return d;
}

/** Screen boxes of a field's clouds of one layer in a view at t = 0. */
function boxes(f: SkyField, layer: Cloud["layer"], rx: number, ry: number) {
  const out: { sx: number; sy: number; c: Cloud }[] = [];
  for (const c of f.clouds) {
    if (c.layer !== layer) continue;
    const s = fix().shapes[c.shape];
    const p = cloudAt(f, c, 0);
    const sx = near(Math.round(p.x), rx, N, W);
    const sy = near(Math.round(KY * p.y) - ALT[layer], ry, KY * N, H);
    if (sx + s.w > 0 && sx < W && sy + s.h > 0 && sy < H) out.push({ sx, sy, c });
  }
  return out;
}

/** The view's pixels under low cloud: a mask, and the share covered. */
function lowCover(f: SkyField, rx: number, ry: number): { mask: Uint8Array; share: number } {
  const mask = new Uint8Array(W * H);
  for (const { sx, sy, c } of boxes(f, "low", rx, ry)) {
    const s = fix().shapes[c.shape];
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const px = sx + x, py = sy + y;
      if (px >= 0 && px < W && py >= 0 && py < H && s.cover[y * s.w + x]) mask[py * W + px] = 1;
    }
  }
  let k = 0;
  for (const m of mask) k += m;
  return { mask, share: k / mask.length };
}

test("the same seed gives the same field", () => {
  assert.deepEqual(makeField(3, N, fix().shapes), fix().field);
  assert.deepEqual(makeField(3, N, fix().shapes, START), fix().opened);
  assert.notDeepEqual(makeField(4, N, fix().shapes).clouds.slice(0, 20), fix().field.clouds.slice(0, 20));
});

test("the wind is gentle", () => {
  const speed = Math.hypot(fix().field.wind.x, fix().field.wind.y);
  assert.ok(speed >= 2 && speed <= 4, `wind ${speed}`);
});

test("each layer uses its own kinds of shape, and low clouds run north to south", () => {
  let lastY = -1;
  for (const c of fix().opened.clouds) {
    const kind = fix().shapes[c.shape].kind;
    if (c.layer === "low") {
      assert.ok(kind === "heap" || kind === "puff" || kind === "wisp", kind);
      assert.ok(c.y >= lastY, "a nearer cloud is drawn after a farther one");
      lastY = c.y;
    } else assert.equal(kind, "bank");
    assert.ok(c.x >= 0 && c.x < N && c.y >= 0 && c.y < N);
  }
});

test("fewer, bigger clouds: the land stays the star, with clear skies in places and great heaps in others", () => {
  const rand = sampler(99);
  const covers: number[] = [];
  let withHeap = 0, clouds = 0;
  for (let k = 0; k < 300; k++) {
    const rx = Math.floor(rand() * N), ry = Math.floor(rand() * KY * N);
    covers.push(lowCover(fix().field, rx, ry).share);
    const seen = boxes(fix().field, "low", rx, ry);
    clouds += seen.length;
    if (seen.some((b) => fix().shapes[b.c.shape].kind === "heap")) withHeap++;
  }
  const mean = covers.reduce((a, b) => a + b, 0) / covers.length;
  assert.ok(mean >= 0.05 && mean <= 0.16, `mean cover ${mean.toFixed(3)}`);
  assert.ok(covers.filter((c) => c < 0.02).length >= 60, `${covers.filter((c) => c < 0.02).length} clear views of 300`);
  assert.ok(covers.filter((c) => c > 0.2).length >= 20, `${covers.filter((c) => c > 0.2).length} heavy views of 300`);
  assert.ok(Math.max(...covers) <= 0.6, `the heaviest view is ${Math.max(...covers).toFixed(2)} covered`);
  assert.ok(withHeap >= 60 && withHeap <= 200, `${withHeap} views of 300 hold a heap`);
  // Not a scatter of small puffs: a view holds about three clouds, not a dozen.
  assert.ok(clouds / 300 <= 5, `${(clouds / 300).toFixed(1)} low clouds a view`);
});

test("never two banks on one screen", () => {
  const rand = sampler(7);
  for (let k = 0; k < 600; k++) {
    const seen = boxes(fix().field, "bank", Math.floor(rand() * N), Math.floor(rand() * KY * N));
    assert.ok(seen.length <= 1, `${seen.length} banks in one view`);
  }
});

test("about one bank every 1,200–2,400 cells of flight", () => {
  const rand = sampler(21);
  let met = 0, flown = 0;
  for (let f = 0; f < 40; f++) {
    const a = rand() * 2 * Math.PI, dx = Math.cos(a), dy = Math.sin(a);
    let x = rand() * N, y = rand() * N;
    const seen = new Set<Cloud>();
    for (let d = 0; d < 6000; d += 40) {
      for (const b of boxes(fix().field, "bank", Math.floor(x) - W / 2, Math.floor(KY * y) - H / 2)) seen.add(b.c);
      x += 40 * dx;
      y += 40 * dy;
    }
    met += seen.size;
    flown += 6000;
  }
  const every = flown / Math.max(1, met);
  assert.ok(every >= 1200 && every <= 2400, `a bank every ${every.toFixed(0)} cells`);
});

test("drift moves with the wind and wraps cleanly after a million seconds", () => {
  const c = fix().field.clouds[0];
  const a = cloudAt(fix().field, c, 10), b = cloudAt(fix().field, c, 10.5);
  const ring = (d: number) => ((d % N) + 1.5 * N) % N - N / 2;
  assert.ok(Math.abs(ring(b.x - a.x) - 0.5 * fix().field.wind.x) < 1e-6);
  assert.ok(Math.abs(ring(b.y - a.y) - 0.5 * fix().field.wind.y) < 1e-6);
  const t = 1e6, far = cloudAt(fix().field, c, t);
  assert.ok(far.x >= 0 && far.x < N && far.y >= 0 && far.y < N, `${far.x}, ${far.y}`);
  assert.ok(Math.abs(ring(far.x - (c.x + fix().field.wind.x * t))) < 1e-6);
  assert.ok(Math.abs(ring(far.y - (c.y + fix().field.wind.y * t))) < 1e-6);
});

test("the first view has cloud in it: a great heap to seaward, puffs and a streamer, and no bank", () => {
  const { mask, share } = lowCover(fix().opened, OPEN.x, OPEN.y);
  assert.ok(share >= 0.08 && share <= 0.25, `the opening view is ${(100 * share).toFixed(1)} % cloud`);
  const seen = boxes(fix().opened, "low", OPEN.x, OPEN.y);
  const kinds = seen.map((b) => fix().shapes[b.c.shape].kind);
  assert.ok(kinds.includes("heap") && kinds.includes("puff") && kinds.includes("wisp"), kinds.join(" "));
  assert.ok(seen.length >= 4 && seen.length <= 7, `${seen.length} clouds`);
  const heap = seen.find((b) => fix().shapes[b.c.shape].kind === "heap")!;
  const hs = fix().shapes[heap.c.shape];
  assert.ok(hs.w >= 134, `the heap is ${hs.w} wide`);
  // Whole, bar a sliver: it is on the frame, low and to the left, the flier's side of the sea.
  assert.ok(heap.sx >= -30 && heap.sx + hs.w <= W / 2 && heap.sy >= H / 3 && heap.sy + hs.h <= H, `heap at ${heap.sx},${heap.sy}`);
  // The flier, at the centre, and the town to the north-east of it stay clear.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const flier = Math.abs(x - W / 2) <= 30 && Math.abs(y - H / 2) <= 30;
    const town = x >= 170 && x <= 340 && y <= 100;
    if (flier || town) assert.equal(mask[y * W + x], 0, `cloud at ${x},${y}`);
  }
  assert.equal(boxes(fix().opened, "bank", OPEN.x, OPEN.y).length, 0);
  // Without a start the field is the plain one.
  assert.notDeepEqual(fix().opened.clouds, fix().field.clouds);
});

test("a start with a heading sets a second heap ahead, off the first frame, to the right of the flier's line", () => {
  const heading = { dx: 0.96, dy: -0.28 };
  const headed = makeField(3, N, fix().shapes, { ...START, ...heading });
  const key = (c: Cloud) => `${c.shape}:${c.x}:${c.y}`;
  const before = new Set(fix().opened.clouds.map(key));
  const added = headed.clouds.filter((c) => !before.has(key(c)));
  assert.equal(added.length, 1);
  const s = fix().shapes[added[0].shape];
  assert.equal(s.kind, "heap");
  // The first frame is as it was without the heading.
  assert.deepEqual(lowCover(headed, OPEN.x, OPEN.y).mask, lowCover(fix().opened, OPEN.x, OPEN.y).mask);
  assert.ok(!boxes(headed, "low", OPEN.x, OPEN.y).some((b) => b.c === added[0]), "it is off the first frame");
  // Its middle, from the flier at the centre of the frame: 285 px or a little more along the heading on screen, and
  // 80 px to its right.
  const sx = near(Math.round(added[0].x), OPEN.x, N, W) + s.w / 2 - W / 2, sy = near(Math.round(KY * added[0].y) - ALT.low, OPEN.y, KY * N, H) + s.h / 2 - H / 2;
  const hx = heading.dx, hy = KY * heading.dy, len = Math.hypot(hx, hy);
  const along = (sx * hx + sy * hy) / len, right = (-sx * hy + sy * hx) / len;
  assert.ok(along >= 283 && along <= 360 && Math.abs(right - 80) <= 2, `along ${along.toFixed(1)}, right ${right.toFixed(1)}`);
  // The flier's line stays clear of it: the heap's top is below the line where they pass.
  assert.ok(right - s.h / 2 > 20, `the heap's top is ${(right - s.h / 2).toFixed(0)} px from the line`);
});

test("the opening changes the sky only round the start", () => {
  const key = (c: Cloud) => `${c.shape}:${c.x}:${c.y}:${c.layer}`;
  const plain = new Set(fix().field.clouds.map(key));
  const far = (c: Cloud) => {
    const dx = Math.abs(((c.x - START.x + 1.5 * N) % N) - N / 2), dy = Math.abs(((c.y - START.y + 1.5 * N) % N) - N / 2);
    return dx > 900 || dy > 900;
  };
  for (const c of fix().opened.clouds) if (far(c)) assert.ok(plain.has(key(c)), "a far cloud is as it was");
  assert.equal(fix().opened.clouds.filter(far).length, fix().field.clouds.filter(far).length);
});
