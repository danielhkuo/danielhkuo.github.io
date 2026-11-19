// A fixed polynomial sine: the same bits in every engine, unlike Math.sin.

export const PI = 3.141592653589793;

export function psin(x: number): number {
  const k = Math.floor(x / PI + 0.5);
  const r = x - k * PI;
  const r2 = r * r;
  const r3 = r2 * r;
  const r5 = r3 * r2;
  const r7 = r5 * r2;
  const r9 = r7 * r2;
  let s = r - r3 / 6 + r5 / 120 - r7 / 5040 + r9 / 362880;
  if (k % 2 !== 0) s = -s;
  if (s > 1) return 1;
  if (s < -1) return -1;
  return s;
}

export function pcos(x: number): number {
  return psin(x + PI / 2);
}

/** atan z for |z| ≤ 0.2, by its series to z²¹: well under 1e-15 off. */
function atanSmall(z: number): number {
  const z2 = z * z;
  let term = z, sum = z;
  for (let k = 3; k <= 21; k += 2) {
    term *= -z2;
    sum += term / k;
  }
  return sum;
}

/** A fixed arctangent of y / x in (−π, π], like Math.atan2: the same bits in every engine. 0 at the origin. */
export function patan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x), ay = Math.abs(y);
  let z = ay <= ax ? ay / ax : ax / ay;
  // atan z = 2 atan(z / (1 + √(1 + z²))), twice: |z| ≤ 1 becomes |z| ≤ tan(π/16) ≈ 0.199.
  z = z / (1 + Math.sqrt(1 + z * z));
  z = z / (1 + Math.sqrt(1 + z * z));
  let a = 4 * atanSmall(z);
  if (ay > ax) a = PI / 2 - a;
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}
