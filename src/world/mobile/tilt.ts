// Tilt steering, an opt-in (spec 4.6): the phone is a steering wheel. The wheel's angle is the direction of gravity in
// the screen's plane, taken from devicemotion's accelerationIncludingGravity (which points away from the ground) and
// turned into the screen's frame by screen.orientation.angle. Gravity, not Euler angles, so holding the phone upright
// never flips. Pure.

/** Degrees of wheel inside which nothing turns, and at which the turn is full. */
export const TILT_DEAD = 4;
export const TILT_FULL = 25;
/** Below this much gravity in the screen's plane the phone is lying flat: no steering, m/s². */
export const FLAT = 3;
/** The low-pass filter's time constant, s. */
export const TILT_TAU = 0.075;

/**
 * The wheel's angle in degrees, positive when the phone is turned clockwise (to steer right), or null while it lies
 * flat. (x, y) is accelerationIncludingGravity in the device's frame (x right, y up in its natural portrait);
 * `angle` is screen.orientation.angle.
 */
export function wheelAngle(x: number, y: number, angle: number): number | null {
  const a = (((angle % 360) + 360) % 360) * (Math.PI / 180);
  // The screen's frame is the device's turned by the orientation angle, anticlockwise.
  const sx = x * Math.cos(a) - y * Math.sin(a);
  const sy = x * Math.sin(a) + y * Math.cos(a);
  if (Math.hypot(sx, sy) < FLAT) return null;
  return (Math.atan2(-sx, sy) * 180) / Math.PI;
}

/** The turn for a wheel at `deg` against the neutral pose: 0 inside TILT_DEAD, full at TILT_FULL. */
export function tiltTurn(deg: number, neutral: number): number {
  let e = deg - neutral;
  e = ((((e + 180) % 360) + 360) % 360) - 180;
  const m = Math.max(0, Math.min(1, (Math.abs(e) - TILT_DEAD) / (TILT_FULL - TILT_DEAD)));
  return Math.sign(e) * m;
}

/** One step of the low-pass filter. */
export function smooth(prev: number, next: number, dt: number, tau = TILT_TAU): number {
  if (dt <= 0) return prev;
  return prev + (next - prev) * (1 - Math.exp(-dt / tau));
}
