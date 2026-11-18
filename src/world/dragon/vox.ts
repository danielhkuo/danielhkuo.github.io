// A small voxel pad for building sprite stacks from profiles: balls, limbs and single pixels in model space
// (x forward/east, y to the model's right/south, z up), turned into a Stack and its inked skirt.

import type { Stack } from "../runtime/stack.ts";

export interface Vox {
  /** Half-widths: x runs −hx…hx, y −hy…hy, z 0…layers − 1. */
  hx: number;
  hy: number;
  layers: number;
  rgba: Uint32Array;
  alpha: Uint8Array;
}

/** Picks a voxel's colour: (x, y, z) in model space, and t, 0 at the shape's underside to 1 at its top. */
export type Shade = (x: number, y: number, z: number, t: number) => number;

export function vox(hx: number, hy: number, layers: number): Vox {
  const size = (2 * hx + 1) * (2 * hy + 1) * layers;
  return { hx, hy, layers, rgba: new Uint32Array(size), alpha: new Uint8Array(size) };
}

/** Sets one voxel; outside the pad it is dropped. */
export function put(v: Vox, x: number, y: number, z: number, colour: number): void {
  const xi = Math.round(x) + v.hx, yi = Math.round(y) + v.hy, zi = Math.round(z);
  const w = 2 * v.hx + 1, h = 2 * v.hy + 1;
  if (xi < 0 || yi < 0 || zi < 0 || xi >= w || yi >= h || zi >= v.layers) return;
  const i = (zi * h + yi) * w + xi;
  v.rgba[i] = colour;
  v.alpha[i] = 255;
}

export function filled(v: Vox, x: number, y: number, z: number): boolean {
  const xi = x + v.hx, yi = y + v.hy;
  const w = 2 * v.hx + 1, h = 2 * v.hy + 1;
  if (xi < 0 || yi < 0 || z < 0 || xi >= w || yi >= h || z >= v.layers) return false;
  return v.alpha[(z * h + yi) * w + xi] !== 0;
}

/** Fills the ellipsoid centred (cx, cy, cz) with radii (rx, ry, rz). */
export function ball(v: Vox, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, shade: Shade): void {
  const z0 = Math.max(0, Math.ceil(cz - rz)), z1 = Math.min(v.layers - 1, Math.floor(cz + rz));
  for (let z = z0; z <= z1; z++) {
    const dz = (z - cz) / rz;
    const t = z1 > z0 ? (z - z0) / (z1 - z0) : 1;
    for (let y = Math.ceil(cy - ry); y <= Math.floor(cy + ry); y++) {
      const dy = (y - cy) / ry;
      for (let x = Math.ceil(cx - rx); x <= Math.floor(cx + rx); x++) {
        const dx = (x - cx) / rx;
        if (dx * dx + dy * dy + dz * dz <= 1.08) put(v, x, y, z, shade(x, y, z, t));
      }
    }
  }
}

/** A limb: balls of radius r0 → r1 strung from a to b; under 0.75 it thins to single voxels. */
export function limb(
  v: Vox, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r0: number, r1: number, shade: Shade,
): void {
  const len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay) + (bz - az) * (bz - az));
  const steps = Math.max(1, Math.ceil(len * 2));
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, r = r0 + (r1 - r0) * u;
    const x = ax + (bx - ax) * u, y = ay + (by - ay) * u, z = az + (bz - az) * u;
    if (r < 0.75) put(v, x, y, z, shade(Math.round(x), Math.round(y), Math.round(z), 1));
    else ball(v, x, y, z, r, r, Math.max(0.6, r * 0.8), shade);
  }
}

/** The pad as a stack, trimmed to its contents: empty slices off the top, empty margins off the sides (evenly, so the centre stays). */
export function toStack(v: Vox): Stack {
  const w0 = 2 * v.hx + 1, h0 = 2 * v.hy + 1;
  let mx = 0, my = 0, top = 0;
  for (let z = 0; z < v.layers; z++) for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) {
    if (v.alpha[(z * h0 + y) * w0 + x] === 0) continue;
    mx = Math.max(mx, Math.abs(x - v.hx));
    my = Math.max(my, Math.abs(y - v.hy));
    top = z;
  }
  const w = 2 * mx + 1, h = 2 * my + 1, layers = top + 1;
  const rgba = new Uint32Array(w * h * layers), alpha = new Uint8Array(w * h * layers);
  for (let z = 0; z < layers; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const from = (z * h0 + y - my + v.hy) * w0 + x - mx + v.hx, to = (z * h + y) * w + x;
    rgba[to] = v.rgba[from];
    alpha[to] = v.alpha[from];
  }
  return { w, h, layers, rgba, alpha };
}

/**
 * The inked skirt of a stack: each slice grown by one pixel to its four neighbours, all `ink`, in a box one pixel
 * wider all round (so the centre stays the centre). Drawn before the stack, it leaves a one-pixel outline around the
 * stack's silhouette.
 */
export function skirtOf(s: Stack, ink: number): Stack {
  const w = s.w + 2, h = s.h + 2;
  const rgba = new Uint32Array(w * h * s.layers), alpha = new Uint8Array(w * h * s.layers);
  for (let k = 0; k < s.layers; k++) {
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        if (s.alpha[(k * s.h + y) * s.w + x] === 0) continue;
        const c = (k * h + y + 1) * w + x + 1;
        alpha[c] = alpha[c - 1] = alpha[c + 1] = alpha[c - w] = alpha[c + w] = 255;
      }
    }
  }
  for (let i = 0; i < rgba.length; i++) if (alpha[i]) rgba[i] = ink;
  return { w, h, layers: s.layers, rgba, alpha };
}

/** The union of a stack's slices seen from above: what casts its shadow. */
export function footprintOf(s: Stack): Uint8Array {
  const stride = s.w * s.h, out = new Uint8Array(stride);
  for (let k = 0; k < s.layers; k++) for (let i = 0; i < stride; i++) if (s.alpha[k * stride + i]) out[i] = 1;
  return out;
}
