// Renders a whole-world overview to .cache/world-map/<n>-<seed>.png. Usage: npm run world:map -- --seed 3 --n 10240

import { main } from "../src/world/cli/map.ts";

process.exitCode = main(process.argv.slice(2));
