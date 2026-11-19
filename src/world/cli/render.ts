// The render harness: builds a world in process, bakes the chunks a list of
// viewpoints needs with the browser's own bake and compositor, and writes each
// view at 400 × 225 and ×3, plus a contact sheet, to .cache/world-renders/.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Look } from "../bake/cells.ts";
import { worldLook } from "../bake/look.ts";
import { buildPalette } from "../render/palette.ts";
import { buildBakeWorld, type BakeWorld } from "../bake/world.ts";
import { rngFor } from "../core/rng.ts";
import { wrap, wrapIndex } from "../core/torus.ts";
import { ARCHETYPE, paramsFor } from "../gen/params.ts";
import { makeWorld, settleWorld, type World } from "../gen/pipeline.ts";
import type { Settlement } from "../gen/settle.ts";
import { cachedTerrain } from "./worldcache.ts";
import type { Plan } from "../gen/plan.ts";
import { createView } from "../runtime/view.ts";
import { bakeWindow, tileCache } from "../bake/chunk.ts";
import { gridScore, inkShare, repeatScore, toneExtremes, toneImage } from "./gates.ts";
import { encodePng } from "./png.ts";

export const VIEW_W = 400;
export const VIEW_H = 225;

export interface Viewpoint {
  name: string;
  /** World cell the view centres on, and the height of the ground there. */
  x: number;
  y: number;
  e: number;
}

export function loadBlueNoise(): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL("../../../public/world/bluenoise.bin", import.meta.url))));
}

/** Six viewpoints chosen from the data, so they follow the seed. */
export function autoViewpoints(world: BakeWorld, plan: Plan, seed: number): Viewpoint[] {
  const { gN, ground, waterKind } = world;
  const at = (name: string, i: number): Viewpoint => {
    const gx = i % gN, gy = (i - gx) / gN;
    return { name, x: 4 * gx + 2, y: 4 * gy + 2, e: Math.max(0, ground[i]) };
  };
  const out: Viewpoint[] = [];

  let peak = 0;
  for (let i = 0; i < ground.length; i++) if (ground[i] > ground[peak]) peak = i;
  out.push(at("peak", peak));

  // A river reach: the widest river, about 160 cells up from where its reach began to be that wide.
  const rv = world.rivers.vertices;
  let reach = -1, best = -1;
  for (let v = 0; v < rv.length; v += 4) {
    const s = rv[v + 2] * 1000 - Math.abs(rv[v + 3] - 160);
    if (s > best) { best = s; reach = v; }
  }
  if (reach >= 0) out.push(at("river", wrapIndex(Math.floor(rv[reach] / 4), Math.floor(rv[reach + 1] / 4), gN)));

  // The coast with the most relief: a shore node under the highest ground within 10 nodes to its north.
  let coast = -1;
  best = -1;
  for (let gy = 0; gy < gN; gy += 2) for (let gx = 0; gx < gN; gx += 2) {
    const i = gy * gN + gx;
    if (waterKind[i] !== 0 || waterKind[wrapIndex(gx, gy + 2, gN)] !== 1) continue;
    let high = 0;
    for (let d = 1; d <= 10; d++) high = Math.max(high, ground[wrapIndex(gx, gy - d, gN)]);
    if (high > best) { best = high; coast = i; }
  }
  if (coast >= 0) out.push(at("coast", coast));

  // The home island's south coast: south from its core until the sea.
  const home = plan.cores.find((c) => c.archetype === ARCHETYPE.home);
  if (home) {
    const gx = wrap(Math.floor(home.x / 4), gN);
    let gy = Math.floor(home.y / 4), last = -1;
    for (let d = 0; d < gN / 2; d++, gy++) {
      const i = wrapIndex(gx, gy, gN);
      if (waterKind[i] === 0) last = i;
      else if (last >= 0 && waterKind[i] === 1) break;
    }
    if (last >= 0) out.push(at("home-south-coast", last));
  }

  // A lowland: the block with the most low, dry ground.
  let low = -1;
  best = -1;
  for (let gy = 0; gy < gN; gy += 4) for (let gx = 0; gx < gN; gx += 4) {
    let s = 0;
    for (let dy = -24; dy <= 24; dy += 4) for (let dx = -32; dx <= 32; dx += 4) {
      const j = wrapIndex(gx + dx, gy + dy, gN);
      if (waterKind[j] === 0 && ground[j] < 18) s++;
    }
    if (s > best) { best = s; low = gy * gN + gx; }
  }
  if (low >= 0) out.push(at("lowland", low));

  const rng = rngFor(seed, "render-viewpoints");
  for (let tries = 0; tries < 4000; tries++) {
    const i = rng.int(gN * gN);
    if (waterKind[i] === 0 && ground[i] > 4) { out.push(at("random", i)); break; }
  }
  return out;
}

/** A site's frame should hold at least this share of land; with less, it is moved toward the coast. */
const SEA_FRAME = 0.3;

/**
 * One viewpoint per reserved site, and one per hamlet up to `hamlets`: the site in the upper third of
 * the frame, with the land to its south, where its approach comes from, below it.
 */
export function siteViewpoints(s: Settlement, hamlets = 0): Viewpoint[] {
  const gN = Math.floor(Math.sqrt(s.ground.length) + 0.5), n = 4 * gN;
  // Share of land in the frame centred on (cx, cy): the view is VIEW_W cells wide and VIEW_H / 0.8 deep.
  const landShare = (cx: number, cy: number): number => {
    let land = 0, all = 0;
    for (let dy = -136; dy <= 136; dy += 16) for (let dx = -192; dx <= 192; dx += 16) {
      all++;
      if (s.ground[wrapIndex(Math.floor((cx + dx) / 4), Math.floor((cy + dy) / 4), gN)] > 0) land++;
    }
    return land / all;
  };
  const out: Viewpoint[] = s.sites.map((site) => {
    const x = Math.floor(site.x), y = Math.floor(site.y) + (site.type === "town" ? 10 : 55);
    // A site out at sea (a stack's lighthouse, a headland's tip) with little but water round it: the frame is
    // shifted toward the nearest coast, as far as keeps the site well inside it, so the land it stands off is in view.
    if (site.type !== "town" && landShare(x, y) < SEA_FRAME) {
      let best = landShare(x, y), bx = x, by = y;
      // The site stays at least 50 px from the sides, 40 from the top and 60 from the bottom of the frame.
      for (let oy = -75; oy <= 85; oy += 10) for (let ox = -150; ox <= 150; ox += 10) {
        const cx = Math.floor(site.x) + ox, cy = Math.floor(site.y) + oy;
        // Enough coast is enough: past that the nearer frame wins, and one that keeps the site in the upper third.
        const score = Math.min(SEA_FRAME, landShare(cx, cy)) - 0.0002 * (Math.abs(ox) + Math.abs(oy - 55));
        if (score > best) { best = score; bx = cx; by = cy; }
      }
      return { name: `site-${site.id}`, x: wrap(bx, n), y: wrap(by, n), e: site.level };
    }
    return { name: `site-${site.id}`, x, y, e: site.level };
  });
  s.hamlets.slice(0, hamlets).forEach((h, k) => out.push({ name: `hamlet-${k}${h.quarry ? "-quarry" : ""}`, x: Math.floor(h.x), y: Math.floor(h.y) + 40, e: 0 }));
  return out;
}

function upscale(src: Uint32Array, w: number, h: number, f: number): Uint32Array {
  const out = new Uint32Array(w * f * h * f);
  for (let y = 0; y < h * f; y++) {
    const sy = Math.floor(y / f) * w, row = y * w * f;
    for (let x = 0; x < w * f; x++) out[row + x] = src[sy + Math.floor(x / f)];
  }
  return out;
}

function bytes(px: Uint32Array): Uint8Array {
  return new Uint8Array(px.buffer, px.byteOffset, px.byteLength);
}

export interface RenderOptions {
  n: number;
  seed: number;
  outDir?: string;
  look?: Look;
  /** Extra viewpoints as "name:x:y". */
  extra?: Viewpoint[];
  /** Which viewpoints to render: the six chosen from the data, the reserved sites, or both (default). */
  views?: "auto" | "sites" | "all" | "none";
  /** The land alone: no siting, so no sites, roads or buildings (and no site views). Seconds, not minutes, on a cached world. */
  wild?: boolean;
  /** Skip the gates (ink, tone, grid, repeat): they cost a minute a view, and a quick look does not need them. */
  noGates?: boolean;
  /** One temperate climate: the world as it was before climates, for a before-and-after. */
  temperate?: boolean;
  /** Hamlets to add to the site viewpoints. */
  hamlets?: number;
  /** Read the land from .cache/world-gen/ (and write it there) instead of generating it every run. */
  cache?: boolean;
  log?: (line: string) => void;
}

export interface RenderResult {
  dir: string;
  files: string[];
  chunks: number;
  msPerChunk: number;
}

export function renderWorld(opts: RenderOptions): RenderResult {
  const log = opts.log ?? (() => {});
  const { n, seed } = opts;
  const t0 = performance.now();
  const base = paramsFor(n);
  const params = opts.temperate ? { ...base, climate: { ...base.climate, zones: undefined } } : base;
  // A wild world is its terrain alone; the bake draws no settlement where there is none.
  const made = opts.wild ? (cachedTerrain(params, seed) as World) : opts.cache ? settleWorld(cachedTerrain(params, seed)) : makeWorld(params, seed);
  if (!opts.wild) {
    for (const line of made.settlement.shortfall) log(`siting shortfall: ${line}`);
    for (const line of made.settlement.displaced) log(`siting out of climate: ${line}`);
    log(`${made.settlement.sites.length} sites, ${made.settlement.hamlets.length} hamlets, ${made.settlement.built.structures.length} structures, ${made.settlement.built.roads.length} road lines`);
  }
  const plan = made.land.plan;
  const world = buildBakeWorld({ params, seed, world: made });
  log(`world ${n} seed ${seed}: ${Math.round(performance.now() - t0)} ms`);

  const look = opts.look ?? worldLook(n, buildPalette({ time: 0.5, season: 0.25, overcast: 0 }));
  const mask = loadBlueNoise();
  const view = createView(world, look, mask, { width: VIEW_W, height: VIEW_H, cacheChunks: 64 });
  const dir = opts.outDir ?? join(process.cwd(), ".cache", "world-renders", `${n}-${seed}`);
  mkdirSync(dir, { recursive: true });

  const views = opts.views ?? "all";
  const points = [
    ...(views === "auto" || views === "all" ? autoViewpoints(world, plan, seed) : []),
    ...((views === "sites" || views === "all") && !opts.wild ? siteViewpoints(made.settlement, opts.hamlets ?? 0) : []),
    ...(opts.extra ?? []),
  ];
  const frames: Uint32Array[] = [];
  const gateTiles = tileCache(world, look, mask, 24);
  const allGates: Record<string, number | string>[] = [];
  const files: string[] = [];
  for (const [k, vp] of points.entries()) {
    // Centre on the ground itself: it is drawn `e` pixels above its sea-level position.
    view.setCamera(vp.x, vp.y - vp.e / 0.8);
    const out = new Uint32Array(VIEW_W * VIEW_H);
    view.frame(out);
    frames.push(out);
    const base = `${k + 1}-${vp.name}`;
    writeFileSync(join(dir, `${base}.png`), encodePng(bytes(out), VIEW_W, VIEW_H));
    writeFileSync(join(dir, `${base}@3x.png`), encodePng(bytes(upscale(out, VIEW_W, VIEW_H, 3)), VIEW_W * 3, VIEW_H * 3));
    files.push(join(dir, `${base}@3x.png`));
    if (opts.noGates) {
      log(`${base}: cell (${vp.x}, ${vp.y})`);
      continue;
    }
    // Gates, on the bake pixels of a 512 × 256 window on the same centre.
    const r = view.rect();
    const gx = r.x + (VIEW_W >> 1) - 256, gy = r.y + (VIEW_H >> 1) - 128;
    const px = bakeWindow(world, look, mask, gateTiles, gx, gy, 512, 256);
    const tone = toneImage(px);
    const sq = new Float32Array(256 * 256);
    for (let y = 0; y < 256; y++) sq.set(tone.subarray(y * 512 + 128, y * 512 + 384), y * 256);
    const gates = { ink: inkShare(px, look.isWater), toneExtremes: toneExtremes(px), grid: gridScore(sq, 256), repeat: repeatScore(tone, 512, 256, [128, 256]) };
    allGates.push({ view: base, ...gates });
    log(`${base}: cell (${vp.x}, ${vp.y}) height ${vp.e.toFixed(1)}  ink ${(100 * gates.ink).toFixed(2)}%  tone-extremes ${(100 * gates.toneExtremes).toFixed(2)}%  grid ${gates.grid.toFixed(2)}  repeat ${gates.repeat.toFixed(2)}`);
  }

  // Contact sheet: three across at ×2.
  const cols = 3, rows = Math.ceil(frames.length / cols), f = 2, gap = 6;
  const sw = cols * VIEW_W * f + (cols + 1) * gap, sh = rows * VIEW_H * f + (rows + 1) * gap;
  const sheet = new Uint32Array(sw * sh).fill(0xff2a2422);
  frames.forEach((fr, k) => {
    const big = upscale(fr, VIEW_W, VIEW_H, f);
    const ox = gap + (k % cols) * (VIEW_W * f + gap), oy = gap + Math.floor(k / cols) * (VIEW_H * f + gap);
    for (let y = 0; y < VIEW_H * f; y++) sheet.set(big.subarray(y * VIEW_W * f, (y + 1) * VIEW_W * f), (oy + y) * sw + ox);
  });
  writeFileSync(join(dir, "contact.png"), encodePng(bytes(sheet), sw, sh));
  files.push(join(dir, "contact.png"));

  writeFileSync(join(dir, "metrics.json"), JSON.stringify(allGates, null, 2));
  const st = view.stats();
  const msPerChunk = st.chunks ? st.bakeMs / st.chunks : 0;
  log(`baked ${st.chunks} chunks, ${msPerChunk.toFixed(1)} ms per chunk (tiles included)`);
  return { dir, files, chunks: st.chunks, msPerChunk };
}

export function main(argv: string[]): void {
  let n = 2048, seed = 7;
  const extra: Viewpoint[] = [];
  let outDir: string | undefined;
  let views: RenderOptions["views"], hamlets = 0, cache = false, wild = false, noGates = false, temperate = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--n") n = Number(argv[++i]);
    else if (a === "--seed") seed = Number(argv[++i]);
    else if (a === "--out") outDir = argv[++i];
    else if (a === "--views") views = argv[++i] as RenderOptions["views"];
    else if (a === "--hamlets") hamlets = Number(argv[++i]);
    else if (a === "--cache") cache = true;
    else if (a === "--wild") wild = true;
    else if (a === "--no-gates") noGates = true;
    else if (a === "--temperate") temperate = true;
    else if (a === "--at") {
      const [name, x, y] = argv[++i].split(":");
      extra.push({ name, x: Number(x), y: Number(y), e: 0 });
    }
  }
  const res = renderWorld({ n, seed, outDir, extra, views, hamlets, cache, wild, noGates, temperate, log: (l) => console.log(l) });
  console.log(res.dir);
}
