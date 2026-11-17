// Automatic look gates for the render harness (design 5.7). They run on bake
// pixels (contract layout) or on plain grayscale images, before any critic.

/** Share of non-water pixels whose ink bits are non-zero. */
export function inkShare(pixels: Uint32Array, isWater: Uint8Array): number {
  let land = 0;
  let inked = 0;
  for (let i = 0; i < pixels.length; i++) {
    const material = pixels[i]! & 255;
    if (isWater[material] === 1) continue;
    land++;
    const light = (pixels[i]! >>> 8) & 255;
    const ink = (light >> 6) & 3;
    if (ink > 0) inked++;
  }
  return land === 0 ? 0 : inked / land;
}

/** Share of pixels at tone 0 or tone 15. */
export function toneExtremes(pixels: Uint32Array): number {
  if (pixels.length === 0) return 0;
  let extreme = 0;
  for (let i = 0; i < pixels.length; i++) {
    const light = (pixels[i]! >>> 8) & 255;
    const tone = light & 15;
    if (tone === 0 || tone === 15) extreme++;
  }
  return extreme / pixels.length;
}

/** Tone (0–15) per pixel, as Float32Array, for the spectral gates. */
export function toneImage(pixels: Uint32Array): Float32Array {
  const out = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    const light = (pixels[i]! >>> 8) & 255;
    out[i] = light & 15;
  }
  return out;
}

function dft2Real(img: Float32Array, size: number): { re: Float64Array; im: Float64Array } {
  const n = size * size;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += img[i]!;
  mean /= n;

  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const twoPi = 2 * Math.PI;

  for (let ky = 0; ky < size; ky++) {
    const sky = ky <= size / 2 ? ky : ky - size;
    for (let kx = 0; kx < size; kx++) {
      const skx = kx <= size / 2 ? kx : kx - size;
      let sumRe = 0;
      let sumIm = 0;
      for (let y = 0; y < size; y++) {
        const phaseY = (twoPi * sky * y) / size;
        const cosY = Math.cos(phaseY);
        const sinY = Math.sin(phaseY);
        for (let x = 0; x < size; x++) {
          const v = img[y * size + x]! - mean;
          const phaseX = (twoPi * skx * x) / size;
          const cosX = Math.cos(phaseX);
          const sinX = Math.sin(phaseX);
          const c = cosX * cosY - sinX * sinY;
          const s = sinX * cosY + cosX * sinY;
          sumRe += v * c;
          sumIm -= v * s;
        }
      }
      const idx = ky * size + kx;
      re[idx] = sumRe;
      im[idx] = sumIm;
    }
  }
  return { re, im };
}

/**
 * Grid gate: high-pass the image (subtract a 9 × 9 toroidal box blur), then over the
 * annulus size/8 ≤ |k| ≤ size/2 compare mean power at axis-aligned frequencies
 * (kx = 0 or ky = 0) with the median power of the rest. Large-scale terrain structure
 * is ignored; pixel lattices and row/column banding are caught. A grid-free image
 * scores about 1; the pass mark is ≤ 1.5. `size` must be a power of two.
 */
export function gridScore(img: Float32Array, size: number): number {
  const { re, im } = dft2Real(img, size);
  const half = size / 4;
  const axisPow: number[] = [];
  const otherPow: number[] = [];

  for (let ky = 0; ky < size; ky++) {
    const sky = ky <= size / 2 ? ky : ky - size;
    for (let kx = 0; kx < size; kx++) {
      const skx = kx <= size / 2 ? kx : kx - size;
      const radius = Math.sqrt(skx * skx + sky * sky);
      if (radius <= 0 || radius > half) continue;

      const idx = ky * size + kx;
      const pow = re[idx]! * re[idx]! + im[idx]! * im[idx]!;
      if (skx === 0 || sky === 0) {
        axisPow.push(pow);
      } else {
        otherPow.push(pow);
      }
    }
  }

  if (axisPow.length === 0 || otherPow.length === 0) return 1;

  let sumA = 0;
  for (let i = 0; i < axisPow.length; i++) sumA += axisPow[i]!;
  const A = sumA / axisPow.length;

  const sorted = otherPow.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const B =
    sorted.length % 2 === 1
      ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2;

  if (B === 0) return A === 0 ? 1 : Infinity;
  return A / B;
}

function autocorrX(img: Float32Array, w: number, h: number, lag: number, mean: number, norm: number): number {
  let sum = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const x2 = (x + lag) % w;
      sum += (img[row + x]! - mean) * (img[row + x2]! - mean);
    }
  }
  return sum / norm;
}

/**
 * Repetition gate: autocorrelation at each lag in `lags` (shift along x, toroidal on the image)
 * divided by the mean autocorrelation at lag ± 3. Returns the worst ratio. Pass ≤ 1.25.
 */
export function repeatScore(img: Float32Array, w: number, h: number, lags: readonly number[]): number {
  const n = w * h;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += img[i]!;
  mean /= n;

  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = img[i]! - mean;
    varSum += d * d;
  }
  if (varSum === 0) return 1;

  const cache = new Map<number, number>();
  const corr = (lag: number) => {
    let c = cache.get(lag);
    if (c === undefined) {
      c = autocorrX(img, w, h, lag, mean, varSum);
      cache.set(lag, c);
    }
    return c;
  };

  let worst = 0;
  for (let i = 0; i < lags.length; i++) {
    const L = lags[i]!;
    const cL = corr(L);
    const d0 = Math.max(Math.abs(corr(L - 3)), 1e-3);
    const d1 = Math.max(Math.abs(corr(L + 3)), 1e-3);
    const denom = (d0 + d1) / 2;
    const ratio = cL / denom;
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

/** Number of 8-connected components of non-zero pixels. */
export function components8(mask: Uint8Array, w: number, h: number): number {
  const n = w * h;
  const visited = new Uint8Array(n);
  let count = 0;
  const stack: number[] = [];

  const push = (idx: number) => {
    stack.push(idx);
  };

  for (let start = 0; start < n; start++) {
    if (mask[start] === 0 || visited[start] === 1) continue;
    count++;
    visited[start] = 1;
    push(start);

    while (stack.length > 0) {
      const idx = stack.pop()!;
      const x = idx % w;
      const y = (idx / w) | 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const ni = ny * w + nx;
          if (mask[ni] === 0 || visited[ni] === 1) continue;
          visited[ni] = 1;
          push(ni);
        }
      }
    }
  }
  return count;
}

/** Pearson chi-square distance Σ (a − b)² / (a + b) between two normalised histograms. */
export function chiSquare(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    const den = ai + bi;
    if (den > 0) sum += ((ai - bi) * (ai - bi)) / den;
  }
  return sum;
}

/** True when two buffers hold the same bytes. */
export function bytesEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
  const ba = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const bb = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  if (ba.byteLength !== bb.byteLength) return false;
  for (let i = 0; i < ba.byteLength; i++) {
    if (ba[i] !== bb[i]) return false;
  }
  return true;
}