// The cumulus painter: a sculpted shape's light, cut into a short ramp of flat
// tones. Sunlit crowns are white with a warm one-pixel rim where they catch the
// sun; the turned-away sides and the undersides step down through cool blue to
// lavender. Every pixel is one of the ramp's colours and fully opaque: no blur,
// no gradient, no stipple.

import type { CloudShape } from "../shapes.ts";
import type { Painter, Sprite } from "../sprite.ts";

/** A ramp, brightest first, packed RGBA: the rim, then the tones from full sun to deepest shade. */
export interface Ramp {
  rim: number;
  /** Tone k shows where light ≥ cuts[k]; the last tone takes the rest. One fewer cut than tones. */
  tones: readonly number[];
  cuts: readonly number[];
}

/** Midday: a warm cream rim, white crowns, then pale blue, blue, blue-violet and lavender-grey shade. */
export const MIDDAY_RAMP: Ramp = {
  rim: 0xffd8f2ff,
  tones: [0xfffafcfd, 0xfff5eae2, 0xffe9cbba, 0xffd7a997, 0xffbf8b7f],
  cuts: [0.2, 0, -0.3, -0.7],
};

/** Index of the tone for a light value. */
export function toneOf(ramp: Ramp, light: number): number {
  let k = 0;
  while (k < ramp.cuts.length && light < ramp.cuts[k]) k++;
  return k;
}

const NONE = 255;

/** A painter for one ramp. */
export function cumulusPainter(ramp: Ramp): Painter {
  return (shape: CloudShape): Sprite => {
    const { w, h } = shape;
    const n = w * h;
    let tone = new Uint8Array(n).fill(NONE);
    for (let i = 0; i < n; i++) if (shape.cover[i]) tone[i] = toneOf(ramp, shape.light[i]);
    // Clean steps: a pixel none of whose four neighbours shares its tone takes the tone most of them have. Twice,
    // since clearing one lone pixel can strand its neighbour. The shape's margin keeps every cloud pixel off the
    // box's edge, so the neighbours are always inside it.
    for (let round = 0; round < 2; round++) {
      const clean = tone.slice();
      for (let i = 0; i < n; i++) {
        const k = tone[i];
        if (k === NONE) continue;
        const near = [tone[i - 1], tone[i + 1], tone[i - w], tone[i + w]];
        if (near.includes(k)) continue;
        let best = k, votes = 0;
        for (const c of near) {
          if (c === NONE) continue;
          const v = near.filter((d) => d === c).length;
          // Ties go to the brighter tone.
          if (v > votes || (v === votes && c < best)) { best = c; votes = v; }
        }
        clean[i] = best;
      }
      tone = clean;
    }

    const rgba = new Uint32Array(n), alpha = new Uint8Array(n);
    const rimmed = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const k = tone[i];
      if (k === NONE) continue;
      alpha[i] = 255;
      // A rim on open sky shows on a sunlit crown; one against a farther lobe only where that lobe is in shade. One
      // pixel thick: never where the pixels above, to the left and between them are rim already.
      const rim = (shape.rim[i] === 1 ? k <= 1 : shape.rim[i] === 2 && k === 0 && tone[i - w] !== NONE && tone[i - w] >= 1)
        && !(rimmed[i - 1] && rimmed[i - w] && rimmed[i - w - 1]);
      if (rim) rimmed[i] = 1;
      rgba[i] = rim ? ramp.rim : ramp.tones[k];
    }
    return { w, h, rgba, alpha };
  };
}

export const paintCumulus: Painter = cumulusPainter(MIDDAY_RAMP);
