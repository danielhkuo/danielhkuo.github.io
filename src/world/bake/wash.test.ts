import assert from "node:assert/strict";
import { test } from "node:test";
import { F_CANOPY, F_QUIET, AUX_ROCK, type Look } from "./cells.ts";
import { drawFalls, FALL_TONE, FOAM_TONE } from "./chunk.ts";
import { evenSnowEdge, INK_SOFT, inkCliffs, inkCrests, inkOcclusion, inkSnowEdge, newPainted } from "./ink.ts";
import { layWashes, pools, STEP_NONE, WASH_HIGH, WASH_KEEP, WASH_LOW, WASH_TONES, washOf, washTone } from "./wash.ts";

const M_LAND = 1, M_SEA = 2, M_RIVER = 3, M_BUILT = 4, M_SNOW = 5, M_ROCK = 6;

function look(): Look {
  const isWater = new Uint8Array(256), isStill = new Uint8Array(256), isBuilt = new Uint8Array(256), isSnow = new Uint8Array(256), isRock = new Uint8Array(256);
  isWater[M_SEA] = isWater[M_RIVER] = 1;
  isStill[M_SEA] = 1;
  isBuilt[M_BUILT] = 1;
  isSnow[M_SNOW] = 1;
  isRock[M_ROCK] = 1;
  return { cover: () => M_LAND, scatter: () => null, isWater, isCanopy: new Uint8Array(256), palette: new Uint32Array(65536), isStill, isBuilt, isSnow, isRock };
}

test("light is laid as three washes: flat ground stays where it was, each wash is nearly one tone, and the tone never runs backwards", () => {
  assert.equal(washTone(0.5, WASH_KEEP), 0.5);
  let last = -1;
  const spread = [[1, 0], [1, 0], [1, 0]];
  for (let v = 0; v <= 255; v++) {
    const l = v / 255, t = washTone(l, WASH_KEEP);
    assert.ok(t >= last - 1e-9, `tone runs backwards at ${l}`);
    last = t;
    const s = washOf(l);
    // Clear of the bands where two washes blend.
    if (Math.abs(l - WASH_LOW) < 0.03 || Math.abs(l - WASH_HIGH) < 0.03) continue;
    spread[s][0] = Math.min(spread[s][0], t);
    spread[s][1] = Math.max(spread[s][1], t);
  }
  for (let s = 0; s < 3; s++) {
    assert.ok(spread[s][1] - spread[s][0] < 0.13, `wash ${s} spans ${spread[s][1] - spread[s][0]}`);
    assert.ok(spread[s][0] <= WASH_TONES[s] && spread[s][1] >= WASH_TONES[s]);
  }
  // And the washes stand well apart.
  assert.ok(spread[1][0] - spread[0][1] > 0.1 && spread[2][0] - spread[1][1] > 0.1);
});

test("washes are laid on land only; pigment pools on the last pixel of a wash that ends crisply against a lighter one", () => {
  const p = newPainted(0, 0, 8, 3);
  p.mat.fill(M_LAND);
  // Row 1: shade, shade, light, light, then a slow rise through the mid wash, water and a wall.
  const row = [60, 60, 200, 200, 120, 135, 128, 128];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) p.light[r * 8 + c] = row[c];
  for (let r = 0; r < 3; r++) { p.mat[r * 8 + 6] = M_SEA; p.mat[r * 8 + 7] = M_BUILT; }
  layWashes(p, look());
  assert.deepEqual([...p.step.subarray(8, 16)], [0, 0, 2, 2, 1, 1, STEP_NONE, STEP_NONE]);
  assert.equal(p.light[8 + 7], 128, "a built thing keeps its tone");
  assert.equal(pools(p, 8), false);
  assert.equal(pools(p, 8 + 1), true, "the shade wash pools against the light");
  assert.equal(pools(p, 8 + 2), false, "the lighter wash does not");
  assert.equal(pools(p, 8 + 4), true, "the mid wash pools under the light one");
  assert.equal(pools(p, 8 + 5), false, "nothing pools against water");
  p.flags[8 + 1] = F_CANOPY;
  assert.equal(pools(p, 8 + 1), false, "nor on a crown");
});

test("ground under turf is inked only over a real break; rock and snow at any; the weight follows the break", () => {
  const bare = new Uint8Array(256);
  bare[M_ROCK] = 1;
  const p = newPainted(0, 0, 6, 3);
  p.mat.fill(M_LAND);
  p.hidden.fill(6, 6, 12);
  const jumps = [3, 9, 20, 3, 12, 30];
  for (let c = 0; c < 6; c++) { p.jump[6 + c] = jumps[c]; if (c >= 3) p.mat[6 + c] = M_ROCK; }
  inkOcclusion(p, bare);
  assert.deepEqual([...p.ink.subarray(6, 12)], [0, 1, 2, 1, 2, 3]);
});

test("a skyline is inked where the ground turns from light to shade within a few pixels, high up; a round crest takes none", () => {
  const W = 40, H = 16;
  const make = (band: number, height: number) => {
    const p = newPainted(0, 0, W, H);
    p.mat.fill(M_LAND);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c;
      p.y[i] = 100 + r;
      p.height[i] = height;
      p.light[i] = r < 6 ? 210 : r < 6 + band ? 128 : 50;
    }
    layWashes(p, look());
    inkCrests(p);
    let on = 0;
    for (let c = 4; c < W - 4; c++) {
      for (let r = 0; r < H; r++) if (r !== 6 + band) assert.equal(p.ink[r * W + c], 0, `ink off the crest at ${c},${r}`);
      if (p.ink[(6 + band) * W + c] === INK_SOFT) on++;
    }
    return on / (W - 8);
  };
  const sharp = make(1, 80);
  assert.ok(sharp > 0.6 && sharp < 1, `a sharp crest is a broken line (${sharp})`);
  assert.equal(make(6, 80), 0, "a round crest");
  assert.equal(make(1, 10), 0, "a low one");
});

test("a snowfield's lower edge against rock takes a soft, broken line; its teeth are evened first", () => {
  const W = 48, H = 12, l = look();
  const p = newPainted(0, 0, W, H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c;
    p.y[i] = 100 + r;
    // Snow above row 6, rock below; every fourth column the snow hangs two pixels lower, a comb.
    const snow = r < 6 || (c % 4 === 0 && r < 8);
    p.mat[i] = snow ? M_SNOW : M_ROCK;
    p.aux[i] = snow ? 0 : AUX_ROCK;
  }
  evenSnowEdge(p, l.isSnow as Uint8Array);
  for (let c = 4; c < W - 4; c++) for (let r = 0; r < H; r++) assert.equal(p.mat[r * W + c], r < 6 ? M_SNOW : M_ROCK, `tooth at ${c},${r}`);
  inkSnowEdge(p, l.isSnow as Uint8Array);
  let on = 0;
  for (let c = 4; c < W - 4; c++) if (p.ink[6 * W + c] === INK_SOFT) on++;
  assert.ok(on > 0.4 * (W - 8) && on < W - 8, `the edge is a broken line (${on})`);
  for (let i = 0; i < W * H; i++) if (p.mat[i] === M_SNOW) assert.equal(p.ink[i], 0, "snow stays clean");
});

test("a stream over a wall is a fall: one pixel at the lip, widening, pale water and cream foam, with foam at its foot", () => {
  const W = 9, H = 20, l = look();
  const p = newPainted(0, 0, W, H);
  const mask = new Uint8Array(65536).fill(100);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c;
    p.mat[i] = r >= 16 ? M_SEA : M_ROCK;
    p.aux[i] = r >= 16 ? 5 : AUX_ROCK;
    p.y[i] = r < 4 ? 100 + r : r < 16 ? 104 : 105 + r;
    if (r >= 4 && r < 16) { p.wall[i] = r - 4; p.span[i] = 12; }
  }
  // The stream's cell is column 4 of the wall.
  for (let r = 4; r < 16; r++) { p.mat[r * W + 4] = M_RIVER; p.aux[r * W + 4] = 10; p.flags[r * W + 4] = F_QUIET; }
  drawFalls(p, l, mask);
  const width = (r: number): number => { let n = 0; for (let c = 0; c < W; c++) if (p.mat[r * W + c] === M_RIVER) n++; return n; };
  assert.equal(width(5), 1, "a pixel wide at the lip");
  let widest = 0;
  for (let r = 6; r < 16; r++) {
    widest = Math.max(widest, width(r));
    for (let c = 0; c < W; c++) if (p.mat[r * W + c] === M_RIVER) {
      const t = p.aux[r * W + c];
      assert.ok(t === FOAM_TONE || t === FALL_TONE || t === FALL_TONE - 2, `fall tone ${t}`);
      assert.ok(c >= 3 && c <= 5, "three pixels at most");
    }
  }
  assert.equal(widest, 3);
  assert.equal(p.aux[16 * W + 4], 0, "foam on the sea at its foot");
  assert.equal(p.aux[19 * W + 4], 5, "and none further out");
});

test("a wall under a band of rock that already carries a line takes no second lip", () => {
  const W = 24, H = 40;
  const p = newPainted(0, 0, W, H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c;
    p.mat[i] = r < 10 ? M_LAND : M_ROCK;
    p.y[i] = 100 + Math.min(r, 20);
    p.height[i] = 30;
    // Rock from row 10: a bench to row 19, then one cell drawn as a wall.
    if (r >= 10) p.aux[i] = AUX_ROCK;
    if (r >= 20) { p.wall[i] = r - 20; p.span[i] = 12; }
  }
  const bare = new Uint8Array(256);
  bare[M_ROCK] = 1;
  const lone = Uint8Array.from(p.ink);
  inkCliffs(p, new Uint8Array(256), bare);
  let lips = 0;
  for (let c = 4; c < W - 4; c++) for (let r = 16; r < 24; r++) if (p.ink[r * W + c] !== 0) lips++;
  assert.ok(lips >= W - 8, "the wall's lip is inked when nothing runs above it");
  p.ink.set(lone);
  for (let c = 0; c < W; c++) p.ink[10 * W + c] = INK_SOFT;
  inkCliffs(p, new Uint8Array(256), bare);
  for (let c = 4; c < W - 4; c++) for (let r = 12; r < 30; r++) assert.equal(p.ink[r * W + c], 0, `a second line at ${c},${r}`);
});
