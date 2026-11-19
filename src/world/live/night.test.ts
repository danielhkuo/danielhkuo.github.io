import assert from "node:assert/strict";
import { test } from "node:test";
import { MATERIAL as M } from "../look/materials.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { airOf, NOON_AIR } from "../sky/air.ts";
import { PHASES } from "../sky/clock.ts";
import { readShipped } from "../pack/shipped.ts";
import { FIXTURE_WORLD } from "../testing/fixtureWorld.ts";
import { differing, frameOf, manifest, seaFrame, shot } from "../testing/liveShot.ts";
import type { Structure } from "../gen/built.ts";
import type { LiveFrame } from "./live.ts";
import { nightLayer, nightLights, windowLit } from "./night.ts";
import { matOf } from "./pixel.ts";

const shipped = await readShipped(FIXTURE_WORLD);
const structures = shipped.world.built?.built.structures ?? [];
const lights = nightLights(structures, manifest.n);
const NIGHT = airOf(PHASES.night, 0.25);
const EVENING = airOf(0.82, 0.25);

function at(f: LiveFrame, air = NIGHT): LiveFrame {
  return { ...f, air };
}

test("the lit windows are the glass of lived-in buildings: roofed, and never the shade under an arch", () => {
  assert.ok(lights.windows.bx.length > 300, `${lights.windows.bx.length} windows`);
  assert.equal(lights.lamps.length, manifest.sites.filter((s) => s.type === "lighthouse").length, "a lamp to each lighthouse");
  // Every window's pixel lies in the world's bake space.
  for (let k = 0; k < lights.windows.bx.length; k++) {
    assert.ok(lights.windows.bx[k] >= 0 && lights.windows.bx[k] < manifest.n);
    assert.ok(lights.windows.by[k] >= 0 && lights.windows.by[k] < 0.8 * manifest.n);
  }
  // A roofless structure (a ruin, a bridge) lights nothing, and an arch's shade is not glass.
  const roofless = structures.filter((s) => !Array.from(s.mat).some((m) => m === M.roofSlate || m === M.roofTile || m === M.roofLead || m === M.copper));
  const none = nightLights(roofless, manifest.n);
  assert.equal(none.windows.bx.length, 0);
});

test("a window lights as the dusk deepens, burns into the night, and most are out by the small hours", () => {
  const keys = Array.from(lights.windows.key);
  const share = (time: number, dark: number): number => keys.filter((k) => windowLit(k, time, dark) > 0).length / keys.length;
  assert.equal(share(0.5, 0), 0, "none by day");
  assert.ok(share(0.76, 0.3) < share(0.8, 0.8), "more light as it darkens");
  assert.ok(share(0.85, 1) > 0.5, `evening ${share(0.85, 1)}`);
  assert.ok(share(0.06, 1) < share(0.85, 1) * 0.5, "the small hours are dark");
  assert.ok(share(0.06, 1) > 0.05, "a few burn all night");
  assert.ok(share(0.21, 0.8) > share(0.1, 1), "early risers light again before dawn");
  for (const k of keys.slice(0, 200)) for (const t of [0, 0.2, 0.8, 0.9]) {
    const v = windowLit(k, t, 1);
    assert.ok(v >= 0 && v <= 1);
  }
});

test("by day the night draws nothing; at night windows light only where the bake shows them", async () => {
  const s = await shot("town");
  const layer = nightLayer(manifest.seed, lights);
  const day = frameOf(s, 3);
  layer.draw(at(day, NOON_AIR));
  assert.equal(differing(day.out, s.out), 0, "nothing by day");
  const plain = frameOf(s, 3);
  layer.draw(plain);
  assert.equal(differing(plain.out, s.out), 0, "nothing without air");

  const night = at(frameOf(s, 3), EVENING);
  layer.draw(night);
  let windows = 0;
  for (let i = 0; i < night.out.length; i++) if (night.out[i] !== s.out[i] && matOf(s.bake[i]) === M.opening) windows++;
  assert.ok(windows > 30, `${windows} lit windows in the town`);
  // The same moment draws the same night.
  const again = at(frameOf(s, 3), EVENING);
  nightLayer(manifest.seed, lights).draw(again);
  assert.equal(differing(again.out, night.out), 0);
});

test("stars show on open water at night and nowhere on land", () => {
  const palette = buildPalette(MIDDAY);
  const sea = at(seaFrame(1000, 800, 5, palette, manifest.n, M.sea));
  const before = new Uint32Array(sea.out);
  nightLayer(manifest.seed).draw(sea);
  const stars = differing(sea.out, before);
  assert.ok(stars > 100 && stars < 2000, `${stars} stars on the sea`);
  const land = at(seaFrame(1000, 800, 5, palette, manifest.n, M.meadowMid));
  const dry = new Uint32Array(land.out);
  nightLayer(manifest.seed).draw(land);
  assert.equal(differing(land.out, dry), 0);
});

test("a lighthouse's beams sweep round it at night", () => {
  const palette = buildPalette(MIDDAY);
  const lamp = lights.lamps[0];
  const rx = Math.floor(lamp.bx) - 200, ry = Math.floor(lamp.by) - 112;
  const a = at(seaFrame(rx, ry, 1, palette, manifest.n, M.sea));
  const b = at(seaFrame(rx, ry, 3.5, palette, manifest.n, M.sea));
  const layer = nightLayer(manifest.seed, lights);
  const before = new Uint32Array(a.out);
  layer.draw(a);
  layer.draw(b);
  assert.ok(differing(a.out, before) > 300, "the beams light the sea round the lamp");
  assert.ok(differing(a.out, b.out) > 300, "and move");
});

/** A small roofed house, 8 × 4 cells, with `marks` on its walls. */
function house(marks: number[]): Structure {
  const cells = 8 * 4;
  return {
    x: 100, y: 100, w: 8, h: 4, base: 0,
    top: new Float32Array(cells).fill(6), mat: new Uint8Array(cells).fill(M.roofSlate), tone: new Uint8Array(cells), paint: new Uint8Array(cells),
    marks,
  };
}

test("marks that touch on a wall are one window and light together; a windmill's hub and the marsh house's dark glass never light", () => {
  // A tall window of three marks, and a single one two columns along.
  const two = nightLights([house([2, 3, 2, M.opening, 110, 2, 3, 3, M.opening, 110, 2, 3, 4, M.opening, 110, 5, 3, 3, M.opening, 110])], 1024).windows;
  assert.equal(two.key.length, 4);
  assert.equal(new Set(two.key).size, 2, "two windows");
  const sizes = [...new Set(two.key)].map((key) => two.key.filter((k) => k === key).length).sort();
  assert.deepEqual(sizes, [1, 3], "the tall window is three marks with one hash");

  const mill = nightLights([house([4, 3, 5, M.opening, 100, 5, 3, 5, M.sailcloth, 190, 2, 2, 3, M.opening, 110])], 1024).windows;
  assert.equal(mill.key.length, 1, "the hub among the sails is no window");

  const marsh = nightLights([house([2, 3, 3, M.lantern, 220, 2, 3, 4, M.lantern, 200, 5, 3, 3, M.opening, 104])], 1024);
  assert.equal(marsh.windows.key.length, 0, "the marsh house's other glass stays dark");
  assert.equal(marsh.lanterns.key.length, 2, "its one window is lit");
});

test("nothing pops: a window's light moves a little for a little more dusk", () => {
  for (const k of Array.from(lights.windows.key).slice(0, 400)) {
    for (let dark = 0; dark < 1; dark += 0.01) {
      assert.ok(Math.abs(windowLit(k, 0.78, dark + 0.01) - windowLit(k, 0.78, dark)) <= 0.11);
    }
  }
});

test("cloud, rain and mist put the stars out", () => {
  const palette = buildPalette(MIDDAY);
  for (const veil of [{ overcast: 1 }, { rain: 1 }, { mist: 1 }, { cloud: 1 }]) {
    const sea = at(seaFrame(1000, 800, 5, palette, manifest.n, M.sea), { ...NIGHT, ...veil });
    const before = new Uint32Array(sea.out);
    nightLayer(manifest.seed).draw(sea);
    assert.equal(differing(sea.out, before), 0);
  }
});
