import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ViewRect } from "../render/compose.ts";
import { CRUISE, type FlightState } from "../runtime/flight.ts";
import { createDragon, dragonFrom, DRAGON_IDS, type DragonId } from "./index.ts";
import type { Land } from "./parts.ts";
import { RIVER_REACH } from "./river.ts";
import { WINGED_REACH } from "./winged.ts";
import { WYRM_REACH } from "./wyrm.ts";

const W = 400, H = 225, N = 1280, GREY = 0xff808080, SHADE = 0xff535353;
const REACH: Record<DragonId, number> = { a: RIVER_REACH, "a-ivory": RIVER_REACH, b: WINGED_REACH, c: WYRM_REACH };
/** Length along the heading, pixels: least and most. */
const LENGTH: Record<DragonId, [number, number]> = { a: [60, 90], "a-ivory": [60, 90], b: [30, 50], c: [20, 34] };

/** The flier at (500, 500), 30 up, at the middle of the frame. */
const rect: ViewRect = { x: 500 - 200, y: Math.floor(0.8 * 500 - 30) - 112, w: W, h: H };
const flat: Land = { depthAt: (_px, py) => (rect.y + py) / 0.8, groundHeight: () => 0 };

/** The study after flying straight along `heading` for 240 frames, drawn over `land`; `turn` bends the path. */
function flown(id: DragonId, heading: number, land: Land, turn = 0): Uint32Array {
  const dragon = createDragon(id, N);
  let s: FlightState = { x: 0, y: 0, heading, speed: CRUISE, alt: 30, bank: 0 };
  for (let k = 240; k >= 0; k--) {
    const h = heading - turn * k;
    s = { ...s, heading: h, x: 500 - Math.cos(heading) * k + turn * k * k * 0.3, y: 500 - Math.sin(heading) * k };
    dragon.step(s, 1 / 60);
  }
  const out = new Uint32Array(W * H).fill(GREY);
  dragon.draw(out, rect, s, land);
  return out;
}

const isBody = (v: number) => v !== GREY && v !== SHADE;

test("?dragon= names a study, and anything else leaves the kite", () => {
  for (const id of DRAGON_IDS) assert.equal(dragonFrom(id), id);
  for (const v of [null, undefined, "", "d", "A", "ivory"]) assert.equal(dragonFrom(v), null);
});

test("each study is drawn, with a shadow, in its reserved colours", () => {
  for (const id of DRAGON_IDS) {
    const out = flown(id, 0, flat);
    let body = 0, shade = 0, red = 0;
    for (const v of out) {
      if (v === SHADE) shade++;
      else if (v !== GREY) {
        body++;
        if ((v & 255) > 150 && ((v >>> 16) & 255) < 110) red++;
      }
    }
    assert.ok(body > 150, `${id}: ${body} pixels`);
    assert.ok(shade > 60, `${id}: a shadow of ${shade} pixels`);
    assert.ok(red > 40, `${id}: vermilion or gold, ${red} pixels`);
  }
});

test("each study is deterministic: the same flight draws the same pixels", () => {
  for (const id of DRAGON_IDS) {
    for (const heading of [0, 0.7, Math.PI / 2, 4]) {
      assert.deepEqual(flown(id, heading, flat, 0.002), flown(id, heading, flat, 0.002), `${id} at ${heading}`);
    }
  }
  const dir = fileURLToPath(new URL("./", import.meta.url));
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    assert.doesNotMatch(readFileSync(join(dir, name), "utf8"), /Math\.random|Date\b|performance\.now/, name);
  }
});

test("land nearer the viewer hides each study, and its shadow", () => {
  for (const id of DRAGON_IDS) {
    const out = flown(id, 0.4, { depthAt: () => 1e6, groundHeight: () => 0 });
    assert.ok(out.every((v) => v === GREY), id);
  }
});

test("a ridge across the frame hides only what is behind it", () => {
  // Land in the frame's western half stands nearer the viewer than anything flying there.
  const ridge: Land = { depthAt: (px, py) => (px < 180 ? 1e6 : (rect.y + py) / 0.8), groundHeight: () => 0 };
  for (const id of DRAGON_IDS) {
    const out = flown(id, 0, ridge), open = flown(id, 0, flat);
    let west = 0, east = 0, same = true;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = out[y * W + x];
      if (x < 180) west += v === GREY ? 0 : 1;
      else {
        east += isBody(v) ? 1 : 0;
        if (isBody(v) && v !== open[y * W + x]) same = false;
      }
    }
    assert.equal(west, 0, `${id}: nothing over the ridge`);
    assert.ok(east > 100, `${id}: the rest shows`);
    assert.ok(same, `${id}: and is drawn as in the open`);
  }
});

test("each study stays within its reach of the flier, and is its stated length", () => {
  for (const id of DRAGON_IDS) {
    for (const heading of [0, 1, Math.PI / 2, 2.5, Math.PI, 4, 5.2]) {
      const out = flown(id, heading, flat);
      let far = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!isBody(out[y * W + x])) continue;
        const d = Math.hypot(x - 200, y - 112);
        if (d > far) far = d;
      }
      assert.ok(far <= REACH[id], `${id} at ${heading}: reaches ${far.toFixed(1)}`);
    }
    const out = flown(id, 0, flat);
    let x0 = W, x1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!isBody(out[y * W + x])) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
    const length = x1 - x0 + 1;
    assert.ok(length >= LENGTH[id][0] && length <= LENGTH[id][1], `${id}: ${length} pixels long`);
  }
});

test("each study draws in under 0.3 ms a frame", () => {
  for (const id of DRAGON_IDS) {
    const dragon = createDragon(id, N);
    let s: FlightState = { x: 0, y: 500, heading: 0.6, speed: CRUISE, alt: 30, bank: 0 };
    for (let k = 240; k >= 0; k--) {
      s = { ...s, x: 500 - Math.cos(0.6) * k, y: 500 - Math.sin(0.6) * k };
      dragon.step(s, 1 / 60);
    }
    const out = new Uint32Array(W * H).fill(GREY);
    // Every wing position is built before the clock starts.
    for (let i = 0; i < 400; i++) {
      dragon.step(s, 1 / 60);
      dragon.draw(out, rect, s, flat);
    }
    let best = Infinity;
    for (let round = 0; round < 5; round++) {
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) {
        dragon.step(s, 1 / 60);
        dragon.draw(out, rect, s, flat);
      }
      best = Math.min(best, (performance.now() - t0) / 200);
    }
    console.log(`dragon ${id}: ${best.toFixed(3)} ms a frame`);
    assert.ok(best < 0.3, `${id}: ${best.toFixed(3)} ms`);
  }
});
