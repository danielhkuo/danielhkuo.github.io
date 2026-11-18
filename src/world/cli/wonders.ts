// The wonders' bench: sites the wonders on a world (the cached seed-3 world by
// default), bakes each one where it stands with the browser's own bake and
// compositor, and writes it at 1× and as a close-up, with the abbey and a
// lighthouse beside them for scale, plus a contact sheet, to .cache/wonders/.
//
//   npm run world:wonders [-- --n 6400 --seed 3 --only baths --no-cache]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { worldLook } from "../bake/look.ts";
import { buildBakeWorld } from "../bake/world.ts";
import { paramsFor } from "../gen/params.ts";
import { makeWorld, settleWorld } from "../gen/pipeline.ts";
import { WONDER_ORDER, type WonderType } from "../gen/wonders.ts";
import { buildPalette } from "../render/palette.ts";
import { createView } from "../runtime/view.ts";
import { encodePng } from "./png.ts";
import { loadBlueNoise, VIEW_H, VIEW_W } from "./render.ts";
import { cachedTerrain } from "./worldcache.ts";

/** The close-up: this much of the frame's middle, enlarged CLOSE_SCALE times. */
const CLOSE_W = 160;
const CLOSE_H = 90;
const CLOSE_SCALE = 5;

interface Shot {
  name: string;
  /** Where the 1× frame centres, and where the close-up does: cells, and the height of what stands there. */
  wide: readonly [number, number, number];
  close: readonly [number, number, number];
}

function upscale(src: Uint32Array, w: number, h: number, f: number): Uint32Array {
  const out = new Uint32Array(w * f * h * f);
  for (let y = 0; y < h * f; y++) {
    const sy = Math.floor(y / f) * w, row = y * w * f;
    for (let x = 0; x < w * f; x++) out[row + x] = src[sy + Math.floor(x / f)];
  }
  return out;
}

function crop(src: Uint32Array, w: number, x0: number, y0: number, cw: number, ch: number): Uint32Array {
  const out = new Uint32Array(cw * ch);
  for (let y = 0; y < ch; y++) out.set(src.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + cw), y * cw);
  return out;
}

function bytes(px: Uint32Array): Uint8Array {
  return new Uint8Array(px.buffer, px.byteOffset, px.byteLength);
}

export interface WondersBenchOptions {
  n: number;
  seed: number;
  cache: boolean;
  only?: readonly WonderType[];
  outDir?: string;
  log?: (line: string) => void;
}

/** Renders every placed wonder and returns the files written, the contact sheet last. */
export function renderWonders(opts: WondersBenchOptions): string[] {
  const log = opts.log ?? (() => {});
  const { n, seed } = opts;
  const params = paramsFor(n);
  const settle = { wonders: opts.only ?? true };
  const made = opts.cache ? settleWorld(cachedTerrain(params, seed), settle) : makeWorld(params, seed, settle);
  const s = made.settlement;
  for (const w of s.wonders) log(`${w.id}: cell (${Math.round(w.x)}, ${Math.round(w.y)}) level ${w.level.toFixed(1)} score ${w.score.toFixed(2)}`);
  for (const line of s.wonderSkips) log(`skipped ${line}`);

  const shots: Shot[] = s.wonders.map((w) => {
    const cx = (w.box[0] + w.box[2]) / 2, cy = (w.box[1] + w.box[3]) / 2;
    // The railway is far wider than a close-up: its close-up is the halt.
    const close: readonly [number, number, number] = w.type === "railway" ? [w.x, w.y, w.level + 4] : [cx, cy, w.level * 0.5 + w.height * 0.3];
    return { name: w.id, wide: [cx, cy + 20, w.level * 0.5], close };
  });
  // For scale and style: the abbey and the first lighthouse, framed the same way.
  for (const type of ["abbey", "lighthouse"] as const) {
    const site = s.sites.find((q) => q.type === type);
    if (site) shots.push({ name: `ref-${site.id}`, wide: [site.x, site.y + 20, site.level], close: [site.x, site.y, site.level + 12] });
  }

  const world = buildBakeWorld({ params, seed, world: made });
  const look = worldLook(n, buildPalette({ time: 0.5, season: 0.25, overcast: 0 }));
  const view = createView(world, look, loadBlueNoise(), { width: VIEW_W, height: VIEW_H, cacheChunks: 64 });
  const dir = opts.outDir ?? join(process.cwd(), ".cache", "wonders");
  mkdirSync(dir, { recursive: true });
  const frame = (x: number, y: number, e: number): Uint32Array => {
    view.setCamera(x, y - e / 0.8);
    const out = new Uint32Array(VIEW_W * VIEW_H);
    view.frame(out);
    return out;
  };

  const files: string[] = [];
  const cw = CLOSE_W * CLOSE_SCALE, ch = CLOSE_H * CLOSE_SCALE;
  const rows: [Uint32Array, Uint32Array][] = [];
  for (const shot of shots) {
    const wide = frame(shot.wide[0], shot.wide[1], shot.wide[2]);
    const near = frame(shot.close[0], shot.close[1], shot.close[2]);
    const close = upscale(crop(near, VIEW_W, (VIEW_W - CLOSE_W) >> 1, (VIEW_H - CLOSE_H) >> 1, CLOSE_W, CLOSE_H), CLOSE_W, CLOSE_H, CLOSE_SCALE);
    writeFileSync(join(dir, `${shot.name}.png`), encodePng(bytes(wide), VIEW_W, VIEW_H));
    writeFileSync(join(dir, `${shot.name}-close.png`), encodePng(bytes(close), cw, ch));
    files.push(join(dir, `${shot.name}.png`), join(dir, `${shot.name}-close.png`));
    rows.push([upscale(wide, VIEW_W, VIEW_H, 2), close]);
  }

  // The contact sheet: one row a shot, the 1× frame doubled beside its close-up.
  const gap = 6, lw = VIEW_W * 2, lh = VIEW_H * 2;
  const sw = lw + cw + 3 * gap, sh = rows.length * (lh + gap) + gap;
  const sheet = new Uint32Array(sw * Math.max(sh, 1)).fill(0xff2a2422);
  rows.forEach(([wide, close], k) => {
    const oy = gap + k * (lh + gap);
    for (let y = 0; y < lh; y++) sheet.set(wide.subarray(y * lw, (y + 1) * lw), (oy + y) * sw + gap);
    for (let y = 0; y < ch; y++) sheet.set(close.subarray(y * cw, (y + 1) * cw), (oy + y) * sw + 2 * gap + lw);
  });
  if (rows.length > 0) {
    writeFileSync(join(dir, "contact.png"), encodePng(bytes(sheet), sw, sh));
    files.push(join(dir, "contact.png"));
  }
  return files;
}

export function main(argv: readonly string[]): number {
  let n = 6400, seed = 3, cache = true, outDir: string | undefined;
  const only: WonderType[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--n") n = Number(argv[++i]);
    else if (a === "--seed") seed = Number(argv[++i]);
    else if (a === "--out") outDir = argv[++i];
    else if (a === "--no-cache") cache = false;
    else if (a === "--only") {
      const type = argv[++i] as WonderType;
      if (!WONDER_ORDER.includes(type)) {
        console.error(`unknown wonder ${type}; one of ${WONDER_ORDER.join(", ")}`);
        return 1;
      }
      only.push(type);
    } else {
      console.error(`unknown argument ${a}`);
      return 1;
    }
  }
  const files = renderWonders({ n, seed, cache, outDir, only: only.length ? only : undefined, log: (l) => console.log(l) });
  console.log(files.length ? files[files.length - 1] : "no wonder was placed: nothing to render");
  return 0;
}
