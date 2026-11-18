// The cloud contact sheet: the shipped world drawn with each cloud style, side by side.
//
//   npm run world:clouds [-- --t <seconds>]
//
// Writes .cache/world-clouds/sheet.png (styles as columns, views as rows) and each frame on its own.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { worldLook } from "../bake/look.ts";
import { wrap } from "../core/torus.ts";
import { encodePng } from "./png.ts";
import type { Manifest } from "../pack/manifest.ts";
import { decodeWorld } from "../pack/world.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import type { FlightState } from "../runtime/flight.ts";
import { drawFlier } from "../runtime/standin.ts";
import { createView } from "../runtime/view.ts";
import { ALT, cloudAt } from "../sky/field.ts";
import { createSky } from "../sky/sky.ts";
import { STYLE_NAMES, STYLES } from "../sky/styles.ts";

const VIEW_W = 400;
const VIEW_H = 225;
const GAP = 8;
const SCALE = 2;
const CREAM_R = 0xf0;
const CREAM_G = 0xe8;
const CREAM_B = 0xd2;

const LAND_VIEWS = ["start", "town", "peak", "sea"] as const;
/** Further views: the heaviest weather, and a second stretch of coast. */
const EXTRA_VIEWS = ["heavy", "coast"] as const;

function readT(argv: readonly string[]): number {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--t") {
      const n = Number(argv[i + 1]);
      return Number.isFinite(n) ? n : 0;
    }
    if (arg.startsWith("--t=")) {
      const n = Number(arg.slice(4));
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

function rgbaOf(px: Uint32Array): Uint8Array {
  return new Uint8Array(px.buffer, px.byteOffset, px.byteLength);
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

/** Parses argv, renders the sheet and the frames, prints where they are; 0 on success. */
export async function main(argv: readonly string[]): Promise<number> {
  const t = readT(argv);
  const worldRoot = fileURLToPath(new URL("../../../public/world/", import.meta.url));
  const current = JSON.parse(readFileSync(join(worldRoot, "current.json"), "utf8")) as { worldId: string };
  const id = current.worldId;
  const manifest = JSON.parse(readFileSync(join(worldRoot, id, "manifest.json"), "utf8")) as Manifest;
  const bin = new Uint8Array(readFileSync(join(worldRoot, id, "world.bin")));
  const world = await decodeWorld(bin);
  const mask = new Uint8Array(readFileSync(join(worldRoot, "bluenoise.bin")));
  const look = worldLook(world.n, buildPalette(MIDDAY));

  let town = manifest.sites[0];
  for (let i = 0; i < manifest.sites.length; i++) {
    if (manifest.sites[i].type === "town") {
      town = manifest.sites[i];
      break;
    }
  }
  let peakI = 0;
  const ground = world.ground;
  for (let i = 1; i < ground.length; i++) if (ground[i] > ground[peakI]) peakI = i;
  const gN = world.gN;
  const gx = peakI % gN;
  const gy = (peakI - gx) / gN;
  const step = world.n / gN;
  const start = manifest.start;
  const places: Record<(typeof LAND_VIEWS)[number], { x: number; y: number }> = {
    start: { x: start.x, y: start.y },
    town: { x: town.x, y: town.y },
    peak: { x: gx * step + step / 2, y: gy * step + step / 2 },
    sea: { x: wrap(start.x - 600 * start.dx, world.n), y: wrap(start.y - 600 * start.dy, world.n) },
  };

  const dir = join(process.cwd(), ".cache", "world-clouds");
  mkdirSync(dir, { recursive: true });

  const cols = STYLE_NAMES.length;
  const rows = LAND_VIEWS.length + 1 + EXTRA_VIEWS.length;
  const cellW = VIEW_W * SCALE;
  const cellH = VIEW_H * SCALE;
  const sheetW = (cols + 1) * GAP + cols * cellW;
  const sheetH = (rows + 1) * GAP + rows * cellH;
  const sheet = new Uint8Array(sheetW * sheetH * 4);
  for (let i = 0; i < sheet.length; i += 4) {
    sheet[i] = CREAM_R;
    sheet[i + 1] = CREAM_G;
    sheet[i + 2] = CREAM_B;
    sheet[i + 3] = 255;
  }

  const frames: Uint8Array[][] = [];
  for (let s = 0; s < STYLE_NAMES.length; s++) {
    const style = STYLES[STYLE_NAMES[s]];
    const sky = createSky(manifest.seed, world.n, style, start);
    const column: Uint8Array[] = [];
    const drawAt = (x: number, y: number): Uint8Array => {
      const view = createView(world, look, mask, { width: VIEW_W, height: VIEW_H });
      view.setCamera(x, y);
      const frame = new Uint32Array(VIEW_W * VIEW_H);
      view.frame(frame, t);
      const rect = view.rect();
      sky.draw(frame, rect, t, "below");
      const state: FlightState = {
        x,
        y,
        heading: -Math.PI / 2,
        speed: 60,
        alt: view.groundHeight(x, y) + 18,
        bank: 0,
      };
      drawFlier(frame, rect, state, view);
      sky.draw(frame, rect, t, "above");
      return rgbaOf(frame);
    };
    for (let v = 0; v < LAND_VIEWS.length; v++) {
      const place = places[LAND_VIEWS[v]];
      column.push(drawAt(place.x, place.y));
    }
    // The bank view: the kite in the middle of the first bank.
    let bx = start.x;
    let by = start.y;
    for (let i = 0; i < sky.field.clouds.length; i++) {
      const c = sky.field.clouds[i];
      if (c.layer === "bank") {
        const p = cloudAt(sky.field, c, t);
        const shape = sky.shapes[c.shape];
        bx = wrap(p.x + shape.w / 2, world.n);
        by = wrap(p.y + (0.6 * shape.h - ALT.bank + 18) / 0.8, world.n);
        break;
      }
    }
    column.push(drawAt(bx, by));
    // The heaviest view: the most low cloud among a spread of views. Then the coast north-east of the start.
    let hx = start.x, hy = start.y, most = -1;
    for (let k = 0; k < 160; k++) {
      const x = (k * 977) % world.n, y = (k * 613) % world.n;
      const probe = new Uint32Array(VIEW_W * VIEW_H);
      sky.draw(probe, { x: Math.floor(x) - VIEW_W / 2, y: Math.floor(0.8 * y) - (VIEW_H >> 1), w: VIEW_W, h: VIEW_H }, t, "below");
      let covered = 0;
      for (let i = 0; i < probe.length; i++) if (probe[i] !== 0) covered++;
      if (covered > most) { most = covered; hx = x; hy = y; }
    }
    column.push(drawAt(hx, hy));
    column.push(drawAt(wrap(start.x + 520, world.n), wrap(start.y - 420, world.n)));
    frames.push(column);
  }

  const written: string[] = [];
  for (let s = 0; s < STYLE_NAMES.length; s++) {
    const name = STYLE_NAMES[s];
    for (let v = 0; v < rows; v++) {
      const label = v < LAND_VIEWS.length ? LAND_VIEWS[v] : v === LAND_VIEWS.length ? "bank" : EXTRA_VIEWS[v - LAND_VIEWS.length - 1];
      const file = join(dir, `${name}-${label}.png`);
      writeFileSync(file, encodePng(frames[s][v], VIEW_W, VIEW_H));
      written.push(file);
      const dx = GAP + s * (cellW + GAP);
      const dy = GAP + v * (cellH + GAP);
      blit2(sheet, sheetW, dx, dy, frames[s][v], VIEW_W, VIEW_H);
    }
  }
  const sheetFile = join(dir, "sheet.png");
  writeFileSync(sheetFile, encodePng(sheet, sheetW, sheetH));
  written.push(sheetFile);
  for (let i = 0; i < written.length; i++) console.log(written[i]);
  return 0;
}
