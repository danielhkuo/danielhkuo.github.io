import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_KEYS, NONE_HELD } from "./bindings.ts";
import { chooseSlot, clampInto, guideFor, keyWord, slotAt, SLOTS_HIGH, type GuideState } from "./guides.ts";
import { FADE_IN, FADE_OUT, lessonAlpha, LEAVE_SHOW, newLesson, SPEED_HOLD, STEER_HOLD, stepLesson, TIMEOUT, WAIT, type Lesson } from "./lesson.ts";

const DT = 1 / 60;

function run(l: Lesson, seconds: number, held = NONE_HELD, shown = true, reduced = false): Lesson {
  for (let t = 0; t < seconds - 1e-9; t += DT) l = stepLesson(l, DT, held, shown, reduced);
  return l;
}

test("the lesson waits, then teaches steering until each way has been held", () => {
  let l = run(newLesson(false), WAIT + DT);
  assert.equal(l.stage, "steer");
  l = run(l, 1, { ...NONE_HELD, left: true });
  assert.equal(l.out, null, "one way is not enough");
  l = run(l, STEER_HOLD + DT, { ...NONE_HELD, right: true });
  assert.notEqual(l.out, null, "learned: fading");
  l = run(l, FADE_OUT + DT);
  assert.equal(l.stage, "speed");
});

test("speed is learned from boost and slow; leave shows a while; then the lesson is done", () => {
  let l: Lesson = { ...newLesson(false), stage: "speed" };
  l = run(l, SPEED_HOLD + DT, { ...NONE_HELD, boost: true });
  l = run(l, SPEED_HOLD + DT, { ...NONE_HELD, slow: true });
  l = run(l, FADE_OUT + DT);
  assert.equal(l.stage, "leave");
  l = run(l, LEAVE_SHOW + FADE_OUT + 2 * DT);
  assert.equal(l.stage, "done");
});

test("a stage nobody learns goes after TIMEOUT; a hidden lesson stands still; a learned one never starts", () => {
  let l: Lesson = { ...newLesson(false), stage: "steer" };
  l = run(l, TIMEOUT + FADE_OUT + 2 * DT);
  assert.equal(l.stage, "speed");
  const before = { ...newLesson(false), stage: "steer" as const, t: 3 };
  assert.deepEqual(run(before, 5, { ...NONE_HELD, left: true }, false), before);
  assert.equal(run(newLesson(true), 30).stage, "done");
});

test("the lesson fades in and out, and under reduced motion simply shows and goes", () => {
  const l: Lesson = { ...newLesson(false), stage: "steer", t: FADE_IN / 2 };
  assert.ok(Math.abs(lessonAlpha(l) - 0.5) < 1e-9);
  assert.equal(lessonAlpha(l, true), 1);
  assert.ok(Math.abs(lessonAlpha({ ...l, t: 5, out: FADE_OUT / 2 }) - 0.5) < 1e-9);
  assert.equal(lessonAlpha({ ...l, out: 0.01 }, true), 0);
  const quick = run({ ...newLesson(false), stage: "steer" }, STEER_HOLD + DT, { ...NONE_HELD, left: true, right: true }, true, true);
  assert.equal(quick.stage, "speed", "no fade under reduced motion");
});

const lit = { keys: new Set<string>(), turn: false, boost: false, slow: false, south: false, east: false };
const base: GuideState = {
  device: "keyboard", phase: "flying", offer: null, lesson: { ...newLesson(false), stage: "steer", t: 5 }, keys: DEFAULT_KEYS,
  family: null, pad: "xbox", lit, reduced: false, landedPrompt: true,
};

test("a prompt for each phase, in the glyphs of the device in hand", () => {
  assert.equal(guideFor({ ...base, offer: "leaf" })?.say, "Press Space to land: leaf.");
  assert.equal(guideFor({ ...base, offer: "leaf" })?.tap, "land");
  assert.equal(guideFor({ ...base, phase: "landing" })?.say, "Press Esc to pull up.");
  assert.equal(guideFor({ ...base, phase: "landed" })?.tap, "takeOff");
  assert.equal(guideFor({ ...base, device: "gamepad", offer: "" })?.say, "Press the bottom face button to land.");
  assert.equal(guideFor({ ...base, device: "gamepad", phase: "landing" })?.say, "Press the right face button to pull up.");
  assert.equal(guideFor({ ...base, device: "touch", phase: "landed" })?.say, "Tap here to take off.");
  assert.equal(guideFor({ ...base, keys: { ...DEFAULT_KEYS, land: "e" }, offer: "" })?.say, "Press E to land.");
  assert.equal(guideFor({ ...base, phase: "landed", landedPrompt: false }), null, "the Codex's own button does it");
});

test("the prompt takes the place of the lesson; the lesson shows only while it is being taught, and not on touch", () => {
  assert.match(guideFor({ ...base, offer: "leaf" })?.id ?? "", /^prompt/);
  assert.match(guideFor(base)?.id ?? "", /^lesson\|steer/);
  assert.equal(guideFor({ ...base, lesson: newLesson(true) }), null);
  assert.equal(guideFor({ ...base, lesson: newLesson(false) }), null, "still waiting");
  assert.equal(guideFor({ ...base, device: "touch" }), null);
});

test("the lesson shows both families until one is used, and lights the keys held", () => {
  const both = guideFor(base);
  const letters = guideFor({ ...base, family: "letters" });
  assert.ok(both && letters && both.sprite.w > letters.sprite.w);
  const held = guideFor({ ...base, family: "letters", lit: { ...lit, keys: new Set(["a"]) } });
  assert.notEqual(held?.id, letters?.id);
  assert.notDeepEqual(held?.sprite.px, letters?.sprite.px);
  // The same state draws the very same sprite.
  assert.equal(guideFor({ ...base, family: "letters" })?.sprite, letters?.sprite);
});

test("guides stand clear of the body: below by default, beside the head when the body trails below", () => {
  const head = { x: 200, y: 112 };
  assert.equal(chooseSlot(null, head, 40, 12, 400, 225, []), "below");
  const trailingDown = Array.from({ length: 20 }, (_, i) => ({ x: 200, y: 116 + 4 * i }));
  assert.equal(chooseSlot(null, head, 40, 12, 400, 225, trailingDown), "right");
  // A slot is kept while it stays clear, though another is preferred.
  assert.equal(chooseSlot("right", head, 40, 12, 400, 225, []), "right");
  assert.equal(chooseSlot(null, head, 40, 12, 400, 225, [], SLOTS_HIGH), "above");
  // Near the foot of the frame, below would leave it.
  assert.equal(chooseSlot(null, { x: 200, y: 218 }, 40, 12, 400, 225, []), "right");
});

test("slots sit GAP from the head, and a guide is kept inside the frame", () => {
  assert.deepEqual(slotAt("below", { x: 100, y: 50 }, 20, 10), { x: 90, y: 64 });
  assert.deepEqual(slotAt("left", { x: 100, y: 50 }, 20, 10), { x: 66, y: 45 });
  assert.deepEqual(clampInto({ x: -5, y: 230 }, 20, 10, 400, 225), { x: 2, y: 213 });
});

test("keys are named as a sentence says them", () => {
  assert.deepEqual([" ", "ArrowLeft", "Escape", "e", "Enter"].map(keyWord), ["Space", "Left", "Esc", "E", "Enter"]);
});
