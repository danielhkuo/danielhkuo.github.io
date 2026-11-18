import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudAt, LOW_ALT, BANK_ALT, makeField, type Cloud, type SkyField } from "./field.ts";
import { makeShapes, SHAPE_COUNTS, type CloudShape } from "./shapes.ts";

const N = 6400, KY = 0.8, W = 400, H = 225;
interface Fix { shapes: CloudShape[]; field: SkyField; withHigh: SkyField }
let memo: Fix | null = null;
/** Built on first use, so the test runner can list these tests before the field exists. */
function fix(): Fix {
  if (!memo) {
    const shapes = makeShapes(3, SHAPE_COUNTS);
    memo = { shapes, field: makeField(3, N, shapes, false), withHigh: makeField(3, N, shapes, true) };
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
  if (d > span + 300) d -= period;
  return d;
}

/** Screen boxes of a field's clouds of one layer in a view at t = 0. */
function boxes(f: SkyField, layer: Cloud["layer"], rx: number, ry: number) {
  const alt = layer === "bank" ? BANK_ALT : LOW_ALT;
  const out: { sx: number; sy: number; c: Cloud }[] = [];
  for (const c of f.clouds) {
    if (c.layer !== layer) continue;
    const s = fix().shapes[c.shape];
    const p = cloudAt(f, c, 0);
    const sx = near(Math.round(p.x), rx, N, W);
    const sy = near(Math.round(KY * p.y) - alt, ry, KY * N, H);
    if (sx + s.w > 0 && sx < W && sy + s.h > 0 && sy < H) out.push({ sx, sy, c });
  }
  return out;
}

/** Share of a view's pixels under low cloud (cover > 0.5). */
function lowCover(rx: number, ry: number): number {
  const mask = new Uint8Array(W * H);
  for (const { sx, sy, c } of boxes(fix().field, "low", rx, ry)) {
    const s = fix().shapes[c.shape];
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const px = sx + (c.flip ? s.w - 1 - x : x), py = sy + y;
      if (px >= 0 && px < W && py >= 0 && py < H && s.cover[y * s.w + x] > 0.5) mask[py * W + px] = 1;
    }
  }
  let k = 0;
  for (const m of mask) k += m;
  return k / mask.length;
}

test("the same seed gives the same field", () => {
  assert.deepEqual(makeField(3, N, fix().shapes, false), fix().field);
  assert.notDeepEqual(makeField(4, N, fix().shapes, false).clouds.slice(0, 20), fix().field.clouds.slice(0, 20));
});

test("the wind is gentle and the high streaks run faster", () => {
  const speed = Math.hypot(fix().field.wind.x, fix().field.wind.y);
  assert.ok(speed >= 2 && speed <= 4, `wind ${speed}`);
  assert.ok(Math.hypot(fix().withHigh.highWind.x, fix().withHigh.highWind.y) >= 1.5 * Math.hypot(fix().withHigh.wind.x, fix().withHigh.wind.y));
});

test("each layer uses its own kinds of shape, and the high layer only when asked", () => {
  for (const c of fix().withHigh.clouds) {
    const kind = fix().shapes[c.shape].kind;
    if (c.layer === "low") assert.ok(kind === "heap" || kind === "wisp", kind);
    if (c.layer === "bank") assert.equal(kind, "bank");
    if (c.layer === "high") assert.equal(kind, "streak");
  }
  assert.ok(fix().field.clouds.every((c) => c.layer !== "high"));
  assert.ok(fix().withHigh.clouds.some((c) => c.layer === "high"));
  for (const c of fix().field.clouds) assert.ok(c.x >= 0 && c.x < N && c.y >= 0 && c.y < N);
});

test("low cloud covers 15–35 % of a view on average, with clear and overcast regions", () => {
  const rand = sampler(99);
  const covers: number[] = [];
  for (let k = 0; k < 200; k++) covers.push(lowCover(Math.floor(rand() * N), Math.floor(rand() * KY * N)));
  const mean = covers.reduce((a, b) => a + b, 0) / covers.length;
  assert.ok(mean >= 0.15 && mean <= 0.35, `mean cover ${mean}`);
  assert.ok(covers.filter((c) => c < 0.05).length >= 20, `${covers.filter((c) => c < 0.05).length} clear views`);
  assert.ok(covers.filter((c) => c > 0.4).length >= 20, `${covers.filter((c) => c > 0.4).length} overcast views`);
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
  const s = fix().withHigh.clouds.find((q) => q.layer === "high")!;
  const h0 = cloudAt(fix().withHigh, s, 0), h1 = cloudAt(fix().withHigh, s, 1);
  assert.ok(Math.abs(ring(h1.x - h0.x) - fix().withHigh.highWind.x) < 1e-6, "high streaks ride the high wind");
});
