import assert from "node:assert/strict";
import { test } from "node:test";
import { knobAt, moveThumb, putDown, readStick, STICK } from "./stick.ts";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("the stick reads nothing inside its dead zone, and starts from 0 at the dead zone's edge", () => {
  const s = putDown(100, 100);
  assert.equal(readStick(s).mag, 0);
  const inDead = readStick(moveThumb(s, 100 + STICK.travel * STICK.dead * 0.99, 100));
  assert.equal(inDead.mag, 0);
  const justPast = readStick(moveThumb(s, 100 + STICK.travel * STICK.dead + 0.01, 100));
  assert.ok(justPast.mag > 0 && justPast.mag < 0.01, `${justPast.mag}`);
});

test("the reading rises to 1 at full travel, never past it, and points where the thumb is", () => {
  const s = putDown(0, 0);
  const half = readStick(moveThumb(s, 0, STICK.travel * (STICK.dead + (1 - STICK.dead) / 2)));
  close(half.mag, 0.5, 1e-9);
  assert.equal(half.x, 0);
  assert.ok(half.y > 0);
  for (const d of [STICK.travel, STICK.travel * 1.5, STICK.travel * 4]) {
    const r = readStick(moveThumb(s, d / Math.SQRT2, -d / Math.SQRT2));
    close(r.mag, 1);
    close(Math.hypot(r.x, r.y), 1);
    close(r.x, Math.SQRT1_2);
    close(r.y, -Math.SQRT1_2);
  }
});

test("past its travel the base follows the thumb, so turning back answers at once", () => {
  let s = putDown(0, 0);
  s = moveThumb(s, 200, 0);
  close(s.baseX, 200 - STICK.travel);
  assert.equal(s.baseY, 0);
  // Back the other way: the knob leaves the rim as soon as the thumb does.
  const back = moveThumb(s, 200 - STICK.travel, 0);
  assert.equal(readStick(back).mag, 0);
  assert.deepEqual(knobAt(back), { x: 200 - STICK.travel, y: 0 });
});

test("the knob is drawn at the thumb, held to the travel circle", () => {
  const s = putDown(10, 10);
  assert.deepEqual(knobAt(moveThumb(s, 20, 10)), { x: 20, y: 10 });
  const far = { baseX: 0, baseY: 0, x: 300, y: 400 };
  const k = knobAt(far);
  close(Math.hypot(k.x, k.y), STICK.travel);
});
