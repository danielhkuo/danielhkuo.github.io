// Writes public/world/bluenoise.bin: the 256² blue-noise mask, one byte per cell.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BLUE_SEED, ranksToU8, voidAndCluster } from "../src/world/core/bluenoise.ts";

const out = fileURLToPath(new URL("../public/world/bluenoise.bin", import.meta.url));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, ranksToU8(voidAndCluster(256, BLUE_SEED)));
