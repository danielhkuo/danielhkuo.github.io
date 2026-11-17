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
