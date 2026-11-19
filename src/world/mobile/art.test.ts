import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { FACE, INK, INK_SOFT, PAPER, PAPER_WASH, VERMILION, VERMILION_DARK, type Sprite } from "../controls/glyphs.ts";
import { roundel, stickKnob, stickWell } from "./art.ts";
import { drawPinned, pinnedScenes } from "./art-scenes.ts";

const count = (s: Sprite, slot: number) => s.px.reduce((a, v) => a + (v === slot ? 1 : 0), 0);
const hash = (a: Uint32Array) => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex");

test("a roundel is cream with an inked double ring and an inked glyph; pressed, it fills vermilion with a paper glyph", () => {
  for (const kind of ["boost", "brake", "land"] as const) {
    for (const r of [9, 14, 22, 30]) {
      const idle = roundel(kind, r, false);
      assert.equal(idle.w, 2 * r + 2);
      if (r >= 14 && kind !== "land") assert.ok(count(idle, FACE) > count(idle, INK), `${kind} ${r}: mostly paper`);
      assert.ok(count(idle, FACE) > 0, `${kind} ${r}: a paper face`);
      assert.ok(count(idle, INK) > 2 * Math.PI * r, `${kind} ${r}: an inked rim and glyph`);
      assert.ok(count(idle, INK_SOFT) > 0, `${kind} ${r}: the inner ring`);
      const pressed = roundel(kind, r, true);
      assert.equal(count(pressed, FACE), 0);
      assert.ok(count(pressed, VERMILION) > 0 && count(pressed, VERMILION_DARK) > 0);
      assert.ok(count(pressed, PAPER) > 0, `${kind} ${r}: the glyph turns paper`);
      // The pressed rim is a pixel thicker, so it shows round a thumb: the outermost ring of pixels is drawn.
      const edge = (s: Sprite) => [...s.px.subarray(0, s.w)].filter((v) => v !== 0).length;
      assert.ok(edge(pressed) > edge(idle), `${kind} ${r}: the pressed rim reaches the edge`);
    }
  }
});

test("the stick is a washed well in an inked ring, with a quatrefoil knob that reddens while held", () => {
  const well = stickWell(30);
  assert.ok(count(well, PAPER_WASH) > Math.PI * 25 * 25);
  assert.ok(count(well, INK) > 2 * Math.PI * 29);
  const rest = stickKnob(12, false);
  const held = stickKnob(12, true);
  assert.ok(count(rest, FACE) > 0 && count(rest, VERMILION) === 0);
  assert.ok(count(held, VERMILION) > 0 && count(held, FACE) === 0);
  // Four lobes: the knob is wider across its middle row than at the middle of a lobe's side.
  const row = (s: Sprite, y: number) => [...s.px.subarray(y * s.w, (y + 1) * s.w)].filter((v) => v !== 0).length;
  assert.ok(row(rest, rest.h >> 1) > row(rest, 2));
});

// Golden hashes of the pinned scenes: any change to the controls' pixels must be judged on renders and retaken here.
const GOLDEN: Record<string, string> = {
  "fill-held": "4aab6c44ddf2235fba89ec646d9e3841f99a6c065ffa9756581f1ed17ba2c644",
  "fill-huge": "5331ecc33310cd80bfdc9246c7e02658bb26ac8a9ede7c5b4a810ac5effe2105",
  "fill-idle": "ba951af8b1f776b68281350db314578ba4ac86507d6f92c132c5fb960c2046cc",
  "fill-left": "3b1aef9b8daba2bd616b2a3ffe9ca8aa1c7408f22ac0327be3e55818dbf3c6ef",
  "letterbox-held": "2ba7db5db64a751eb161b8d718fa9f81babe2f3b19c6d93a876f024fd489930b",
  "letterbox-huge": "430ce679126052a80be3f8d86c214b1be36474f5c7c0bfe6af3dbff1d25398f0",
  "letterbox-idle": "e50ba22a78422fb85145961e1f37348bef5c12782b609b7f601cf52e2c12652e",
  "letterbox-left": "b37d6c027a0fe3efbde8a4a538a3bca14296dfd0876ab6d886f7ebb1b609fdb1",
  "tabbar-held": "abc4a8c8eee5ef2f5df5a0380fcd47e85d094146defc0b52f05aa6ff2ad8a95a",
  "tabbar-huge": "67e6f8c3e2a931dcfc1a6468b075f8bf0e19678c521a3b7baae27ab42cfc561e",
  "tabbar-idle": "7da12d8ef6a685803b7dd85742869c0c4fbe6d86e827ceaca75a3acae0e13edd",
  "tabbar-left": "9de95826b0ba938966aba27511b7d33cefa3f537a185e359c189006c08eea4ac",
};

test("the pinned scenes draw the same pixels as when they were judged", () => {
  for (const p of pinnedScenes()) {
    const h = hash(drawPinned(p));
    if (process.env.PRINT_GOLDENS) console.log(`  "${p.name}": "${h}",`);
    else assert.equal(h, GOLDEN[p.name], p.name);
  }
});
