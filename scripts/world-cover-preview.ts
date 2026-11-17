// Renders cover previews on the real land to .cache/world-renders/cover/:
// for each region archetype a top-down map at one pixel per cell, and the
// camera's view (3×) of its most farmed and its most varied ground; plus the
// home view through the seasons and the day.
//
//   node scripts/world-cover-preview.ts [--seed 7] [--n 2048] [--size 1024x768] [--only home,karst] [--tag name]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  busiest, cameraFrame, coverShares, mapWindow, paint, previewWorld, upscale, VIEW_H, VIEW_W,
} from "../src/world/cli/cover-preview.ts";
import { encodePng } from "../src/world/cli/png.ts";
import { NOON, worldLook } from "../src/world/look/look.ts";
import { isCrop, isWater } from "../src/world/look/materials.ts";
import { buildPalette } from "../src/world/render/palette.ts";

const args = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const seed = Number(arg("seed", "7"));
const n = Number(arg("n", "2048"));
const [w, h] = arg("size", "1024x768").split("x").map(Number);
const only = arg("only", "home,highland,slate,lakes,karst").split(",");
const tag = arg("tag", "");
const root = fileURLToPath(new URL("../.cache/", import.meta.url));
const outDir = `${root}world-renders/cover/`;
const mask = new Uint8Array(readFileSync(fileURLToPath(new URL("../public/world/bluenoise.bin", import.meta.url))));
const NAMES = ["home", "highland", "slate", "lakes", "karst", "skerry"];

mkdirSync(outDir, { recursive: true });
const { world, plan } = previewWorld(n, seed, `${root}world`);
const look = worldLook(n);

function save(name: string, rgba: Uint8Array, pw: number, ph: number): void {
  const file = `${outDir}${name}${tag ? `-${tag}` : ""}-${n}.png`;
  writeFileSync(file, encodePng(rgba, pw, ph));
  console.log(`${file}  ${pw}×${ph}`);
}

for (const name of only) {
  const core = plan.cores.find((c) => c.archetype === NAMES.indexOf(name));
  if (!core) continue;
  const x0 = Math.round(core.x - w / 2);
  const y0 = Math.round(core.y - h / 2);
  const map = mapWindow(world, look, mask, x0, y0, w, h);
  save(name, paint(map, look.palette), w, h);
  console.log(`  ${name}: ${coverShares(map, isWater).join(", ")}`);

  const farm = busiest(map, isCrop);
  const frame = cameraFrame(world, look, mask, x0 + farm.x, y0 + farm.y);
  save(`${name}-view`, upscale(frame, VIEW_W, VIEW_H, 3), VIEW_W * 3, VIEW_H * 3);

  if (name === only[0]) {
    // The same view through the year (rows) and the day (columns).
    const seasons = [0, 0.25, 0.5, 0.75];
    const times = [0.25, 0.5, 0.8, 0.95];
    const sheet = new Uint8Array(VIEW_W * 4 * VIEW_H * 4 * 4);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const mood = { ...look, palette: buildPalette({ time: times[c], season: seasons[r], overcast: 0 }) };
        const tile = cameraFrame(world, mood, mask, x0 + farm.x, y0 + farm.y);
        for (let y = 0; y < VIEW_H; y++) {
          sheet.set(tile.subarray(y * VIEW_W * 4, (y + 1) * VIEW_W * 4), ((r * VIEW_H + y) * VIEW_W * 4 + c * VIEW_W) * 4);
        }
      }
    }
    save(`${name}-moods`, sheet, VIEW_W * 4, VIEW_H * 4);
    const grey = { ...look, palette: buildPalette({ ...NOON, overcast: 1 }) };
    save(`${name}-overcast`, upscale(cameraFrame(world, grey, mask, x0 + farm.x, y0 + farm.y), VIEW_W, VIEW_H, 2), VIEW_W * 2, VIEW_H * 2);
  }
}
