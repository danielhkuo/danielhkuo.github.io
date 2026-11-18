// Dragon studies: each study drawn over the shipped world, for the owner to choose between.
//
//   npm run world:dragon -- [--forest x,y] [--only a|a-ivory|b|c]
//
// Writes to .cache/dragon-studies/:
//   <id>-<place>.png   eight headings over the start bay, the town and a forest, at 4×
//   <id>-frame.png     one whole 400×225 frame at 1×, with the clouds
//   <id>-close.png     three headings at 6×
//   frames.png         the whole frames side by side
//   a-motion.png       the river-dragon turning and undulating, twelve moments
//   a-head.png         the river-dragon's head in eight headings, at 4× and at 1×
//   a-turn.png         the river-dragon held in a right turn and in a left, at 4×
//   b-beat.png, c-beat.png   the wingbeat
//   sheet.png          everything on one contact sheet

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { wrap } from "../core/torus.ts";
import { createDragon, DRAGON_IDS, DRAGON_NAMES, type Dragon, type DragonId } from "../dragon/index.ts";
import { WINGED_CYCLE } from "../dragon/winged.ts";
import { WYRM_BEAT } from "../dragon/wyrm.ts";
import { makeLayers } from "../live/registry.ts";
import type { Manifest } from "../pack/manifest.ts";
import { decodeFlightData } from "../pack/world.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { createBakeHost } from "../runtime/bakeHost.ts";
import { CRUISE, startState, stepFlight, type FlightInput, type FlightState } from "../runtime/flight.ts";
import type { BakePool, ChunkWant } from "../runtime/pool.ts";
import { createStreamView, type StreamView } from "../runtime/stream.ts";
import { createSky, type Sky } from "../sky/sky.ts";
import { styleFrom } from "../sky/styles.ts";
import { namedViews } from "./live.ts";
import { encodePng } from "./png.ts";

const W = 400, H = 225;
const CREAM = 0xffd2e8f0, INK = 0xff1d2228;
/** A forest on the shipped world (seed 3), found by eye. */
const FOREST = { x: 5960, y: 3770 };
/** How far ahead of the picture's centre each study's flier sits, so the whole body is in the crop. */
const AHEAD: Record<DragonId, number> = { a: 34, "a-ivory": 34, b: 4, c: 3 };
const HEADINGS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
const DT = 1 / 60;

/** A picture being assembled: packed RGBA, cream to start with. */
interface Sheet {
  w: number;
  h: number;
  px: Uint32Array;
}

function sheet(w: number, h: number): Sheet {
  return { w, h, px: new Uint32Array(w * h).fill(CREAM) };
}

/** Copies the w × h crop of `src` (a W × H frame) centred on the frame's centre into `dst` at (dx, dy), scaled. */
function blit(dst: Sheet, dx: number, dy: number, src: Uint32Array, w: number, h: number, scale: number): void {
  const x0 = (W - w) >> 1, y0 = (H - h) >> 1;
  for (let y = 0; y < h * scale; y++) {
    const row = (dy + y) * dst.w + dx, from = (y0 + Math.floor(y / scale)) * W + x0;
    if (dy + y >= dst.h) break;
    for (let x = 0; x < w * scale; x++) if (dx + x < dst.w) dst.px[row + x] = src[from + Math.floor(x / scale)];
  }
}

function paste(dst: Sheet, dx: number, dy: number, src: Sheet): void {
  for (let y = 0; y < src.h && dy + y < dst.h; y++) {
    for (let x = 0; x < src.w && dx + x < dst.w; x++) dst.px[(dy + y) * dst.w + dx + x] = src.px[y * src.w + x];
  }
}

// A 3 × 5 lettering for the sheet's labels: rows top to bottom, three bits each.
const GLYPHS: Record<string, string> = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111",
  F: "111100110100100", G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010",
  K: "101101110101101", L: "100100100100111", M: "101111111101101", N: "110101101101101", O: "010101101101010",
  P: "110101110100100", Q: "010101101111011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101", Y: "101101010010010",
  Z: "111001010100111", "0": "111101101101111", "1": "010110010010111", "2": "110001010100111",
  "3": "110001010001110", "4": "101101111001001", "5": "111100110001110", "6": "111100111101111",
  "7": "111001010010010", "8": "111101111101111", "9": "111101111001111", "-": "000000111000000",
  ".": "000000000000010", ":": "000010000010000", "×": "000101010101000", "/": "001001010100100",
  ",": "000000000010100",
};

function label(dst: Sheet, x: number, y: number, text: string, scale = 2): void {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = GLYPHS[ch];
    if (g) {
      for (let i = 0; i < 15; i++) {
        if (g[i] !== "1") continue;
        const gx = cx + (i % 3) * scale, gy = y + Math.floor(i / 3) * scale;
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
          if (gx + sx < dst.w && gy + sy < dst.h) dst.px[(gy + sy) * dst.w + gx + sx] = INK;
        }
      }
    }
    cx += 4 * scale;
  }
}

function save(dir: string, name: string, s: Sheet): string {
  const file = join(dir, name);
  writeFileSync(file, encodePng(new Uint8Array(s.px.buffer, s.px.byteOffset, s.px.byteLength), s.w, s.h));
  return file;
}

/** A pool that bakes each wanted chunk at once, in-process. */
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

interface Stage {
  view: StreamView;
  sky: Sky;
  n: number;
  out: Uint32Array;
}

/** Draws one frame with the camera on (cx, cy) at the flier's height: land, live layers, the study, and the sky if asked. */
function frameOf(st: Stage, dragon: Dragon, s: FlightState, cx: number, cy: number, time: number, clouds: boolean): Uint32Array {
  st.view.setCamera(cx, cy - s.alt / 0.8);
  for (let i = 0; i < 10 && !st.view.ready(); i++) st.view.update(0, 0);
  st.view.frame(st.out, time, { x: s.x, y: s.y, alt: s.alt, heading: s.heading, speed: s.speed });
  const rect = st.view.rect();
  if (clouds) st.sky.draw(st.out, rect, time, "below");
  dragon.draw(st.out, rect, s, st.view);
  if (clouds) st.sky.draw(st.out, rect, time, "above");
  return new Uint32Array(st.out);
}

/** The study flown straight along `heading` so that the middle of its body is over (cx, cy), 18 units up, at `time`. */
function posed(st: Stage, id: DragonId, cx: number, cy: number, heading: number, time: number): { dragon: Dragon; s: FlightState } {
  const dragon = createDragon(id, st.n);
  const dx = Math.cos(heading), dy = Math.sin(heading);
  const hx = cx + dx * AHEAD[id], hy = cy + dy * AHEAD[id];
  const alt = st.view.groundHeight(wrap(hx, st.n), wrap(hy, st.n)) + 18;
  let s: FlightState = { x: 0, y: 0, heading, speed: CRUISE, alt, bank: 0 };
  for (let k = 160; k >= 0; k--) {
    s = { ...s, x: wrap(hx - dx * k, st.n), y: wrap(hy - dy * k, st.n) };
    dragon.step(s, DT);
  }
  dragon.pose.time = time;
  dragon.pose.wave = (time * 2 * Math.PI) / 2.4;
  return { dragon, s };
}

function readFlag(argv: readonly string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1];
    if (argv[i].startsWith(`${name}=`)) return argv[i].slice(name.length + 1);
  }
  return undefined;
}

/** The command line; 0 on success. */
export async function main(argv: readonly string[]): Promise<number> {
  const worldRoot = fileURLToPath(new URL("../../../public/world/", import.meta.url));
  const current = JSON.parse(readFileSync(join(worldRoot, "current.json"), "utf8")) as { worldId: string };
  const id = current.worldId;
  const manifest = JSON.parse(readFileSync(join(worldRoot, id, "manifest.json"), "utf8")) as Manifest;
  const bin = new Uint8Array(readFileSync(join(worldRoot, id, "world.bin")));
  const mask = new Uint8Array(readFileSync(join(worldRoot, "bluenoise.bin")));
  const [data, bake, named] = await Promise.all([decodeFlightData(bin), createBakeHost(bin, mask), namedViews(bin, manifest)]);
  const view = createStreamView(data, syncPool(bake), buildPalette(MIDDAY), mask, {
    width: W,
    height: H,
    sites: manifest.sites,
    layers: makeLayers({ seed: manifest.seed, n: manifest.n, sites: manifest.sites, land: data }),
  });
  const st: Stage = { view, sky: createSky(manifest.seed, manifest.n, styleFrom(null), manifest.start), n: manifest.n, out: new Uint32Array(W * H) };

  const forestArg = readFlag(argv, "--forest")?.split(",").map(Number);
  const forest = forestArg && forestArg.length === 2 && forestArg.every(Number.isFinite) ? { x: forestArg[0], y: forestArg[1] } : FOREST;
  const places: [string, { x: number; y: number }][] = [["bay", named.start], ["town", named.town], ["forest", forest]];
  const only = readFlag(argv, "--only");
  const ids = DRAGON_IDS.filter((d) => !only || d === only);

  const dir = join(process.cwd(), ".cache", "dragon-studies");
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];

  const CW = 128, CH = 104, GAP = 4, PAD = 12, LINE = 18;
  const rowW = 8 * (CW * 2 + GAP) - GAP;
  const bands: Sheet[] = [];

  for (const d of ids) {
    // Eight headings over each place: a 4× strip of its own, and a 2× row on the sheet.
    const band = sheet(rowW, LINE + places.length * (CH * 2 + LINE));
    label(band, 0, 2, DRAGON_NAMES[d], 3);
    places.forEach(([name, at], p) => {
      const big = sheet(4 * (CW * 4 + GAP) - GAP, 2 * (CH * 4 + GAP) - GAP);
      const y = LINE + p * (CH * 2 + LINE);
      label(band, 0, y + 4, `${name}  ${HEADINGS.join(" ")}`);
      for (let h = 0; h < 8; h++) {
        const { dragon, s } = posed(st, d, at.x, at.y, (h * Math.PI) / 4, 1 + h * 0.37);
        const f = frameOf(st, dragon, s, at.x, at.y, 1 + h * 0.37, false);
        blit(big, (h % 4) * (CW * 4 + GAP), (h >> 2) * (CH * 4 + GAP), f, CW, CH, 4);
        blit(band, h * (CW * 2 + GAP), y + LINE - 2, f, CW, CH, 2);
      }
      written.push(save(dir, `${d}-${name}.png`, big));
    });
    bands.push(band);

    // One whole frame at 1×, with the clouds: how it reads in play.
    const at = named.start;
    const { dragon, s } = posed(st, d, at.x, at.y, -0.5, 2);
    const whole = sheet(W, H);
    blit(whole, 0, 0, frameOf(st, dragon, s, at.x, at.y, 2, true), W, H, 1);
    written.push(save(dir, `${d}-frame.png`, whole));
  }

  // Close-ups at 6×: east, south-east and north.
  for (const d of ids) {
    const KW = d === "c" ? 56 : d === "b" ? 72 : 104, KH = d === "a" || d === "a-ivory" ? 100 : 64;
    const close = sheet(3 * (KW * 6 + GAP) - GAP, LINE + KH * 6);
    label(close, 0, 2, `${DRAGON_NAMES[d]} AT 6×`);
    [0, 1, 6].forEach((h, i) => {
      const { dragon, s } = posed(st, d, forest.x, forest.y, (h * Math.PI) / 4, 1.3 + i);
      blit(close, i * (KW * 6 + GAP), LINE, frameOf(st, dragon, s, forest.x, forest.y, 1.3 + i, false), KW, KH, 6);
    });
    written.push(save(dir, `${d}-close.png`, close));
    bands.push(close);
  }

  // The frames at 1×, side by side.
  const wholes = sheet(rowW, LINE + H);
  label(wholes, 0, 2, "AT 1× IN THE WHOLE FRAME, WITH CLOUDS");
  ids.forEach((d, i) => {
    const at = named.start;
    const { dragon, s } = posed(st, d, at.x, at.y, -0.5, 2);
    blit(wholes, i * (W + GAP), LINE, frameOf(st, dragon, s, at.x, at.y, 2, true), W, H, 1);
  });
  written.push(save(dir, "frames.png", wholes));
  bands.push(wholes);

  // The river-dragon in motion: flown through the real flight model, a right turn and then a left.
  if (ids.includes("a")) {
    const MW = 168, MH = 120, COUNT = 12;
    const motion = sheet(6 * (MW * 2 + GAP) - GAP, LINE + 2 * (MH * 2 + GAP));
    label(motion, 0, 2, "A IN MOTION: A RIGHT TURN, THEN A LEFT, EVERY 0.4 S");
    const dragon = createDragon("a", st.n);
    let s = startState(manifest.start, view);
    const idle: FlightInput = { turn: 0, boost: false, brake: false };
    for (let k = 0; k < 150; k++) {
      s = stepFlight(s, idle, DT, view, st.n);
      dragon.step(s, DT);
    }
    let t = 0, shot = 0;
    for (let k = 1; shot < COUNT; k++) {
      t = k * DT;
      const turn = t > 0.4 && t < 1.8 ? 1 : t > 2.3 && t < 4.2 ? -1 : 0;
      s = stepFlight(s, { turn, boost: false, brake: false }, DT, view, st.n);
      dragon.step(s, DT);
      if (k % 24 !== 0) continue;
      const cx = s.x - Math.cos(s.heading) * 26, cy = s.y - Math.sin(s.heading) * 26;
      const f = frameOf(st, dragon, s, cx, cy, t, false);
      blit(motion, (shot % 6) * (MW * 2 + GAP), LINE + Math.floor(shot / 6) * (MH * 2 + GAP), f, MW, MH, 2);
      shot++;
    }
    written.push(save(dir, "a-motion.png", motion));
    bands.push(motion);
  }

  // The river-dragon's face: its head in eight headings at 4×, and the same crops at 1×.
  if (ids.includes("a")) {
    const FW = 48, FH = 40;
    const head = sheet(8 * (FW * 4 + GAP) - GAP, LINE + FH * 4 + GAP + FH);
    label(head, 0, 2, `A: THE HEAD AT 4× AND AT 1×  ${HEADINGS.join(" ")}`);
    for (let h = 0; h < 8; h++) {
      const { dragon, s } = posed(st, "a", forest.x, forest.y, (h * Math.PI) / 4, 1 + h * 0.37);
      const f = frameOf(st, dragon, s, s.x, s.y, 1 + h * 0.37, false);
      blit(head, h * (FW * 4 + GAP), LINE, f, FW, FH, 4);
      blit(head, h * (FW * 4 + GAP), LINE + FH * 4 + GAP, f, FW, FH, 1);
    }
    written.push(save(dir, "a-head.png", head));
    bands.push(head);

    // Banking: held in a right turn (top row) and in a left (bottom row), through the real flight model.
    const TW = 116, TH = 96, SHOTS = 4;
    const turns = sheet(SHOTS * (TW * 4 + GAP) - GAP, LINE + 2 * (TH * 4 + GAP));
    label(turns, 0, 2, "A BANKING AT 4×: HELD RIGHT (TOP) AND HELD LEFT (BOTTOM), EVERY 0.7 S");
    ([1, -1] as const).forEach((turn, row) => {
      const dragon = createDragon("a", st.n);
      let s = startState(manifest.start, view);
      for (let k = 0; k < 150; k++) {
        s = stepFlight(s, { turn: 0, boost: false, brake: false }, DT, view, st.n);
        dragon.step(s, DT);
      }
      for (let k = 1, shot = 0; shot < SHOTS; k++) {
        s = stepFlight(s, { turn, boost: false, brake: false }, DT, view, st.n);
        dragon.step(s, DT);
        if (k % 42 !== 0) continue;
        const cx = s.x - Math.cos(s.heading) * 24, cy = s.y - Math.sin(s.heading) * 24;
        blit(turns, shot * (TW * 4 + GAP), LINE + row * (TH * 4 + GAP), frameOf(st, dragon, s, cx, cy, k * DT, false), TW, TH, 4);
        shot++;
      }
    });
    written.push(save(dir, "a-turn.png", turns));
    bands.push(turns);
  }

  // The wingbeats of B and C.
  for (const [d, span, title] of [["b", WINGED_CYCLE, "B: TWO BEATS AND A GLIDE"], ["c", WYRM_BEAT * 2, "C: THE FLUTTER"]] as const) {
    if (!ids.includes(d)) continue;
    const BW = d === "b" ? 104 : 80, BH = d === "b" ? 88 : 64, COUNT = d === "b" ? 9 : 12;
    const beat = sheet(COUNT * (BW * 2 + GAP) - GAP, LINE + BH * 2);
    label(beat, 0, 2, title);
    const at = named.start;
    for (let i = 0; i < COUNT; i++) {
      const time = (i * span) / COUNT;
      const { dragon, s } = posed(st, d, at.x, at.y, -0.5, time);
      blit(beat, i * (BW * 2 + GAP), LINE, frameOf(st, dragon, s, at.x, at.y, time, false), BW, BH, 2);
    }
    written.push(save(dir, `${d}-beat.png`, beat));
    bands.push(beat);
  }

  let total = PAD;
  let widest = 0;
  for (const b of bands) {
    total += b.h + PAD;
    if (b.w > widest) widest = b.w;
  }
  const all = sheet(widest + 2 * PAD, total);
  let y = PAD;
  for (const b of bands) {
    paste(all, PAD, y, b);
    y += b.h + PAD;
  }
  written.push(save(dir, "sheet.png", all));
  for (const f of written) console.log(f);
  return 0;
}
