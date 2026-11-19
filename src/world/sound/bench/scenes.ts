// The bench's scenes (design §8): each a pure timeline of the dragon's pose and what the ear hears, fed to the real
// mix and engine. Scenes that move drive the real stepFlight (and advance, for the landing) with scripted keys.

import { CRUISE, BRAKE, stepFlight, type FlightInput, type FlightState } from "../../runtime/flight.ts";
import { advance, cameraAt, easeFocus, land, restShare, takeOff, type Phase, type Target } from "../../sites/landing.ts";
import { emptyHearing, type Hearing, type Places, type Pose, type Prefs } from "../types.ts";

export type Action =
  /** "on" is the first enable (the slow fade); a scene without one starts already on. */
  | { at: number; do: "on" | "mute" | "unmute" | "hide" | "show" }
  /** No frames for `for` seconds, then one frame with the large dt. */
  | { at: number; do: "stall"; for: number };

/** A stretch of a scene the render script measures on its own: loudness and left/right balance. */
export interface Mark {
  name: string;
  t0: number;
  t1: number;
}

export interface SceneFrame {
  pose: Pose;
  hearing: Hearing;
  /** Where the camera centres (it differs from the dragon only round a landing). Nothing in the sound reads it. */
  camera?: { x: number; y: number };
}

export interface Scene {
  name: string;
  seconds: number;
  /** What to listen for. */
  about: string;
  places: Places | null;
  prefs: Prefs;
  /** World time at the scene's start, seconds. */
  t0: number;
  /** The frame at scene time t (0 … seconds). */
  at(t: number): SceneFrame;
  actions?: Action[];
  /** Also rendered as `<name>-beds`, with waves and every one-shot muted. */
  beds?: boolean;
  /** Plays the stand-in pips and tails. */
  probe?: boolean;
  /** A calibration tone in place of the world: dBFS peak, Hz. */
  tone?: { db: number; hz: number };
  marks?: Mark[];
  /** Level constants replaced for this scene's renders (as "K_WIND.a": 0): how one layer is heard alone. */
  set?: Record<string, number>;
}

export const BENCH_PREFS: Prefs = { volume: 1, headphones: false, calm: false, touch: false };
const CALM: Prefs = { ...BENCH_PREFS, calm: true };

const N = 10240;
const FPS = 60;
/** Meadows: level ground 12 units up, nothing to the south to climb over. */
const MEADOW = { groundHeight: () => 12, occlusionFloor: () => 0 };
const NORTH = -Math.PI / 2, SOUTH = Math.PI / 2;
const QUIET = emptyHearing();

type Keys = (t: number) => FlightInput;
const key = (turn: -1 | 0 | 1 = 0, boost = false, brake = false): FlightInput => ({ turn, boost, brake });

function startAt(x: number, y: number, heading: number, speed = CRUISE): FlightState {
  return { x, y, heading, speed, alt: 30, bank: 0 };
}

/**
 * A timeline flown once with the real flight model at 60 Hz, then read back by time. `resets` re-aim the dragon while
 * it is level (a turn leaves it facing anywhere; each manoeuvre of `turns` starts from the heading its name says).
 */
function flown(seconds: number, t0: number, start: FlightState, keys: Keys, resets: { at: number; heading: number }[] = []): (t: number) => SceneFrame {
  let frames: SceneFrame[] | null = null;
  const build = () => {
    const out: SceneFrame[] = [];
    let s = start;
    for (let k = 0; k <= seconds * FPS; k++) {
      const t = k / FPS;
      for (const r of resets) if (k === Math.round(r.at * FPS)) s = { ...s, heading: r.heading, bank: 0 };
      if (k > 0) s = stepFlight(s, keys(t), 1 / FPS, MEADOW, N);
      out.push({ pose: { t: t0 + t, dt: 1 / FPS, x: s.x, y: s.y, alt: s.alt, heading: s.heading, speed: s.speed, bank: s.bank, rest: 0 }, hearing: QUIET });
    }
    return out;
  };
  return (t) => {
    frames ??= build();
    return frames[Math.min(frames.length - 1, Math.max(0, Math.round(t * FPS)))];
  };
}

const LEVEL: Keys = () => key();

/** brake 6, cruise 6, boost 8, cruise 4, brake 6. */
const SPEEDS: Keys = (t) => (t < 6 ? key(0, false, true) : t < 12 ? key() : t < 20 ? key(0, true) : t < 24 ? key() : key(0, false, true));

/**
 * One half of `turns`, 16 s: level 1, left 2, level 3, right 4, a fast reversal (left 1.2), level, then four 50 ms
 * taps half a second apart, level to the end.
 */
function turnKeys(t: number): FlightInput {
  if (t >= 1 && t < 3) return key(-1);
  if (t >= 6 && t < 10) return key(1);
  if (t >= 10 && t < 11.2) return key(-1);
  for (let i = 0; i < 4; i++) {
    const a = 13 + 0.5 * i;
    if (t >= a && t < a + 0.05) return key(i % 2 ? -1 : 1);
  }
  return key();
}
const TURNS: Keys = (t) => turnKeys(t % 16);

/** `turns` starting at `at`: the dragon is aimed north again before the right turn and the taps, then south for the second half. */
const aims = (at: number) => [
  { at: at + 5.5, heading: NORTH }, { at: at + 12.6, heading: NORTH },
  { at: at + 16, heading: SOUTH }, { at: at + 21.5, heading: SOUTH }, { at: at + 28.6, heading: SOUTH },
];

/** Marks for one half of `turns`, starting at `at`: each turn's bloom (its first 0.6 s), the taps, and level flight. */
function turnMarks(at: number, tag: string): Mark[] {
  return [
    { name: `${tag} level`, t0: at + 3.8, t1: at + 5.8 },
    { name: `${tag} left turn`, t0: at + 1.05, t1: at + 1.65 },
    { name: `${tag} right turn`, t0: at + 6.05, t1: at + 6.65 },
    { name: `${tag} taps`, t0: at + 13, t1: at + 15 },
  ];
}

/** Approach the abbey from the south, land (the camera eased aside for the Codex), rest 6 s, take off. */
function landing(seconds: number, t0: number): (t: number) => SceneFrame {
  const abbey: Target = { id: "abbey-0", x: 5000, y: 5000, radius: 14 };
  const targets = [abbey];
  /** The camera's place at rest: 64 cells east of the landmark (16 % of the frame), a third of the way up it. */
  const site = { x: abbey.x + 64, y: abbey.y, alt: 12 + 0.35 * 30 };
  let frames: SceneFrame[] | null = null;
  const build = () => {
    const out: SceneFrame[] = [];
    let s = startAt(5000, 5260, NORTH);
    let phase: Phase = { kind: "flying", quiet: null };
    let focus = 0;
    let landedAt = -1;
    for (let k = 0; k <= seconds * FPS; k++) {
      const t = k / FPS;
      if (k > 0) {
        if (phase.kind === "flying" && phase.quiet === null && landedAt < 0 && t >= 2.5) phase = land(phase, s, targets, N);
        if (phase.kind === "landed" && t >= landedAt + 6) phase = takeOff(phase);
        const r = advance(phase, s, key(), 1 / FPS, MEADOW, N, targets);
        phase = r.phase;
        s = r.s;
        if (r.landed) landedAt = t;
        focus = easeFocus(focus, phase.kind !== "flying", 1 / FPS);
      }
      out.push({
        pose: { t: t0 + t, dt: 1 / FPS, x: s.x, y: s.y, alt: s.alt, heading: s.heading, speed: s.speed, bank: s.bank, rest: restShare(phase) },
        hearing: QUIET,
        camera: cameraAt(s, site, focus, N),
      });
    }
    return out;
  };
  return (t) => {
    frames ??= build();
    return frames[Math.min(frames.length - 1, Math.max(0, Math.round(t * FPS)))];
  };
}


/** `wind-speeds` then `turns`, as one flight. */
const CALM_KEYS: Keys = (t) => (t < 30 ? SPEEDS(t) : TURNS(t - 30));

const scene = (s: Omit<Scene, "places" | "prefs" | "t0"> & Partial<Pick<Scene, "places" | "prefs" | "t0">>): Scene => ({ places: null, prefs: BENCH_PREFS, t0: 100, ...s });

export const SCENES: Scene[] = [
  scene({
    name: "calibration",
    seconds: 4,
    about: "A 1 kHz tone at −20 dBFS through the master chain at volume 1: it must come out at −20 dBFS, so the limiter's make-up is undone by the trim.",
    tone: { db: -20, hz: 1000 },
    at: flown(4, 100, startAt(5000, 5000, NORTH), LEVEL),
  }),
  scene({
    name: "wind-cruise",
    seconds: 20,
    about: "Level cruise over meadows: buffet in each ear on its own, rush, gusts that never repeat; no whistle.",
    at: flown(20, 100, startAt(5000, 5000, NORTH), LEVEL),
  }),
  scene({
    name: "wind-speeds",
    seconds: 30,
    about: "Brake 6 s, cruise 6, boost 8, cruise 4, brake 6: pitch and weight rise together; the swell at boost; air letting go at brake.",
    at: flown(30, 100, startAt(5000, 5000, NORTH, CRUISE * BRAKE), SPEEDS),
    marks: [
      { name: "brake", t0: 2, t1: 6 },
      { name: "cruise", t0: 8.5, t1: 12 },
      { name: "boost", t0: 15, t1: 20 },
    ],
  }),
  scene({
    name: "turns",
    seconds: 32,
    about: "Heading north: left 2 s, level 3, right 4, a fast reversal, four 50 ms taps; then the same heading south (the dragon is re-aimed while level before each). A bloom on the outside wing as seen on screen, both ways; taps silent.",
    at: flown(32, 100, startAt(5000, 5000, NORTH), TURNS, aims(0)),
    marks: [...turnMarks(0, "north"), ...turnMarks(16, "south")],
  }),
  scene({
    name: "turns-whoosh",
    seconds: 32,
    about: "The same turns with the wind's layers muted (renders only): the whoosh alone, to read its level, its side and the silence of the taps.",
    at: flown(32, 100, startAt(5000, 5000, NORTH), TURNS, aims(0)),
    marks: [...turnMarks(0, "north"), ...turnMarks(16, "south")],
    set: { "K_WIND.a": 0, "K_WIND.b": 0, "K_WIND.c": 0, "K_WIND.d": 0, "K_WIND.e": 0 },
  }),
  scene({
    name: "reduced-motion",
    seconds: 62,
    about: "wind-speeds then turns under reduced motion: half the rise; no whoosh; nothing leaps.",
    prefs: CALM,
    beds: true,
    at: flown(62, 100, startAt(5000, 5000, NORTH, CRUISE * BRAKE), CALM_KEYS, aims(30)),
    marks: [
      { name: "brake", t0: 2, t1: 6 },
      { name: "cruise", t0: 8.5, t1: 12 },
      { name: "boost", t0: 15, t1: 20 },
      ...turnMarks(30, "north"),
      ...turnMarks(46, "south"),
    ],
  }),
  scene({
    name: "landing",
    seconds: 30,
    about: "Approach the abbey, land (the camera shifted for the Codex), rest 6 s, take off: wind draining to a breeze; the stage does not slide as the camera moves.",
    beds: true,
    at: landing(30, 100),
  }),
  scene({
    name: "toggle",
    seconds: 16,
    about: "On at 0, off at 6, on at 9, off at 13: a slow first rise; clean stops; nothing old on return.",
    probe: true,
    actions: [{ at: 0, do: "on" }, { at: 6, do: "mute" }, { at: 9, do: "unmute" }, { at: 13, do: "mute" }],
    at: flown(16, 100, startAt(5000, 5000, NORTH), LEVEL),
  }),
  scene({
    name: "hide-show",
    seconds: 16,
    about: "Hide at 5, show at 9. No click, no stale tail; what should be sounding at the new time is, once.",
    probe: true,
    // The stand-in tails start at 2.5, 6.5, 10.5 s: one is cut by the hide, one starts unseen and is joined at the show.
    t0: 234.5,
    actions: [{ at: 5, do: "hide" }, { at: 9, do: "show" }],
    at: flown(16, 234.5, startAt(5000, 5000, NORTH), LEVEL),
  }),
  scene({
    name: "stall",
    seconds: 12,
    about: "A 0.6 s gap in the frames at 5 s: no hole after it, nothing doubled.",
    probe: true,
    // The stand-in tails start at 1.4, 5.4, 9.4 s: one sounds into the gap (not doubled), one starts inside it (joined).
    t0: 235.6,
    actions: [{ at: 5, do: "stall", for: 0.6 }],
    at: flown(12, 235.6, startAt(5000, 5000, NORTH), LEVEL),
    marks: [
      { name: "before the gap", t0: 4, t1: 5 },
      { name: "after the gap", t0: 5.6, t1: 6.6 },
    ],
  }),
];

/** A recorded flight (world-fly.mjs --soundlog), as `/world?stats&soundlog` wrote it. */
export interface SoundLog {
  v: 1;
  worldId: string;
  places: Places | null;
  prefs: Prefs;
  /** One row a frame: t, dt, x, y, alt, heading, speed, bank, rest, index of the Hearing in force. */
  frames: number[][];
  hearings: Hearing[];
}

/** True when `x` has a sound log's shape. */
export function isSoundLog(x: unknown): x is SoundLog {
  const l = x as SoundLog | null;
  return !!l && l.v === 1 && typeof l.worldId === "string" && Array.isArray(l.frames) && Array.isArray(l.hearings) && l.frames.every((f) => Array.isArray(f) && f.length >= 10);
}

/** The scene that replays a recorded flight through the real mix and engine: the game as flown. */
export function replayScene(log: SoundLog, seconds = 30): Scene {
  const rows = log.frames;
  const start = rows[0]?.[0] ?? 0;
  const length = Math.min(seconds, rows.length ? rows[rows.length - 1][0] - start : 0);
  let i = 0;
  const frame: SceneFrame = { pose: { t: 0, dt: 0, x: 0, y: 0, alt: 0, heading: 0, speed: 0, bank: 0, rest: 0 }, hearing: QUIET };
  return {
    name: "flight-replay",
    seconds: Math.max(1, Math.floor(length)),
    about: "The recorded world-fly route, fed to the real mix and engine: the game as flown.",
    places: log.places,
    prefs: { ...BENCH_PREFS, calm: log.prefs?.calm === true, touch: log.prefs?.touch === true },
    t0: start,
    at(t) {
      const want = start + t;
      if (i >= rows.length || rows[i][0] > want) i = 0;
      while (i + 1 < rows.length && rows[i + 1][0] <= want) i++;
      const r = rows[i];
      const p = frame.pose;
      // The row in force at that time (the render stamps the frame with its own time).
      p.t = want;
      p.dt = r[1];
      p.x = r[2];
      p.y = r[3];
      p.alt = r[4];
      p.heading = r[5];
      p.speed = r[6];
      p.bank = r[7];
      p.rest = r[8];
      frame.hearing = log.hearings[r[9]] ?? QUIET;
      return frame;
    },
  };
}

/** Every scene to render: each scene, and its `-beds` twin where it has one. */
export function renderNames(scenes: readonly Scene[]): { name: string; seconds: number; about: string }[] {
  const out: { name: string; seconds: number; about: string }[] = [];
  for (const s of scenes) {
    out.push({ name: s.name, seconds: s.seconds, about: s.about });
    if (s.beds) out.push({ name: `${s.name}-beds`, seconds: s.seconds, about: `${s.about} (Continuous layers only: waves and every one-shot muted.)` });
  }
  return out;
}
