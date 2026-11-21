import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILD, CLEAR_WEATHER, parseWeather, SLOT, slotOf, weatherAt } from "./weather.ts";

const SEED = 3;
/** 1 December 2026, 00:00 UTC. */
const EPOCH = 1796083200;
/** Two weeks of the clock, sampled every 15 seconds. */
const SPAN = 14 * 86400;
const STEP = 15;

test("everyone flying at the same moment has the same weather", () => {
  for (let s = 0; s < 2000; s++) {
    const at = EPOCH + s * 97.3;
    assert.deepEqual(weatherAt(at, SEED), weatherAt(at, SEED));
  }
});

test("every amount stays within 0 and 1, and clear weather is all zeros", () => {
  for (let at = EPOCH; at < EPOCH + SPAN; at += STEP) {
    const w = weatherAt(at, SEED);
    for (const v of [w.cloud, w.rain, w.mist, w.overcast]) assert.ok(v >= 0 && v <= 1, `${at}: ${JSON.stringify(w)}`);
    if (w.kind === "clear") assert.deepEqual(w, CLEAR_WEATHER);
  }
});

test("weather is occasional: showers and mists each pass many times a day, and most of the time is fair", () => {
  let raining = 0, misty = 0, any = 0, samples = 0, passes = 0, wasRaining = false;
  for (let at = EPOCH; at < EPOCH + SPAN; at += STEP) {
    const w = weatherAt(at, SEED);
    samples++;
    if (w.rain > 0) raining++;
    if (w.mist > 0) misty++;
    if (w.kind !== "clear") any++;
    if (w.rain > 0 && !wasRaining) passes++;
    wasRaining = w.rain > 0;
  }
  const perDay = passes / 14;
  assert.ok(perDay >= 10 && perDay <= 26, `${perDay} showers a day`);
  assert.ok(raining / samples > 0.03 && raining / samples < 0.12, `rain ${raining / samples}`);
  assert.ok(misty / samples > 0.04 && misty / samples < 0.12, `mist ${misty / samples}`);
  assert.ok(any / samples > 0.12 && any / samples < 0.28, `weather ${any / samples} of the time`);
});

test("a visitor who stays four minutes meets weather now and then, and a fair sky more often than not", () => {
  const STAY = 240;
  let visits = 0, weather = 0, rain = 0;
  for (let arrive = EPOCH; arrive < EPOCH + SPAN; arrive += 131) {
    let sawWeather = false, sawRain = false;
    for (let at = arrive; at <= arrive + STAY; at += 20) {
      const w = weatherAt(at, SEED);
      if (w.kind !== "clear") sawWeather = true;
      if (w.rain > 0.3) sawRain = true;
    }
    visits++;
    if (sawWeather) weather++;
    if (sawRain) rain++;
  }
  assert.ok(weather / visits > 0.2 && weather / visits < 0.4, `weather on ${weather / visits} of visits`);
  assert.ok(rain / visits > 0.08 && rain / visits < 0.25, `rain on ${rain / visits} of visits`);
});

test("the clouds build before the rain, and rain never falls from a thin sky", () => {
  for (let at = EPOCH; at < EPOCH + SPAN; at += STEP) {
    const w = weatherAt(at, SEED);
    if (w.rain > 0) assert.ok(w.cloud > 0.6, `${at}: rain ${w.rain} under cloud ${w.cloud}`);
    if (w.rain > 0.5) assert.ok(w.cloud > 0.95, `${at}`);
  }
  // A shower's first minutes are cloud alone.
  let found = 0;
  for (let slot = Math.floor(EPOCH / SLOT); found < 20; slot++) {
    const s = slotOf(slot * SLOT, SEED);
    if (s.kind !== "rain") continue;
    found++;
    const start = slot * SLOT + s.start;
    const early = weatherAt(start + BUILD / 2, SEED);
    assert.equal(early.rain, 0);
    assert.ok(early.cloud > 0.3 && early.kind === "clouds");
  }
});

test("a pass begins and ends inside its slot, so weather never jumps at a slot's edge", () => {
  for (let slot = Math.floor(EPOCH / SLOT); slot < Math.floor(EPOCH / SLOT) + 2000; slot++) {
    const s = slotOf(slot * SLOT, SEED);
    if (s.kind === "clear") continue;
    assert.ok(s.start >= 60 && s.start + s.total <= SLOT - 60, `slot ${slot}`);
    assert.deepEqual(weatherAt(slot * SLOT, SEED), CLEAR_WEATHER);
    assert.deepEqual(weatherAt(slot * SLOT + SLOT - 1, SEED), CLEAR_WEATHER);
  }
});

test("weather changes smoothly: no jump bigger than a step's worth", () => {
  let last = weatherAt(EPOCH, SEED);
  for (let at = EPOCH + 1; at < EPOCH + 3 * 86400; at += 1) {
    const w = weatherAt(at, SEED);
    for (const k of ["cloud", "rain", "mist", "overcast"] as const) assert.ok(Math.abs(w[k] - last[k]) < 0.05, `${k} at ${at}`);
    last = w;
  }
});

test("?weather= names a kind, at full strength or a share", () => {
  assert.deepEqual(parseWeather("clear"), CLEAR_WEATHER);
  assert.equal(parseWeather("rain")?.rain, 1);
  assert.equal(parseWeather("rain")?.cloud, 1);
  assert.equal(parseWeather("rain:0.5")?.rain, 0.5);
  assert.equal(parseWeather("mist")?.mist, 1);
  assert.equal(parseWeather("clouds:0.4")?.cloud, 0.4);
  assert.equal(parseWeather("clouds")?.rain, 0);
  for (const bad of [null, "", "snow", "rain:2", "rain:x"]) assert.equal(parseWeather(bad), null, `${bad}`);
});
