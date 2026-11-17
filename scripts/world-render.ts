// Renders world viewpoints to .cache/world-renders/<n>-<seed>/. Usage: npm run world:render -- --n 2048 --seed 7

import { main } from "../src/world/cli/render.ts";

main(process.argv.slice(2));
