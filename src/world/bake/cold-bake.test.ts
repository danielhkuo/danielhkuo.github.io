// A cold bake, as each of the page's workers makes its first: buildCells must stay in its optimised code.
//
// buildCells is one long function that runs a few times a tile. V8 optimises it by entering at whichever loop grows hot
// first; when that is a loop nested inside the per-cell loop (the tree crown's stamp, once per tree), every exit from
// it throws the function back to the interpreter. On world 3a2f194713e2 that happened 22 600 times over the start
// view's four chunks and doubled their bake (2.9 s against 1.4 s), which is the page's time to its first full view.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const { worldId } = JSON.parse(readFileSync(join(root, "public/world/current.json"), "utf8")) as { worldId: string };
const dir = join(root, "public/world", worldId);
const shipped = existsSync(join(dir, "core.bin"));
const url = (p: string) => JSON.stringify(pathToFileURL(join(root, p)).href);

/** Bakes the start view's first chunks (those the view wants before any other) by one cold host, in a fresh process. */
const probe = `
  import { readFileSync } from "node:fs";
  const { createTiledBakeHost } = await import(${url("src/world/runtime/tiledHost.ts")});
  const { decodeCore } = await import(${url("src/world/pack/regions.ts")});
  const { createRegionLand } = await import(${url("src/world/runtime/regionLand.ts")});
  const { createStreamView } = await import(${url("src/world/runtime/stream.ts")});
  const { buildPalette, MIDDAY } = await import(${url("src/world/render/palette.ts")});
  const { startState } = await import(${url("src/world/runtime/flight.ts")});
  const dir = ${JSON.stringify(dir)};
  const mask = new Uint8Array(readFileSync(${JSON.stringify(join(root, "public/world/bluenoise.bin"))}));
  const manifest = JSON.parse(readFileSync(dir + "/manifest.json", "utf8"));
  const coreBin = new Uint8Array(readFileSync(dir + "/core.bin"));
  const fetchRegion = async (rx, ry) => new Uint8Array(readFileSync(dir + "/regions/" + rx + "-" + ry + ".bin"));
  const land = createRegionLand(await decodeCore(coreBin), fetchRegion);
  let wants = [];
  const pool = { want(l) { wants = l; }, onBaked: null, onError: null, stats: () => ({}), dispose() {} };
  const view = createStreamView(land, pool, buildPalette(MIDDAY), mask, { width: 400, height: 225 });
  const s = startState(manifest.start, view);
  view.setCamera(s.x, s.y - s.alt / 0.8);
  view.update(0, 0);
  const bake = await createTiledBakeHost(coreBin, fetchRegion, mask);
  const first = wants.filter((w) => w.priority < 1);
  for (const w of first) await bake(w.cx, w.cy);
  console.log("chunks " + first.length);
`;

test("a cold bake of the start view keeps buildCells in its optimised code", { skip: !shipped && "the shipped world is not here" }, () => {
  const out = execFileSync(
    process.execPath,
    ["--trace-deopt", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "-e", probe],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  );
  assert.match(out, /chunks [1-9]/, "the start view's chunks were baked");
  const exits = out.split("\n").filter((l) => l.includes("exit from OSR'd inner loop") && l.includes("<JSFunction buildCells ")).length;
  // A few dozen are left by loops that run once a row; one a tree is the fault.
  assert.ok(exits < 1000, `buildCells was thrown out of its optimised code ${exits} times`);
});

test("buildCells calls its loop helpers out of line, so the minifier does not fold them back", () => {
  // The production minifier inlines a function called from one place. It turned stampCrown back into a function
  // expression made and called per tree, inside the per-cell loop, and the browser's workers were thrown out of
  // optimised code at that loop again (33 000 times at the start). The annotation keeps each one a function of its own.
  const src = readFileSync(join(root, "src/world/bake/cells.ts"), "utf8");
  for (const name of ["blendRegions", "stampCrown", "marchShadow"]) {
    const calls = [...src.matchAll(new RegExp(`(\\/\\*#__NOINLINE__\\*\\/ )?\\b${name}\\(`, "g"))].filter((m) => !src.slice(Math.max(0, (m.index ?? 0) - 9), m.index).includes("function"));
    assert.ok(calls.length >= 1, `${name} is called`);
    for (const c of calls) assert.ok(c[1], `a call to ${name} without /*#__NOINLINE__*/`);
  }
});
