// Renders each placed wonder, at 1× and close up, to .cache/wonders/. Usage: npm run world:wonders [-- --only baths]

import { main } from "../src/world/cli/wonders.ts";

process.exitCode = main(process.argv.slice(2));
