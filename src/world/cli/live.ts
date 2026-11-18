// Frame strips: a view of the shipped world drawn at several moments, with the live layers, the clouds and the
// stand-in kite, to judge motion.
//
//   npm run world:live -- [--view start|town|abbey|falls|river|peak|sea|all] [--at x,y] [--frames 6] [--dt 0.25]
//                         [--t 0] [--clouds <style>|none] [--sights all]
//
// --sights all shows every rare sight at once, near the view's centre where the land allows.
//
// Writes .cache/world-live/<view>.png (the frames side by side at 2×) and <view>-<k>.png for each frame.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { torusDist2, wrap } from "../core/torus.ts";
import type { LiveLayer } from "../live/live.ts";
import { makeLayers } from "../live/registry.ts";
import type { Manifest } from "../pack/manifest.ts";
import { decodeFlightData, decodeWorld } from "../pack/world.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { createBakeHost } from "../runtime/bakeHost.ts";
import type { FlightState } from "../runtime/flight.ts";
import type { BakePool, ChunkWant } from "../runtime/pool.ts";
import { drawFlier } from "../runtime/standin.ts";
import { createStreamView } from "../runtime/stream.ts";
import { createSky } from "../sky/sky.ts";
import type { CloudStyle } from "../sky/styles.ts";
import { styleFrom } from "../sky/styles.ts";
import { encodePng } from "./png.ts";

export interface StripOptions {
  bin: Uint8Array;
  manifest: Manifest;
  mask: Uint8Array;
  /** The camera's world point (the kite flies here, heading north, 18 units over the ground). */
  x: number;
  y: number;
  /** Seconds, one frame each. */
  times: readonly number[];
  layers: readonly LiveLayer[];
  /** The cloud style to draw, or null for none. */
  clouds: CloudStyle | null;
  width?: number;
  height?: number;
}

const DEFAULT_W = 400;
const DEFAULT_H = 225;
const SCALE = 2;
const GAP = 6;
const CREAM_R = 0xf0;
const CREAM_G = 0xe8;
const CREAM_B = 0xd2;

const VIEW_NAMES = ["start", "town", "abbey", "falls", "river", "peak", "sea"] as const;

function rgbaOf(px: Uint32Array): Uint8Array {
  return new Uint8Array(px.buffer, px.byteOffset, px.byteLength);
}

function syncPool(bake: (cx: number, cy: number) => Uint32Array): BakePool {
  let baked = 0;
  let bakeMs = 0;
  const pool: BakePool = {
    want(list: readonly ChunkWant[]) {
      const t0 = performance.now();
      for (let i = 0; i < list.length; i++) {
        const w = list[i];
        const px = bake(w.cx, w.cy);
        pool.onBaked?.(w.cx, w.cy, px);
        baked++;
      }
      bakeMs += performance.now() - t0;
    },
    onBaked: null,
    onError: null,
    stats() {
      return { inFlight: 0, queued: 0, baked, bakeMs, workers: 1 };
    },
    dispose() {},
  };
  return pool;
}

/** Nearest-neighbour 2× into a cream sheet, at the cell's top-left. */
function blit2(sheet: Uint8Array, sheetW: number, dx: number, dy: number, src: Uint8Array, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const r = src[si];
      const g = src[si + 1];
      const b = src[si + 2];
      const a = src[si + 3];
      const ox = dx + x * SCALE;
      const oy = dy + y * SCALE;
      for (let py = 0; py < SCALE; py++) {
        let di = ((oy + py) * sheetW + ox) * 4;
        sheet[di] = r;
        sheet[di + 1] = g;
        sheet[di + 2] = b;
        sheet[di + 3] = a;
        di += 4;
        sheet[di] = r;
        sheet[di + 1] = g;
        sheet[di + 2] = b;
        sheet[di + 3] = a;
      }
    }
  }
}

/**
 * Draws one 400×225 frame (or width × height) per time: the stream view over the decoded world with every chunk baked
 * in-process (createBakeHost) before drawing, the layers run by the view, then sky below, the kite, sky above.
 */
export async function renderStrip(o: StripOptions): Promise<Uint32Array[]> {
  const width = o.width ?? DEFAULT_W;
  const height = o.height ?? DEFAULT_H;
  const data = await decodeFlightData(o.bin);
  const palette = buildPalette(MIDDAY);
  const bake = await createBakeHost(o.bin, o.mask);
  const pool = syncPool(bake);
  const view = createStreamView(data, pool, palette, o.mask, {
    width,
    height,
    sites: o.manifest.sites,
    layers: o.layers,
  });
  const ground = view.groundHeight(o.x, o.y);
  const alt = ground + 18;
  const kite: FlightState = {
    x: o.x,
    y: o.y,
    heading: -Math.PI / 2,
    speed: 60,
    alt,
    bank: 0,
  };
  view.setCamera(o.x, o.y - alt / 0.8);
  for (let i = 0; i < 10 && !view.ready(); i++) view.update(0, 0);

  const sky = o.clouds ? createSky(o.manifest.seed, o.manifest.n, o.clouds) : null;
  const out = new Uint32Array(width * height);
  const frames: Uint32Array[] = [];
  for (let t = 0; t < o.times.length; t++) {
    const time = o.times[t];
    view.frame(out, time, { x: kite.x, y: kite.y, alt: kite.alt, heading: kite.heading, speed: kite.speed });
    const rect = view.rect();
    if (sky) sky.draw(out, rect, time, "below");
    drawFlier(out, rect, kite, view);
    if (sky) sky.draw(out, rect, time, "above");
    frames.push(new Uint32Array(out));
  }
  return frames;
}

function siteOf(manifest: Manifest, type: string): { x: number; y: number } | undefined {
  for (let i = 0; i < manifest.sites.length; i++) {
    const s = manifest.sites[i];
    if (s.type === type) return { x: s.x, y: s.y };
  }
  return undefined;
}

function riverAt(world: Awaited<ReturnType<typeof decodeWorld>>, manifest: Manifest): { x: number; y: number } {
  let refX = manifest.start.x;
  let refY = manifest.start.y;
  const abbey = siteOf(manifest, "abbey");
  if (abbey) {
    refX = abbey.x;
    refY = abbey.y;
  }
  const rv = world.rivers.vertices;
  let best = Infinity;
  let x = refX;
  let y = refY;
  for (let v = 0; v < rv.length; v += 4) {
    const vx = wrap(rv[v], world.n);
    const vy = wrap(rv[v + 1], world.n);
    const d = torusDist2(refX, refY, vx, vy, world.n);
    if (d < best) {
      best = d;
      x = vx;
      y = vy;
    }
  }
  return { x, y };
}

/**
 * Named views on the shipped world: start (the manifest start), town and abbey (their sites), falls (the tallest
 * waterfall, from the decoded world's `falls`), river (the abbey site's river point, else a river vertex near the start),
 * peak (the highest ground), sea (600 cells off the start along −(dx, dy)).
 */
export async function namedViews(bin: Uint8Array, manifest: Manifest): Promise<Record<string, { x: number; y: number }>> {
  const world = await decodeWorld(bin);
  const { gN, ground, n, start } = { gN: world.gN, ground: world.ground, n: world.n, start: manifest.start };
  let peakI = 0;
  for (let i = 1; i < ground.length; i++) if (ground[i] > ground[peakI]) peakI = i;
  const gx = peakI % gN;
  const gy = (peakI - gx) / gN;
  const step = n / gN;

  let fallX = start.x;
  let fallY = start.y;
  let bestDrop = -1;
  const falls = world.falls;
  for (let f = 0; f < falls.length; f += 3) {
    const drop = falls[f + 2];
    if (drop > bestDrop) {
      bestDrop = drop;
      fallX = wrap(falls[f], n);
      fallY = wrap(falls[f + 1], n);
    }
  }

  const town = siteOf(manifest, "town");
  const abbey = siteOf(manifest, "abbey");
  const river = riverAt(world, manifest);

  return {
    start: { x: start.x, y: start.y },
    town: town ?? { x: start.x, y: start.y },
    abbey: abbey ?? { x: start.x, y: start.y },
    falls: { x: fallX, y: fallY },
    river,
    peak: { x: gx * step + step / 2, y: gy * step + step / 2 },
    sea: { x: wrap(start.x - 600 * start.dx, n), y: wrap(start.y - 600 * start.dy, n) },
  };
}

function readFlag(argv: readonly string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === name) return argv[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

function readNumber(argv: readonly string[], name: string, fallback: number): number {
  const raw = readFlag(argv, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parseClouds(argv: readonly string[]): CloudStyle | null {
  const raw = readFlag(argv, "--clouds");
  if (raw === "none") return null;
  if (raw === undefined) return styleFrom(null);
  if (raw === "watercolour" || raw === "storybook" || raw === "layered") return styleFrom(raw);
  return styleFrom(null);
}

function parseAt(argv: readonly string[]): { x: number; y: number } | null {
  const raw = readFlag(argv, "--at");
  if (!raw) return null;
  const comma = raw.indexOf(",");
  if (comma < 0) return null;
  const x = Number(raw.slice(0, comma));
  const y = Number(raw.slice(comma + 1));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

async function writeStrip(
  name: string,
  place: { x: number; y: number },
  bin: Uint8Array,
  manifest: Manifest,
  mask: Uint8Array,
  layers: readonly LiveLayer[],
  clouds: CloudStyle | null,
  times: readonly number[],
  dir: string,
): Promise<string[]> {
  const frames = await renderStrip({
    bin,
    manifest,
    mask,
    x: place.x,
    y: place.y,
    times,
    layers,
    clouds,
  });
  const written: string[] = [];
  const w = DEFAULT_W;
  const h = DEFAULT_H;
  const cellW = w * SCALE;
  const cellH = h * SCALE;
  const count = frames.length;
  const sheetW = (count + 1) * GAP + count * cellW;
  const sheetH = GAP + GAP + cellH;
  const sheet = new Uint8Array(sheetW * sheetH * 4);
  for (let i = 0; i < sheet.length; i += 4) {
    sheet[i] = CREAM_R;
    sheet[i + 1] = CREAM_G;
    sheet[i + 2] = CREAM_B;
    sheet[i + 3] = 255;
  }
  for (let k = 0; k < count; k++) {
    const file = join(dir, `${name}-${k}.png`);
    const rgba = rgbaOf(frames[k]);
    writeFileSync(file, encodePng(rgba, w, h));
    written.push(file);
    const dx = GAP + k * (cellW + GAP);
    blit2(sheet, sheetW, dx, GAP, rgba, w, h);
  }
  const stripFile = join(dir, `${name}.png`);
  writeFileSync(stripFile, encodePng(sheet, sheetW, sheetH));
  written.push(stripFile);
  return written;
}

/** The command line; 0 on success. */
export async function main(argv: readonly string[]): Promise<number> {
  const viewArg = readFlag(argv, "--view") ?? "all";
  const framesN = readNumber(argv, "--frames", 6);
  const dt = readNumber(argv, "--dt", 0.25);
  const t0 = readNumber(argv, "--t", 0);
  const clouds = parseClouds(argv);
  const at = parseAt(argv);

  const times: number[] = [];
  for (let i = 0; i < framesN; i++) times.push(t0 + i * dt);

  const worldRoot = fileURLToPath(new URL("../../../public/world/", import.meta.url));
  const current = JSON.parse(readFileSync(join(worldRoot, "current.json"), "utf8")) as { worldId: string };
  const id = current.worldId;
  const manifest = JSON.parse(readFileSync(join(worldRoot, id, "manifest.json"), "utf8")) as Manifest;
  const bin = new Uint8Array(readFileSync(join(worldRoot, id, "world.bin")));
  const mask = new Uint8Array(readFileSync(join(worldRoot, "bluenoise.bin")));
  const forceSights = readFlag(argv, "--sights") === "all";
  const land = await decodeFlightData(bin);
  const layers = makeLayers({ seed: manifest.seed, n: manifest.n, sites: manifest.sites, land, forceSights });

  const dir = join(process.cwd(), ".cache", "world-live");
  mkdirSync(dir, { recursive: true });

  const places = await namedViews(bin, manifest);
  if (at) places.at = at;

  const todo: string[] = [];
  if (viewArg === "all") {
    for (let i = 0; i < VIEW_NAMES.length; i++) todo.push(VIEW_NAMES[i]);
    if (at) todo.push("at");
  } else {
    todo.push(viewArg);
  }

  const written: string[] = [];
  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    const place = places[name];
    if (!place) continue;
    const paths = await writeStrip(name, place, bin, manifest, mask, layers, clouds, times, dir);
    for (let j = 0; j < paths.length; j++) written.push(paths[j]);
  }
  for (let i = 0; i < written.length; i++) console.log(written[i]);
  return 0;
}