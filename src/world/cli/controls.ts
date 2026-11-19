// The touch controls' bench: the shipped world drawn as a phone shows it, with the controls on top, to judge their look
// on renders (CLAUDE.md: anything judged by eye is judged on renders).
//
//   npm run world:controls
//
// Writes to .cache/controls/:
//   phone-<place>.png   a whole phone frame (iPhone 17, landscape, filled and letterboxed) at 2× its CSS size
//   states.png          each control idle and pressed, the stick at rest and pushed, on paper, sea, forest and rock
//   sheet.png           everything on one sheet

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDragon } from "../dragon/index.ts";
import { makeLayers } from "../live/registry.ts";
import type { Manifest } from "../pack/manifest.ts";
import { readShipped } from "../pack/shipped.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { createWorldBakeHost } from "../runtime/bakeHost.ts";
import { CRUISE, type FlightState } from "../runtime/flight.ts";
import type { BakePool, ChunkWant } from "../runtime/pool.ts";
import { createStreamView } from "../runtime/stream.ts";
import { createSky } from "../sky/sky.ts";
import { styleFrom } from "../sky/styles.ts";
import { fitFrame } from "../runtime/fit.ts";
import { wrap } from "../core/torus.ts";
import { drawControls, roundel, stickKnob, stickWell, type ControlsScene } from "../mobile/art.ts";
import { blit } from "../controls/blit.ts";
import { layoutControls, type Insets } from "../mobile/layout.ts";
import { namedViews } from "./live.ts";
import { encodePng } from "./png.ts";

const CREAM = 0xffd2e8f0;

interface Sheet {
  w: number;
  h: number;
  px: Uint32Array;
}

function sheet(w: number, h: number, fill = CREAM): Sheet {
  return { w, h, px: new Uint32Array(w * h).fill(fill) };
}

/** Pastes a w × h frame into `dst` at (dx, dy), each frame pixel `scale` sheet pixels. */
function pasteScaled(dst: Sheet, dx: number, dy: number, src: Uint32Array, w: number, h: number, scale: number): void {
  for (let y = 0; y < h * scale; y++) {
    if (dy + y >= dst.h) break;
    const from = Math.floor(y / scale) * w;
    for (let x = 0; x < w * scale; x++) if (dx + x < dst.w) dst.px[(dy + y) * dst.w + dx + x] = src[from + Math.floor(x / scale)];
  }
}

/** Pastes a w × h frame into the dw × dh box of `dst` at (dx, dy), nearest neighbour, as the page's canvas scales it. */
function pasteFit(dst: Sheet, dx: number, dy: number, dw: number, dh: number, src: Uint32Array, w: number, h: number): void {
  for (let y = 0; y < dh && dy + y < dst.h; y++) {
    const from = Math.min(h - 1, Math.floor((y * h) / dh)) * w;
    for (let x = 0; x < dw && dx + x < dst.w; x++) dst.px[(dy + y) * dst.w + dx + x] = src[from + Math.min(w - 1, Math.floor((x * w) / dw))];
  }
}

function save(dir: string, name: string, s: Sheet): string {
  const file = join(dir, name);
  writeFileSync(file, encodePng(new Uint8Array(s.px.buffer, s.px.byteOffset, s.px.byteLength), s.w, s.h));
  return file;
}

function syncPool(bake: (cx: number, cy: number) => Uint32Array): BakePool {
  let baked = 0;
  const pool: BakePool = {
    want(list: readonly ChunkWant[]) {
      for (const w of list) {
        pool.onBaked?.(w.cx, w.cy, bake(w.cx, w.cy));
        baked++;
      }
    },
    onBaked: null,
    onError: null,
    stats: () => ({ inFlight: 0, queued: 0, baked, bakeMs: 0, workers: 1 }),
    dispose() {},
  };
  return pool;
}

const PHONE: Insets = { top: 0, right: 62, bottom: 20, left: 62 };

/** A phone's screen: CSS size, device pixels per CSS pixel, and how the frame is fitted. */
interface Screen {
  name: string;
  w: number;
  h: number;
  dpr: number;
  fit: "fill" | "letterbox";
}

const SCREENS: Screen[] = [
  { name: "iphone17-fill", w: 874, h: 338, dpr: 3, fit: "fill" },
  { name: "iphone17-letterbox", w: 874, h: 338, dpr: 3, fit: "letterbox" },
];

/** The frame for a screen: its size in frame pixels and where it sits, CSS px. */
function frameFor(s: Screen): { fw: number; fh: number; rect: { x: number; y: number; w: number; h: number } } {
  if (s.fit === "letterbox") {
    // How the 400×225 frame sat before it filled the window: a whole number of device pixels, centred.
    const k = Math.max(1, Math.floor(Math.min((s.w * s.dpr) / 400, (s.h * s.dpr) / 225))) / s.dpr;
    return { fw: 400, fh: 225, rect: { x: (s.w - 400 * k) / 2, y: (s.h - 225 * k) / 2, w: 400 * k, h: 225 * k } };
  }
  // The window's own fitting (runtime/fit.ts): from the top-left, a whole scale, within its pixel budget.
  const f = fitFrame(s.w, s.h, s.dpr);
  return { fw: f.w, fh: f.h, rect: { x: 0, y: 0, w: (f.w * f.scale) / s.dpr, h: (f.h * f.scale) / s.dpr } };
}

export async function main(): Promise<number> {
  const worldRoot = fileURLToPath(new URL("../../../public/world/", import.meta.url));
  const shipped = await readShipped(worldRoot);
  const manifest = shipped.manifest as unknown as Manifest;
  const mask = new Uint8Array(readFileSync(join(worldRoot, "bluenoise.bin")));
  const data = shipped.flight;
  const bake = createWorldBakeHost(shipped.world, mask);
  const named = await namedViews(shipped.world, manifest);
  const dir = join(process.cwd(), ".cache", "controls");
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const pieces: Sheet[] = [];

  const places: [string, { x: number; y: number }][] = [["bay", named.start], ["town", named.town]];
  for (const screen of SCREENS) {
    const { fw, fh, rect } = frameFor(screen);
    const view = createStreamView(data, syncPool(bake), buildPalette(MIDDAY), mask, {
      width: fw,
      height: fh,
      sites: manifest.sites,
      layers: makeLayers({ seed: manifest.seed, n: manifest.n, sites: manifest.sites, land: data }),
    });
    const sky = createSky(manifest.seed, manifest.n, styleFrom(null), manifest.start);
    for (const [place, at] of places) {
      const out = new Uint32Array(fw * fh);
      const s: FlightState = { x: at.x, y: at.y, heading: -Math.PI / 2, speed: CRUISE, alt: view.groundHeight(at.x, at.y) + 18, bank: 0 };
      const dragon = createDragon(manifest.n);
      for (let k = 120; k >= 0; k--) dragon.step({ ...s, y: wrap(s.y + k, manifest.n) }, 1 / 60);
      view.setCamera(s.x, s.y - s.alt / 0.8);
      for (let i = 0; i < 12 && !view.ready(); i++) view.update(0, 0);
      view.frame(out, 3, { x: s.x, y: s.y, alt: s.alt, heading: s.heading, speed: s.speed });
      const r = view.rect();
      sky.draw(out, r, 3, "below");
      dragon.draw(out, r, s, view);
      sky.draw(out, r, 3, "above");
      const layout = layoutControls({ width: screen.w, height: screen.h, insets: PHONE, platform: "ios", hand: "right", size: 1, frame: rect, land: true });
      const knob = { baseX: layout.rest.x + 6, baseY: layout.rest.y - 4, knobX: layout.rest.x + 6 + 30, knobY: layout.rest.y - 4 - 22 };
      const scene: ControlsScene = { layout, frame: rect, stick: knob, ghost: false, pressed: { boost: true, brake: false, land: false }, alpha: 1 };
      drawControls(out, fw, fh, scene);
      // The phone's screen at 2 sheet pixels a CSS pixel: paper round a letterboxed frame.
      const shot = sheet(Math.round(screen.w * 2), Math.round(screen.h * 2));
      pasteFit(shot, Math.round(rect.x * 2), Math.round(rect.y * 2), Math.round(rect.w * 2), Math.round(rect.h * 2), out, fw, fh);
      written.push(save(dir, `phone-${screen.name}-${place}.png`, shot));
      pieces.push(shot);
    }
  }

  // The states, at the frame-pixel radii a filled iPhone 17 frame gives (about 0.6 frame px a CSS px), 4×.
  const grounds: [string, number][] = [["paper", CREAM], ["sea", 0xffb08a5a], ["forest", 0xff3f6a4a], ["rock", 0xff7d8794]];
  const cell = 64;
  const states = sheet(cell * 9, cell * grounds.length);
  grounds.forEach(([, colour], gy) => {
    const tile = new Uint32Array(cell * 9 * cell).fill(colour);
    const items = [
      roundel("boost", 22, false), roundel("boost", 22, true), roundel("brake", 17, false), roundel("brake", 17, true),
      roundel("land", 22, false), roundel("land", 22, true), stickWell(34), stickKnob(13, false), stickKnob(13, true),
    ];
    items.forEach((it, i) => blit(tile, cell * 9, cell, it, i * cell + ((cell - it.w) >> 1), (cell - it.h) >> 1, 1));
    for (let y = 0; y < cell; y++) states.px.set(tile.subarray(y * cell * 9, (y + 1) * cell * 9), (gy * cell + y) * states.w);
  });
  const big = sheet(states.w * 4, states.h * 4);
  pasteScaled(big, 0, 0, states.px, states.w, states.h, 4);
  written.push(save(dir, "states.png", big));

  const W = Math.max(big.w, ...pieces.map((p) => p.w));
  const H = pieces.reduce((a, p) => a + p.h + 16, 0) + big.h;
  const all = sheet(W, H);
  let y = 0;
  for (const p of [...pieces, big]) {
    for (let j = 0; j < p.h; j++) all.px.set(p.px.subarray(j * p.w, (j + 1) * p.w), (y + j) * W);
    y += p.h + 16;
  }
  written.push(save(dir, "sheet.png", all));
  for (const f of written) console.log(f);
  return 0;
}
