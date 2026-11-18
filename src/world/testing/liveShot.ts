// Frames of the shipped world as a live layer is handed them, for the live layers' tests.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { namedViews, renderStrip } from "../cli/live.ts";
import type { Flier, LiveFrame, LiveLayer } from "../live/live.ts";
import type { Manifest } from "../pack/manifest.ts";
import { decodeFlightData } from "../pack/world.ts";

const root = process.cwd();
const { worldId } = JSON.parse(readFileSync(join(root, "public/world/current.json"), "utf8")) as { worldId: string };
const bin = new Uint8Array(readFileSync(join(root, "public/world", worldId, "world.bin")));
const mask = new Uint8Array(readFileSync(join(root, "public/world/bluenoise.bin")));

export const manifest = JSON.parse(readFileSync(join(root, "public/world", worldId, "manifest.json"), "utf8")) as Manifest;
/** The shipped world's ground grid, as the flight page hands it to the layers. */
export const land = await decodeFlightData(bin);

/** The composed land of one view, its bake pixels and the rect. */
export interface Shot {
  out: Uint32Array;
  bake: Uint32Array;
  rect: LiveFrame["rect"];
  palette: LiveFrame["palette"];
  n: number;
}

const shots = new Map<string, Shot>();

/** The named view (see cli/live.ts), drawn once and kept. */
export async function shot(view: string): Promise<Shot> {
  const hit = shots.get(view);
  if (hit) return hit;
  const place = (await namedViews(bin, manifest))[view];
  let got: Shot | null = null;
  const grab: LiveLayer = {
    name: "grab",
    draw: (f) => { got = { out: new Uint32Array(f.out), bake: new Uint32Array(f.bake), rect: { ...f.rect }, palette: f.palette, n: f.n }; },
  };
  await renderStrip({ bin, manifest, mask, x: place.x, y: place.y, times: [0], layers: [grab], clouds: null });
  assert.ok(got, "the view drew");
  shots.set(view, got);
  return got;
}

/** A fresh frame of `s` at time t, for a layer to draw on. */
export function frameOf(s: Shot, t: number, flier?: Flier): LiveFrame {
  return { out: new Uint32Array(s.out), bake: s.bake, rect: s.rect, t, palette: s.palette, n: s.n, flier };
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
 * A frame over open, level sea a long way from any shore (tone 9), with nothing drawn on it: each pixel's bake depth
 * puts it at world row by / 0.8.
 */
export function seaFrame(rx: number, ry: number, t: number, palette: LiveFrame["palette"], n: number, material: number): LiveFrame {
  const w = 400, h = 225;
  const bake = new Uint32Array(w * h);
  for (let r = 0; r < h; r++) {
    const by = ry + r, cy = Math.floor(by / 256);
    const depth = Math.round(((by - 256 * cy) / 0.8) * 8);
    for (let c = 0; c < w; c++) bake[r * w + c] = (material | (9 << 8) | (depth << 16)) >>> 0;
  }
  const out = new Uint32Array(w * h).fill(palette[(material << 8) | 9]);
  return { out, bake, rect: { x: rx, y: ry, w, h }, t, palette, n };
}
