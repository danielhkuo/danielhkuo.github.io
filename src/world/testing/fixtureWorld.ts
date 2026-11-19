// The world the live-layer tests draw: seed 3 at 6400 cells, the first world shipped (format 1), kept here as a
// fixture so the tests stay pinned to known places (the waterfall, the harbour, the start) whatever world the site
// ships. Read it with readShipped(FIXTURE_WORLD).

import { fileURLToPath } from "node:url";

export const FIXTURE_WORLD = fileURLToPath(new URL("./fixture-world/", import.meta.url));
