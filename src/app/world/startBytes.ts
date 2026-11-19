// Server only: what the flight fetches before its first view, read from public/world at build time.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Bytes the flight fetches before its first view: the manifest, the core, and the 2 × 2 regions round the start (the
 * phone's "before you fly" card states it). 0 when the world files are absent or in another format.
 */
export function startBytes(): number {
  try {
    const dir = path.join(process.cwd(), "public", "world");
    const { worldId } = JSON.parse(readFileSync(path.join(dir, "current.json"), "utf8")) as { worldId: string };
    const root = path.join(dir, worldId);
    const m = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as { n: number; regionCells?: number; start: { x: number; y: number } };
    let bytes = statSync(path.join(root, "manifest.json")).size + statSync(path.join(root, "core.bin")).size;
    if (m.regionCells) {
      const per = Math.round(m.n / m.regionCells);
      const rx = Math.floor(m.start.x / m.regionCells - 0.5);
      const ry = Math.floor(m.start.y / m.regionCells - 0.5);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const file = path.join(root, "regions", `${(((rx + dx) % per) + per) % per}-${(((ry + dy) % per) + per) % per}.bin`);
        try {
          bytes += statSync(file).size;
        } catch {
          // a region the build left out: it is not fetched either
        }
      }
    }
    return bytes;
  } catch {
    return 0;
  }
}
