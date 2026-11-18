// Moment strips: each wonder's appearance, on the settled seed-3 world, through the moments layer.
// The shipped world has no wonders baked into it, so this settles from the terrain cache and bakes
// with the same compositor the flight page uses. `npm run world:live -- --view moments` calls it.
// `--view all` does not.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bakeChunk, CHUNK, tileCache, type TileSource } from "../bake/chunk.ts";
import { groundAt, type Look } from "../bake/cells.ts";
import { worldLook } from "../bake/look.ts";
import type { BakeWorld } from "../bake/world.ts";
import { buildBakeWorld } from "../bake/world.ts";
import { torusDelta, wrap } from "../core/torus.ts";
import type { PlacedSite } from "../gen/sites.ts";
import type { PlacedWonder } from "../gen/wonders.ts";
import { paramsFor } from "../gen/params.ts";
import { settleWorld } from "../gen/pipeline.ts";
import { modP, ringDelta } from "../live/art.ts";
import { CLOCK_LASTS, CLOCK_LEAD, momentSpan, momentsLayer, widestSands, gardenWhere, type MomentsLayer } from "../live/moments.ts";
import type { Land } from "../live/routes.ts";
import { manifestWonders } from "../pack/manifest.ts";
import { compose, paperGrain, type ViewRect } from "../render/compose.ts";
import { buildPalette } from "../render/palette.ts";
import { encodePng } from "./png.ts";
import { loadBlueNoise, VIEW_H, VIEW_W } from "./render.ts";
import { cachedTerrain } from "./worldcache.ts";

/** The same world the wonders bench draws. */
const N = 6400;
const SEED = 3;

/** Six poses through one appearance, from the opening to just before it fades. */
const FRAC = [0.08, 0.22, 0.4, 0.55, 0.72, 0.92];

const CLOSE_W = 160;
const CLOSE_H = 90;
const CLOSE_SCALE = 5;
const WIDE_SCALE = 2;
const GAP = 6;
const CREAM = [0xf0, 0xe8, 0xd2, 0xff];

interface Cam {
  x: number;
  y: number;
  e: number;
  /** Frame pixel the close crop centres on. The wide frame ignores it. */
  fx?: number;
  fy?: number;
}

interface Shot {
  name: string;
  lasts: number;
  lead: number;
  only: string;
  wide: (at: number) => Cam;
  close: (at: number) => Cam;
}

/** Seconds of flight that show `frac` of the way through a forced appearance. */
function timeOf(frac: number, lasts: number, lead: number): { t: number; at: number } {
  const at = frac * lasts;
  let t = at - lead;
  if (t < 0) t += lasts;
  return { t, at };
}

function across(at: number, lasts: number): number {
  const u = at / lasts;
  return u < 0.5 ? u * 2 : 2 - u * 2;
}

function lerpRing(a: readonly [number, number], b: readonly [number, number], u: number, n: number): { x: number; y: number } {
  return {
    x: modP(a[0] + ringDelta(a[0], b[0], n) * u, n),
    y: modP(a[1] + ringDelta(a[1], b[1], n) * u, n),
  };
}

function anchor(w: PlacedWonder, name: string): readonly [number, number] {
  const p = w.anchors[name];
  return p ?? [w.x, w.y];
}

function pointAlong(run: Float32Array, u: number, n: number): { x: number; y: number } {
  const pts = run.length >> 1;
  if (pts <= 1) return { x: run[0] ?? 0, y: run[1] ?? 0 };
  const f = u <= 0 ? 0 : u >= 1 ? pts - 1 : u * (pts - 1);
  let i = Math.floor(f);
  if (i >= pts - 1) i = pts - 2;
  const k = i === pts - 2 && u >= 1 ? 1 : f - i;
  const x0 = run[i * 2];
  const y0 = run[i * 2 + 1];
  return {
    x: modP(x0 + ringDelta(x0, run[i * 2 + 2], n) * k, n),
    y: modP(y0 + ringDelta(y0, run[i * 2 + 3], n) * k, n),
  };
}

function upscale(src: Uint32Array, w: number, h: number, f: number): Uint32Array {
  const out = new Uint32Array(w * f * h * f);
  for (let y = 0; y < h * f; y++) {
    const sy = Math.floor(y / f) * w;
    const row = y * w * f;
    for (let x = 0; x < w * f; x++) out[row + x] = src[sy + Math.floor(x / f)];
  }
  return out;
}

function crop(src: Uint32Array, w: number, h: number, cx: number, cy: number): Uint32Array {
  let x0 = Math.round(cx) - (CLOSE_W >> 1);
  let y0 = Math.round(cy) - (CLOSE_H >> 1);
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x0 + CLOSE_W > w) x0 = w - CLOSE_W;
  if (y0 + CLOSE_H > h) y0 = h - CLOSE_H;
  const out = new Uint32Array(CLOSE_W * CLOSE_H);
  for (let y = 0; y < CLOSE_H; y++) out.set(src.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + CLOSE_W), y * CLOSE_W);
  return out;
}

function creamSheet(frames: Uint32Array[], fw: number, fh: number): { rgba: Uint8Array; w: number; h: number } {
  const sw = frames.length * fw + (frames.length + 1) * GAP;
  const sh = fh + 2 * GAP;
  const sheet = new Uint8Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const o = i * 4;
    sheet[o] = CREAM[0];
    sheet[o + 1] = CREAM[1];
    sheet[o + 2] = CREAM[2];
    sheet[o + 3] = CREAM[3];
  }
  for (let k = 0; k < frames.length; k++) {
    const src = new Uint8Array(frames[k].buffer, frames[k].byteOffset, frames[k].byteLength);
    const dx = GAP + k * (fw + GAP);
    for (let y = 0; y < fh; y++) {
      sheet.set(src.subarray(y * fw * 4, (y + 1) * fw * 4), ((GAP + y) * sw + dx) * 4);
    }
  }
  return { rgba: sheet, w: sw, h: sh };
}

function chunkSource(world: BakeWorld, look: Look, mask: Uint8Array): (cx: number, cy: number) => Uint32Array {
  const n = world.n;
  const tiles: TileSource = tileCache(world, look, mask, 48);
  const periodX = n / CHUNK;
  const periodY = (n * 4) % (5 * CHUNK) === 0 ? (n * 4) / 5 / CHUNK : 0;
  const cache = new Map<string, Uint32Array>();
  return (cx, cy) => {
    const kx = wrap(cx, periodX);
    const ky = periodY ? wrap(cy, periodY) : cy;
    const key = `${kx},${ky}`;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const px = bakeChunk(world, look, mask, tiles, kx, ky);
    cache.set(key, px);
    if (cache.size > 96) cache.delete(cache.keys().next().value as string);
    return px;
  };
}

function planePose(at: number, lasts: number, pontoon: readonly [number, number]): { x: number; y: number; alt: number } {
  const p = at / lasts;
  if (p < 0.34) {
    const u = p / 0.34;
    return { x: pontoon[0], y: pontoon[1] + 48 * (1 - u), alt: 16 + (1.4 - 16) * u };
  }
  if (p < 0.62) {
    const u = (p - 0.34) / 0.28;
    return { x: pontoon[0] + 3 * u, y: pontoon[1] + 8 * (1 - u), alt: 1.35 };
  }
  return { x: pontoon[0] + 3, y: pontoon[1], alt: 1.2 };
}

function clockPlace(world: BakeWorld, sites: readonly PlacedSite[]): { x: number; y: number; base: number } | null {
  const town = sites.find((s) => s.type === "town" && s.harbour);
  const hb = town?.harbour;
  if (!hb) return null;
  const hx = Math.floor(hb.x);
  const shore = Math.floor(hb.y) + 2;
  const river = torusDelta(hx, hb.mouthX, world.n) < 0 ? -1 : 1;
  const cx = hx - river * 6 - 8;
  const cy = shore - 28 - 1;
  const base = groundAt(world, cx, cy);
  return { x: cx, y: cy + 2, base: base > 0 ? base : 0 };
}

function shotsOf(world: BakeWorld, placed: readonly PlacedWonder[], sites: readonly PlacedSite[], land: Land, shoreClass: Uint8Array | null): Shot[] {
  const n = world.n;
  const byType = new Map<string, PlacedWonder>();
  for (let i = 0; i < placed.length; i++) byType.set(placed[i].type, placed[i]);
  const need = (type: string): PlacedWonder => {
    const w = byType.get(type);
    if (!w) throw new Error(`the settled world has no ${type}`);
    return w;
  };
  const fixed = (x: number, y: number, e: number, fy?: number): (at: number) => Cam => () => ({ x, y, e, fy });

  const baths = need("baths");
  const quay = anchor(baths, "quay");
  const bathsMid = lerpRing([baths.x, baths.y], quay, 0.45, n);

  const rail = need("railway");
  const shore = anchor(rail, "shore");
  const halt = anchor(rail, "halt");

  const church = need("drowned-church");
  const tower = anchor(church, "tower");

  const hotel = need("cove-hotel");
  const pontoon = anchor(hotel, "pontoon");
  const hotelWide = lerpRing([hotel.x, hotel.y], pontoon, 0.55, n);

  const marsh = need("marsh-house");
  const lamp = anchor(marsh, "lamp");
  const gate = anchor(marsh, "gate");
  const firm = anchor(marsh, "firm");
  const causeway = lerpRing(gate, firm, 0.5, n);
  const marshWide = lerpRing([lamp[0], lamp[1]], [causeway.x, causeway.y], 0.35, n);

  const mastW = need("airship-mast");
  const mast = anchor(mastW, "mast");

  const bridge = need("bridge-town");
  const west = anchor(bridge, "west");
  const east = anchor(bridge, "east");
  const span = lerpRing(west, east, 0.5, n);
  const deck = bridge.height > 17 ? bridge.height - 17 : 6;

  const oak = need("great-oak");
  const crown = anchor(oak, "crown");

  const dome = need("observatory");
  const domeAt = anchor(dome, "dome");

  const clock = clockPlace(world, sites);
  const sea = gardenWhere(SEED, n, land, 0);
  const sands = widestSands(land, n);

  const ferry = (at: number, lasts: number): Cam => {
    const u = across(at, lasts);
    return { x: quay[0], y: quay[1] + 42 + (2 - 42) * u, e: 3 };
  };
  const train = (at: number, lasts: number): Cam => {
    const p = lerpRing(shore, halt, across(at, lasts), n);
    return { x: p.x, y: p.y, e: 3 };
  };

  const out: Shot[] = [
    {
      name: "baths",
      ...spanOf("ferry"),
      only: "baths",
      wide: fixed(bathsMid.x, bathsMid.y, baths.level * 0.45),
      close: (at) => ferry(at, momentSpan(SEED, "ferry").lasts),
    },
    {
      name: "railway",
      ...spanOf("train"),
      only: "railway",
      wide: fixed(lerpRing(shore, halt, 0.5, n).x, lerpRing(shore, halt, 0.5, n).y, 5),
      close: (at) => train(at, momentSpan(SEED, "train").lasts),
    },
    {
      name: "drowned-church",
      ...spanOf("church"),
      only: "drowned-church",
      wide: fixed(tower[0], tower[1], church.level + 8),
      close: fixed(tower[0], tower[1], church.level + 16),
    },
    {
      name: "cove-hotel",
      ...spanOf("plane"),
      only: "cove-hotel",
      wide: fixed(hotelWide.x, hotelWide.y, Math.max(6, hotel.level * 0.4)),
      close: (at) => {
        const pose = planePose(at, momentSpan(SEED, "plane").lasts, pontoon);
        return { x: pose.x, y: pose.y, e: pose.alt + 3 };
      },
    },
    {
      name: "marsh-house",
      ...spanOf("marsh"),
      only: "marsh-house",
      wide: fixed(marshWide.x, marshWide.y, Math.max(4, marsh.level * 0.35)),
      close: (at) => {
        const p = lerpRing(gate, firm, across(at, momentSpan(SEED, "marsh").lasts), n);
        return { x: p.x, y: p.y, e: 3 };
      },
    },
    {
      name: "airship-mast",
      ...spanOf("airship"),
      only: "airship-mast",
      wide: fixed(mast[0] + 8, mast[1], mastW.level + mastW.height * 0.65),
      close: fixed(mast[0] + 14, mast[1], mastW.level + mastW.height + 2),
    },
    {
      name: "bridge-town",
      ...spanOf("bridge"),
      only: "bridge-town",
      wide: fixed(span.x, span.y + 6, Math.max(3, deck * 0.45)),
      close: fixed(span.x, span.y + 4, Math.max(2, deck - 3)),
    },
    {
      name: "great-oak",
      ...spanOf("oak"),
      only: "great-oak",
      wide: fixed(crown[0], crown[1], oak.level + 18),
      close: fixed(crown[0] + 16, crown[1], oak.level + 32),
    },
    {
      name: "observatory",
      ...spanOf("dome"),
      only: "observatory",
      wide: fixed(domeAt[0], domeAt[1], dome.level + dome.height * 0.55),
      close: fixed(domeAt[0], domeAt[1], dome.level + dome.height),
    },
  ];

  if (clock) {
    out.push({
      name: "clock",
      lasts: CLOCK_LASTS,
      lead: CLOCK_LEAD,
      only: "clock",
      wide: fixed(clock.x, clock.y + 6, clock.base + 8),
      close: fixed(clock.x, clock.y, clock.base + 14),
    });
  }
  if (sea) {
    out.push({
      name: "floating-garden",
      ...spanOf("garden"),
      only: "floating-garden",
      // The island is drawn above whichever deep-sea pixel the frame's middle holds, about 74px up.
      wide: fixed(sea.x, sea.y, 4),
      close: fixed(sea.x, sea.y, 4, (VIEW_H >> 1) - 74),
    });
  }
  const beach = shoreClass ? beachMid(shoreClass, world.ground, world.gN, n) : null;
  const shipAt = beach ?? (sands.length >= 4 ? pointAlong(sands, 0.5, n) : null);
  if (shipAt) {
    out.push({
      name: "land-ship",
      ...spanOf("land-ship"),
      only: "land-ship",
      // Fixed on the sands, so the ship runs through the frame instead of the camera chasing it.
      wide: fixed(shipAt.x, shipAt.y, 4),
      close: fixed(shipAt.x, shipAt.y, 2),
    });
  }
  return out;
}

/** The middle of the longest beach, cove or dune, in world cells. The land-ship is drawn on the sand there. */
function beachMid(cls: Uint8Array, ground: Float32Array, gN: number, n: number): { x: number; y: number } | null {
  const cell = n / gN;
  const at = (gx: number, gy: number): number => {
    let x = gx % gN;
    let y = gy % gN;
    if (x < 0) x += gN;
    if (y < 0) y += gN;
    return ground[y * gN + x];
  };
  const index = (gx: number, gy: number): number => {
    let x = gx % gN;
    let y = gy % gN;
    if (x < 0) x += gN;
    if (y < 0) y += gN;
    return y * gN + x;
  };
  const beach = (gx: number, gy: number): boolean => {
    const k = index(gx, gy);
    const c = cls[k];
    if (c !== 1 && c !== 4 && c !== 5) return false;
    const h = ground[k];
    if (h < 0 || h > 2.4) return false;
    for (let d = 0; d < 4; d++) {
      const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
      const dy = d === 2 ? 1 : d === 3 ? -1 : 0;
      for (let s = 1; s <= 2; s++) if (at(gx + dx * s, gy + dy * s) < -0.3) return true;
    }
    return false;
  };
  const seen = new Uint8Array(gN * gN);
  let best: number[] = [];
  const step = (x: number, y: number, turn: number, out: number[]): void => {
    let cx = x;
    let cy = y;
    for (let s = 0; s < 500; s++) {
      let seaX = 0;
      let seaY = 0;
      let foundSea = false;
      for (let d = 0; d < 4 && !foundSea; d++) {
        const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
        const dy = d === 2 ? 1 : d === 3 ? -1 : 0;
        for (let k = 1; k <= 2; k++) {
          if (at(cx + dx * k, cy + dy * k) < -0.3) {
            seaX = dx;
            seaY = dy;
            foundSea = true;
            break;
          }
        }
      }
      if (!foundSea) break;
      // The sea lies on one axis, so the shore runs on the other.
      const alongX = seaY !== 0 ? turn : 0;
      const alongY = seaX !== 0 ? turn : 0;
      const opts: readonly (readonly [number, number])[] = [
        [cx + alongX, cy + alongY],
        [cx + alongX - seaX, cy + alongY - seaY],
        [cx + alongX + seaX, cy + alongY + seaY],
      ];
      let ok = false;
      let nx = 0;
      let ny = 0;
      for (let i = 0; i < opts.length; i++) {
        const px = opts[i][0];
        const py = opts[i][1];
        if (!beach(px, py)) continue;
        const id = index(px, py);
        if (seen[id]) continue;
        nx = id % gN;
        ny = (id / gN) | 0;
        ok = true;
        break;
      }
      if (!ok) break;
      seen[ny * gN + nx] = 1;
      out.push(nx, ny);
      cx = nx;
      cy = ny;
    }
  };
  for (let gy = 0; gy < gN; gy += 2) {
    for (let gx = 0; gx < gN; gx += 2) {
      const start = gy * gN + gx;
      if (seen[start] || !beach(gx, gy)) continue;
      seen[start] = 1;
      const back: number[] = [];
      const fore: number[] = [];
      step(gx, gy, -1, back);
      step(gx, gy, 1, fore);
      const cells: number[] = [];
      for (let i = back.length - 2; i >= 0; i -= 2) cells.push(back[i], back[i + 1]);
      cells.push(gx, gy);
      for (let i = 0; i < fore.length; i++) cells.push(fore[i]);
      if (cells.length > best.length) best = cells;
    }
  }
  if (best.length < 4) return null;
  const mid = (best.length >> 2) << 1;
  return { x: (best[mid] + 0.5) * cell, y: (best[mid + 1] + 0.5) * cell };
}

function spanOf(kind: string): { lasts: number; lead: number } {
  const s = momentSpan(SEED, kind);
  return { lasts: s.lasts, lead: s.lead };
}

/**
 * Draws the named moments (or every one) into `.cache/world-live/` and returns the files written.
 * Each name gets a 2× strip and a 5× close-up, six frames through the appearance.
 */
export function renderMomentViews(names: readonly string[], outDir?: string): string[] {
  const params = paramsFor(N);
  const made = settleWorld(cachedTerrain(params, SEED), { wonders: true });
  const world = buildBakeWorld({ params, seed: SEED, world: made });
  const look = worldLook(N, buildPalette({ time: 0.5, season: 0.25, overcast: 0 }));
  const mask = loadBlueNoise();
  const chunks = chunkSource(world, look, mask);
  const land: Land = { gN: world.gN, ground: world.ground };
  const wonders = manifestWonders(made.settlement.wonders, N);
  const sites = made.settlement.sites.map((s) => ({ id: s.id, type: s.type, x: s.x, y: s.y }));
  const layer: MomentsLayer = momentsLayer({
    seed: SEED,
    n: N,
    sites,
    land,
    wonders,
    forceSights: true,
  });
  const seen: { kind: string; px: number; py: number }[] = [];
  layer.log = seen;

  const out = new Uint32Array(VIEW_W * VIEW_H);
  const bake = new Uint32Array(VIEW_W * VIEW_H);
  const rect: ViewRect = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
  const palette = look.palette;

  const drawAt = (cam: Cam, t: number): Uint32Array => {
    rect.x = Math.floor(cam.x) - (VIEW_W >> 1);
    rect.y = Math.floor(0.8 * cam.y - cam.e) - (VIEW_H >> 1);
    compose(chunks, palette, rect, out, undefined, undefined, bake);
    seen.length = 0;
    layer.draw({ out, bake, rect, t, palette, n: N });
    paperGrain(out, rect, mask);
    return out.slice();
  };

  const want = new Set(names);
  const shots = shotsOf(world, made.settlement.wonders, made.settlement.sites, land, made.land.shoreClass).filter((s) => want.has(s.name));
  const dir = outDir ?? join(process.cwd(), ".cache", "world-live");
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const wideW = VIEW_W * WIDE_SCALE;
  const wideH = VIEW_H * WIDE_SCALE;
  const closeW = CLOSE_W * CLOSE_SCALE;
  const closeH = CLOSE_H * CLOSE_SCALE;

  for (let s = 0; s < shots.length; s++) {
    const shot = shots[s];
    layer.only = shot.only;
    const wides: Uint32Array[] = [];
    const closes: Uint32Array[] = [];
    for (let k = 0; k < FRAC.length; k++) {
      const { t, at } = timeOf(FRAC[k], shot.lasts, shot.lead);
      const wideCam = shot.wide(at);
      const widePx = drawAt(wideCam, t);
      const wideKinds = seen.map((n) => n.kind).join(" ");
      wides.push(upscale(widePx, VIEW_W, VIEW_H, WIDE_SCALE));
      const closeCam = shot.close(at);
      const closePx = drawAt(closeCam, t);
      const closeKinds = seen.map((n) => n.kind).join(" ");
      const cx = closeCam.fx ?? (VIEW_W >> 1);
      const cy = closeCam.fy ?? (VIEW_H >> 1);
      closes.push(upscale(crop(closePx, VIEW_W, VIEW_H, cx, cy), CLOSE_W, CLOSE_H, CLOSE_SCALE));
      console.log(`${shot.name} ${FRAC[k]} wide:${wideKinds || "—"} close:${closeKinds || "—"}`);
    }
    const wideSheet = creamSheet(wides, wideW, wideH);
    const closeSheet = creamSheet(closes, closeW, closeH);
    const wideFile = join(dir, `moment-${shot.name}.png`);
    const closeFile = join(dir, `moment-${shot.name}-close.png`);
    writeFileSync(wideFile, encodePng(wideSheet.rgba, wideSheet.w, wideSheet.h));
    writeFileSync(closeFile, encodePng(closeSheet.rgba, closeSheet.w, closeSheet.h));
    files.push(wideFile, closeFile);
  }
  return files;
}
