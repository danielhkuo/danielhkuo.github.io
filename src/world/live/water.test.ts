import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FALL_TONE, FOAM_TONE } from "../bake/chunk.ts";
import { namedViews, renderStrip } from "../cli/live.ts";
import { readShipped } from "../pack/shipped.ts";
import { MATERIAL as M } from "../look/materials.ts";
import type { Manifest } from "../pack/manifest.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import type { LiveFrame, LiveLayer } from "./live.ts";
import { matOf, toneOf } from "./pixel.ts";
import { makeLayers } from "./registry.ts";
import { TALL_FALL, WAVE_PERIOD, waterLayer } from "./water.ts";

const root = process.cwd();
const { world, flight, manifest: shippedManifest } = await readShipped(join(root, "public/world"));
const manifest = shippedManifest as unknown as Manifest;
const mask = new Uint8Array(readFileSync(join(root, "public/world/bluenoise.bin")));

const isWater = (v: number): boolean => matOf(v) >= M.sea && matOf(v) <= M.river;

/** A frame of the shipped world as the layers are handed it: the composed land, its bake pixels and the rect. */
interface Shot {
  out: Uint32Array;
  bake: Uint32Array;
  rect: LiveFrame["rect"];
  palette: LiveFrame["palette"];
  n: number;
}

const shots = new Map<string, Shot>();
async function shot(view: string, dx = 0): Promise<Shot> {
  const key = `${view}:${dx}`;
  const hit = shots.get(key);
  if (hit) return hit;
  const place = (await namedViews(world, manifest))[view];
  let got: Shot | null = null;
  const grab: LiveLayer = {
    name: "grab",
    draw: (f) => { got = { out: new Uint32Array(f.out), bake: new Uint32Array(f.bake), rect: { ...f.rect }, palette: f.palette, n: f.n }; },
  };
  await renderStrip({ world, flight, manifest, mask, x: place.x + dx, y: place.y, times: [0], layers: [grab], clouds: null });
  assert.ok(got, "the view drew");
  shots.set(key, got);
  return got;
}

/** The water layer's frame of `s` at time t. */
function draw(layer: LiveLayer, s: Shot, t: number): Uint32Array {
  const out = new Uint32Array(s.out);
  layer.draw({ out, bake: s.bake, rect: s.rect, t, palette: s.palette, n: s.n });
  return out;
}

function differing(a: Uint32Array, b: Uint32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

test("the registry runs the water", () => {
  const layers = makeLayers({ seed: manifest.seed, n: manifest.n, sites: manifest.sites });
  assert.ok(layers.some((l) => l.name === "water"));
});

test("the same time gives the same frame, whatever was drawn before", async () => {
  for (const view of ["start", "falls"]) {
    const s = await shot(view);
    const a = waterLayer(manifest.seed), b = waterLayer(manifest.seed);
    const first = draw(a, s, 12.3);
    draw(a, s, 40.7);
    draw(a, s, 3.1);
    assert.deepEqual(draw(a, s, 12.3), first, `${view}: no state carried between frames`);
    assert.deepEqual(draw(b, s, 12.3), first, `${view}: two layers of one seed agree`);
  }
});

test("only water is repainted, save the spray at a tall fall's foot, and only in the water's own colours", async () => {
  const layer = waterLayer(manifest.seed);
  for (const view of ["start", "falls", "river", "sea", "town"]) {
    const s = await shot(view);
    const w = s.rect.w, h = s.rect.h;
    // Every colour water can take: its four materials at every tone and shadow depth, without ink.
    const house = new Set<number>();
    for (const m of [M.sea, M.seaClear, M.lake, M.river]) for (let l = 0; l < 64; l++) house.add(s.palette[(m << 8) | l]);
    const fall = (i: number): boolean => matOf(s.bake[i]) === M.river && toneOf(s.bake[i]) >= FALL_TONE;
    let onLand = 0;
    for (const t of [0, 1.3, 2.6, 3.9, 7.7]) {
      const out = draw(layer, s, t);
      for (let i = 0; i < out.length; i++) {
        if (out[i] === s.out[i]) continue;
        assert.ok(house.has(out[i]), `${view} t=${t}: pixel ${i} is in the water's colours`);
        if (isWater(s.bake[i])) continue;
        onLand++;
        assert.notEqual(matOf(s.bake[i]), M.none, `${view}: nothing over the haze`);
        // Spray: a fall of TALL_FALL pixels or more ends within a few pixels.
        const x = i % w, y = (i - x) / w;
        let tallest = 0;
        for (let dy = -4; dy <= 2; dy++) for (let dx = -4; dx <= 4; dx++) {
          const fx = x + dx, fy = y + dy;
          if (fx < 0 || fx >= w || fy < 0 || fy >= h || !fall(fy * w + fx)) continue;
          let run = 0;
          for (let k = fy, gap = 0; k >= 0 && gap <= 2; k--) {
            if (fall(k * w + fx)) { run = fy - k + 1; gap = 0; } else gap++;
          }
          if (run > tallest) tallest = run;
        }
        assert.ok(tallest >= TALL_FALL, `${view} t=${t}: land pixel ${x},${y} repainted away from a tall fall`);
      }
    }
    if (view !== "falls") assert.equal(onLand, 0, `${view}: no spray without a tall fall`);
  }
});

test("the water moves: sea, river and fall each change within a quarter second", async () => {
  const layer = waterLayer(manifest.seed);
  const sea = await shot("start");
  const kinds: [string, Shot, (v: number) => boolean][] = [
    ["sea", sea, (v) => matOf(v) === M.sea || matOf(v) === M.seaClear],
    ["river", await shot("river"), (v) => matOf(v) === M.river && toneOf(v) < 8],
    ["fall", await shot("falls"), (v) => matOf(v) === M.river && toneOf(v) >= FALL_TONE],
  ];
  for (const [name, s, pick] of kinds) {
    let moved = 0, total = 0;
    for (const t of [0, 2, 5.5]) {
      const a = draw(layer, s, t), b = draw(layer, s, t + 0.25);
      for (let i = 0; i < a.length; i++) {
        if (!pick(s.bake[i])) continue;
        total++;
        if (a[i] !== b[i]) moved++;
      }
    }
    assert.ok(total > 50, `${name}: the view has ${total} such pixels`);
    assert.ok(moved > 0, `${name}: something moved`);
  }
  // Foam does reach the beaches: over one wave, some sea pixel turns the river's foam colour.
  const foam = sea.palette[(M.river << 8) | FOAM_TONE];
  let foamed = 0;
  for (let k = 0; k < 8; k++) {
    const out = draw(layer, sea, (k / 8) * WAVE_PERIOD);
    for (let i = 0; i < out.length; i++) if (out[i] === foam && matOf(sea.bake[i]) === M.sea) foamed++;
  }
  assert.ok(foamed > 40, `foam on the sea over a wave: ${foamed}`);
});

test("calm: from one 60 fps frame to the next, few pixels change, and the land is never the minority", async () => {
  const layer = waterLayer(manifest.seed);
  for (const view of ["start", "sea", "falls"]) {
    const s = await shot(view);
    let water = 0;
    for (let i = 0; i < s.bake.length; i++) if (isWater(s.bake[i])) water++;
    let worst = 0, total = 0;
    const frames = 120;
    let prev = draw(layer, s, 20);
    for (let k = 1; k <= frames; k++) {
      const next = draw(layer, s, 20 + k / 60);
      const d = differing(prev, next);
      if (d > worst) worst = d;
      total += d;
      prev = next;
    }
    // Under 1 water pixel in 60 a frame at the worst step, and on average under 1 in 300: no strobing.
    assert.ok(worst < water / 60 + 40, `${view}: worst frame changed ${worst} of ${water} water pixels`);
    assert.ok(total / frames < water / 300 + 12, `${view}: ${(total / frames).toFixed(1)} of ${water} water pixels change a frame`);
    // At any moment most of the water is as it was baked.
    assert.ok(differing(prev, s.out) < water * 0.12 + 150, `${view}: ${differing(prev, s.out)} of ${water} water pixels repainted`);
  }
});

test("the patterns are fixed to the world: a view three pixels east is the same picture, shifted", async () => {
  const layer = waterLayer(manifest.seed);
  const a = await shot("start"), b = await shot("start", 3);
  assert.equal(b.rect.x, a.rect.x + 3);
  const w = a.rect.w, h = a.rect.h;
  const pa = draw(layer, a, 9.4), pb = draw(layer, b, 9.4);
  // Away from the frame's edge, where the shore distance cannot see the same shore.
  const edge = 20;
  for (let y = edge; y < h - edge; y++) for (let x = edge + 3; x < w - edge; x++) {
    if (pa[y * w + x] !== pb[y * w + x - 3]) assert.fail(`pixel ${x},${y} differs between the views`);
  }
});

test("a hill standing in front of the sea is not a shore; sand at the sea's own depth is", () => {
  const palette = buildPalette(MIDDAY);
  const w = 48, h = 24;
  const px = (m: number, tone: number, row8: number): number => (m | (tone << 8) | (row8 << 16)) >>> 0;
  const frame = (landRow8: (y: number) => number): { bake: Uint32Array; base: Uint32Array } => {
    const bake = new Uint32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      // Sea above, sand below row 16; level water gains ten eighths of a world row with each pixel.
      bake[y * w + x] = y < 16 ? px(M.sea, 3, 100 + y * 10) : px(M.sand, 9, landRow8(y));
    }
    const base = new Uint32Array(w * h);
    for (let i = 0; i < base.length; i++) base[i] = palette[bake[i] & 0xffff];
    return { bake, base };
  };
  const foamOver = (f: { bake: Uint32Array; base: Uint32Array }): number => {
    const layer = waterLayer(7);
    const foam = palette[(M.river << 8) | FOAM_TONE];
    let hits = 0;
    for (let k = 0; k < 16; k++) {
      const out = new Uint32Array(f.base);
      layer.draw({ out, bake: f.bake, rect: { x: 0, y: 0, w, h }, t: (k / 16) * WAVE_PERIOD * 9, palette, n: 1280 });
      for (let i = 0; i < out.length; i++) if (out[i] === foam) hits++;
    }
    return hits;
  };
  const beach = foamOver(frame((y) => 100 + y * 10));
  const hill = foamOver(frame((y) => 100 + y * 10 + 400));
  assert.ok(beach > 60, `foam on the beach: ${beach}`);
  assert.equal(hill, 0, "no foam behind a hill");
});

test("cost: the water is under 2.5 ms a frame (p95) on the start bay and on open sea", async () => {
  const layer = waterLayer(manifest.seed);
  for (const view of ["start", "sea"]) {
    const s = await shot(view);
    const out = new Uint32Array(s.out.length);
    const f: LiveFrame = { out, bake: s.bake, rect: s.rect, t: 0, palette: s.palette, n: s.n };
    const times: number[] = [];
    for (let k = 0; k < 360; k++) {
      out.set(s.out);
      f.t = k / 60;
      const t0 = performance.now();
      layer.draw(f);
      const ms = performance.now() - t0;
      if (k >= 60) times.push(ms);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    assert.ok(p95 < 2.5, `${view}: p95 ${p95.toFixed(2)} ms, median ${times[times.length >> 1].toFixed(2)} ms`);
  }
});
