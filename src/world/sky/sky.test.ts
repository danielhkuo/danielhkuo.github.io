import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewRect } from "../render/compose.ts";
import { BANK_ALT, cloudAt, LOW_ALT, type Cloud, type SkyField } from "./field.ts";
import type { CloudShape } from "./shapes.ts";
import { createSky, drawClouds, drawShadows } from "./sky.ts";
import type { Sprite } from "./sprite.ts";
import { STYLES } from "./styles.ts";

const N = 1280, W = 400, H = 225, GREY = 0xff808080, WHITE = 0xffffffff, BLACK = 0xff000000;

function solid(w: number, h: number, rgba = WHITE, alpha = 255): Sprite {
  return { w, h, rgba: new Uint32Array(w * h).fill(rgba), alpha: new Uint8Array(w * h).fill(alpha) };
}
function field(...clouds: Cloud[]): SkyField {
  return { n: N, clouds, wind: { x: 0, y: 0 } };
}
const rect = (x = 0, y = 0): ViewRect => ({ x, y, w: W, h: H });
const frame = () => new Uint32Array(W * H).fill(GREY);
/** A cloud whose sprite's top-left lands at screen (sx, sy) in rect(0, 0); 0.8·y lands on whole rows for y = 5k. */
const at = (sx: number, sy: number, layer: Cloud["layer"], alt: number): Cloud => ({ shape: 0, x: sx, y: (sy + alt) / 0.8, layer });

test("a low cloud is drawn by the low layer only", () => {
  const f = field(at(190, 105, "low", LOW_ALT));
  const out = frame();
  drawClouds(out, rect(), f, [solid(20, 10)], 0, "bank", 255);
  assert.ok(out.every((v) => v === GREY), "not by the bank layer");
  drawClouds(out, rect(), f, [solid(20, 10)], 0, "low", 255);
  assert.equal(out[110 * W + 200], WHITE);
  assert.equal(out[105 * W + 190], WHITE, "its top-left corner");
  assert.equal(out[104 * W + 190], GREY);
  assert.equal(out[105 * W + 189], GREY);
  assert.equal(out[114 * W + 209], WHITE, "its bottom-right corner");
  assert.equal(out[115 * W + 209], GREY);
});

test("a bank is lifted by its own height", () => {
  const f = field(at(100, 60, "bank", BANK_ALT));
  const out = frame();
  drawClouds(out, rect(), f, [solid(20, 10)], 0, "bank", 255);
  assert.equal(out[60 * W + 100], WHITE);
  assert.equal(out[59 * W + 100], GREY);
});

test("a cloud across the seam is drawn on both sides of it", () => {
  // Spans x 1270–1289, which wraps to 1270–1279 and 0–9.
  const c: Cloud = { shape: 0, x: 1270, y: 250, layer: "low" };
  const row = Math.round(0.8 * 250) - LOW_ALT;
  const left = frame();
  drawClouds(left, rect(-5, 0), field(c), [solid(20, 10)], 0, "low", 255);
  for (let x = 0; x < 15; x++) assert.equal(left[row * W + x], WHITE, `col ${x} at rect.x −5`);
  assert.equal(left[row * W + 15], GREY);
  const right = frame();
  drawClouds(right, rect(1260, 0), field(c), [solid(20, 10)], 0, "low", 255);
  for (let x = 10; x < 30; x++) assert.equal(right[row * W + x], WHITE, `col ${x} at rect.x 1260`);
  // Bake rows wrap every 0.8·n = 1024: a cloud near the bottom of the world shows above a view just past the top.
  const low: Cloud = { shape: 0, x: 50, y: 1270, layer: "low" };
  const top = frame();
  drawClouds(top, rect(0, -60), field(low), [solid(20, 10)], 0, "low", 255);
  const sy = Math.round(0.8 * 1270) - LOW_ALT - 1024 + 60;
  assert.equal(top[sy * W + 55], WHITE, `row ${sy} with rect.y < 0`);
});

test("clouds clip at the frame's edge instead of wrapping onto its other side", () => {
  const out = frame();
  drawClouds(out, rect(), field(at(390, 100, "low", LOW_ALT)), [solid(20, 10)], 0, "low", 255);
  for (let x = 390; x < 400; x++) assert.equal(out[100 * W + x], WHITE);
  for (let x = 0; x < 12; x++) assert.equal(out[101 * W + x], GREY, `col ${x} of the next row`);
});

test("alpha blends, and zero alpha leaves a pixel alone", () => {
  const f = field(at(100, 100, "low", LOW_ALT));
  const none = frame();
  drawClouds(none, rect(), f, [solid(20, 10, WHITE, 0)], 0, "low", 255);
  drawClouds(none, rect(), f, [solid(20, 10)], 0, "low", 0);
  assert.ok(none.every((v) => v === GREY));
  const half = frame();
  drawClouds(half, rect(), f, [solid(20, 10)], 0, "low", 128);
  const r = half[105 * W + 110] & 255;
  assert.ok(Math.abs(r - (0x80 + (0xff - 0x80) * 128 / 255)) <= 1.01, `red ${r}`);
  assert.equal(half[105 * W + 110] >>> 24, 255, "the frame stays opaque");
});

test("clouds drift with the wind", () => {
  const f: SkyField = { ...field(at(100, 100, "low", LOW_ALT)), wind: { x: 10, y: 0 } };
  const out = frame();
  drawClouds(out, rect(), f, [solid(20, 10)], 2, "low", 255);
  assert.equal(out[100 * W + 120], WHITE, "20 cells east after 2 s");
  assert.equal(out[100 * W + 105], GREY);
  assert.equal(cloudAt(f, f.clouds[0], 2).x, 120);
});

/** A shape that is all cloud, with a solid shadow box at (dx, dy) from its top-left. */
function slab(w: number, h: number, dx: number, dy: number): CloudShape {
  return {
    kind: "heap", w, h, cover: new Uint8Array(w * h).fill(1), light: new Float32Array(w * h), rim: new Uint8Array(w * h),
    shadow: { w, h: 4, dx, dy, mask: new Uint8Array(w * 4).fill(1) },
  };
}

test("a cloud's shadow falls on the ground under it, south-east by the sun's slope, and only dims", () => {
  // The sprite's top-left is at (100, 60); on the ground that is row 60 + LOW_ALT, and the sun moves it 0.354 · alt
  // east and 0.8 · 0.354 · alt down the screen.
  const f = field(at(100, 60, "low", LOW_ALT));
  const out = frame();
  drawShadows(out, rect(), f, [slab(20, 10, 2, 8)], 0, "low", [128, 192, 255]);
  const sx = 100 + 2 + Math.round(0.354 * LOW_ALT), sy = 60 + LOW_ALT + 8 + Math.round(0.8 * 0.354 * LOW_ALT);
  const dim = out[sy * W + sx];
  assert.deepEqual([dim & 255, (dim >>> 8) & 255, (dim >>> 16) & 255, dim >>> 24], [0x40, 0x60, 0x7f, 255]);
  assert.equal(out[(sy + 3) * W + sx + 19], dim, "its far corner");
  assert.equal(out[(sy - 1) * W + sx], GREY);
  assert.equal(out[sy * W + sx - 1], GREY);
  assert.equal(out[(sy + 4) * W + sx], GREY);
  let changed = 0;
  for (const v of out) if (v !== GREY) changed++;
  assert.equal(changed, 20 * 4);
  drawShadows(out, rect(), f, [slab(20, 10, 2, 8)], 0, "bank", [128, 192, 255]);
  assert.equal(changed, out.filter((v) => v !== GREY).length, "not by another layer");
});

test("a shadow across the seam is drawn on both sides of it", () => {
  const c: Cloud = { shape: 0, x: 1270, y: 250, layer: "low" };
  const row = Math.round(0.8 * 250) + Math.round(0.8 * 0.354 * LOW_ALT);
  const left = frame();
  drawShadows(left, rect(-5, 0), field(c), [slab(20, 10, -Math.round(0.354 * LOW_ALT), 0)], 0, "low", [0, 0, 0]);
  for (let x = 0; x < 15; x++) assert.equal(left[row * W + x], BLACK, `col ${x} at rect.x −5`);
  assert.equal(left[row * W + 15], GREY);
});

test("the sky draws clouds below the flier, and veils the flier inside a bank without changing the bank", () => {
  const sky = createSky(3, 6400, STYLES.cumulus);
  // A view with a bank in it, found from the field.
  const bank = sky.field.clouds.find((c) => c.layer === "bank")!;
  const shape = sky.shapes[bank.shape];
  const p = cloudAt(sky.field, bank, 0);
  const r = rect(Math.round(p.x) - 60, Math.round(0.8 * p.y) - BANK_ALT - 20);
  const below = frame();
  sky.draw(below, r, 0, "below");
  assert.ok(below.some((v) => v !== GREY), "the bank is drawn in the below pass");
  // A pixel well inside the bank.
  let px = -1;
  for (let y = 40; y < shape.h - 20 && px < 0; y++) for (let x = 40; x < shape.w - 40 && px < 0; x++) {
    if (shape.cover[y * shape.w + x] && shape.cover[(y + 12) * shape.w + x + 12] && shape.cover[(y - 12) * shape.w + x - 12]) px = (20 + y) * W + 60 + x;
  }
  assert.ok(px >= 0);
  const cloud = below[px];
  assert.notEqual(cloud, GREY);
  // The veil alone changes nothing: the bank over itself is the bank.
  const again = below.slice();
  sky.draw(again, r, 0, "above");
  assert.deepEqual(again, below);
  // A flier drawn there shows faintly: between its own colour and the cloud's.
  const RED = 0xff2b3fcf;
  const withFlier = below.slice();
  withFlier[px] = RED;
  sky.draw(withFlier, r, 0, "above");
  const seen = withFlier[px], g = (v: number) => (v >>> 8) & 255;
  assert.ok(g(seen) > g(RED) + 40 && g(seen) < g(cloud) - 25, `green ${g(seen)} between ${g(RED)} and ${g(cloud)}`);
  assert.equal(seen >>> 24, 255);
  // Outside any bank the flier is untouched.
  const clear = frame();
  clear[5] = RED;
  sky.draw(clear, rect(Math.round(p.x) + 2000, Math.round(0.8 * p.y) + 1500), 0, "above");
  assert.ok(clear[5] === RED || sky.field.clouds.some((c) => c.layer === "bank" && c !== bank));
});

test("the sky is the same for every visitor at the same moment", () => {
  const a = createSky(3, 6400, STYLES.cumulus, { x: 5726, y: 3784 }), b = createSky(3, 6400, STYLES.cumulus, { x: 5726, y: 3784 });
  const r = rect(5526, 2897);
  for (const t of [0, 12.5, 4000]) {
    const fa = frame(), fb = frame();
    a.draw(fa, r, t, "below"); a.draw(fa, r, t, "above");
    b.draw(fb, r, t, "below"); b.draw(fb, r, t, "above");
    assert.deepEqual(fa, fb, `t = ${t}`);
  }
  const f0 = frame(), f1 = frame();
  a.draw(f0, r, 0, "below");
  a.draw(f1, r, 30, "below");
  assert.ok(f0.some((v) => v !== GREY), "the opening view has cloud");
  assert.notDeepEqual(f0, f1, "and it drifts");
});

test("the busiest view draws in under 3 ms in Node", () => {
  const sky = createSky(3, 6400, STYLES.cumulus);
  let best = rect(), most = -1;
  for (let k = 0; k < 120; k++) {
    const r = rect((k * 977) % 6400, (k * 613) % 5120);
    const out = frame();
    sky.draw(out, r, 0, "below");
    let changed = 0;
    for (const v of out) if (v !== GREY) changed++;
    if (changed > most) { most = changed; best = r; }
  }
  const out = frame(), times: number[] = [];
  for (let k = 0; k < 50; k++) {
    const t0 = performance.now();
    sky.draw(out, best, k / 60, "below");
    sky.draw(out, best, k / 60, "above");
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[25] < 3, `median ${times[25].toFixed(2)} ms`);
});

test("the sky in noon's air is the sky as painted; weather clouds gather only as the weather builds", async () => {
  const { NOON_AIR, airOf } = await import("./air.ts");
  const { parseWeather } = await import("./weather.ts");
  const plain = createSky(3, N, STYLES.cumulus);
  const noon = createSky(3, N, STYLES.cumulus);
  noon.setAir(NOON_AIR);
  const covered = (sky: ReturnType<typeof createSky>, x: number, y: number): number => {
    const out = frame();
    sky.draw(out, rect(x, y), 0, "below");
    return out.filter((v) => v !== GREY).length;
  };
  let busy = 0;
  for (let k = 0; k < 12; k++) {
    const x = k * 97, y = k * 61;
    const a = frame(), b = frame();
    plain.draw(a, rect(x, y), 0, "below");
    noon.draw(b, rect(x, y), 0, "below");
    assert.deepEqual(a, b, "noon is the sky as painted");
    const built = createSky(3, N, STYLES.cumulus);
    built.setAir(airOf(0.5, 0.25, parseWeather("clouds") ?? undefined));
    busy += covered(built, x, y) - covered(plain, x, y);
  }
  assert.ok(busy > 12 * W * H * 0.08, `the built sky covers more: ${busy}`);
});

test("at night the clouds go dark and blue, and before rain they go grey", async () => {
  const { airOf } = await import("./air.ts");
  const { parseWeather } = await import("./weather.ts");
  const { rampIn } = await import("./sky.ts");
  const { oklabOf } = await import("../render/palette.ts");
  const noon = rampIn(airOf(0.5, 0.25));
  const night = rampIn(airOf(0.92, 0.25));
  const storm = rampIn(airOf(0.5, 0.25, parseWeather("clouds") ?? undefined));
  for (let k = 0; k < noon.tones.length; k++) {
    const d = oklabOf(noon.tones[k]), n = oklabOf(night.tones[k]), s = oklabOf(storm.tones[k]);
    assert.ok(n[0] < d[0] - 0.25 && n[2] < -0.01, `tone ${k} at night`);
    assert.ok(s[0] < d[0] - 0.02 && Math.hypot(s[1], s[2]) < Math.hypot(d[1], d[2]) + 0.01, `tone ${k} before rain`);
  }
});

test("a low sun burns on a cloud's rim and crown over violet undersides; the moon leaves it blue-grey", async () => {
  const { rampIn } = await import("./sky.ts");
  const { airOf } = await import("./air.ts");
  const { oklabOf } = await import("../render/palette.ts");
  for (const time of [0.25, 0.75]) {
    const ramp = rampIn(airOf(time, 0.25));
    const rim = oklabOf(ramp.rim), crown = oklabOf(ramp.tones[0]), under = oklabOf(ramp.tones[ramp.tones.length - 1]);
    assert.ok(rim[1] > 0.04 && rim[2] > 0 && crown[1] > 0.03, `rim ${rim} crown ${crown} at ${time}`);
    assert.ok(under[2] < -0.03 && under[0] < rim[0] - 0.2, `underside ${under} at ${time}`);
  }
  const golden = oklabOf(rampIn(airOf(0.705, 0.25)).rim);
  assert.ok(golden[2] > 0.05 && golden[2] > golden[1], `golden rim ${golden}`);
  const night = rampIn(airOf(0, 0.25));
  for (const c of [night.rim, ...night.tones]) {
    const [, a, b] = oklabOf(c);
    assert.ok(b < -0.02 && Math.hypot(a, b) < 0.09, `a cloud at night ${[a, b]}`);
  }
  assert.ok(oklabOf(night.rim)[0] > oklabOf(night.tones[4])[0] + 0.1);
});
