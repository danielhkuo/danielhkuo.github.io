import assert from "node:assert/strict";
import { test } from "node:test";
import { MATERIAL as M } from "../look/materials.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { airOf, NOON_AIR } from "../sky/air.ts";
import { PHASES } from "../sky/clock.ts";
import { parseWeather } from "../sky/weather.ts";
import { land, manifest, seaFrame } from "../testing/liveShot.ts";
import { RAINBOW_EVERY, sightsLayer } from "./sights.ts";

const ctx = { seed: manifest.seed, n: manifest.n, sites: manifest.sites, land };
const palette = buildPalette(MIDDAY);

test("a rainbow needs the sun: it stands by day, never at night or in mist", () => {
  const sights = sightsLayer(ctx);
  let bow: { x: number; y: number } | null = null, when = 0;
  for (let t = 0; t < 2 * RAINBOW_EVERY && !bow; t += 2) {
    const full = sights.rainbowsAt(t).find((r) => r.shown === 1);
    if (full) { bow = full; when = t; }
  }
  assert.ok(bow);
  const kinds = (air: ReturnType<typeof airOf> | undefined): string[] => {
    const layer = sightsLayer(ctx);
    const f = seaFrame(Math.round(bow.x) - 200, Math.round(0.8 * (bow.y - 40)) - 112, when, palette, ctx.n, M.sea);
    layer.log = [];
    layer.draw(air ? { ...f, air } : f);
    return layer.log.map((p) => p.kind);
  };
  assert.ok(kinds(undefined).includes("rainbow"));
  assert.ok(kinds(NOON_AIR).includes("rainbow"));
  assert.ok(!kinds(airOf(PHASES.night, 0.25)).includes("rainbow"));
  assert.ok(!kinds(airOf(0.5, 0.25, parseWeather("mist") ?? undefined)).includes("rainbow"));
});

test("the kite flies on fair days only: not at night and not in the rain", () => {
  const town = manifest.sites.find((s) => s.type === "town");
  assert.ok(town);
  const kites = (air: ReturnType<typeof airOf>): number => {
    let seen = 0;
    for (let t = 0; t < 600; t += 7) {
      const layer = sightsLayer({ ...ctx, forceSights: true });
      const f = seaFrame(town.x - 200, Math.round(0.8 * town.y) - 150, t, palette, ctx.n, M.meadowMid);
      layer.log = [];
      layer.draw({ ...f, air });
      if (layer.log.some((p) => p.kind === "kite")) seen++;
    }
    return seen;
  };
  assert.ok(kites(NOON_AIR) > 0, "a kite by day");
  assert.equal(kites(airOf(PHASES.night, 0.25)), 0);
  assert.equal(kites(airOf(0.5, 0.25, parseWeather("rain") ?? undefined)), 0);
});
