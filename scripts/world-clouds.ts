// Renders the cloud styles side by side on the shipped world. Usage: npm run world:clouds

import { main } from "../src/world/cli/clouds.ts";

main(process.argv.slice(2)).then((code) => process.exit(code));
