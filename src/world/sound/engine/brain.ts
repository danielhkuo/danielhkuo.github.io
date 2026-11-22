// Part of the engine's thinking, apart from its hands (design §14.6): which waves the lanes start and which cues the
// scheduler finds are worked out from where the dragon is and what the ear heard, with no Web Audio in sight. On the
// page the engine does this itself (and offline, always). Where the ear listens in a worker, a Brain does it there, at
// every pass of the ear (ten times a second, as each new Hearing is made), and its answer rides home with the Hearing:
// no message is added. The page is left to start what it is told to start. Both run the same functions.
//
// (The mix stays on the page: it wants the dragon's pose thirty times a second, and a message a mix costs the frame
// more than the mix does.)

import { torusDelta } from "../../core/torus.ts";
import { PASS } from "../ear.ts";
import { NIGHT_GULLS } from "../levels.ts";
import { bellCues, LONGEST_RING } from "../schedule/bells.ts";
import { clockCues, WHIRR_END } from "../schedule/chimes.ts";
import { gullCues, nightKeeps, type Colony } from "../schedule/gulls.ts";
import { ferryCues, flockCues, planeCues, trainCues } from "../schedule/moments.ts";
import type { Cue, Hearing } from "../types.ts";
import { createLanes, type EmitterState, type LapStart, type WaveStart } from "./lanes.ts";
import { createScheduler, type CueSource, type Due } from "./scheduler.ts";

/** A colony with the middle of where its birds wheel. */
export type ColonyAt = Colony & { x: number; y: number };

/** Colonies are asked for calls only within this many cells of the dragon. */
const GULL_REACH = 350;

/**
 * The calls of the colonies near (x, y) in [a, b), appended to `out`; at night only a seeded share of them (the same
 * ones each time). `near` is scratch. The engine's gull source and the Brain's are this one function.
 */
export function gullCuesNear(seed: number, n: number, colonies: readonly ColonyAt[], x: number, y: number, night: number, a: number, b: number, out: Cue[], near: Colony[]): void {
  near.length = 0;
  for (const c of colonies) {
    const dx = torusDelta(x, c.x, n), dy = torusDelta(y, c.y, n);
    if (dx * dx + dy * dy <= GULL_REACH * GULL_REACH) near.push(c);
  }
  if (!near.length) return;
  const from = out.length;
  gullCues(seed, near, a, b, out);
  // At night the colonies roost: only a seeded share of the day's calls is made (the same ones each time).
  const keep = 1 - (1 - NIGHT_GULLS) * night;
  if (keep < 1) {
    let w = from;
    for (let r = from; r < out.length; r++) {
      const c = out[r];
      if (nightKeeps(seed, c.colony ?? 0, c.k ?? 0, keep)) out[w++] = c;
    }
    out.length = w;
  }
}

/** The colonies: each site's wheelers, with the middle of where they wheel. */
export function coloniesOf(wheelers: readonly { site: number; town: boolean; x: number; y: number }[]): ColonyAt[] {
  const colonies: ColonyAt[] = [];
  for (const w of wheelers) {
    let c = colonies.find((k) => k.id === w.site);
    if (!c) colonies.push((c = { id: w.site, birds: 0, town: w.town, x: 0, y: 0 }));
    c.x += (w.x - c.x) / ++c.birds;
    c.y += (w.y - c.y) / c.birds;
  }
  return colonies;
}

/** The moments in reach of the dragon, as bits of an ask's `reach` (the page knows where each stands). */
export const REACH: Readonly<Record<string, number>> = { clock: 1, train: 2, plane: 4, ferry: 8, flock: 16 };

/**
 * A Brain steps once a pass of the ear, not thirty times a second: so it looks this much further ahead than the page
 * would (a pass's length), and what it finds is found as early as the page found it. The page lets a start be that
 * much further off, too.
 */
export const BRAIN_AHEAD = PASS;

export interface BrainInit {
  seed: number;
  n: number;
  touch: boolean;
  forced: boolean;
  colonies: ColonyAt[];
  /** The railway's two ends, when there is one. */
  railway: { shore: [number, number]; halt: [number, number] } | null;
}

/** What the page tells a Brain at each pass. */
export interface BrainAsk {
  /** World time now, and where the dragon is. */
  t: number;
  x: number;
  y: number;
  /** How dark it is, 0 … 1 (the gulls roost). */
  night: number;
  /** How far ahead the page finds its cues, seconds (the Brain adds BRAIN_AHEAD). */
  look: number;
  /** The moments in reach (REACH bits). */
  reach: number;
  /**
   * The page's surf is built, so the lanes may start waves. Until then they are not stepped: their first step finds
   * the waves already breaking, once, and it must not be spent on a page that cannot yet play them.
   */
  surf: boolean;
  /** Comes back with the answer: the page counts it up at every clear, and drops answers to asks from before. */
  epoch: number;
}

/** A Brain's answer: the lanes as they now stand (their mask, and each emitter's six numbers), and what to start. */
export interface BrainReply {
  epoch: number;
  mask: number;
  emitters: Float64Array;
  waves: WaveStart[] | null;
  laps: LapStart[] | null;
  due: Due[] | null;
}

const EMITTER_FLOATS = 6;

/** Reads a reply's emitters into the page's own. */
export function unpackEmitters(from: Float64Array, emitters: EmitterState[]): void {
  const count = from.length / EMITTER_FLOATS;
  for (let k = 0, at = 0; k < count; k++) {
    let e = emitters[k];
    if (!e) e = emitters[k] = { until: -Infinity, x: 0, y: 0, kind: 0, lane: -1, db: 0 };
    e.until = from[at++];
    e.x = from[at++];
    e.y = from[at++];
    e.kind = from[at++];
    e.lane = from[at++];
    e.db = from[at++];
  }
  emitters.length = count;
}

export interface Brain {
  /** One step, with the Hearing just made: the lanes' waves and laps and the scheduler's cues to start. */
  step(ask: BrainAsk, hearing: Hearing): BrainReply;
  /** A cue source of this kind now has its voice (bell, gull, clock, train, plane, ferry, flock): it is asked from here on. */
  source(kind: string): void;
  /** Everything started has been stopped (a mute, a hide): forget it, and rejoin. */
  clear(): void;
  /** The sectors that hold a lane, for the ear. */
  mask(): number;
}

/**
 * The Brain as the page sees it, when it thinks elsewhere. The page keeps `ask` up to date (the ear sends it with each
 * pass) and takes the answers as they come.
 */
export interface RemoteBrain {
  /** False once it has failed: the engine goes back to thinking for itself. */
  alive(): boolean;
  readonly ask: { look: number; reach: number; surf: boolean };
  /** The oldest answer not yet taken, or null. */
  take(): BrainReply | null;
  source(kind: string): void;
  /** Everything started has been stopped: answers still on their way are dropped. */
  clear(): void;
}

export function createBrain(init: BrainInit): Brain {
  const { seed, n, forced } = init;
  const lanes = createLanes({ lanes: init.touch ? 2 : 4, emitters: init.touch ? 4 : 8, seed });
  /** The ask being answered: the sources read where the dragon is, how dark it is and what is in reach from it. */
  let now: BrainAsk = { t: 0, x: 0, y: 0, night: 0, look: 0, reach: 0, surf: false, epoch: 0 };
  const near: Colony[] = [];
  const within = (bit: number, cues: (a: number, b: number, out: Cue[]) => void) => (a: number, b: number, out: Cue[]) => {
    if (now.reach & bit) cues(a, b, out);
  };
  const railway = init.railway;
  /** Every source there can be; one is asked only once the page says its voice exists. */
  const all: Record<string, CueSource> = {
    bell: { kind: "bell", cues: (a, b, out) => bellCues(seed, a, b, out), lookBack: LONGEST_RING },
    gull: { kind: "gull", lookBack: 0, cues: (a, b, out) => gullCuesNear(seed, n, init.colonies, now.x, now.y, now.night, a, b, out, near) },
    clock: { kind: "clock", lookBack: WHIRR_END, cues: within(REACH.clock, (a, b, out) => clockCues(seed, forced, a, b, out)) },
    plane: { kind: "plane", lookBack: 0, cues: within(REACH.plane, (a, b, out) => planeCues(seed, forced, a, b, out)) },
    ferry: { kind: "ferry", lookBack: 0, cues: within(REACH.ferry, (a, b, out) => ferryCues(seed, forced, a, b, out)) },
    flock: { kind: "flock", lookBack: 0, cues: within(REACH.flock, (a, b, out) => flockCues(seed, forced, a, b, out)) },
  };
  if (railway) all.train = { kind: "train", lookBack: 0, cues: within(REACH.train, (a, b, out) => trainCues(seed, railway.shore, railway.halt, n, forced, a, b, out)) };
  const sources: CueSource[] = [];
  const scheduler = createScheduler(sources);
  const waves: WaveStart[] = [];
  const laps: LapStart[] = [];
  const due: Due[] = [];
  let lastT = NaN, lastLanes = NaN;

  return {
    step(ask, hearing) {
      now = ask;
      const t = ask.t, look = ask.look + BRAIN_AHEAD;
      // Seconds since the last step: what the lanes and the scheduler call a frame.
      const since = lastT === lastT ? t - lastT : 0;
      lastT = t;
      waves.length = 0;
      laps.length = 0;
      if (ask.surf) {
        lanes.step(hearing, t, lastLanes === lastLanes ? t - lastLanes : 0, look, waves, laps);
        lastLanes = t;
      }
      due.length = 0;
      if (sources.length) scheduler.pass(t, since, look, due);
      const states = lanes.emitters;
      const emitters = new Float64Array(EMITTER_FLOATS * states.length);
      let at = 0;
      for (const e of states) {
        emitters[at++] = e.until;
        emitters[at++] = e.x;
        emitters[at++] = e.y;
        emitters[at++] = e.kind;
        emitters[at++] = e.lane;
        emitters[at++] = e.db;
      }
      return { epoch: ask.epoch, mask: lanes.mask(), emitters, waves: waves.length ? waves.slice() : null, laps: laps.length ? laps.slice() : null, due: due.length ? due.slice() : null };
    },
    source(kind) {
      const s = all[kind];
      if (s && !sources.includes(s)) sources.push(s);
    },
    clear() {
      lanes.clear();
      scheduler.clear();
      lastT = NaN;
      lastLanes = NaN;
    },
    mask: () => lanes.mask(),
  };
}
