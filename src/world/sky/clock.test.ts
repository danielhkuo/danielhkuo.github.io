import assert from "node:assert/strict";
import { test } from "node:test";
import { dayOfYear, daylight, LONGEST_DAY, parseSeason, parseTime, PHASES, SEASONS, SHORTEST_DAY, SOLAR_NOON, sunPhase } from "./clock.ts";

const JUNE = dayOfYear(2026, 6, 21);
const DECEMBER = dayOfYear(2026, 12, 21);
const MARCH = dayOfYear(2026, 3, 20);

test("days of the year count from 1 January, with 29 February in a leap year", () => {
  assert.equal(dayOfYear(2026, 1, 1), 1);
  assert.equal(dayOfYear(2026, 12, 31), 365);
  assert.equal(dayOfYear(2024, 12, 31), 366);
  assert.equal(dayOfYear(2024, 3, 1), 61);
  assert.equal(dayOfYear(2026, 3, 1), 60);
});

test("days are long at midsummer and short at midwinter", () => {
  assert.ok(Math.abs(daylight(JUNE) - LONGEST_DAY) < 0.01);
  assert.ok(Math.abs(daylight(DECEMBER) - SHORTEST_DAY) < 0.02);
  assert.ok(Math.abs(daylight(MARCH) - 12) < 0.3);
});

test("the sun rises at phase 0.25, stands at noon at 0.5 and sets at 0.75, on any day", () => {
  for (const doy of [JUNE, DECEMBER, MARCH, 1, 200]) {
    const d = daylight(doy);
    assert.ok(Math.abs(sunPhase(SOLAR_NOON - d / 2, doy) - 0.25) < 1e-9, `sunrise on day ${doy}`);
    assert.ok(Math.abs(sunPhase(SOLAR_NOON, doy) - 0.5) < 1e-9, `noon on day ${doy}`);
    assert.ok(Math.abs(sunPhase(SOLAR_NOON + d / 2, doy) - 0.75) < 1e-9, `sunset on day ${doy}`);
  }
});

test("the phase runs on through the night and wraps at its middle", () => {
  const doy = MARCH;
  let last = -1;
  // From just after noon through the night to just before the next noon, the phase only rises (taken past 1).
  for (let h = 12.6; h < 12.5 + 24; h += 0.25) {
    let p = sunPhase(h, doy);
    if (p < 0.5) p += 1;
    assert.ok(p > last, `hour ${h}`);
    last = p;
  }
  // The middle of the night is phase 0.
  const midnight = SOLAR_NOON + 12;
  const p = sunPhase(midnight, doy);
  assert.ok(p < 1e-9 || p > 1 - 1e-9, `${p}`);
});

test("a summer evening at eight is still day; a winter one is night", () => {
  assert.ok(sunPhase(20, JUNE) < 0.75);
  assert.ok(sunPhase(20, DECEMBER) > 0.8);
  assert.ok(sunPhase(7, DECEMBER) < 0.25, "a winter morning at seven is before sunrise");
  assert.ok(sunPhase(7, JUNE) > 0.25);
});

test("?time= takes a name, a clock time or a phase, and nothing else", () => {
  assert.equal(parseTime("dusk", MARCH), PHASES.dusk);
  assert.equal(parseTime(" Night ", MARCH), PHASES.night);
  assert.equal(parseTime("0.3", MARCH), 0.3);
  assert.equal(parseTime("1", MARCH), 1);
  assert.equal(parseTime("12:30", MARCH), sunPhase(12.5, MARCH));
  assert.equal(parseTime("21:15", JUNE), sunPhase(21.25, JUNE));
  assert.equal(parseTime("6", MARCH), sunPhase(6, MARCH));
  for (const bad of [null, "", "teatime", "25:00", "12:75", "1.5", "-0.2"]) assert.equal(parseTime(bad, MARCH), null, `${bad}`);
});

test("--season takes a name or a number from 0 to 1", () => {
  assert.equal(parseSeason("winter"), SEASONS.winter);
  assert.equal(parseSeason("0.4"), 0.4);
  for (const bad of [null, "", "monsoon", "2"]) assert.equal(parseSeason(bad), null);
});
