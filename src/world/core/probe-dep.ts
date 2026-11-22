/** A 32-bit integer stir. Lives in its own file so the probe proves chained .ts imports. */
export function stir(x: number): number {
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  return (x ^ (x >>> 15)) >>> 0;
}
