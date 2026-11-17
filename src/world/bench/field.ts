// Synthetic land for the bake bench. Not the generator: it only has to give
// the bake the same shapes and sizes of input the real packs will carry.

export interface BenchField {
  /** World size in cells; a multiple of 256. */
  nCells: number;
  /** nCells / 4: the solver grid G. */
  gN: number;
  /** nCells / 8: the coarse grid C. */
  cN: number;
  /** gN² heights in units; sea is negative, down to −24. */
  heights: Float32Array;
  /** gN² height above nearest drainage, 0–255. */
  hand: Uint8Array;
  /** Six planes of cN², 0–255: moisture, wind exposure, coast exposure, debris, rock class (0, 1, 2), region (0–5). */
  fields: Uint8Array;
}

function wrap(i: number, n: number): number {
  const m = i % n;
  return m < 0 ? m + n : m;
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix ^ Math.imul(seed, 0x9e3779b1), 0x85ebca6b);
  h = Math.imul(h ^ Math.imul(iy, 0xc2b2ae35), 0x27d4eb2f);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Periodic gradient noise. Lattice indices wrap so the field tiles. */
function gradNoise(x: number, y: number, seed: number, period: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fade(fx);
  const uy = fade(fy);
  const dot = (ix: number, iy: number, dx: number, dy: number) => {
    const h = hash2(wrap(ix, period), wrap(iy, period), seed);
    switch (h & 7) {
      case 0: return dx + dy;
      case 1: return -dx + dy;
      case 2: return dx - dy;
      case 3: return -dx - dy;
      case 4: return dx;
      case 5: return -dx;
      case 6: return dy;
      default: return -dy;
    }
  };
  const n00 = dot(x0, y0, fx, fy);
  const n10 = dot(x0 + 1, y0, fx - 1, fy);
  const n01 = dot(x0, y0 + 1, fx, fy - 1);
  const n11 = dot(x0 + 1, y0 + 1, fx - 1, fy - 1);
  const a = n00 + (n10 - n00) * ux;
  const b = n01 + (n11 - n01) * ux;
  return a + (b - a) * uy;
}

/** Gradient fbm sampled in G-node space. `baseScale` is nodes per coarsest lattice cell and must divide gN. */
function terrainFbm(gx: number, gy: number, seed: number, gN: number, baseScale: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let scale = baseScale;
  for (let o = 0; o < octaves; o++) {
    const period = gN / scale;
    sum += amp * gradNoise((gx + 0.5) / scale, (gy + 0.5) / scale, seed + o * 1013, period);
    norm += amp;
    amp *= 0.5;
    scale /= 2;
  }
  return sum / norm;
}

function valueNoise(x: number, y: number, seed: number, period: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const at = (ix: number, iy: number) => (hash2(wrap(ix, period), wrap(iy, period), seed) & 1023) / 1023;
  const v00 = at(x0, y0);
  const v10 = at(x0 + 1, y0);
  const v01 = at(x0, y0 + 1);
  const v11 = at(x0 + 1, y0 + 1);
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fy;
}

function valueFbm(x: number, y: number, seed: number, period: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 917, period * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function clampByte(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v;
}

export function makeBenchField(nCells: number, seed: number): BenchField {
  const gN = nCells / 4;
  const cN = nCells / 8;
  const gCount = gN * gN;
  const values = new Float32Array(gCount);

  for (let gy = 0; gy < gN; gy++) {
    for (let gx = 0; gx < gN; gx++) {
      const base = terrainFbm(gx, gy, seed, gN, 16, 4);
      const ridge = 1 - Math.abs(terrainFbm(gx, gy, seed + 7919, gN, 8, 3));
      values[gy * gN + gx] = base + ridge * ridge * 0.9;
    }
  }

  const order = Array.from(values);
  order.sort((a, b) => a - b);
  const threshold = order[Math.floor(order.length * 0.7)];
  let vmax = threshold;
  for (let i = 0; i < gCount; i++) if (values[i] > vmax) vmax = values[i];
  const span = vmax - threshold || 1;

  const heights = new Float32Array(gCount);
  const hand = new Uint8Array(gCount);
  for (let gy = 0; gy < gN; gy++) {
    for (let gx = 0; gx < gN; gx++) {
      const i = gy * gN + gx;
      const v = values[i];
      let h: number;
      if (v > threshold) {
        const s = (v - threshold) / span;
        h = 125 * s * Math.sqrt(s);
      } else {
        h = Math.max(-24, (v - threshold) * 60);
      }
      heights[i] = h;
      if (h > 0) {
        const n = valueNoise(gx + 0.5, gy + 0.5, seed + 4001, gN) * 2 - 1;
        hand[i] = clampByte(Math.round(0.35 * h + 15 * n));
      }
    }
  }

  const cCount = cN * cN;
  const fields = new Uint8Array(6 * cCount);
  const plane = (p: number, i: number, value: number) => {
    fields[p * cCount + i] = value;
  };

  const smooth = (salt: number) => {
    const raw = new Float32Array(cCount);
    let lo = Infinity;
    let hi = -Infinity;
    for (let cy = 0; cy < cN; cy++) {
      for (let cx = 0; cx < cN; cx++) {
        const n = valueFbm(cx + 0.5, cy + 0.5, seed + salt, cN, 4);
        raw[cy * cN + cx] = n;
        if (n < lo) lo = n;
        if (n > hi) hi = n;
      }
    }
    const width = hi - lo || 1;
    for (let i = 0; i < cCount; i++) raw[i] = (raw[i] - lo) / width;
    return raw;
  };

  const moisture = smooth(11);
  const wind = smooth(22);
  const coast = smooth(33);
  const debris = smooth(44);
  for (let i = 0; i < cCount; i++) {
    plane(0, i, clampByte(Math.round(moisture[i] * 255)));
    plane(1, i, clampByte(Math.round(wind[i] * 255)));
    plane(2, i, clampByte(Math.round(coast[i] * 255)));
    plane(3, i, clampByte(Math.round(debris[i] * 255)));
  }

  const rockN = new Float32Array(cCount);
  for (let cy = 0; cy < cN; cy++) {
    for (let cx = 0; cx < cN; cx++) {
      rockN[cy * cN + cx] = valueFbm(cx + 0.5, cy + 0.5, seed + 55, cN, 2);
    }
  }
  const rockOrder = Array.from(rockN);
  rockOrder.sort((a, b) => a - b);
  const rockT1 = rockOrder[Math.floor(rockOrder.length / 3)];
  const rockT2 = rockOrder[Math.floor((2 * rockOrder.length) / 3)];
  for (let i = 0; i < cCount; i++) {
    const r = rockN[i];
    plane(4, i, r <= rockT1 ? 0 : r <= rockT2 ? 1 : 2);
  }

  const regionN = new Float32Array(cCount);
  let rLo = Infinity;
  let rHi = -Infinity;
  for (let cy = 0; cy < cN; cy++) {
    for (let cx = 0; cx < cN; cx++) {
      const n = valueFbm(cx + 0.5, cy + 0.5, seed + 77, cN, 2);
      regionN[cy * cN + cx] = n;
      if (n < rLo) rLo = n;
      if (n > rHi) rHi = n;
    }
  }
  const rSpan = rHi - rLo || 1;
  for (let i = 0; i < cCount; i++) {
    let band = Math.floor(((regionN[i] - rLo) / rSpan) * 6);
    if (band < 0) band = 0;
    if (band > 5) band = 5;
    plane(5, i, band);
  }

  return { nCells, gN, cN, heights, hand, fields };
}

/** A 256² dither mask, one byte per cell. The real blue-noise mask replaces it later; the cost is one lookup either way. */
export function makeBenchMask(seed: number): Uint8Array {
  const mask = new Uint8Array(65536);
  let h = seed >>> 0;
  for (let i = 0; i < 65536; i++) {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ Math.imul(i + 1, 0x9e3779b1), 0x297a2d39);
    h = (h ^ (h >>> 15)) >>> 0;
    mask[i] = h & 255;
  }
  return mask;
}
