import assert from "node:assert/strict";
import { test } from "node:test";
import { CREAM } from "../render/compose.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { airOf, lightFor, lightMoved, NOON_AIR, paletteOptions } from "./air.ts";
import { PHASES } from "./clock.ts";
import { parseWeather } from "./weather.ts";

test("noon's air is the shipped light: the midday palette and the plain cream", () => {
  assert.deepEqual(airOf(0.5, 0.25), NOON_AIR);
  const lit = lightFor(NOON_AIR);
  assert.deepEqual(lit.palette, buildPalette(MIDDAY));
  assert.equal(lit.cream, CREAM);
  assert.deepEqual(paletteOptions(NOON_AIR), MIDDAY);
});

test("the air carries the darkness of the hour and the weather's rain and mist", () => {
  const night = airOf(PHASES.night, 0.6, parseWeather("rain") ?? undefined);
  assert.equal(night.night, 1);
  assert.equal(night.rain, 1);
  assert.ok(night.overcast > 0.5);
  assert.equal(airOf(PHASES.noon, 0.6).night, 0);
  const misty = airOf(0.3, 0.6, parseWeather("mist") ?? undefined);
  assert.equal(paletteOptions(misty).mist, 1);
  // At night the cream behind the grain goes dark too.
  assert.ok((lightFor(night).cream & 255) < 140);
});

test("the palette is rebuilt only once the light has moved a step you could see", () => {
  const a = airOf(0.6, 0.25);
  assert.equal(lightMoved(a, airOf(0.6005, 0.25)), false);
  assert.equal(lightMoved(a, airOf(0.602, 0.25)), true);
  assert.equal(lightMoved(airOf(0.9995, 0.25), airOf(0.0005, 0.25)), false, "midnight is no jump");
  assert.equal(lightMoved(a, { ...a, overcast: 0.01 }), false);
  assert.equal(lightMoved(a, { ...a, overcast: 0.03 }), true);
  assert.equal(lightMoved({ ...a, mist: 0.01 }, a), true, "clearing to nothing always lands");
  assert.equal(lightMoved(a, { ...a, rain: 1, cloud: 1, night: 0.5 }), false, "rain and cloud need no new palette");
});
