// The dragon studies over the shipped world, and their contact sheet. Usage: npm run world:dragon

import { main } from "../src/world/cli/dragon.ts";

main(process.argv.slice(2)).then((code) => process.exit(code));
