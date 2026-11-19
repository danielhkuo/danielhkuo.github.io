import assert from "node:assert/strict";
import { test } from "node:test";
import { FLAT, smooth, TILT_DEAD, TILT_FULL, tiltTurn, wheelAngle } from "./tilt.ts";

const G = 9.81;
const deg = (r: number) => (r * Math.PI) / 180;

/** accelerationIncludingGravity for a phone held upright in the screen's frame, its wheel turned `w`° clockwise. */
function upright(w: number, angle: number): { x: number; y: number } {
  // In the screen's frame the reading points up the screen, leaning left as the wheel turns right.
  const sx = -Math.sin(deg(w)) * G;
  const sy = Math.cos(deg(w)) * G;
  // Back to the device's frame: turn by -angle.
  const a = deg(-angle);
  return { x: sx * Math.cos(a) - sy * Math.sin(a), y: sx * Math.sin(a) + sy * Math.cos(a) };
}

test("held level in any orientation the wheel reads 0, and turning it reads the turn, clockwise positive", () => {
  for (const angle of [0, 90, 180, 270]) {
    for (const w of [0, 10, -20, 45]) {
      const g = upright(w, angle);
      const got = wheelAngle(g.x, g.y, angle);
      assert.ok(got !== null && Math.abs(got - w) < 1e-9, `angle ${angle}, wheel ${w}: ${got}`);
    }
  }
});

test("in landscape (angle 90) the device's x axis is the screen's up", () => {
  assert.ok(Math.abs(wheelAngle(G, 0, 90)!) < 1e-9);
  assert.ok(wheelAngle(G * Math.cos(deg(30)), G * Math.sin(deg(30)), 90)! > 0);
});

test("a phone lying flat does not steer", () => {
  assert.equal(wheelAngle(0, 0, 90), null);
  assert.equal(wheelAngle(FLAT * 0.9, 0, 0), null);
});

test("the turn is 0 inside the dead zone, full at TILT_FULL, from the neutral pose", () => {
  assert.equal(tiltTurn(TILT_DEAD - 0.1, 0), 0);
  assert.equal(tiltTurn(TILT_FULL, 0), 1);
  assert.equal(tiltTurn(-TILT_FULL - 10, 0), -1);
  assert.ok(Math.abs(tiltTurn(10 + (TILT_DEAD + TILT_FULL) / 2, 10) - 0.5) < 1e-9);
  // Across ±180 the shorter way round counts.
  assert.equal(tiltTurn(-175, 175), tiltTurn(10, 0));
});

test("the filter eases toward the reading without overshooting", () => {
  let v = 0;
  for (let i = 0; i < 60; i++) {
    const next = smooth(v, 1, 1 / 60);
    assert.ok(next > v && next <= 1);
    v = next;
  }
  assert.ok(v > 0.99);
  assert.equal(smooth(0.5, 1, 0), 0.5);
});
