// Frame strips: a view of the shipped world drawn at several moments, with the live layers, the clouds and the
// stand-in kite, to judge motion.
//
//   npm run world:live -- [--view start|town|abbey|falls|river|peak|sea|all] [--at x,y] [--frames 6] [--dt 0.25]
//                         [--t 0] [--clouds <style>|none] [--sights all] [--time dusk] [--season autumn]
//                         [--weather rain] [--out dir] [--times dawn,day,golden,dusk,night] [--weathers clear,rain]
//
// --time, --season and --weather take what the page's ?time=, ?season= and ?weather= take (sky/clock.ts,
// sky/weather.ts): a clear midsummer noon when left out. --times draws one frame at each time instead of frames
// through t (each at --t), and --weathers one in each weather: a sweep over the same land.
//   npm run world:live -- --view moments
//   npm run world:live -- --view baths
//
// `--view moments` (or one wonder: baths, railway, drowned-church, cove-hotel, marsh-house, airship-mast,
// bridge-town, great-oak, observatory, clock, floating-garden, land-ship) settles the seed-3 world and draws
// each moment through its appearance. `--view all` stays on the shipped world and its seven named views.
//
// --sights all shows every rare sight at once, near the view's centre where the land allows.
//
// Writes .cache/world-live/<view>.png (the frames side by side at 2×) and <view>-<k>.png for each frame, or into --out.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BakeWorld } from "../bake/world.ts";
import { torusDist2, wrap } from "../core/torus.ts";
import type { LiveLayer } from "../live/live.ts";
import { makeLayers } from "../live/registry.ts";
import type { StoryContext } from "../live/story.ts";
import type { StopKey } from "../story/stops.ts";
import { wondersOf, type Manifest } from "../pack/manifest.ts";
import { readShipped } from "../pack/shipped.ts";
import { decodeFlightData, decodeWorld, type FlightData } from "../pack/world.ts";
import { airOf, lightFor, NOON_AIR, type Air } from "../sky/air.ts";
import { dayOfYear, parseSeason, parseTime, PHASES, SEASONS } from "../sky/clock.ts";
import { CLEAR_WEATHER, parseWeather } from "../sky/weather.ts";
import { createBakeHost, createWorldBakeHost } from "../runtime/bakeHost.ts";
import type { FlightState } from "../runtime/flight.ts";
import type { BakePool, ChunkWant } from "../runtime/pool.ts";
import { flownDragon } from "../dragon/index.ts";
import { createStreamView } from "../runtime/stream.ts";
import { createRain } from "../sky/rain.ts";
import { createSky } from "../sky/sky.ts";
import type { CloudStyle } from "../sky/styles.ts";
import { styleFrom } from "../sky/styles.ts";
import { encodePng } from "./png.ts";

interface StripBase {
  manifest: Manifest;
  mask: Uint8Array;
}

/**
 * A strip drawn from format-1 bytes (`bin`) or from a world already decoded (`world` and `flight`).
 * The tools pass the decoded world. Callers that still hold `world.bin` pass `bin`.
 */
export type StripOptions = StripBase & (
  | { bin: Uint8Array; world?: undefined; flight?: undefined }
  | { world: BakeWorld; flight: FlightData; bin?: undefined }
) & {
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
  /** The light and weather; a clear midsummer noon when left out. */
  air?: Air;
  /** One air per frame, in place of `air`: a sweep through the day or the weather over the same land. */
  airs?: readonly Air[];
};

const DEFAULT_W = 400;
const DEFAULT_H = 225;
const SCALE = 2;
const GAP = 6;
const CREAM_R = 0xf0;
const CREAM_G = 0xe8;
const CREAM_B = 0xd2;

const VIEW_NAMES = ["start", "town", "abbey", "falls", "river", "peak", "sea"] as const;

/** Settled-world strips, one appearance each. Not part of `--view all`. */
const MOMENT_VIEWS = new Set([
  "baths", "railway", "drowned-church", "cove-hotel", "marsh-house", "airship-mast",
  "bridge-town", "great-oak", "observatory", "clock", "floating-garden", "land-ship",
]);

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
 * in-process (createWorldBakeHost, or createBakeHost when only `bin` is given) before drawing, the layers run by the
 * view, then sky below, the kite, sky above.
 */
export async function renderStrip(o: StripOptions): Promise<Uint32Array[]> {
  const width = o.width ?? DEFAULT_W;
  const height = o.height ?? DEFAULT_H;
  const data = o.flight ?? await decodeFlightData(o.bin);
  const air = o.air ?? NOON_AIR;
  const { palette, cream } = lightFor(air);
  const bake = o.world ? createWorldBakeHost(o.world, o.mask) : await createBakeHost(o.bin, o.mask);
  const pool = syncPool(bake);
  const view = createStreamView(data, pool, palette, o.mask, {
    width,
    height,
    sites: o.manifest.sites,
    layers: o.layers,
  });
  view.setLight(palette, cream, air);
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
  const rain = createRain(o.manifest.seed);
  const out = new Uint32Array(width * height);
  const frames: Uint32Array[] = [];
  let lit = air;
  for (let t = 0; t < o.times.length; t++) {
    const time = o.times[t];
    const want = o.airs?.[t] ?? air;
    if (want !== lit) {
      const next = lightFor(want);
      view.setLight(next.palette, next.cream, want);
      lit = want;
    }
    view.frame(out, time, { x: kite.x, y: kite.y, alt: kite.alt, heading: kite.heading, speed: kite.speed });
    const rect = view.rect();
    sky?.setAir(lit);
    // The rain falls under the clouds and the flier, as on the page.
    rain(out, rect, time, lit);
    if (sky) sky.draw(out, rect, time, "below");
    const dragon = flownDragon(o.manifest.n, kite, time);
    dragon.setAir(lit);
    dragon.draw(out, rect, kite, view);
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

function riverAt(world: BakeWorld, manifest: Manifest): { x: number; y: number } {
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
export async function namedViews(bin: Uint8Array, manifest: Manifest): Promise<Record<string, { x: number; y: number }>>;
export async function namedViews(world: BakeWorld, manifest: Manifest): Promise<Record<string, { x: number; y: number }>>;
export async function namedViews(source: Uint8Array | BakeWorld, manifest: Manifest): Promise<Record<string, { x: number; y: number }>> {
  const world = source instanceof Uint8Array ? await decodeWorld(source) : source;
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

/**
 * --story draws the quest's five things where src/world/story/places.json puts them (when it is for this world);
 * --found pine,desk counts those as found from the strip's first frame, so their pieces play through it.
 */
function storyFrom(argv: readonly string[], worldId: string, sites: readonly { id: string; type: string; x: number; y: number }[] = []): StoryContext | undefined {
  if (!argv.includes("--story")) return undefined;
  const file = JSON.parse(readFileSync(fileURLToPath(new URL("../story/places.json", import.meta.url)), "utf8")) as {
    worldId: string;
    hall?: { x: number; y: number };
    stops: Record<string, { x: number; y: number }>;
  };
  // A world that stands the monuments lists them as curio sites: their pieces are drawn on them. Otherwise the stops
  // come from places.json for the world it was made for, drawn whole.
  const curios = sites.filter((st) => st.type === "curio" && st.id.startsWith("curio-"));
  const stops = curios.length > 0
    ? curios.map((st) => ({ key: st.id.slice(6) as StopKey, x: st.x, y: st.y, baked: true }))
    : file.worldId === worldId ? Object.entries(file.stops).map(([key, p]) => ({ key: key as StopKey, x: p.x, y: p.y })) : [];
  if (stops.length === 0) return undefined;
  const found = (readFlag(argv, "--found") ?? "").split(",").filter((k) => k !== "") as StopKey[];
  // Found from the strip's second frame, so the first shows the pennant and the piece starts then.
  const from = readNumber(argv, "--t", 0) + 0.5 * readNumber(argv, "--dt", 0.25);
  return { stops, hall: readFlag(argv, "--hall") ? parseHall(readFlag(argv, "--hall")!) : file.hall, found: (t) => (t < from ? [] : found) };
}

/** --hall x,y tries the hall at another place than places.json's. */
function parseHall(raw: string): { x: number; y: number } | undefined {
  const [x, y] = raw.split(",").map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
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
  world: BakeWorld,
  flight: FlightData,
  manifest: Manifest,
  mask: Uint8Array,
  layers: readonly LiveLayer[],
  clouds: CloudStyle | null,
  times: readonly number[],
  dir: string,
  air: Air,
  airs?: readonly Air[],
): Promise<string[]> {
  const frames = await renderStrip({
    world,
    flight,
    manifest,
    mask,
    x: place.x,
    y: place.y,
    times,
    layers,
    clouds,
    air,
    airs,
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

  const forceSights = readFlag(argv, "--sights") === "all";
  // The air: a midsummer day unless told otherwise, so a clock time lands where it would in June.
  const doy = dayOfYear(2026, 6, 21);
  const time = parseTime(readFlag(argv, "--time") ?? null, doy) ?? PHASES.noon;
  const season = parseSeason(readFlag(argv, "--season") ?? null) ?? SEASONS.summer;
  const weather = parseWeather(readFlag(argv, "--weather") ?? null) ?? CLEAR_WEATHER;
  const air = airOf(time, season, weather);
  let airs: Air[] | undefined;
  const sweepTimes = readFlag(argv, "--times"), sweepWeathers = readFlag(argv, "--weathers");
  if (sweepTimes || sweepWeathers) {
    airs = [];
    for (const tq of sweepTimes ? sweepTimes.split(",") : [null]) {
      for (const wq of sweepWeathers ? sweepWeathers.split(",") : [null]) {
        const at = tq === null ? time : parseTime(tq, doy);
        const w = wq === null ? weather : parseWeather(wq);
        if (at === null || w === null) throw new Error(`no such time or weather: ${tq ?? ""} ${wq ?? ""}`);
        airs.push(airOf(at, season, w));
      }
    }
    times.length = 0;
    for (let i = 0; i < airs.length; i++) times.push(t0);
  }
  if (viewArg === "moments" || MOMENT_VIEWS.has(viewArg)) {
    const { renderMomentViews } = await import("./momentstrip.ts");
    const names = viewArg === "moments" ? [...MOMENT_VIEWS] : [viewArg];
    const written = renderMomentViews(names);
    for (let i = 0; i < written.length; i++) console.log(written[i]);
    return 0;
  }
  const worldRoot = fileURLToPath(new URL("../../../public/world/", import.meta.url));
  const shipped = await readShipped(worldRoot);
  const manifest = shipped.manifest as unknown as Manifest;
  const mask = new Uint8Array(readFileSync(join(worldRoot, "bluenoise.bin")));
  const land = shipped.flight;
  const layers = makeLayers({
    seed: manifest.seed,
    n: manifest.n,
    sites: manifest.sites,
    land,
    wonders: wondersOf(manifest),
    forceSights,
    structures: shipped.world.built?.built.structures,
    story: storyFrom(argv, manifest.worldId, manifest.sites),
  });

  const dir = readFlag(argv, "--out") ?? join(process.cwd(), ".cache", "world-live");
  mkdirSync(dir, { recursive: true });

  const places = await namedViews(shipped.world, manifest);
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
    const paths = await writeStrip(name, place, shipped.world, land, manifest, mask, layers, clouds, times, dir, air, airs);
    for (let j = 0; j < paths.length; j++) written.push(paths[j]);
  }
  for (let i = 0; i < written.length; i++) console.log(written[i]);
  return 0;
}