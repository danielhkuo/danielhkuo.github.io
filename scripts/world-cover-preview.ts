// Renders top-down cover previews to .cache/world-renders/cover/: one map per
// region archetype at one pixel per cell, a 3× view-sized crop of each, and a
// sheet of the home crop through the seasons and the day.
//
//   node scripts/world-cover-preview.ts [--seed 7] [--n 6400] [--size 1024x768] [--only home,karst]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { paint, renderCoverPreview, upscale, type Preview } from "../src/world/cli/cover-preview.ts";
import { encodePng } from "../src/world/cli/png.ts";
import { paramsFor } from "../src/world/gen/params.ts";
import { planWorld } from "../src/world/gen/plan.ts";
import { MATERIAL_NAMES } from "../src/world/look/materials.ts";

const args = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const seed = Number(arg("seed", "7"));
const n = Number(arg("n", "6400"));
const [w, h] = arg("size", "1024x768").split("x").map(Number);
const only = arg("only", "home,highland,slate,lakes,karst").split(",");
const outDir = fileURLToPath(new URL("../.cache/world-renders/cover/", import.meta.url));
const mask = new Uint8Array(readFileSync(fileURLToPath(new URL("../public/world/bluenoise.bin", import.meta.url))));
const NAMES = ["home", "highland", "slate", "lakes", "karst", "skerry"];
const VIEW_W = 400;
const VIEW_H = 225;
const NOON = { time: 0.5, season: 0.25, overcast: 0 };

mkdirSync(outDir, { recursive: true });
const plan = planWorld(paramsFor(n), seed);

function save(name: string, rgba: Uint8Array, pw: number, ph: number): void {
  writeFileSync(`${outDir}${name}.png`, encodePng(rgba, pw, ph));
  console.log(`${outDir}${name}.png  ${pw}×${ph}`);
}

function crop(p: Preview, cx: number, cy: number): { material: Uint8Array; light: Uint8Array } {
  const material = new Uint8Array(VIEW_W * VIEW_H);
  const light = new Uint8Array(VIEW_W * VIEW_H);
  for (let y = 0; y < VIEW_H; y++) {
    for (let x = 0; x < VIEW_W; x++) {
      const i = (cy + y) * p.w + cx + x;
      material[y * VIEW_W + x] = p.material[i];
      light[y * VIEW_W + x] = p.light[i];
    }
  }
  return { material, light };
}

for (const name of only) {
  const core = plan.cores.find((c) => c.archetype === NAMES.indexOf(name));
  if (!core) continue;
  // South of the spine, where the camera looks: valley sides, lowland and coast.
  const win = { n, x0: Math.round(core.x - w / 2), y0: Math.round(core.y - h * 0.3), w, h };
  const p = renderCoverPreview(plan, win, seed, mask, NOON);
  save(name, p.rgba, w, h);
  const cx = Math.floor((w - VIEW_W) / 2);
  const cy = Math.floor((h - VIEW_H) / 2);
  const view = crop(p, cx, cy);
  save(`${name}-view`, upscale(paint(view.material, view.light, VIEW_W, VIEW_H, NOON), VIEW_W, VIEW_H, 3), VIEW_W * 3, VIEW_H * 3);

  const shares: string[] = [];
  for (let m = 0; m < 256; m++) {
    const share = p.histogram[m] / (w * h);
    if (share >= 0.005) shares.push(`${MATERIAL_NAMES[m]} ${(share * 100).toFixed(1)}`);
  }
  console.log(`  ${name}: ${p.stamps} stamps; ${shares.join(", ")}`);

  if (name === only[0]) {
    // The same crop through the year (rows) and the day (columns).
    const seasons = [0, 0.25, 0.5, 0.75];
    const times = [0.25, 0.5, 0.8, 0.95];
    const sheet = new Uint8Array(VIEW_W * 4 * VIEW_H * 4 * 4);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const tile = paint(view.material, view.light, VIEW_W, VIEW_H, { time: times[c], season: seasons[r], overcast: 0 });
        for (let y = 0; y < VIEW_H; y++) {
          sheet.set(tile.subarray(y * VIEW_W * 4, (y + 1) * VIEW_W * 4), ((r * VIEW_H + y) * VIEW_W * 4 + c * VIEW_W) * 4);
        }
      }
    }
    save(`${name}-moods`, sheet, VIEW_W * 4, VIEW_H * 4);
    save(`${name}-overcast`, upscale(paint(view.material, view.light, VIEW_W, VIEW_H, { time: 0.5, season: 0.25, overcast: 1 }), VIEW_W, VIEW_H, 2), VIEW_W * 2, VIEW_H * 2);
  }
}
