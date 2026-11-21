// Frames of the shipped world as a live layer is handed them, for the live layers' tests.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { namedViews, renderStrip } from "../cli/live.ts";
import type { Flier, LiveFrame, LiveLayer } from "../live/live.ts";
import type { Manifest } from "../pack/manifest.ts";
import { readShipped } from "../pack/shipped.ts";
import { FIXTURE_WORLD } from "./fixtureWorld.ts";

const root = process.cwd();
const worldRoot = FIXTURE_WORLD;
const shipped = await readShipped(worldRoot);
const mask = new Uint8Array(readFileSync(join(root, "public/world/bluenoise.bin")));

export const manifest = shipped.manifest as unknown as Manifest;
/** The shipped world's ground grid, as the flight page hands it to the layers. */
export const land = shipped.flight;

/** The composed land of one view, its bake pixels and the rect, and the land past its edges as the page hands it on. */
export interface Shot {
  out: Uint32Array;
  bake: Uint32Array;
  rect: LiveFrame["rect"];
  palette: LiveFrame["palette"];
  n: number;
  bakeSpace?: LiveFrame["bakeSpace"];
}

const shots = new Map<string, Shot>();

/** The named view (see cli/live.ts), `width` × `height`, drawn once and kept. */
export async function shot(view: string, width = 400, height = 225): Promise<Shot> {
  const place = (await namedViews(shipped.world, manifest))[view];
  return shotAt(place.x, place.y, width, height);
}

/** The view of world (x, y) as cli/live.ts frames it, `width` × `height`, drawn once and kept. */
export async function shotAt(x: number, y: number, width = 400, height = 225): Promise<Shot> {
  const key = `${x},${y} ${width}x${height}`;
  const hit = shots.get(key);
  if (hit) return hit;
  const place = { x, y };
  let got: Shot | null = null;
  const grab: LiveLayer = {
    name: "grab",
    draw: (f) => {
      got = { out: new Uint32Array(f.out), bake: new Uint32Array(f.bake), rect: { ...f.rect }, palette: f.palette, n: f.n, bakeSpace: f.bakeSpace };
    },
  };
  await renderStrip({
    world: shipped.world, flight: shipped.flight, manifest, mask, x: place.x, y: place.y, times: [0], layers: [grab], clouds: null, width, height,
  });
  assert.ok(got, "the view drew");
  shots.set(key, got);
  return got;
}

/** The w × h window of `s` whose top-left is its pixel (ox, oy): the frame a view that far over would have drawn. */
export function cut(s: Shot, ox: number, oy: number, w: number, h: number): Shot {
  assert.ok(ox >= 0 && oy >= 0 && ox + w <= s.rect.w && oy + h <= s.rect.h, "the window lies inside the shot");
  const out = new Uint32Array(w * h), bake = new Uint32Array(w * h);
  for (let r = 0; r < h; r++) {
    const from = (oy + r) * s.rect.w + ox;
    out.set(s.out.subarray(from, from + w), r * w);
    bake.set(s.bake.subarray(from, from + w), r * w);
  }
  return { out, bake, rect: { x: s.rect.x + ox, y: s.rect.y + oy, w, h }, palette: s.palette, n: s.n, bakeSpace: s.bakeSpace };
}

/** A fresh frame of `s` at time t, for a layer to draw on. */
export function frameOf(s: Shot, t: number, flier?: Flier): LiveFrame {
  return { out: new Uint32Array(s.out), bake: s.bake, rect: s.rect, t, palette: s.palette, n: s.n, flier, bakeSpace: s.bakeSpace };
}

/** `layer`'s frame of `s` at time t. */
export function drawn(layer: LiveLayer, s: Shot, t: number, flier?: Flier): Uint32Array {
  const f = frameOf(s, t, flier);
  layer.draw(f);
  return f.out;
}

export function differing(a: Uint32Array, b: Uint32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/**
 * A w × h frame of land that is the same everywhere along its rows: bake pixel `pixelAt(by)` on bake row by, on the
 * frame and past its edges alike, each drawn as `fill`.
 */
export function levelFrame(
  rx: number, ry: number, t: number, palette: LiveFrame["palette"], n: number, pixelAt: (by: number) => number, fill: number, w = 400, h = 225,
): LiveFrame {
  const bake = new Uint32Array(w * h);
  for (let r = 0; r < h; r++) bake.fill(pixelAt(ry + r), r * w, (r + 1) * w);
  const out = new Uint32Array(w * h).fill(fill);
  return { out, bake, rect: { x: rx, y: ry, w, h }, t, palette, n, bakeSpace: (_bx, by) => pixelAt(by) };
}

/** Bake pixel of level land of `material` at tone `tone`, `height` units up, on bake row by. */
export function levelPixel(material: number, tone: number, height: number): (by: number) => number {
  return (by) => {
    const cy = Math.floor(by / 256);
    const depth = Math.round(((by + height - 256 * cy) / 0.8) * 8);
    return (material | (tone << 8) | (depth << 16)) >>> 0;
  };
}

/**
 * A frame over open, level sea a long way from any shore (tone 9), with nothing drawn on it: each pixel's bake depth
 * puts it at world row by / 0.8. The sea runs on past the frame's edges.
 */
export function seaFrame(rx: number, ry: number, t: number, palette: LiveFrame["palette"], n: number, material: number, w = 400, h = 225): LiveFrame {
  return levelFrame(rx, ry, t, palette, n, levelPixel(material, 9, 0), palette[(material << 8) | 9], w, h);
}
