// Builds the shipped world. Usage: npm run world:build -- --seed 3 [--n 6400] [--cache]

import { main } from "../src/world/cli/build.ts";

main(process.argv.slice(2)).then((code) => process.exit(code));
