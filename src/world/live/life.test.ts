import assert from "node:assert/strict";
import { test } from "node:test";
import { isCanopy, isGrass, MATERIAL as M } from "../look/materials.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { differing, drawn, frameOf, manifest, seaFrame, shot } from "../testing/liveShot.ts";
import { isBeach, isPasture, isRoof, isSea, lifeLayer, LOW, REACH, startledFor, UPLAND, type Placed } from "./life.ts";
import type { Flier, LiveLayer } from "./live.ts";
import { lightOf, matOf } from "./pixel.ts";
import { makeLayers } from "./registry.ts";
import { KITE_EVERY, NET_EVERY, RAINBOW_EVERY, sightsLayer, type Sight } from "./sights.ts";
import { worldRowAt } from "./sprites.ts";
import { GUST_SPEED, windLayer } from "./wind.ts";

const ctx = { seed: manifest.seed, n: manifest.n, sites: manifest.sites };
const palette = buildPalette(MIDDAY);
const W = 400, H = 225;

/** What the life layer places on `view` at time t. */
async function placed(view: string, t: number, flier?: Flier): Promise<Placed[]> {
  const life = lifeLayer(ctx);
  life.log = [];
  drawn(life, await shot(view), t, flier);
  return life.log;
}

test("the registry runs the wind, the life and the sights after the water", () => {
  const names = makeLayers(ctx).map((l) => l.name);
  assert.deepEqual(names, ["water", "wind", "life", "sights"]);
});

test("the same time gives the same frame, whatever was drawn before", async () => {
  const makers: (() => LiveLayer)[] = [() => windLayer(ctx.seed), () => lifeLayer(ctx), () => sightsLayer(ctx)];
  for (const view of ["town", "abbey"]) {
    const s = await shot(view);
    const flier: Flier = { x: s.rect.x + 200, y: (s.rect.y + 130) / 0.8, alt: 30, heading: -Math.PI / 2, speed: 60 };
    for (const make of makers) {
      const a = make(), b = make();
      const first = drawn(a, s, 12.3, flier);
      drawn(a, s, 40.7);
      drawn(a, s, 3.1, flier);
      assert.deepEqual(drawn(a, s, 12.3, flier), first, `${view} ${a.name}: no state carried between frames`);
      assert.deepEqual(drawn(b, s, 12.3, flier), first, `${view} ${a.name}: two layers of one seed agree`);
    }
  }
});

test("another seed places things elsewhere", async () => {
  const s = await shot("abbey");
  const other = { ...ctx, seed: ctx.seed + 1 };
  assert.ok(differing(drawn(windLayer(ctx.seed), s, 5), drawn(windLayer(other.seed), s, 5)) > 0);
  assert.ok(differing(drawn(lifeLayer(ctx), s, 5), drawn(lifeLayer(other), s, 5)) > 0);
});

test("the wind repaints only grass and tree crowns, in their own colours, and never an inked line", async () => {
  const wind = windLayer(ctx.seed);
  for (const view of ["abbey", "town"]) {
    const s = await shot(view);
    const out = drawn(wind, s, 7.5);
    let grass = 0, crowns = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i] === s.out[i]) continue;
      const v = s.bake[i], m = matOf(v), light = lightOf(v);
      assert.ok(light < 64, `${view}: an inked pixel changed at ${i}`);
      if (isGrass[m] === 1) {
        // The same material, one or two tones lighter, shadow kept.
        assert.ok(out[i] === s.palette[(m << 8) | (light + 1)] || out[i] === s.palette[(m << 8) | (light + 2)], `${view}: grass off its ramp at ${i}`);
        assert.ok((light & 15) + 1 <= 15);
        grass++;
      } else {
        assert.equal(isCanopy[m], 1, `${view}: the wind touched material ${m} at ${i}`);
        // The crown's own shading, from the pixel upwind.
        const u = s.bake[i - 1];
        assert.equal(isCanopy[matOf(u)], 1);
        assert.equal(out[i], s.palette[(matOf(u) << 8) | lightOf(u)]);
        crowns++;
      }
    }
    assert.ok(grass > 500, `${view}: gusts show on the grass (${grass})`);
    assert.ok(crowns > 20, `${view}: crowns stir (${crowns})`);
    // Subtle: a gust lies over a small share of the frame.
    assert.ok(grass + crowns < 0.2 * out.length, `${view}: ${grass + crowns} pixels under gusts`);
  }
});

test("gusts travel: the frame changes in a quarter second, a little, and a gust is where it was GUST_SPEED pixels upwind", async () => {
  const wind = windLayer(ctx.seed);
  const s = await shot("abbey");
  const a = drawn(wind, s, 3), b = drawn(wind, s, 3.25);
  const moved = differing(a, b);
  assert.ok(moved > 30, `the wind moves (${moved})`);
  assert.ok(moved < 0.03 * a.length, `and does not shimmer (${moved} pixels in 0.25 s)`);
  // Two frames a pixel-step apart differ only along the gusts' edges; frames within one step are the same.
  assert.equal(differing(drawn(wind, s, 3.001), drawn(wind, s, 3.001 + 1 / GUST_SPEED)) > 0, true);
  assert.equal(differing(drawn(wind, s, 4 / GUST_SPEED + 0.001), drawn(wind, s, 4 / GUST_SPEED + 0.01)), 0);
});

test("small life stands only where it belongs", async () => {
  let sheep = 0, smoke = 0, boats = 0, resting = 0, gulls = 0;
  for (const view of ["start", "town", "abbey"]) {
    const s = await shot(view);
    for (const t of [0, 20, 61.5]) {
      for (const p of await placed(view, t)) {
        if (p.kind === "gull") { gulls++; continue; }
        assert.ok(p.px >= 0 && p.px < W && p.py >= 0 && p.py < H, `${view}: ${p.kind} in the frame`);
        const v = s.bake[p.py * W + p.px], m = matOf(v);
        if (p.kind === "sheep") {
          assert.equal(isPasture[m], 1, `${view}: a sheep on material ${m}`);
          assert.ok(0.8 * worldRowAt(frameOf(s, t), p.px, p.py) - (s.rect.y + p.py) >= UPLAND - 3, `${view}: a sheep on low ground`);
          sheep++;
        } else if (p.kind === "smoke") {
          assert.equal(isRoof[m], 1, `${view}: smoke from material ${m}`);
          smoke++;
        } else if (p.kind === "boat") {
          for (let d = -4; d <= 4; d += 2) assert.equal(isSea[matOf(s.bake[p.py * W + p.px + d])], 1, `${view}: a boat's hull off the sea`);
          boats++;
        } else {
          assert.equal(isBeach[m], 1, `${view}: a gull resting on material ${m}`);
          resting++;
        }
      }
    }
  }
  assert.ok(sheep >= 10, `sheep graze (${sheep})`);
  assert.ok(smoke >= 6, `chimneys smoke (${smoke})`);
  assert.ok(boats >= 2, `boats sail (${boats})`);
  assert.ok(resting >= 1, `gulls rest on the beach (${resting})`);
  assert.ok(gulls >= 12, `gulls wheel over the town (${gulls})`);
});

test("smoke rises only in the town, and gulls wheel only round the town and the lighthouses", async () => {
  assert.equal((await placed("abbey", 3)).filter((p) => p.kind === "smoke" || p.kind === "gull").length, 0);
  assert.ok((await placed("town", 3)).filter((p) => p.kind === "gull").length >= 5);
});

test("the life layer draws only its sprites: nearly all of the frame is left alone", async () => {
  const life = lifeLayer(ctx);
  for (const view of ["start", "town", "abbey"]) {
    const s = await shot(view);
    const changed = differing(drawn(life, s, 9), s.out);
    assert.ok(changed > 20 && changed < 0.012 * s.out.length, `${view}: ${changed} pixels`);
  }
});

test("the life moves between t and t + 0.25 s, and only a little", async () => {
  const life = lifeLayer(ctx);
  for (const view of ["start", "town"]) {
    const s = await shot(view);
    const moved = differing(drawn(life, s, 30), drawn(life, s, 30.25));
    assert.ok(moved > 4, `${view}: something moved (${moved})`);
    assert.ok(moved < 500, `${view}: but the scene is calm (${moved})`);
  }
  // Sheep are slow: nothing on the abbey's pastures moves in a quarter second most of the time, but they do walk.
  const s = await shot("abbey");
  let steps = 0;
  for (let t = 0; t < 40; t += 2) if (differing(drawn(life, s, t), drawn(life, s, t + 2)) > 0) steps++;
  assert.ok(steps >= 3, `sheep walk (${steps} of 20 two-second spans)`);
});

test("a bird is startled when the flier's track comes within reach, low, and settles again", () => {
  const n = ctx.n;
  const north = -Math.PI / 2;
  const flier = (y: number, alt = 20): Flier => ({ x: 1000, y, alt, heading: north, speed: 60 });
  // The bird is at (1010, 2000) on ground 5 up; the flier flies north along x = 1000.
  const tau = (y: number, alt?: number): number => startledFor(flier(y, alt), n, 1010, 2000, 5);
  assert.equal(tau(2000 + REACH + 5), -1, "not yet in reach");
  assert.ok(tau(2000 + REACH - 4) >= 0 && tau(2000 + REACH - 4) < 0.2, "startled as the flier comes within reach");
  assert.ok(tau(2000) > tau(2020), "and longer in the air the further the flier has gone");
  assert.ok(tau(1900) > 2, "still up as it leaves");
  assert.equal(tau(1600), -1, "settled once it is well past");
  assert.equal(tau(2000, 5 + LOW + 1), -1, "a high flier does not disturb it");
  assert.equal(startledFor(flier(2000), n, 1000 + REACH + 1, 2000, 5), -1, "nor one that passes wide");
  assert.equal(startledFor(undefined, n, 1010, 2000, 5), -1, "nor no flier at all");
  // Across the world's seam.
  assert.ok(startledFor({ x: n - 3, y: 10, alt: 20, heading: north, speed: 60 }, n, 4, n - 10, 5) >= 0);
});

test("gulls on the beach lift and scatter when the flier passes low over them", async () => {
  const s = await shot("start");
  const calm = await placed("start", 4);
  const rest = calm.find((p) => p.kind === "gull-resting");
  assert.ok(rest, "a gull rests on the start view's beach");
  const f = frameOf(s, 4);
  const row = worldRowAt(f, rest.px, rest.py), ground = 0.8 * row - (s.rect.y + rest.py);
  // The flier has just passed over the bird, heading north, 15 units over the beach.
  const over: Flier = { x: s.rect.x + rest.px, y: row - 40, alt: ground + 15, heading: -Math.PI / 2, speed: 60 };
  const stirred = await placed("start", 4, over);
  assert.equal(stirred.some((p) => p.kind === "gull-resting" && p.px === rest.px && p.py === rest.py), false, "it has left the sand");
  assert.ok(stirred.some((p) => p.kind === "gull-startled" && p.px === rest.px && p.py === rest.py), "and is in the air");
  const life = lifeLayer(ctx);
  const quiet = drawn(life, s, 4), busy = drawn(life, s, 4, over);
  assert.ok(differing(quiet, busy) > 4, "the frame shows it");
  // Its pixels on the sand are the sand's again, and it is drawn somewhere else.
  const at = rest.py * W + rest.px;
  assert.notEqual(quiet[at], s.out[at]);
  assert.equal(busy[at], s.out[at]);
  // The same flier, high up, leaves the birds be.
  assert.deepEqual(drawn(life, s, 4, { ...over, alt: ground + LOW + 300 }), quiet);
  // And once it is long gone they are back where they were.
  assert.deepEqual(drawn(life, s, 4, { ...over, y: row - 600 }), quiet);
});

test("the wheeling gulls scatter too", async () => {
  const s = await shot("town");
  const life = lifeLayer(ctx);
  life.log = [];
  const quiet = drawn(life, s, 4);
  const gull = life.log.find((p) => p.kind === "gull" && p.px > 40 && p.px < W - 40 && p.py > 40 && p.py < H - 20);
  life.log = null;
  assert.ok(gull);
  // A flier passing under that gull's place in the sky (gulls fly some 42–65 up), at their height.
  const over: Flier = { x: s.rect.x + gull.px, y: (s.rect.y + gull.py + 50) / 0.8 - 30, alt: 50, heading: -Math.PI / 2, speed: 60 };
  assert.ok(differing(quiet, drawn(life, s, 4, over)) > 4);
});

test("boats sail on open sea only, leave a wake on the water's own ramp, and come and go", () => {
  const life = lifeLayer(ctx);
  const town = manifest.sites.find((site) => site.type === "town");
  assert.ok(town);
  // A frame of open sea round the town, as if the land were not there: every boat shows.
  let seen = 0, most = 0;
  const xs = new Set<number>();
  for (let t = 0; t < 240; t += 20) {
    const f = seaFrame(Math.round(town.x) - 200, Math.round(0.8 * town.y) - 112, t, palette, ctx.n, M.sea);
    const sea = f.out[0];
    life.log = [];
    life.draw(f);
    const boats = life.log.filter((p) => p.kind === "boat");
    seen += boats.length;
    if (boats.length > most) most = boats.length;
    for (const b of boats) xs.add(b.px);
    for (let i = 0; i < f.out.length; i++) {
      if (f.out[i] === sea) continue;
      // Not sea-coloured: a boat's own pixels (timber, sail), its wake (the sea at a paler tone), or a gull overhead.
      const c = f.out[i];
      const wake = c === palette[(M.sea << 8) | 0] || c === palette[(M.sea << 8) | 2];
      const boat = boats.some((b) => Math.abs((i % W) - b.px) <= 10 && Math.abs(Math.floor(i / W) - b.py) <= 9);
      const gull = life.log.some((p) => p.kind === "gull" && Math.abs((i % W) - p.px) <= 3 && Math.abs(Math.floor(i / W) - p.py) <= 3);
      assert.ok(wake || boat || gull, `a stray pixel at ${i % W}, ${Math.floor(i / W)}`);
    }
  }
  assert.ok(seen > 12 && most <= 12, `boats on the water (${seen} sightings, ${most} at once)`);
  assert.ok(xs.size > 8, "and they move");
  // On land, none.
  const land = seaFrame(Math.round(town.x) - 200, Math.round(0.8 * town.y) - 112, 20, palette, ctx.n, M.meadowMid);
  life.log = [];
  life.draw(land);
  assert.equal(life.log.filter((p) => p.kind === "boat").length, 0);
});

// ── Sights ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the sights layer shows on a frame of open sea centred on world (x, y) at sea level. */
function sightsOver(x: number, y: number, t: number, material: number = M.sea): { log: Sight[]; changed: number } {
  const sights = sightsLayer(ctx);
  const f = seaFrame(Math.round(x) - 200, Math.round(0.8 * y) - 112, t, palette, ctx.n, material);
  const before = new Uint32Array(f.out);
  sights.log = [];
  sights.draw(f);
  return { log: sights.log, changed: differing(before, f.out) };
}

test("skeins of birds cross the sky: few, always moving, each a V of seven", () => {
  const sights = sightsLayer(ctx);
  const a = sights.skeinsAt(100), b = sights.skeinsAt(100.25);
  assert.ok(a.length >= 12 && a.length <= 40);
  for (let k = 0; k < a.length; k++) {
    const step = Math.hypot(b[k].x - a[k].x, b[k].y - a[k].y);
    assert.ok(step > 1.5 && step < 4, `skein ${k} flies ${step} cells in a quarter second`);
  }
  assert.deepEqual(sightsLayer(ctx).skeinsAt(100), a, "the same for the same seed");
  // Under a skein (it flies 150 up, so it draws 150 pixels up the frame from its place on the sea).
  const here = sightsOver(a[0].x, a[0].y - 150 / 0.8, 100);
  assert.ok(here.log.some((p) => p.kind === "skein" && Math.abs(p.px - 200) <= 2 && Math.abs(p.py - 112) <= 2));
  // Seven birds of four to seven pixels each (and perhaps a fishing boat on the sea below).
  assert.ok(here.changed >= 7 * 4 && here.changed <= 7 * 7 + 60, `seven small birds (${here.changed} pixels)`);
  assert.notEqual(sightsOver(a[0].x, a[0].y - 150 / 0.8, 100.5).changed, 0);
  // Most of the sky is empty: over a hundred places, only a few have a skein in the frame.
  let busy = 0;
  for (let k = 0; k < 100; k++) if (sightsOver(k * 631, k * 977, 100).log.some((p) => p.kind === "skein")) busy++;
  assert.ok(busy < 20, `${busy} of 100 frames have a skein`);
});

test("a rainbow stands for a while, fades in and out, and is gone between times", () => {
  const sights = sightsLayer(ctx);
  let shownFor = 0, bow: { x: number; y: number } | null = null, when = 0;
  for (let t = 0; t < 2 * RAINBOW_EVERY; t += 2) {
    const all = sights.rainbowsAt(t);
    const full = all.find((r) => r.shown === 1);
    if (full && !bow) { bow = full; when = t; }
    if (bow && all.some((r) => r.x === bow?.x && r.y === bow?.y)) shownFor += 2;
  }
  assert.ok(bow, "a rainbow in the first few minutes");
  assert.ok(shownFor >= 30 && shownFor <= 70, `it stands ${shownFor} s`);
  const full = sightsOver(bow.x, bow.y - 40, when);
  assert.ok(full.log.some((p) => p.kind === "rainbow"));
  assert.ok(full.changed > 800, `the bow is drawn (${full.changed} pixels)`);
  // A wash, never a solid colour: every pixel stays close to the sea under it.
  const f = seaFrame(Math.round(bow.x) - 200, Math.round(0.8 * (bow.y - 40)) - 112, when, palette, ctx.n, M.sea);
  const sea = f.out[0];
  sights.draw(f);
  for (let i = 0; i < f.out.length; i++) {
    for (let c = 0; c < 24; c += 8) assert.ok(Math.abs(((f.out[i] >>> c) & 255) - ((sea >>> c) & 255)) < 60);
  }
  // Fading: half a minute later or earlier there is a moment it is fainter, and a time it is gone.
  const fades = sights.rainbowsAt(when - 3).concat(sights.rainbowsAt(when - 6)).filter((r) => r.x === bow?.x && r.shown < 1);
  assert.ok(fades.length > 0, "it eases in");
  let gone = false;
  for (let t = when; t < when + RAINBOW_EVERY; t += 2) if (!sights.rainbowsAt(t).some((r) => r.x === bow?.x && r.y === bow?.y)) gone = true;
  assert.ok(gone, "and goes");
});

test("a fishing boat lies on deep water and shoots its net now and then; never on land or in the shallows", () => {
  let fishers = 0, nets = 0, without = 0;
  for (let k = 0; k < 6; k++) {
    for (let t = 0; t < NET_EVERY; t += 10) {
      const { log } = sightsOver(300 + k * 700, 500 + k * 450, t);
      if (log.some((p) => p.kind === "fisher")) fishers++;
      if (log.some((p) => p.kind === "net")) nets++;
      else if (log.some((p) => p.kind === "fisher")) without++;
    }
  }
  assert.ok(fishers > 0, "fishing boats on the open sea");
  assert.ok(nets > 0 && without > 0, `nets out some of the time (${nets} with, ${without} without)`);
  for (let k = 0; k < 6; k++) {
    assert.equal(sightsOver(300 + k * 700, 500 + k * 450, 30, M.meadowMid).log.filter((p) => p.kind === "fisher").length, 0);
  }
  // Shallow water (shore tone under 6): none.
  const sights = sightsLayer(ctx);
  const f = seaFrame(100, 288, 30, palette, ctx.n, M.sea);
  for (let i = 0; i < f.bake.length; i++) f.bake[i] = (f.bake[i] & ~0xff00) | (3 << 8);
  sights.log = [];
  sights.draw(f);
  assert.equal(sights.log.length, 0);
});

test("a kite flies over the town on its clock, and is down between flights", async () => {
  const s = await shot("town");
  const sights = sightsLayer(ctx);
  let up = 0, down = 0;
  for (let t = 0; t < KITE_EVERY; t += 5) {
    sights.log = [];
    const out = drawn(sights, s, t);
    if (sights.log.some((p) => p.kind === "kite")) {
      up++;
      assert.ok(differing(out, s.out) >= 12);
    } else {
      down++;
      assert.equal(differing(out, s.out), 0, "nothing of it shows");
    }
  }
  assert.ok(up >= 8 && down >= 8, `up ${up}, down ${down} of ${KITE_EVERY / 5}`);
  // No kite away from the town.
  const abbey = await shot("abbey");
  for (let t = 0; t < KITE_EVERY; t += 15) assert.equal(differing(drawn(sights, abbey, t), abbey.out), 0);
});

// ── Cost ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("wind, life and sights together stay well inside the frame budget on the town view", async () => {
  const s = await shot("town");
  const layers = [windLayer(ctx.seed), lifeLayer(ctx), sightsLayer(ctx)];
  const f = frameOf(s, 0, { x: s.rect.x + 200, y: (s.rect.y + 130) / 0.8, alt: 30, heading: -Math.PI / 2, speed: 60 });
  const ms: number[] = [];
  for (let k = 0; k < 240; k++) {
    f.t = k / 60;
    const t0 = performance.now();
    for (const layer of layers) layer.draw(f);
    ms.push(performance.now() - t0);
  }
  const warm = ms.slice(60).sort((a, b) => a - b);
  const p95 = warm[Math.floor(warm.length * 0.95)];
  // The aim is 1.2 ms in Node; the bound here is slack enough for a loaded machine.
  assert.ok(p95 < 2.5, `p95 ${p95.toFixed(2)} ms, median ${warm[warm.length >> 1].toFixed(2)} ms`);
  console.log(`live layers (wind + life + sights), town view: median ${warm[warm.length >> 1].toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`);
});
