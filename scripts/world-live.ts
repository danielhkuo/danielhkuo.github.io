// Frame strips of the shipped world with its live layers. Usage: npm run world:live -- --view falls

import { main } from "../src/world/cli/live.ts";

main(process.argv.slice(2)).then((code) => process.exit(code));
