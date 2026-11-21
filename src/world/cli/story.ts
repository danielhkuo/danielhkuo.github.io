// The quest's monument points for a world build or a render: read from src/world/story/places.json, which was chosen
// on renders of one seed and size. Another world gets none (scripts/story-places.ts finds points for it).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MonumentKey } from "../gen/monuments.ts";

const KEYS: readonly MonumentKey[] = ["pine", "desk", "bell", "mill", "basket"];

export function storyMonuments(n: number, seed: number): { key: MonumentKey; x: number; y: number }[] {
  const file = JSON.parse(readFileSync(fileURLToPath(new URL("../story/places.json", import.meta.url)), "utf8")) as {
    seed?: number;
    n?: number;
    stops?: Record<string, { x: number; y: number }>;
  };
  if (file.seed !== seed || file.n !== n || !file.stops) {
    console.warn(`story: places.json is for seed ${file.seed} at ${file.n}, not seed ${seed} at ${n}: no monuments`);
    return [];
  }
  const out: { key: MonumentKey; x: number; y: number }[] = [];
  for (const key of KEYS) {
    const p = file.stops[key];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out.push({ key, x: p.x, y: p.y });
  }
  return out;
}
