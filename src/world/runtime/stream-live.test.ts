import assert from "node:assert/strict";
import { test } from "node:test";
import type { LiveFrame, LiveLayer } from "../live/live.ts";
import type { FlightData } from "../pack/world.ts";
import { buildPalette } from "../render/palette.ts";
import { fieldWorld, loadMask } from "../testing/bakefix.ts";
import type { BakePool, ChunkWant } from "./pool.ts";
import { createStreamView } from "./stream.ts";

const N = 1280, W = 400, H = 225;
const palette = buildPalette({ time: 0.5, season: 0.25, overcast: 0 });
const mask = loadMask();
const world = fieldWorld(N, () => 20);
const data: FlightData = { n: N, gN: world.gN, ground: world.ground, occlusion: new Uint8Array(0), block: 0 };
/** Every bake pixel in a chunk is material 5, tone 9, with its row as depth. */
function flatChunk(): Uint32Array {
  const px = new Uint32Array(256 * 256);
  for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) px[r * 256 + c] = (5 | (9 << 8) | (r << 16)) >>> 0;
  return px;
}

class InstantPool implements BakePool {
  onBaked: ((cx: number, cy: number, px: Uint32Array) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  bake: boolean;
  constructor(bake: boolean) {
    this.bake = bake;
  }
  want(list: readonly ChunkWant[]): void {
    if (this.bake) for (const w of list) this.onBaked?.(w.cx, w.cy, flatChunk());
  }
  stats() {
    return { inFlight: 0, queued: 0, baked: 0, bakeMs: 0, workers: 1 };
  }
  dispose(): void {}
}

test("after a frame, the view hands back the bake pixel under each pixel", () => {
  const view = createStreamView(data, new InstantPool(true), palette, mask, { width: W, height: H, paper: false });
  view.setCamera(640, 640);
  view.update(0, 0);
  view.frame(new Uint32Array(W * H));
  const bake = view.bakeFrame();
  assert.equal(bake.length, W * H);
  const r = view.rect();
  assert.equal(bake[0], (5 | (9 << 8) | ((((r.y % 256) + 256) % 256) << 16)) >>> 0);
});

test("under haze the bake pixel is 0", () => {
  const view = createStreamView(data, new InstantPool(false), palette, mask, { width: W, height: H, paper: false });
  view.setCamera(640, 640);
  view.update(0, 0);
  view.frame(new Uint32Array(W * H));
  assert.ok(view.bakeFrame().every((v) => v === 0));
});

test("live layers run after compositing and before the paper grain, and see the frame", () => {
  const order: string[] = [];
  let sawBake = 0, sawT = -1;
  const layer: LiveLayer = {
    name: "probe",
    draw: (f) => {
      order.push("layer");
      sawBake = f.bake[0];
      sawT = f.t;
      assert.equal(f.palette, palette);
      assert.deepEqual(f.rect, view.rect());
      // Paint one pixel pure black: the paper grain must still lie over it afterwards.
      f.out[100] = 0xff000000;
    },
  };
  const view = createStreamView(data, new InstantPool(true), palette, mask, { width: W, height: H, layers: [layer] });
  view.setCamera(640, 640);
  view.update(0, 0);
  const out = new Uint32Array(W * H);
  view.frame(out, 2.5);
  assert.deepEqual(order, ["layer"]);
  assert.notEqual(sawBake, 0);
  assert.equal(sawT, 2.5);
  // Paper grain changes most pixels a little; a pure-black pixel under grain either stays black (a hollow) or lifts toward cream.
  const plain = createStreamView(data, new InstantPool(true), palette, mask, { width: W, height: H, layers: [{ name: "black", draw: (f: LiveFrame) => { f.out.fill(0xff000000); } }] });
  plain.setCamera(640, 640);
  plain.update(0, 0);
  const grained = new Uint32Array(W * H);
  plain.frame(grained, 0);
  assert.ok(grained.some((v) => v !== 0xff000000), "the grain lies over what the layers drew");
});

test("a failing layer is reported once and the frame still draws", () => {
  const errors: string[] = [];
  const view = createStreamView(data, new InstantPool(true), palette, mask, {
    width: W, height: H, layers: [{ name: "broken", draw: () => { throw new Error("nope"); } }], onLayerError: (n, m) => errors.push(`${n}: ${m}`),
  });
  view.setCamera(640, 640);
  view.update(0, 0);
  const out = new Uint32Array(W * H);
  view.frame(out, 0);
  view.frame(out, 0.1);
  assert.deepEqual(errors, ["broken: nope"]);
  assert.ok(out.some((v) => v !== 0));
});

test("the flier is handed to the layers when the frame is given one", () => {
  const seen: unknown[] = [];
  const view = createStreamView(data, new InstantPool(true), palette, mask, {
    width: W, height: H, paper: false, layers: [{ name: "see", draw: (f: LiveFrame) => { seen.push(f.flier); } }],
  });
  view.setCamera(640, 640);
  view.update(0, 0);
  const out = new Uint32Array(W * H);
  const flier = { x: 640, y: 660, alt: 30, heading: 1, speed: 60 };
  view.frame(out, 0, flier);
  view.frame(out, 0);
  assert.deepEqual(seen, [flier, undefined]);
});
