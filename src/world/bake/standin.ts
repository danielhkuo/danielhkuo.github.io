// STAND-IN look: a few materials, a plain cover table, simple scatter and a
// plain palette, so the bake can be rendered before the real cover, scatter
// and palette (src/world/cover.ts, scatter.ts, render/palette.ts) land. It is
// swapped out by handing bakeChunk a different Look; nothing else changes.

import { hash2 } from "../core/hash.ts";
import type { CoverInput, Palette, Stamp } from "../look/contract.ts";
import type { Look } from "./cells.ts";

export const SMAT = {
  sea: 1, lake: 2, river: 3, sand: 4, meadow: 5, pasture: 6, heath: 7, woodFloor: 8, broadleaf: 9, conifer: 10,
  rock: 11, snow: 12, scree: 13, boulder: 14, marsh: 15, broadleafLight: 16, alpine: 17,
} as const;

function jitter(mask: Uint8Array, x: number, y: number, rule: number, edge: number): number {
  return (mask[((y + 37 * rule + 7) & 255) * 256 + ((x + 53 * rule + 13) & 255)] / 255 - 0.5) * edge;
}

function cover(c: CoverInput, mask: Uint8Array): number {
  if (c.water === 1) return SMAT.sea;
  if (c.water === 2) return SMAT.lake;
  if (c.water === 3) return SMAT.river;
  const { x, y, e, slope: s } = c;
  const cold = e / 100 + 0.1 * c.northness;
  let j = jitter(mask, x, y, 0, 0.4);
  if (c.shore === 1 && e < 1.6 + j && s < 0.3) return SMAT.sand;
  j = jitter(mask, x, y, 1, 0.08);
  if (cold > 0.86 + j && s < 1.1) return SMAT.snow;
  j = jitter(mask, x, y, 2, 0.3);
  if (s > 1.5 + j || (s > 1.0 + j && c.rock === 0)) return SMAT.rock;
  j = jitter(mask, x, y, 3, 0.2);
  if (s > 0.8 + j && e > 45) return SMAT.scree;
  j = jitter(mask, x, y, 4, 0.1);
  if (cold > 0.6 + j) return SMAT.alpine;
  j = jitter(mask, x, y, 5, 0.12);
  if (c.wind > 0.8 + j && e > 18) return SMAT.heath;
  j = jitter(mask, x, y, 6, 0.1);
  if (c.hand > 1.5 + 10 * j && c.hand < 34 + 40 * j && s > 0.06 + j * 0.2 && s < 0.85 && c.moisture > 0.5 + 2 * j && c.wind < 0.75) return SMAT.woodFloor;
  if (c.hand < 0.6 && s < 0.03) return SMAT.marsh;
  j = jitter(mask, x, y, 7, 0.16);
  return c.moisture < 0.4 + j ? SMAT.pasture : SMAT.meadow;
}

const stamp: Stamp = { x: 0, y: 0, r: 0, h: 0, mat: 0, shape: 0 };

function scatter(c: CoverInput, groundMat: number, mask: Uint8Array, riverDist?: number): Stamp | null {
  if (riverDist !== undefined && riverDist < 5) return null;
  const v = mask[((c.y + 71) & 255) * 256 + ((c.x + 233) & 255)];
  const hsh = hash2(c.x, c.y, 0x5ca7);
  stamp.x = c.x + 0.5;
  stamp.y = c.y + 0.5;
  if (groundMat === SMAT.woodFloor) {
    if (v >= 50) return null;
    const cold = c.e / 100 + 0.1 * c.northness;
    if (cold > 0.42 + ((hsh >>> 8) & 255) / 2550) {
      stamp.r = 1.3 + 0.35 * (hsh & 3);
      stamp.h = 2.6 * stamp.r + 1;
      stamp.mat = SMAT.conifer;
      stamp.shape = 1;
    } else {
      stamp.r = 1.6 + 0.5 * (hsh & 3);
      stamp.h = 1.2 * stamp.r + 1.5;
      stamp.mat = (hsh >>> 4) & 3 ? SMAT.broadleaf : SMAT.broadleafLight;
      stamp.shape = 0;
    }
    return stamp;
  }
  if (groundMat === SMAT.meadow || groundMat === SMAT.pasture) {
    if (v >= 4) return null;
    stamp.r = 1.8 + 0.4 * (hsh & 3);
    stamp.h = 1.2 * stamp.r + 1.5;
    stamp.mat = SMAT.broadleaf;
    stamp.shape = 0;
    return stamp;
  }
  if (groundMat === SMAT.heath || groundMat === SMAT.scree) {
    if (v >= 6) return null;
    stamp.r = 0.9 + 0.3 * (hsh & 1);
    stamp.h = 1.4;
    stamp.mat = SMAT.boulder;
    stamp.shape = 0;
    return stamp;
  }
  return null;
}

type Rgb = readonly [number, number, number];

const BASE: Record<number, Rgb> = {
  [SMAT.sand]: [232, 216, 168],
  [SMAT.meadow]: [140, 182, 96],
  [SMAT.pasture]: [176, 194, 108],
  [SMAT.heath]: [166, 172, 112],
  [SMAT.woodFloor]: [98, 142, 82],
  [SMAT.broadleaf]: [78, 136, 72],
  [SMAT.broadleafLight]: [108, 156, 76],
  [SMAT.conifer]: [52, 104, 84],
  [SMAT.rock]: [206, 190, 164],
  [SMAT.snow]: [238, 241, 246],
  [SMAT.scree]: [204, 194, 172],
  [SMAT.boulder]: [150, 142, 134],
  [SMAT.marsh]: [128, 160, 108],
  [SMAT.alpine]: [160, 188, 128],
};

const WARM: Rgb = [255, 246, 208];
const COOL: Rgb = [52, 62, 110];
const SHADE: Rgb = [70, 80, 138];
const INK: Rgb = [48, 36, 34];

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function packRgb(c: Rgb): number {
  return (0xff000000 | (Math.floor(c[2] + 0.5) << 16) | (Math.floor(c[1] + 0.5) << 8) | Math.floor(c[0] + 0.5)) >>> 0;
}

function waterColour(m: number, tone: number): Rgb {
  if (m === SMAT.river) {
    const k = (tone & 7) < 2 ? 1 : 0;
    return k ? [214, 236, 240] : [176, 214, 228];
  }
  // Tone is the distance from the shore: foam, then a pale shelf deepening.
  const foam: Rgb = [240, 244, 232];
  const shelf: Rgb = m === SMAT.lake ? [150, 206, 214] : [172, 222, 212];
  const deep: Rgb = m === SMAT.lake ? [104, 160, 196] : [118, 178, 198];
  if (tone === 0) return foam;
  return mix(shelf, deep, (tone - 1) / 14);
}

function buildPalette(): Palette {
  const pal = new Uint32Array(256 * 256);
  const paper = packRgb([240, 232, 210]);
  pal.fill(paper);
  for (let m = 1; m <= 17; m++) {
    const water = m <= 3;
    for (let light = 0; light < 256; light++) {
      const tone = light & 15, shadow = (light >> 4) & 3, ink = (light >> 6) & 3;
      let c: Rgb;
      if (water) c = waterColour(m, tone);
      else {
        const k = (tone - 7.5) / 7.5;
        const b = BASE[m];
        // Lights warm towards the paper; darks deepen in their own hue and cool a little.
        const dark = m === SMAT.rock || m === SMAT.scree || m === SMAT.boulder ? [b[0] * 0.6, b[1] * 0.52, b[2] * 0.48] as Rgb : mix([b[0] * 0.5, b[1] * 0.52, b[2] * 0.56], COOL, 0.15);
        c = k >= 0 ? mix(b, WARM, 0.5 * k) : mix(b, dark, -0.8 * k);
      }
      if (shadow) c = mix(c, SHADE, water ? 0.08 * shadow : 0.16 + 0.1 * shadow);
      if (ink === 1) c = mix(c, INK, 0.5);
      else if (ink >= 2) c = mix(c, INK, 0.88);
      pal[(m << 8) | light] = packRgb(c);
    }
  }
  return pal;
}

/** The stand-in Look. */
export function standinLook(): Look {
  const isWater = new Uint8Array(256), isCanopy = new Uint8Array(256), noInk = new Uint8Array(256);
  isWater[SMAT.sea] = isWater[SMAT.lake] = isWater[SMAT.river] = 1;
  isCanopy[SMAT.broadleaf] = isCanopy[SMAT.broadleafLight] = isCanopy[SMAT.conifer] = 1;
  noInk[SMAT.sand] = noInk[SMAT.marsh] = 1;
  return { cover, scatter, isWater, isCanopy, noInk, palette: buildPalette() };
}
