import assert from "node:assert/strict";
import { test } from "node:test";
import { blit } from "./blit.ts";
import { ROWS, textWidth } from "./font.ts";
import {
  CAP_H, CAP_MIN_W, COLOURS, FACE, INK, keyCap, keycap, keyLegend, label, padDpad, padFace, padStick, padTrigger, PAPER, row,
  column, SKIRT, slip, text, touchButton, touchStick, touchTap, VERMILION, VERMILION_DARK, type Sprite,
} from "./glyphs.ts";

function count(s: Sprite, slot: number): number {
  return s.px.reduce((a, v) => a + (v === slot ? 1 : 0), 0);
}

test("key legends: letters in capitals, named keys in lower case, arrows as arrows", () => {
  assert.deepEqual(["a", "W", " ", "Shift", "Escape", "Enter", "ArrowLeft", "ArrowUp", "F5"].map(keyLegend), ["A", "W", "space", "shift", "esc", "enter", "←", "↑", "f5"]);
});

test("a key-cap is CAP_H tall, at least CAP_MIN_W wide, inked round a pale face over a darker skirt", () => {
  const k = keyCap("a");
  assert.equal(k.h, CAP_H);
  assert.equal(k.w, CAP_MIN_W);
  // Corners clipped, rim inked.
  assert.equal(k.px[0], 0);
  assert.equal(k.px[1], INK);
  assert.equal(k.px[(CAP_H - 1) * k.w + 1], INK);
  assert.ok(count(k, FACE) > 30 && count(k, SKIRT) >= 2 * (k.w - 2));
  assert.ok(count(k, INK) > 2 * (k.w + CAP_H));
});

test("wide legends widen the cap, and the space bar is drawn wide", () => {
  assert.equal(keyCap("Shift").w, textWidth("shift") + 6);
  assert.ok(keyCap(" ").w >= 31);
});

test("a lit cap is pressed: it drops a pixel and turns vermilion, its legend paper", () => {
  const k = keyCap("d", true);
  assert.equal(k.h, CAP_H);
  for (let x = 0; x < k.w; x++) assert.equal(k.px[x], 0, "the top row is clear");
  assert.equal(count(k, FACE), 0);
  assert.ok(count(k, VERMILION) > 30 && count(k, VERMILION_DARK) === k.w - 2);
  assert.ok(count(k, PAPER) > 5);
});

test("a word on a cap sits on the face, within it", () => {
  for (const key of ["Shift", " ", "Escape"]) {
    const k = keyCap(key);
    for (let y = 0; y < k.h; y++) {
      for (let x = 0; x < k.w; x++) {
        if (k.px[y * k.w + x] !== INK) continue;
        const rim = x === 0 || x === k.w - 1 || y === 0 || y === k.h - 1;
        assert.ok(rim || y <= 8, `${key}: ink at row ${y} is below the face`);
      }
    }
  }
});

test("labels are ink with a paper halo, a pixel wider each side", () => {
  const l = label("land");
  assert.deepEqual([l.w, l.h], [textWidth("land") + 2, ROWS + 2]);
  assert.equal(count(l, INK), count(text("land"), INK));
  assert.ok(count(l, PAPER) > count(l, INK));
});

test("a slip is a paper plate as tall as a cap, its words inked on it", () => {
  const s = slip("land");
  assert.deepEqual([s.w, s.h], [textWidth("land") + 6, CAP_H]);
  assert.equal(s.px[0], 0, "corners clipped");
  assert.equal(s.px[1], INK);
  assert.equal(count(s, INK) - (2 * (s.w - 2) + 2 * (CAP_H - 2)), count(text("land"), INK));
});

test("rows and columns lay sprites out with their gaps", () => {
  const a = keycap("A");
  const b = label("steer");
  const r = row([a, b], 2);
  assert.deepEqual([r.w, r.h], [a.w + 2 + b.w, Math.max(a.h, b.h)]);
  const c = column([a, b], 1, "start");
  assert.deepEqual([c.w, c.h], [Math.max(a.w, b.w), a.h + 1 + b.h]);
  assert.equal(c.px[1], INK, "flush left: the cap's rim starts at column 1");
});

test("pad and touch glyphs: the button to press is filled vermilion, darker while held; the rest are pale", () => {
  const centre = 12 * 15 + 7;
  assert.equal(padFace("south").px[centre], VERMILION);
  assert.equal(padFace("south", true).px[centre], VERMILION_DARK);
  assert.equal(padFace("north").px[centre], FACE);
  assert.equal(padFace("north").px[10 * 15 + 7], INK, "every button is ringed in ink");
  assert.ok(count(padStick(true), VERMILION) > 0 && count(padStick(), VERMILION) === 0);
  assert.ok(count(padDpad(["left"], true), VERMILION) > 0);
  assert.ok(count(padTrigger("RT"), INK) > 0);
  for (const s of [touchTap(), touchStick(), touchButton("boost"), touchButton("slow", true)]) assert.ok(count(s, INK) > 10);
  assert.ok(count(touchTap(true), VERMILION) > 0);
});

test("blit draws a sprite's colours over the frame, clipped to it, at its opacity", () => {
  const fw = 6;
  const fh = 4;
  const frame = new Uint32Array(fw * fh).fill(0xff000000);
  const s: Sprite = { w: 2, h: 2, px: Uint8Array.from([INK, 0, PAPER, INK]) };
  blit(frame, fw, fh, s, 5, 3);
  const [r, g, b] = COLOURS[INK];
  assert.equal(frame[3 * fw + 5], (0xff000000 | (b << 16) | (g << 8) | r) >>> 0);
  assert.equal(frame.filter((p) => p !== 0xff000000).length, 1, "only the corner pixel lands in the frame");
  const half = new Uint32Array(1).fill(0xff000000);
  blit(half, 1, 1, { w: 1, h: 1, px: Uint8Array.from([PAPER]) }, 0, 0, 0.5);
  const red = half[0] & 255;
  assert.ok(Math.abs(red - COLOURS[PAPER][0] / 2) <= 2, `half paper over black: ${red}`);
  const none = new Uint32Array(1).fill(0xff000000);
  blit(none, 1, 1, { w: 1, h: 1, px: Uint8Array.from([PAPER]) }, 0, 0, 0);
  assert.equal(none[0], 0xff000000);
});
