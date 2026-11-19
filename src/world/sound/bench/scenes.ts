// The bench's scenes (design §8): each a pure timeline of the dragon's pose and what the ear hears, fed to the real
// mix and engine. Scenes that move drive the real stepFlight (and advance, for the landing) with scripted keys.

import { CRUISE, BRAKE, stepFlight, type FlightInput, type FlightState } from "../../runtime/flight.ts";
import { warpTile } from "../../live/water.ts";
import { MATERIAL as M } from "../../look/materials.ts";
import { advance, cameraAt, easeFocus, land, restShare, takeOff, type Phase, type Target } from "../../sites/landing.ts";
import { wheelersOf } from "../../live/life.ts";
import { momentWindow } from "../../live/moments.ts";
import { censusStartles } from "../census.ts";
import { createEar } from "../ear.ts";
import { createLanes } from "../engine/lanes.ts";
import { KEKS, LONG, MEW, YELP } from "../schedule/gulls.ts";
import { copyHearing, emptyHearing, type Hearing, type Places, type Pose, type Prefs, type Startle } from "../types.ts";
import { coastEast, coastOfKinds, coastWest, cove, frameOf, gridOf, islet, OPEN_SEA, overlay, riverNS, type FlatWorld } from "./land.ts";

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
  /** Only the waves' hiss path sounds. */
  hissOnly?: boolean;
  /** The repetition check (bench/repeat.ts) is run over the render's waves. */
  repeat?: boolean;
  /** Seconds of the render to hand back as sound (the rest is rendered and measured, then let go). */
  keep?: number;
  /** In place of the abbey's hours: one stroke of the tenor under its hammer, this many seconds into the scene. */
  stroke?: number;
  /** In place of any bell: one sample of 1 into the reverb's send, this many seconds into the scene. */
  impulse?: number;
  /** In place of the colonies' own calling: these calls (times in seconds into the scene), each from its own fixed place. */
  gullScript?: { at: number; call: number; voice: number; x: number; y: number }[];
  /** Of the clock, only the tune's chimes. */
  tuneOnly?: boolean;
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

/** The seed the bench's stand-in world is drawn with: the shipped world's, so its waves bend as the picture's do. */
const SEED = 3;
let warp: Uint8Array | null = null;

/** A dragon holding still at (x, y), 30 units up: no wind but the breeze, so the water is heard alone. */
function hover(seconds: number, t0: number, x: number, y: number, rest = 0): (t: number) => SceneFrame {
  return (t) => ({ pose: { t: t0 + Math.min(seconds, Math.max(0, Math.round(t * FPS) / FPS)), dt: 1 / FPS, x, y, alt: 30, heading: NORTH, speed: 0, bank: 0, rest }, hearing: QUIET });
}

/**
 * A timeline over a stand-in world: the real ear makes a pass ten times a second over the frame the camera would
 * see, with the lane mask the real lane logic would hand it, and each frame carries the Hearing then in force.
 */
function heard(world: FlatWorld, seconds: number, flight: (t: number) => SceneFrame, touch = false, census = false): (t: number) => SceneFrame {
  let hearings: Hearing[] | null = null;
  /** With the census: the gulls put up, by frame (thirty looks a second, each frame carrying the last look's). */
  const startled: Startle[][] = [];
  const build = () => {
    warp ??= warpTile(SEED);
    const ear = createEar();
    ear.setWorld({ n: world.n, land: gridOf(world) });
    ear.setWarp(warp);
    const lanes = createLanes({ lanes: touch ? 2 : 4, emitters: touch ? 4 : 8, seed: SEED });
    const out: Hearing[] = [];
    const buffer = new Uint32Array(400 * 225);
    let last: Hearing = QUIET, lastT = NaN;
    for (let k = 0; k <= seconds * FPS; k++) {
      const pose = flight(k / FPS).pose;
      if (census) {
        if (k % 2 === 0) {
          const list: Startle[] = [];
          censusStartles(frameOf(world, pose.x, pose.y - pose.alt / 0.8, buffer), pose, world.n, SEED, [], list, []);
          startled.push(list);
        } else startled.push(startled[k - 1]);
      }
      if (k % 6 === 0) {
        // In flight the camera centres on the dragon itself, alt / 0.8 cells north of its ground point.
        const seen = frameOf(world, pose.x, pose.y - pose.alt / 0.8, buffer);
        // Twice at the start: the second pass knows where the first found shore.
        if (k === 0) ear.pass(pose, seen, 0);
        last = copyHearing(ear.pass(pose, seen, lanes.mask()));
        out.push(last);
      }
      lanes.step(last, pose.t, lastT === lastT ? pose.t - lastT : 0, 0.25, [], []);
      lastT = pose.t;
    }
    return out;
  };
  return (t) => {
    hearings ??= build();
    const k = Math.min(seconds * FPS, Math.max(0, Math.round(t * FPS)));
    const f = flight(t);
    const hearing = hearings[Math.floor(k / 6)];
    return { pose: f.pose, hearing: census ? { ...hearing, startled: startled[k] } : hearing, camera: f.camera };
  };
}

/** Cruising south, 40 cells off a coast that runs north–south at x = 5040. */
const alongCoast = (seconds: number, t0: number, y0 = 3000) => flown(seconds, t0, startAt(5000, y0, SOUTH), LEVEL);
const BEACH_COAST = coastEast(5040, M.sand);
/** The wind alone. */
const NO_WATER = { "K_SURF.wave": 0, "K_SURF.lap": 0, "K_SURF.bedHiss": 0, "K_SURF.bedBody": 0, "K_SURF.bedRumble": 0, "K_SURF.bedRattle": 0, "K_SURF.open": 0 };
/** The approach from 600 cells out at 60 cells a second: one-second stretches centred 400, 300, 200, 100 and 50 cells from the beach. */
const APPROACH: Mark[] = [400, 300, 200, 100, 50].map((d) => ({ name: `${d} cells out`, t0: (600 - d) / 60 - 0.5, t1: (600 - d) / 60 + 0.5 }));
/** No rivers or falls. */
const NO_FRESH = { "K_RIVER.flow": 0, "K_RIVER.brook": 0, "K_RIVER.riffle": 0, "K_RIVER.fallSmall": 0, "K_RIVER.fallTall": 0 };
/** The water alone: the still surf scenes are solo, so their levels can be read against §3.6. */
const NO_WIND = { "K_WIND.a": 0, "K_WIND.b": 0, "K_WIND.c": 0, "K_WIND.d": 0, "K_WIND.e": 0, "K_WIND.w": 0 };

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
    // The long right turn: its bloom, and the pressure it holds once the bank has settled.
    { name: `${tag} right bloom`, t0: at + 6.3, t1: at + 7.6 },
    { name: `${tag} right hold`, t0: at + 8.6, t1: at + 9.9 },
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


/** A town at (5000, 5000) and nothing else: its nine gulls wheel over it. */
const TOWN_SITES = [{ type: "town", x: 5000, y: 5000 }];
const HARBOUR: Places = { worldId: "bench", seed: SEED, n: N, forced: false, abbeys: [], towns: [{ x: 5000, y: 5000 }], lighthouses: [], gulls: wheelersOf(TOWN_SITES, SEED), wonders: [] };
const NO_GULLS: Places = { ...HARBOUR, towns: [], gulls: [] };

/** A town with its clock and no gulls; a railway across shallow water, shore to halt 288 cells east (18 cells a second on this seed); a cove hotel's pontoon. */
const CLOCK_TOWN: Places = { ...NO_GULLS, towns: [{ x: 5000, y: 5000 }] };
const RAILWAY: Places = { ...NO_GULLS, wonders: [{ type: "railway", x: 5000, y: 5000, level: 0, height: 0, anchors: { shore: [4856, 5000], halt: [5144, 5000] } }] };
const HOTEL: Places = { ...NO_GULLS, wonders: [{ type: "cove-hotel", x: 5000, y: 5000, level: 0, height: 0, anchors: { pontoon: [5000, 5000] } }] };
/** World time at which `kind` first appears on the bench's seed. */
function firstAppearance(kind: string): number {
  for (let t = 0; t < 4000; t += 1) {
    const at = momentWindow(SEED, kind, t);
    if (at >= 0) return t - at;
  }
  return 0;
}
const TRAIN_AT = firstAppearance("train"), PLANE_AT = firstAppearance("plane"), FERRY_AT = firstAppearance("ferry"), CHURCH_AT = firstAppearance("church");
/** The baths, their quay 10 cells south of them (the ferry comes in from 42 cells further south); a drowned church's tower. */
const BATHS: Places = { ...NO_GULLS, wonders: [{ type: "baths", x: 5000, y: 4990, level: 0, height: 0, anchors: { quay: [5000, 5000] } }] };
const CHURCH: Places = { ...NO_GULLS, wonders: [{ type: "drowned-church", x: 5000, y: 5000, level: 0, height: 0, anchors: { tower: [5000, 5000] } }] };
const WEST = Math.PI;

/** The bench's abbey, and the places that hold it alone. */
const ABBEY = { x: 5000, y: 5000 };
const abbeyAt = (x: number, y: number): Places => ({ worldId: "bench", seed: SEED, n: N, forced: false, abbeys: [{ x, y }], towns: [], lighthouses: [], gulls: [], wonders: [] });
const AT_ABBEY = abbeyAt(ABBEY.x, ABBEY.y);
/** World time at the top of the abbey's hour `H` (it strikes ((H + 11) mod 12) + 1). */
const hourTop = (H: number) => 240 * H;
/** The bells alone, dry: no send to the reverb. */
const DRY = { "K_BELL.send": 0 };

/**
 * In from 1400 cells south of the abbey at cruise, slowing over the last two seconds to brake speed, then round the
 * tower at 100 cells, clockwise from due south (the bells pass from ahead to the left, behind, the right).
 */
function approach(seconds: number, t0: number): (t: number) => SceneFrame {
  const R = 100, far = 1400, slowS = 2;
  const run = (far - R) / CRUISE - slowS / 2 * (1 - BRAKE);
  return (time) => {
    const t = Math.min(seconds, Math.max(0, Math.round(time * FPS) / FPS));
    // Speed: cruise, then eased to brake speed over the two seconds before the circle is joined.
    const u = Math.min(1, Math.max(0, (t - (run - slowS)) / slowS));
    const speed = CRUISE * (1 - (1 - BRAKE) * u * u * (3 - 2 * u));
    let x = ABBEY.x, y: number, heading = NORTH;
    if (t <= run) {
      // Distance flown: cruise throughout, less what the slowing has cost so far (the integral of the ease).
      const lost = CRUISE * (1 - BRAKE) * slowS * (u * u * u - (u * u * u * u) / 2);
      y = ABBEY.y + far - (CRUISE * t - lost);
    } else {
      const a = ((t - run) * CRUISE * BRAKE) / R;
      x = ABBEY.x - R * Math.sin(a);
      y = ABBEY.y + R * Math.cos(a);
      heading = Math.PI + a;
    }
    return { pose: { t: t0 + t, dt: 1 / FPS, x, y, alt: 30, heading, speed, bank: 0, rest: 0 }, hearing: QUIET };
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
    name: "surf-beach",
    set: NO_WIND,
    seconds: 48,
    about: "Still, 25 cells off a beach, the whole nine-wave set: build, crash, hiss changing colour, backwash; the big ones; the lull.",
    at: heard(coastEast(5025, M.sand), 48, hover(48, 100, 5000, 5000)),
  }),
  scene({
    name: "surf-shingle",
    set: NO_WIND,
    seconds: 30,
    about: "The same at shingle: the crash, then stones dragging in the backwash, falling in pitch.",
    at: heard(coastEast(5025, M.shingle), 30, hover(30, 100, 5000, 5000)),
  }),
  scene({
    name: "surf-rock",
    set: NO_WIND,
    seconds: 30,
    about: "The same at a cliff: a boom, spray thrown up and hissing back, the gully gurgling as it drains.",
    at: heard(coastEast(5025, M.cliffHard), 30, hover(30, 100, 5000, 5000)),
  }),
  scene({
    name: "surf-rock-one",
    seconds: 30,
    set: NO_WIND,
    about: "One short cliff, so one lane: each boom on its own, a hit and a decay, then the gully. (At a long cliff four lanes' booms overlap.)",
    at: heard(islet(5025, 5000, 16, M.cliffHard), 30, hover(30, 100, 5000, 5000)),
  }),
  scene({
    name: "surf-calm",
    set: NO_WIND,
    seconds: 20,
    about: "At a quay: sparse laps, each its own.",
    at: heard(coastEast(5025, M.cobble), 20, hover(20, 100, 5000, 5000)),
  }),
  scene({
    name: "open-sea",
    set: NO_WIND,
    seconds: 20,
    about: "Far offshore: a faint wide wash, coming and going, with no clock in it.",
    at: heard(OPEN_SEA, 20, hover(20, 100, 5000, 5000)),
  }),
  scene({
    name: "surf-far",
    // Far surf alone: the dragon is over open water here, and the sea's own wash would be heard under it.
    set: { ...NO_WIND, "K_SURF.open": 0 },
    seconds: 30,
    about: "250 cells off a long coast to the west: a low wandering rumble on the left.",
    at: heard(coastWest(4750, M.sand), 30, hover(30, 100, 5000, 5000)),
  }),
  scene({
    name: "cove",
    set: NO_WIND,
    beds: true,
    seconds: 30,
    about: "Still, in a cove with shore on every side: surf all round, none missing where no lane is.",
    at: heard(cove(5000, 5000, 90, M.sand), 30, hover(30, 100, 5000, 5000)),
  }),
  scene({
    name: "coast-run",
    seconds: 45,
    about: "Cruise 40 cells off a coast: beach, shingle, cliff, 15 s each. One shore changing character; each crash left behind where it broke.",
    beds: true,
    at: heard(coastOfKinds(5040, [M.sand, M.shingle, M.cliffHard], 3000, 900), 45, alongCoast(45, 100)),
  }),
  scene({
    name: "sea-to-coast",
    seconds: 40,
    about: "From 600 cells out, straight in, across the beach, inland: far rumble first; waves resolve; they pass under and fall behind, duller.",
    beds: true,
    at: heard(coastEast(5000, M.sand), 40, flown(40, 100, startAt(4400, 5000, 0), LEVEL)),
  }),
  scene({
    name: "sea-to-coast-water",
    seconds: 40,
    about: "The same approach with the wind muted: the water alone. It must rise smoothly from about 400 cells out: far rumble, then the bed, then waves.",
    set: NO_WIND,
    at: heard(coastEast(5000, M.sand), 40, flown(40, 100, startAt(4400, 5000, 0), LEVEL)),
    marks: APPROACH,
  }),
  scene({
    name: "sea-to-coast-wind",
    seconds: 40,
    about: "The same approach with the water muted: the wind alone, to set the water against.",
    set: NO_WATER,
    at: heard(coastEast(5000, M.sand), 40, flown(40, 100, startAt(4400, 5000, 0), LEVEL)),
    marks: APPROACH,
  }),
  scene({
    name: "surf-repeat",
    seconds: 600,
    about: "Landed by one short beach for ten minutes, only the waves' hiss sounding: the repetition check. No two waves may share a stretch of noise. (The sound kept is the first minute.)",
    hissOnly: true,
    repeat: true,
    keep: 60,
    // One short beach, so one lane: about 230 waves in the ten minutes.
    at: heard(islet(5025, 5000, 16, M.sand), 600, hover(600, 100, 5000, 5000, 1)),
  }),
  scene({
    name: "river",
    set: NO_WIND,
    seconds: 20,
    about: "Still, between a wide river 20 cells to the east and a stream 25 cells to the west: bubbles, not hiss; the purl on the right, the brook's separate notes on the left.",
    at: heard(overlay(riverNS(5020, 6, 4), riverNS(4974.5, 2, 10)), 20, hover(20, 100, 5000, 5000)),
  }),
  scene({
    name: "brook",
    set: NO_WIND,
    seconds: 20,
    about: "Still, 15 cells from a stream alone: single bubbles, each a short rising note.",
    at: heard(riverNS(5014.5, 2, 10), 20, hover(20, 100, 5000, 5000)),
  }),
  scene({
    name: "fall-small",
    set: NO_WIND,
    seconds: 20,
    about: "Still, 20 cells from a small fall (4 rows) on a river: a loud brook with a bright body; no rumble.",
    at: heard(riverNS(5020, 4, 4, [{ y: 4995, run: 4 }]), 20, hover(20, 100, 5000, 5000)),
  }),
  scene({
    name: "fall-tall",
    set: NO_WIND,
    seconds: 20,
    about: "Still, 30 cells from a tall fall (18 rows): body, hiss that breathes, the plunge, and a rumble under it all.",
    at: heard(riverNS(5030, 4, 4, [{ y: 4977.5, run: 18 }]), 20, hover(20, 100, 5000, 5000)),
  }),
  scene({
    name: "river-to-fall",
    seconds: 40,
    about: "Up a river at cruise to a tall fall and past, the camera sliding: the purl, then the fall rising with no gap, then left behind, duller.",
    beds: true,
    at: heard(riverNS(5015, 4, 4, [{ y: 4977.5, run: 18 }]), 40, flown(40, 100, startAt(5000, 6200, NORTH), LEVEL)),
    marks: [
      { name: "the river alone", t0: 4, t1: 12 },
      { name: "at the fall", t0: 19, t1: 21 },
    ],
  }),
  ...(["", "-water", "-wind"] as const).map((part) => scene({
    name: `fall-tall-pass${part}`,
    seconds: 12,
    about: `Cruising north past a tall fall 30 cells to the east, from 250 cells off: heard under the wind from the frame's edge in, loudest abeam, then behind and duller.${part === "-water" ? " (The water alone.)" : part === "-wind" ? " (The wind alone.)" : ""}`,
    set: part === "-water" ? NO_WIND : part === "-wind" ? NO_FRESH : undefined,
    at: heard(riverNS(5030, 4, 4, [{ y: 4977.5, run: 18 }]), 12, flown(12, 100, startAt(5000, 5250, NORTH), LEVEL)),
    // The half second from each distance in (30 cells at cruise, from 250 off): the fall's foot is inside the frame from 177 cells.
    marks: [150, 120, 90, 60, 30].map((d) => ({ name: `${d} to ${d - 30} cells out`, t0: (250 - d) / 60, t1: (250 - d) / 60 + 0.5 })),
  })),
  scene({
    name: "falls-handover",
    set: NO_WIND,
    seconds: 14,
    about: "Slowly north past two small falls toward a tall one: the tall fall takes the spare chain when it beats the weaker small one, a half-second crossfade with no hole.",
    at: heard(
      overlay(overlay(riverNS(5030, 4, 4, [{ y: 5495, run: 4 }], 5440, 5560), riverNS(4965, 4, 4, [{ y: 5465, run: 4 }], 5410, 5530)), riverNS(5015, 4, 4, [{ y: 5307.5, run: 18 }], 5200, 5380)),
      14, flown(14, 100, startAt(5000, 5560, NORTH, CRUISE * BRAKE), () => key(0, false, true)),
    ),
  }),
  scene({
    name: "gull-calls",
    set: NO_WIND,
    seconds: 20,
    about: "One bird's four calls 30 cells to the east (a yelp, a run of keks, a mew, a long call), then a yelp, keks and a mew from 200 cells: harmonics, rasp at the peak only; far off, a thin kyow.",
    places: NO_GULLS,
    gullScript: [
      { at: 0.5, call: YELP, voice: 0, x: 5030, y: 5000 }, { at: 1.6, call: KEKS, voice: 0, x: 5030, y: 5000 }, { at: 3.2, call: MEW, voice: 0, x: 5030, y: 5000 },
      { at: 5.2, call: LONG, voice: 0, x: 5030, y: 5000 },
      { at: 14.5, call: YELP, voice: 0, x: 5200, y: 5000 }, { at: 15.6, call: KEKS, voice: 0, x: 5200, y: 5000 }, { at: 17.4, call: MEW, voice: 0, x: 5200, y: 5000 },
    ],
    at: hover(20, 100, 5000, 5000),
  }),
  scene({
    name: "gulls-harbour",
    set: NO_WIND,
    seconds: 60,
    about: "Still, 80 cells south of the town: calls in clusters with silences between; answers; each bird in its own place, moving as it wheels.",
    places: HARBOUR,
    t0: 400,
    at: hover(60, 400, 5000, 5080),
  }),
  scene({
    name: "gulls-lowpass",
    seconds: 30,
    about: "A boosted low pass along a beach where gulls rest: each bird's keks as it lifts, and its wingbeats on the drawn downstrokes, under the wind.",
    places: NO_GULLS,
    at: heard(coastEast(5040, M.sand), 30, flown(30, 100, startAt(5030, 3000, SOUTH), () => key(0, true)), false, true),
  }),
  scene({
    name: "gulls-lowpass-wind",
    set: { ...NO_WATER, "K_GULL.kek": 0, "K_GULL.flap": 0 },
    seconds: 30,
    about: "The same pass, the wind alone: what the birds must be heard over.",
    places: NO_GULLS,
    at: heard(coastEast(5040, M.sand), 30, flown(30, 100, startAt(5030, 3000, SOUTH), () => key(0, true)), false, true),
  }),
  scene({
    name: "gulls-lowpass-birds",
    set: { ...NO_WIND, ...NO_WATER },
    seconds: 30,
    about: "The same pass, the birds alone: keks and wingbeats.",
    places: NO_GULLS,
    at: heard(coastEast(5040, M.sand), 30, flown(30, 100, startAt(5030, 3000, SOUTH), () => key(0, true)), false, true),
  }),
  scene({
    name: "clock",
    set: NO_WIND,
    seconds: 40,
    about: "At the town, 60 cells off, through hour 3: the whirr, the doors, a figure and a phrase at a time to the tune, three strokes, the ratchet only in the gaps, the doors.",
    places: CLOCK_TOWN,
    t0: hourTop(3) - 2,
    at: hover(40, hourTop(3) - 2, 5000, 5060),
    marks: [{ name: "the tune", t0: 2.6, t1: 24.5 }, { name: "its first bar", t0: 2.6, t1: 4.3 }, { name: "bar 7", t0: 12.64, t1: 14.3 }],
  }),
  scene({
    name: "clock-tune",
    set: NO_WIND,
    seconds: 27,
    about: "The clock's tune alone, chimes only (no mechanism, no count): E Dorian, 6/8, thirteen bars.",
    places: CLOCK_TOWN,
    tuneOnly: true,
    t0: hourTop(3) - 1,
    at: hover(27, hourTop(3) - 1, 5000, 5060),
  }),
  scene({
    name: "train",
    set: NO_WIND,
    seconds: 36,
    about: "Still, 60 cells off the middle of the line, the train's whole run: chuffs by the wheel, the whistle and its echo, the spray, the turn at the halt, and back.",
    places: RAILWAY,
    t0: TRAIN_AT - 2,
    at: hover(36, TRAIN_AT - 2, 5000, 5060),
    // The train is nearest (60 cells) 8 s into its run and again 24 s in: a second either side of each. Its whistles sound from 140 cells.
    marks: [{ name: "chuffs at 60 cells, out", t0: 9, t1: 11 }, { name: "chuffs at 60 cells, back", t0: 25, t1: 27 }, { name: "the long whistle, 140 cells off", t0: 3.05, t1: 4.2 }],
  }),
  ...(["", "-alone"] as const).map((part) => scene({
    name: `train-pass${part}`,
    set: part ? NO_WIND : undefined,
    seconds: 20,
    about: `A cruise pass the other way along the line, 30 cells off, meeting the train as it whistles: the whistle bends while it sounds, by less than a semitone in all.${part ? " (The train alone.)" : ""}`,
    places: RAILWAY,
    t0: TRAIN_AT - 2,
    at: flown(20, TRAIN_AT - 2, startAt(5100, 5030, WEST), LEVEL),
  })),
  scene({
    name: "seaplane",
    set: NO_WIND,
    seconds: 25,
    about: "Still, 60 cells west of the pontoon: the seaplane down from the south, two splashes as its floats skip, the taxi, the engine running down to three last pops.",
    places: HOTEL,
    t0: PLANE_AT - 2,
    at: hover(25, PLANE_AT - 2, 4940, 5000),
    marks: [{ name: "the approach", t0: 2.5, t1: 8.5 }],
  }),
  scene({
    name: "ferry",
    set: NO_WIND,
    seconds: 55,
    about: "Still, 60 cells west of the ferry's way: its engine's slow thump and its bow wash coming in, a short blast before the quay, a long one as it leaves, each with its echo; the baths' steam and pools faint behind.",
    places: BATHS,
    t0: FERRY_AT - 2,
    at: hover(55, FERRY_AT - 2, 4940, 5020),
    marks: [{ name: "the engine and wash", t0: 8, t1: 20 }, { name: "the long horn", t0: 30.05, t1: 33 }],
  }),
  scene({
    name: "ferry-pass-alone",
    set: NO_WIND,
    seconds: 14,
    about: "A cruise pass 35 cells south of the ferry as it sounds its long blast: the horn bends by less than a semitone.",
    places: BATHS,
    t0: FERRY_AT + 22,
    at: flown(14, FERRY_AT + 22, startAt(4550, 5040, 0), LEVEL),
  }),
  scene({
    name: "church-flock",
    set: NO_WIND,
    seconds: 47,
    about: "Still, 60 cells south of the drowned church: the flock's lift (a clatter of wings at full level from the first beat), then wingbeats thinning as it circles, and ripples lapping at the tower.",
    places: CHURCH,
    t0: CHURCH_AT - 2,
    at: hover(47, CHURCH_AT - 2, 5000, 5060),
    marks: [{ name: "the lift", t0: 2, t1: 5 }, { name: "circling", t0: 15, t1: 40 }],
  }),
  scene({
    name: "bell-stroke",
    seconds: 12,
    about: "One stroke of the tenor, 60 cells off: clang to dark hum; the warble of its doublets; the tail ends in silence.",
    set: NO_WIND,
    places: AT_ABBEY,
    stroke: 0.5,
    at: hover(12, 100, ABBEY.x, ABBEY.y + 60),
  }),
  scene({
    name: "bell-stroke-dry",
    seconds: 12,
    about: "The same stroke with no reverb: what the bell itself does (its partials and their decays are measured here).",
    set: { ...NO_WIND, ...DRY },
    places: AT_ABBEY,
    stroke: 0.5,
    at: hover(12, 100, ABBEY.x, ABBEY.y + 60),
  }),
  scene({
    name: "reverb-impulse",
    seconds: 4,
    about: "One sample into the reverb's send bus, half a second in: the render is the reverb's own response (measured, not for listening).",
    set: NO_WIND,
    places: AT_ABBEY,
    impulse: 0.5,
    at: hover(4, 100, ABBEY.x, ABBEY.y + 60),
  }),
  scene({
    name: "bells-near",
    seconds: 75,
    about: "At the tower through hour 5: the bells entering in turn, drifting against each other; a pause; five strokes.",
    set: NO_WIND,
    places: AT_ABBEY,
    t0: hourTop(5),
    at: hover(75, hourTop(5), ABBEY.x, ABBEY.y + 60),
    marks: [
      { name: "peal", t0: 14, t1: 36 },
      { name: "peal 25–33 s", t0: 25, t1: 33 },
      { name: "the hour", t0: 40, t1: 52 },
    ],
  }),
  scene({
    name: "bells-twelve",
    seconds: 40,
    about: "At the tower, the page's first hour, from just before its strokes: twelve of them, 2.4 s apart.",
    set: NO_WIND,
    places: AT_ABBEY,
    t0: hourTop(0) + 38,
    at: hover(40, hourTop(0) + 38, ABBEY.x, ABBEY.y + 60),
  }),
  scene({
    name: "abbey-approach",
    seconds: 90,
    about: "From 1400 cells, 4 s before the hour, in to the tower and round it: faint, wandering, mostly hum; clearing on arrival; the wind yields 3 dB only when near.",
    beds: true,
    places: AT_ABBEY,
    t0: hourTop(7) - 4,
    at: approach(90, hourTop(7) - 4),
    marks: [
      // The wind at brake speed round the tower: under the bells, and after they are done.
      { name: "wind, ringing", t0: 40, t1: 60 },
      { name: "wind, after", t0: 75, t1: 90 },
    ],
  }),
  scene({
    name: "bells-rejoin",
    seconds: 40,
    about: "Unlock mid-peal; a 0.6 s stall at 10 s; hide at 20, show at 24: tails present at once; nothing doubled after the stall; nothing stale after the hide; five strokes for the hour.",
    set: NO_WIND,
    places: AT_ABBEY,
    t0: hourTop(5) + 14,
    actions: [{ at: 0, do: "on" }, { at: 10, do: "stall", for: 0.6 }, { at: 20, do: "hide" }, { at: 24, do: "show" }],
    at: hover(40, hourTop(5) + 14, ABBEY.x, ABBEY.y + 60),
    marks: [{ name: "peal 25–33 s", t0: 11, t1: 19 }],
  }),
  scene({
    name: "toggle",
    seconds: 16,
    about: "Cruising along a beach: on at 0, off at 6, on at 9, off at 13. A slow first rise; clean stops; nothing old on return.",
    actions: [{ at: 0, do: "on" }, { at: 6, do: "mute" }, { at: 9, do: "unmute" }, { at: 13, do: "mute" }],
    at: heard(BEACH_COAST, 16, alongCoast(16, 100)),
  }),
  scene({
    name: "hide-show",
    seconds: 16,
    about: "Cruising along a beach: hide at 5, show at 9. No click, no stale wave; the waves that should be breaking at the new time are, once, joined part-way.",
    actions: [{ at: 5, do: "hide" }, { at: 9, do: "show" }],
    at: heard(BEACH_COAST, 16, alongCoast(16, 100)),
  }),
  scene({
    name: "stall",
    seconds: 12,
    about: "Cruising along a beach: a 0.6 s gap in the frames at 5 s. No hole after it, nothing doubled.",
    actions: [{ at: 5, do: "stall", for: 0.6 }],
    at: heard(BEACH_COAST, 12, alongCoast(12, 100)),
    marks: [
      { name: "before the gap", t0: 4, t1: 5 },
      { name: "after the gap", t0: 5.6, t1: 6.6 },
    ],
  }),
  scene({
    name: "hide-show-bells",
    seconds: 16,
    about: "The same, mid-peal, past an abbey 120 cells inland: the rings that should be sounding on return are, once.",
    actions: [{ at: 5, do: "hide" }, { at: 9, do: "show" }],
    places: abbeyAt(4880, 3480),
    t0: hourTop(5) + 16,
    at: heard(BEACH_COAST, 16, alongCoast(16, hourTop(5) + 16)),
  }),
  scene({
    name: "stall-bells",
    seconds: 12,
    about: "The same, mid-peal, past an abbey 120 cells inland: no ring doubled, none missing after the gap.",
    actions: [{ at: 5, do: "stall", for: 0.6 }],
    places: abbeyAt(4880, 3360),
    t0: hourTop(5) + 16,
    at: heard(BEACH_COAST, 12, alongCoast(12, hourTop(5) + 16)),
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
