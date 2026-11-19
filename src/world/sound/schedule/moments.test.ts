import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOCK_LASTS, figureOut, figureP, momentSpan, momentWindow, PLANE_DOWN, PLANE_MOORED, planeAt, planePlace, trainAt, trainPlace, WORLD_HOUR } from "../../live/moments.ts";
import { CHIME_NAMES } from "../synth/chimes.ts";
import type { Cue } from "../types.ts";
import { hourNumber } from "./bells.ts";
import { CHIME, CLACK, clockCues, COUNT_AT, COUNT_GAP, RATCHET, WHIRR } from "./chimes.ts";
import { appearance, BEAT_DB, CHUFF, CHUFF_CELLS, CLICK, PLANE_POPS, PLANE_RUNDOWN, planeCues, planeRpm, POP, SPLASH, trainCues, trainRun, WHISTLE_LONG, WHISTLE_SHORT } from "./moments.ts";
import { BAR_S, melodySemitones, parsons, QUAVER_S, TUNE, tuneNotes } from "./tune.ts";

const SEED = 3, N = 10240;

test("the tune: thirteen bars of six quavers, E Dorian within a ninth, one leap of a sixth, ending on the low tonic; its contour is the one that was checked", () => {
  assert.equal(TUNE.length, 13);
  for (const bar of TUNE) assert.equal(bar.melody.reduce((a, n) => a + n[1], 0), 6);
  const semis = melodySemitones();
  assert.equal(parsons(semis), "*DDUUDDDUURDDDUDDDUUUUDDDDDUDUDUUUDDDDUDUDD");
  // E5 (12 above E4) to F♯6 (26): a ninth. Dorian on E: E F♯ G A B C♯ D.
  assert.equal(Math.min(...semis), 12);
  assert.equal(Math.max(...semis), 26);
  for (const s of semis) assert.ok([0, 2, 3, 5, 7, 9, 10].includes(s % 12), `${s}`);
  assert.equal(semis[semis.length - 1], 12);
  const leaps = semis.slice(1).map((s, i) => Math.abs(s - semis[i]));
  assert.deepEqual(leaps.filter((d) => d >= 8), [9], "one sixth: E5 up to C♯6");
  assert.ok(leaps.filter((d) => d <= 4).length >= leaps.length - 6, "mostly steps and thirds");
  // Three bars are the time from one figure stepping out to the next.
  assert.ok(Math.abs(3 * BAR_S - (figureOut(1) - figureOut(0))) < 1e-9);
  assert.ok(Math.abs(QUAVER_S - 0.2783) < 1e-4);
  assert.equal(CHIME_NAMES.length, 11);
});

test("the tune is not one of the chime and folk tunes it could be taken for (their openings, from memory, as semitone steps)", () => {
  const ours = melodySemitones().slice(1).map((s, i) => s - melodySemitones()[i]);
  // Openings as successive intervals in semitones (each from memory; a check, not a database search).
  const known: Record<string, number[]> = {
    "Westminster quarters, first change": [-2, -2, -5],
    "Westminster quarters, second change": [4, -2, -7, 5, 2, 2, -4],
    "Whittington chimes (a falling scale)": [-2, -1, -2, -2, -2, -1],
    "Carol of the Bells": [-1, 1, -3, 3, -1, 1, -3],
    "Greensleeves": [3, 2, 2, 1, -1, -2, -3],
    "Scarborough Fair": [0, 7, 0, -5, 1, -1, -2],
    "Drunken Sailor": [0, 0, 0, 0, 0, -7, 3, 4],
    "Skye Boat Song": [2, -2, 5, 0, 2, -2, 7],
    "Frère Jacques": [2, 2, -4, 0, 2, 2, -4],
    "Swallowtail Jig": [0, 7, -2, 2, -7, 7, -2],
    "Morrison's Jig": [7, -7, 7, -7, 7, 2, 2],
    "The Butterfly": [7, -4, 4, -7, 7, -4],
    "Sumer is icumen in": [-2, -2, 2, 2, 1, -1, -2],
  };
  const text = ours.join(",");
  for (const [name, steps] of Object.entries(known)) {
    // Neither our opening nor any stretch of five or more of our intervals is that tune's opening.
    const head = steps.slice(0, Math.max(3, Math.min(6, steps.length)));
    assert.notDeepEqual(ours.slice(0, head.length), head, name);
    if (steps.length >= 5) assert.ok(!`,${text},`.includes(`,${steps.slice(0, 5).join(",")},`), name);
  }
  // Ours opens on a falling 8–7–5–6–7–5–4: down a tone, down a third, up a tone, up a semitone, down a third, down a tone.
  assert.deepEqual(ours.slice(0, 6), [-2, -3, 2, 1, -3, -2]);
});

test("the clock: each figure steps out on the first beat of a phrase, as the picture has it; the count is the hour; the ratchet keeps clear of the chimes", () => {
  for (let i = 0; i < 5; i++) {
    assert.ok(Math.abs(figureP(figureOut(i), i) - 0.02) < 1e-12, "figureOut is where the picture's figure first shows");
    assert.ok(Math.abs(figureOut(i) - (0.626 + 5.009 * i)) < 2e-3);
  }
  const notes = tuneNotes();
  for (const H of [0, 3, 7]) {
    const S = H * WORLD_HOUR;
    const cues: Cue[] = [];
    clockCues(SEED, false, S, S + CLOCK_LASTS, cues);
    const clacks = cues.filter((c) => c.variant === CLACK && c.key.includes("figure"));
    assert.equal(clacks.length, 5);
    const melody = cues.filter((c) => c.variant === CHIME && c.key.includes("note"));
    assert.equal(melody.length, notes.length);
    clacks.forEach((c, i) => {
      assert.ok(Math.abs(c.t - S - figureOut(i)) < 1e-9);
      // The first melody note of bars 1, 4, 7, 10 and 13 falls with it (each note is up to 12 ms early or late).
      const k = notes.findIndex((nt) => !nt.low && nt.measure === 3 * i);
      assert.ok(Math.abs(melody[k].t - c.t) <= 0.0121, `figure ${i}`);
    });
    const count = cues.filter((c) => c.key.includes("count"));
    assert.equal(count.length, hourNumber(H));
    count.forEach((c, j) => assert.ok(Math.abs(c.t - S - COUNT_AT - COUNT_GAP * j) < 1e-9));
    assert.equal(cues[0].variant, WHIRR);
    // No chime starts while the ratchet's loop runs.
    for (const r of cues.filter((c) => c.variant === RATCHET)) {
      for (const c of cues.filter((x) => x.variant === CHIME)) assert.ok(c.t < r.t - 1e-9 || c.t >= r.t + (r.lasts ?? 0) - 1e-9, `${c.key} in ${r.key}`);
    }
    // Windows tile.
    const parts: Cue[] = [];
    for (let t = S; t < S + CLOCK_LASTS; t += 0.31) clockCues(SEED, false, t, Math.min(S + CLOCK_LASTS, t + 0.31), parts);
    assert.deepEqual(parts.map((c) => c.key), cues.map((c) => c.key));
  }
  // Forced, the procession loops every 36 s.
  const forced: Cue[] = [];
  clockCues(SEED, true, 0, 80, forced);
  assert.equal(forced.filter((c) => c.variant === WHIRR).length, 2);
});

test("the train's chuffs follow its drawn wheels: one for every 3 cells the picture's engine has run, on both legs", () => {
  const shore: [number, number] = [4856, 5000], halt: [number, number] = [5144, 5000];
  const span = momentSpan(SEED, "train");
  let start = 0;
  for (let t = 0; ; t++) {
    const at = momentWindow(SEED, "train", t);
    if (at >= 0) {
      start = t - at;
      break;
    }
  }
  assert.deepEqual(appearance(SEED, "train", start + 5, false), { start, lasts: span.lasts });
  const { cells, v } = trainRun(shore, halt, N, span.lasts);
  assert.ok(Math.abs(cells - 288) < 1e-9 && Math.abs(v - 18) < 1e-9);
  const cues: Cue[] = [];
  trainCues(SEED, shore, halt, N, false, start - 1, start + span.lasts + 1, cues);
  const chuffs = cues.filter((c) => c.variant === CHUFF);
  assert.equal(chuffs.length, 2 * 95, "95 a leg: 288 cells at one for every 3");
  const beat = CHUFF_CELLS / v;
  for (const c of chuffs) {
    const at = c.t - start, leg = at < span.lasts / 2 ? 0 : 1;
    // Where the picture draws the engine then, and how far that is along its leg.
    const late = c.k === 2 ? 0.04 * beat : 0;
    trainAt(at - late, span.lasts, shore, halt, N);
    const run = leg === 0 ? trainPlace.x - shore[0] : halt[0] - trainPlace.x;
    assert.ok(Math.abs(run / CHUFF_CELLS - Math.round(run / CHUFF_CELLS)) < 1e-6, `chuff at ${at.toFixed(3)} s: ${run.toFixed(3)} cells run`);
    assert.equal(Math.round(run / CHUFF_CELLS) & 3, c.k, "the beat of the wheel turn");
    assert.ok((c.db ?? 0) <= BEAT_DB[c.k ?? 0] + 4 + 1e-9);
  }
  // Four beats a wheel turn of 12 cells: six a second at 18 cells a second.
  assert.ok(Math.abs(1 / beat - 6) < 1e-9);
  // Whistles: a long one 1 s out, two shorts before the halt, a long one after it; the engine faces the way it goes.
  const w = cues.filter((c) => c.variant === WHISTLE_LONG || c.variant === WHISTLE_SHORT).map((c) => [c.variant, Math.round((c.t - start) * 10) / 10]);
  assert.deepEqual(w, [[WHISTLE_LONG, 1], [WHISTLE_SHORT, 13.8], [WHISTLE_SHORT, 14.3], [WHISTLE_LONG, 16.8]]);
  trainAt(5, span.lasts, shore, halt, N);
  assert.equal(trainPlace.face, 1);
  trainAt(20, span.lasts, shore, halt, N);
  assert.equal(trainPlace.face, -1);
  // Wheel clicks: pairs, a rail apart; windows tile.
  assert.ok(cues.filter((c) => c.variant === CLICK).length > 100);
  const parts: Cue[] = [];
  for (let t = start - 1; t < start + span.lasts + 1; t += 0.27) trainCues(SEED, shore, halt, N, false, t, Math.min(start + span.lasts + 1, t + 0.27), parts);
  assert.deepEqual(parts.map((c) => c.key).sort(), cues.map((c) => c.key).sort());
  assert.equal(new Set(cues.map((c) => c.key)).size, cues.length);
});

test("the seaplane: its splashes fall as the picture's floats reach the water, its last pops after the engine has run down", () => {
  const span = momentSpan(SEED, "plane");
  let start = 0;
  for (let t = 0; ; t++) {
    const at = momentWindow(SEED, "plane", t);
    if (at >= 0) {
      start = t - at;
      break;
    }
  }
  const cues: Cue[] = [];
  planeCues(SEED, false, start, start + span.lasts, cues);
  const splashes = cues.filter((c) => c.variant === SPLASH), pops = cues.filter((c) => c.variant === POP);
  assert.equal(splashes.length, 2);
  assert.equal(pops.length, 3);
  // Just before the first splash the picture has it a hand's breadth above the water; at it, down.
  const at = splashes[0].t - start;
  planeAt(at - 0.05, span.lasts, [5000, 5000]);
  assert.ok(planePlace.alt > 1.4 && planePlace.alt < 1.6);
  planeAt(at + 0.01, span.lasts, [5000, 5000]);
  assert.ok(planePlace.alt <= 1.4);
  assert.ok(Math.abs(at - PLANE_DOWN * span.lasts) < 1e-9 && Math.abs(splashes[1].t - splashes[0].t - 0.5) < 1e-9);
  pops.forEach((p, i) => assert.ok(Math.abs(p.t - start - PLANE_MOORED * span.lasts - PLANE_RUNDOWN - PLANE_POPS[i]) < 1e-9));
  // The engine: 1900 rpm easing to 1400 at touchdown, a taxi at 850, run down to 300, then stopped.
  assert.equal(planeRpm(0, span.lasts), 1900);
  assert.ok(Math.abs(planeRpm(PLANE_DOWN * span.lasts - 1e-6, span.lasts) - 1400) < 1);
  assert.equal(planeRpm(0.5 * span.lasts, span.lasts), 850);
  assert.ok(Math.abs(planeRpm(PLANE_MOORED * span.lasts + PLANE_RUNDOWN - 1e-6, span.lasts) - 300) < 1);
  assert.equal(planeRpm(PLANE_MOORED * span.lasts + PLANE_RUNDOWN + 0.1, span.lasts), 0);
  for (let t = 0.1; t < PLANE_DOWN * span.lasts; t += 0.1) assert.ok(planeRpm(t, span.lasts) <= planeRpm(t - 0.1, span.lasts));
});
