import assert from "node:assert/strict";
import { test } from "node:test";
import { STICK } from "./stick.ts";
import { createTouch, HYSTERESIS, type TouchTargets } from "./touch.ts";

const AT: TouchTargets = {
  zone: { x0: 80, y0: 80, x1: 400, y1: 300 },
  boost: { x: 750, y: 250, r: 44 },
  brake: { x: 656, y: 268, r: 36 },
  land: { x: 740, y: 160, r: 44 },
};
const NO_LAND: TouchTargets = { ...AT, land: null };

test("a thumb in the zone puts the stick down where it lands, and steers as it moves", () => {
  const t = createTouch();
  t.down(1, 150, 200, AT);
  assert.deepEqual(t.stick(), { baseX: 150, baseY: 200, x: 150, y: 200 });
  assert.equal(t.read().stick.mag, 0);
  t.move(1, 150 + STICK.travel, 200, AT);
  assert.equal(t.read().stick.mag, 1);
  assert.equal(t.read().stick.x, 1);
  t.up(1, 150 + STICK.travel, 200, AT);
  assert.equal(t.stick(), null);
  assert.equal(t.read().stick.mag, 0);
});

test("the stick and Boost are held at once by two fingers", () => {
  const t = createTouch();
  t.down(1, 150, 200, AT);
  const e = t.down(2, 750, 250, AT);
  assert.equal(e.pressed, "boost");
  t.move(1, 150, 200 - STICK.travel, AT);
  const r = t.read();
  assert.equal(r.boost, true);
  assert.equal(r.stick.mag, 1);
  assert.ok(r.stick.y < 0);
  t.up(2, 750, 250, AT);
  assert.equal(t.read().boost, false);
  assert.equal(t.read().stick.mag, 1);
});

test("a thumb rolls from Brake onto Boost, and keeps a button a little past its edge", () => {
  const t = createTouch();
  t.down(3, 656, 268, AT);
  assert.equal(t.read().brake, true);
  // Just past Brake's edge, within the hysteresis: still braking.
  t.move(3, 656 - 36 - HYSTERESIS + 1, 268, AT);
  assert.equal(t.read().brake, true);
  const rolled = t.move(3, 745, 252, AT);
  assert.equal(rolled.pressed, "boost");
  assert.deepEqual([t.read().brake, t.read().boost], [false, true]);
  // Off every button: nothing held, and the stick zone is never taken by a sliding finger.
  t.move(3, 200, 200, AT);
  assert.deepEqual([t.read().brake, t.read().boost, t.stick()], [false, false, null]);
});

test("a second finger in the zone does not take the stick from the first", () => {
  const t = createTouch();
  t.down(1, 150, 200, AT);
  t.down(2, 300, 250, AT);
  t.move(2, 380, 250, AT);
  assert.equal(t.stick()?.baseX, 150);
  assert.equal(t.read().stick.mag, 0);
  t.up(1, 150, 200, AT);
  // The stray finger does not inherit it either.
  t.move(2, 390, 250, AT);
  assert.equal(t.stick(), null);
});

test("Land acts when the finger lifts on it, and not after sliding off", () => {
  const t = createTouch();
  assert.equal(t.down(1, 740, 160, AT).pressed, "land");
  assert.equal(t.up(1, 742, 158, AT).tapped, "land");
  t.down(2, 740, 160, AT);
  t.move(2, 740, 160 - 44 - HYSTERESIS - 1, AT);
  t.move(2, 740, 160, AT);
  assert.equal(t.up(2, 740, 160, AT).tapped, null);
  // With no landmark in reach there is no Land to press.
  t.down(3, 740, 160, NO_LAND);
  assert.equal(t.up(3, 740, 160, NO_LAND).tapped, null);
});

test("a cancel, a clear or a pause lets go of everything, with no tap", () => {
  const t = createTouch();
  t.down(1, 150, 200, AT);
  t.down(2, 750, 250, AT);
  t.down(3, 740, 160, AT);
  t.cancel(3);
  assert.equal(t.up(3, 740, 160, AT).tapped, null);
  t.cancel(1);
  assert.equal(t.stick(), null);
  assert.equal(t.active(), true);
  t.clear();
  assert.equal(t.active(), false);
  assert.deepEqual(t.read(), { stick: { x: 0, y: 0, mag: 0 }, boost: false, brake: false });
});

test("pressing a button another finger already holds is not a new press", () => {
  const t = createTouch();
  assert.equal(t.down(1, 750, 250, AT).pressed, "boost");
  assert.equal(t.down(2, 752, 252, AT).pressed, null);
  t.up(1, 750, 250, AT);
  assert.equal(t.read().boost, true);
});
