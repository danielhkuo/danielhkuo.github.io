import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ViewRect } from "../render/compose.ts";
import { BOOST, BRAKE, CRUISE, TURN, type FlightState } from "../runtime/flight.ts";
import { REST_SWING } from "./body.ts";
import { createDragon } from "./index.ts";
import type { Land } from "./parts.ts";
import { LACQUER } from "./look.ts";
import { RIVER_REACH } from "./river.ts";
import { windAmount } from "./wind.ts";

const W = 400, H = 225, N = 1280, GREY = 0xff808080, SHADE = 0xff535353;
/** One dragon now (the owner chose A); the loops below keep their shape so another could be added. */
const DRAGON_IDS = ["a"] as const;
type DragonId = (typeof DRAGON_IDS)[number];
const REACH: Record<DragonId, number> = { a: RIVER_REACH };
/** Length along the heading, pixels: least and most. */
const LENGTH: Record<DragonId, [number, number]> = { a: [60, 90] };

/** The flier at (500, 500), 30 up, at the middle of the frame. */
const rect: ViewRect = { x: 500 - 200, y: Math.floor(0.8 * 500 - 30) - 112, w: W, h: H };
const flat: Land = { depthAt: (_px, py) => (rect.y + py) / 0.8, groundHeight: () => 0 };

/** The dragon after flying straight along `heading` for 240 frames at `speed`, drawn over `land`; `turn` bends the path. */
function flown(id: DragonId, heading: number, land: Land, turn = 0, bank = 0, speed = CRUISE): Uint32Array {
  const dragon = createDragon(N);
  let s: FlightState = { x: 0, y: 0, heading, speed, alt: 30, bank };
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
/** Wind is pale air blended over what lies under it: neither the ground, nor its shadow, nor any colour of the dragon. */
const PAINT = new Set<number>(Object.values(LACQUER));
const isWind = (v: number) => isBody(v) && !PAINT.has(v);
const windIn = (out: Uint32Array) => out.reduce((count, v) => count + (isWind(v) ? 1 : 0), 0);

test("the dragon is drawn, with a shadow, in its reserved colours", () => {
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

test("the dragon is deterministic: the same flight draws the same pixels", () => {
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

test("the dragon stays within its reach of the flier, and is its stated length", () => {
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

test("there is no wind at cruising speed or below", () => {
  assert.equal(windAmount(CRUISE), 0);
  assert.equal(windAmount(CRUISE * BRAKE), 0);
  assert.equal(windAmount(0), 0);
  for (const speed of [CRUISE, CRUISE * BRAKE, CRUISE * 1.02]) {
    for (const heading of [0, 1, 2.5, 4]) assert.equal(windIn(flown("a", heading, flat, 0, 0, speed)), 0, `${speed} at ${heading}`);
  }
});

test("a boost draws wind: pale streaks along the body, more of them the faster it flies", () => {
  assert.equal(windAmount(CRUISE * BOOST), 1);
  for (const heading of [0, 1, 2.5, 4]) {
    const full = windIn(flown("a", heading, flat, 0, 0, CRUISE * BOOST));
    const part = windIn(flown("a", heading, flat, 0, 0, CRUISE * 1.25));
    assert.ok(full > 40, `at ${heading}: ${full} pixels of wind`);
    assert.ok(part > 0 && part < full, `at ${heading}: ${part} pixels part-way, ${full} at full boost`);
    // Wind is only ever lighter than what it lies over.
    for (const v of flown("a", heading, flat, 0, 0, CRUISE * BOOST)) if (isWind(v)) assert.ok((v & 255) > 0x53, `at ${heading}`);
  }
});

test("the wind is deterministic, and stays within the dragon's reach", () => {
  for (const heading of [0, 0.7, Math.PI / 2, 2.5, 4, 5.2]) {
    const out = flown("a", heading, flat, 0.002, 0.5, CRUISE * BOOST);
    assert.deepEqual(out, flown("a", heading, flat, 0.002, 0.5, CRUISE * BOOST), `at ${heading}`);
    let far = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (isBody(out[y * W + x])) far = Math.max(far, Math.hypot(x - 200, y - 112));
    }
    assert.ok(far <= RIVER_REACH, `at ${heading}: reaches ${far.toFixed(1)}`);
  }
});

test("the dragon draws in under 0.2 ms a frame, boosting or not", () => {
  for (const speed of [CRUISE, CRUISE * BOOST]) {
    const id = "a";
    const dragon = createDragon(N);
    let s: FlightState = { x: 0, y: 500, heading: 0.6, speed, alt: 30, bank: 0 };
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
    console.log(`dragon ${id} at ×${speed / CRUISE}: ${best.toFixed(3)} ms a frame`);
    assert.ok(best < 0.2, `${id}: ${best.toFixed(3)} ms`);
  }
});

test("A has a face from every heading: bright eyes with ink beside them", () => {
  for (let h = 0; h < 16; h++) {
    const out = flown("a", (h * Math.PI) / 8, flat);
    let eyes = 0;
    // The crown is two rows above the flier's own row.
    for (let y = 104; y <= 116; y++) for (let x = 194; x <= 206; x++) {
      if (out[y * W + x] !== LACQUER.tip || Math.hypot(x - 200, y - 110) > 4.5) continue;
      const i = y * W + x;
      if (out[i - 1] === LACQUER.ink || out[i + 1] === LACQUER.ink || out[i - W] === LACQUER.ink || out[i + W] === LACQUER.ink) eyes++;
    }
    assert.ok(eyes >= 2, `heading ${h}: ${eyes} eye pixels`);
  }
});

test("A rolls into its turns: the gold belly shows on the outside", () => {
  // A full-bank turn at cruising speed, ending heading east at the middle of the frame. A right turn's outside is
  // then the north, so the belly's gold lies up the frame from the body's middle; for a left turn, down it.
  const side = (bank: number): number => {
    const dragon = createDragon(N), rate = (bank * TURN) / 60, path: [number, number, number][] = [];
    let x = 0, y = 0;
    for (let k = 0; k <= 240; k++) {
      const heading = rate * (k - 240);
      x += Math.cos(heading);
      y += Math.sin(heading);
      path.push([x, y, heading]);
    }
    let s: FlightState = { x: 0, y: 0, heading: 0, speed: CRUISE, alt: 30, bank };
    for (const [px, py, heading] of path) {
      s = { ...s, x: 500 + px - x, y: 500 + py - y, heading };
      dragon.step(s, 1 / 60);
    }
    const out = new Uint32Array(W * H).fill(GREY);
    dragon.draw(out, rect, s, flat);
    // Along the body behind the mane and ahead of the fin: gold above the column's middle, less gold below it.
    let above = 0;
    for (let px = 135; px < 180; px++) {
      let top = H, bottom = -1;
      for (let py = 0; py < H; py++) if (isBody(out[py * W + px])) {
        if (py < top) top = py;
        bottom = py;
      }
      for (let py = top; py <= bottom; py++) if (out[py * W + px] === LACQUER.belly) above += py * 2 < top + bottom ? 1 : -1;
    }
    return above;
  };
  const right = side(1), left = side(-1);
  assert.ok(right > 10 && left < -10, `right ${right}, left ${left}`);
});

test("at rest the coil breathes: the wave's swing settles to a fifth, and widens again in flight", () => {
  const dragon = createDragon(N);
  const s: FlightState = { x: 500, y: 500, heading: 0, speed: 0, alt: 30, bank: 0 };
  assert.equal(dragon.pose.swing, 1);
  for (let i = 0; i < 240; i++) dragon.step(s, 1 / 60, 1);
  assert.ok(Math.abs(dragon.pose.swing - REST_SWING) < 0.01, `swing ${dragon.pose.swing}`);
  for (let i = 0; i < 240; i++) dragon.step({ ...s, speed: CRUISE }, 1 / 60, 0);
  assert.ok(Math.abs(dragon.pose.swing - 1) < 0.01, `swing ${dragon.pose.swing}`);
});

test("a resting dragon stirs less from moment to moment than one that swings at its full width", () => {
  const moved = (rest: number): number => {
    const dragon = createDragon(N);
    for (let k = 240; k >= 0; k--) dragon.step({ x: 500 - k, y: 500, heading: 0, speed: CRUISE, alt: 30, bank: 0 }, 1 / 60, rest);
    const s: FlightState = { x: 500, y: 500, heading: 0, speed: 0, alt: 30, bank: 0 };
    for (let i = 0; i < 120; i++) dragon.step(s, 1 / 60, rest);
    const a = new Uint32Array(W * H).fill(GREY);
    dragon.draw(a, rect, s, flat);
    for (let i = 0; i < 70; i++) dragon.step(s, 1 / 60, rest);
    const b = new Uint32Array(W * H).fill(GREY);
    dragon.draw(b, rect, s, flat);
    let differ = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differ++;
    return differ;
  };
  const resting = moved(1), swinging = moved(0);
  assert.ok(resting < swinging * 0.5, `resting ${resting} px, swinging ${swinging} px`);
});
