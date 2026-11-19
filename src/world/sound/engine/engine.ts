// The engine: the only code that touches Web Audio (design §6). It takes a BaseAudioContext, so the page and the
// offline render run the same code. Each frame it runs the scheduler; thirty times a second it runs the mix and sends
// the targets that moved. Every method takes the audio time to act at, so a whole timeline can be scheduled ahead and
// rendered in one go (the bench's unstepped mode, and how Firefox renders).

import { easeFor, easeOffset, lateness, LOOKAHEAD, lookaheadFor, SAMPLE_EVERY, sampleOffset, whenFor, type ClockReading } from "../clock.ts";
import { BED_OFF, BED_OFF_S, BED_ON, FADE_IN, K_SURF, K_WIND, LIMITER_DELAY_S, LIMITER_METER_SETTLE_S, TAU } from "../levels.ts";
import { mix, moved, newMemory, newTargets, SEND, T } from "../mix.ts";
import { bellCues, HAMMER, LONGEST_RING } from "../schedule/bells.ts";
import { pipCues, tailCues } from "../schedule/probe.ts";
import { leadOf, ROCK, SHINGLE } from "../schedule/waves.ts";
import { torusDelta } from "../../core/torus.ts";
import { airCutoff, dbToGain, distanceGain, offsetTo, panOf, SMALL, southCutoff, southGain, southOf } from "../space.ts";
import { RING_S, TENOR } from "../synth/bells.ts";
import { IR_TAPS } from "../synth/ir.ts";
import { TAIL_S } from "../synth/probe.ts";
import { emptyHearing, HEARING_FLOATS, pooledHearing, unpackHearing, type Census, type Cue, type Hearing, type Pose, type Prefs, type Pt } from "../types.ts";
import { bind, buildMaster, gain, type Binding, type Bus, type Ctx, type Master } from "./graph.ts";
import { createEar, gatherRows, latticeOf, PASS, type Seen } from "../ear.ts";
import { createKit, spawnWorker, type Kit } from "./kit.ts";
import { createScheduler, STALL, type CueSource, type Due, type Scheduler } from "./scheduler.ts";
import { createLanes, type Lanes, type LapStart, type WaveStart } from "./lanes.ts";
import { buildOpenSea, buildSurfBed } from "./sea.ts";
import { createOneShots, createPool, type OneShots, type Pool } from "./slots.ts";
import { buildSurf, type Surf } from "./waves.ts";
import { buildBells, buildReverb, type Bells } from "./bells.ts";
import { buildFalls, type Falls } from "./falls.ts";
import { buildHub, type Hub } from "./hub.ts";
import { buildRiverBed } from "./river.ts";
import { buildWhistles, buildWhoosh, buildWind, type Voice } from "./wind.ts";

export interface EngineOptions {
  touch: boolean;
  /** The world's seed: where each noise loop is read from. */
  seed: number;
  /** Rendering offline: build everything at once, world time maps to audio time exactly. */
  offline?: boolean;
  /** Plays the bench's stand-in pips and tails (the toggle, hide-show and stall scenes). */
  probe?: boolean;
  /** Mutes waves and every one-shot, to judge the continuous layers alone (the `-beds` renders). */
  beds?: boolean;
  /** The world's size in cells (positions wrap every n). */
  n?: number;
  /** No waves, laps or beds (a measuring arm). */
  noSurf?: boolean;
  /** Only the waves' hiss path sounds (no wind, no beds, no other part of a wave): the repetition check's render. */
  hissOnly?: boolean;
  /** A calibration tone into the master chain: dBFS peak and Hz. */
  tone?: { db: number; hz: number };
  /** The world's abbeys: the nearest one rings. None, and there are no bells. */
  abbeys?: readonly Pt[];
  /** In place of the abbey's hours: one stroke of the tenor under its hammer at this world time (the bench's `bell-stroke`). */
  oneStroke?: number;
  /** In place of any bell: one sample of 1 into the reverb's send bus at this world time, so a render is the reverb's own response (the bench's `reverb-impulse`). */
  impulse?: number;
}

/** When a frame is: given by the bench; read from the context by the page. */
export interface Timing {
  /** Audio time of this frame. */
  now: number;
  /** Audio time minus world time. */
  o: number;
}

export interface EngineStats {
  /** The most the limiter pulled down, dB (0 = it never worked); null when it could not be read. */
  limiterMinDb: number | null;
  /** Audio times at which every one-shot started is heard at the output (its start, past its pad and the limiter's delay). */
  onsets: number[];
  oneShots: number;
  dropped: number;
  nodes: number;
  /** Parameter sends made by the mix. */
  sends: number;
  /** Waves started in each lane, and the world times every wave started at (with its lane and train). */
  wavesByLane: number[];
  waves: { t: number; when: number; lane: number; train: number; kind: number; strength: number; lasts: number }[];
  /** Every bell stroke started: its hour, bell (5 the hour's hammer) and number, its world time, the audio time it was started at, and how far into its ring (0: from its top, with its strike). */
  strokes: { H: number; bell: number; k: number; t: number; when: number; offset: number }[];
  /** Falls: how many were given a chain outright, how many took the spare from a weaker one, and each of those moments (audio time, the fall's place). */
  fallsBound: number;
  fallHandovers: number;
  fallLog: { when: number; x: number; y: number; handover: boolean }[];
}

export interface Engine {
  /** One frame. Nothing is sent while muted or hidden. */
  frame(pose: Pose, hearing: Hearing, prefs: Prefs, timing?: Timing): void;
  /** Sound is wanted: the first enable fades in slowly once the wind is built; a later one (unmute, tab shown) quickly. */
  enable(first: boolean): void;
  /** The mute fade; every one-shot is stopped 250 ms on and the ledgers are cleared. The caller suspends the device. */
  mute(at?: number): void;
  /** Tab hidden: hold, a 200 ms ramp to 0 on the audio clock, everything stopped. The caller suspends the device. */
  hide(at?: number): void;
  /** The device was interrupted (its clock is frozen, nothing is heard): silence at once, everything stopped. */
  cut(): void;
  /** The bench's mute boxes. */
  setBus(bus: Bus, on: boolean): void;
  /** The sectors that hold a lane, as bits: for the ear. */
  laneMask(): number;
  /** What the last frame did, as bits (WORK): for the probe, to say where a long frame went. */
  work(): number;
  /** True when no graph is waiting to be built. */
  built(): boolean;
  /** True once sound has been enabled and not muted or hidden since. */
  readonly live: boolean;
  stats(): EngineStats;
  dispose(): void;
}

/**
 * The master's mute gain, as scheduled: an exponential approach, or straight lines through points (time, value). Kept
 * so a fade can be taken over from the value it has reached, at any time, the same way in every browser.
 */
type Fade = { kind: "still"; v: number } | { kind: "target"; v0: number; t0: number; to: number; tau: number } | { kind: "line"; pts: number[] };

function fadeAt(f: Fade, t: number): number {
  if (f.kind === "still") return f.v;
  if (f.kind === "target") return t <= f.t0 ? f.v0 : f.to + (f.v0 - f.to) * Math.exp(-(t - f.t0) / f.tau);
  const p = f.pts;
  if (t <= p[0]) return p[1];
  for (let i = 2; i < p.length; i += 2) {
    if (t <= p[i]) return p[i - 1] + ((p[i + 1] - p[i - 1]) * (t - p[i - 2])) / (p[i] - p[i - 2]);
  }
  return p[p.length - 1];
}

/** Segments in a fade-in: straight lines in amplitude that follow a straight line in decibels. */
const FADE_STEPS = 12;
/** Seconds from silence to the foot of a fade-in's line. */
const FADE_FOOT = 0.02;

const MIX_EVERY = 1 / 30;

/** What a frame did, as bits. */
export const WORK = { build: 1, kit: 2, mix: 4, wave: 8, lap: 16, enable: 32, clock: 64, lanes: 128 } as const;
/** Level of the bench's pips and tails, dB. */
const PIP_DB = -18, TAIL_DB = -22;
/** The pad of digital silence at the head of every one-shot buffer, seconds. */
const PAD = 0.02;

export function createEngine(ctx: Ctx, kit: Kit, opts: EngineOptions): Engine {
  const offline = opts.offline === true;
  const master: Master = buildMaster(ctx);
  const busOn: Record<Bus, boolean> = { wind: true, water: true, life: true, moments: true, bells: true };
  const bindings: Binding[] = [
    bind(T.MASTER, [master.volume.gain]),
    bind(T.WORLD, [master.world.gain]),
    bind(T.DUCK, [master.bus.wind.gain, master.bus.water.gain], (v, k) => (busOn[k === 0 ? "wind" : "water"] ? v : 0)),
  ];
  const shots: OneShots = createOneShots(ctx, opts.touch ? 20 : 40);
  const sources: CueSource[] = [];
  if (opts.probe && !opts.beds) {
    sources.push({ kind: "pip", cues: (a, b, out) => pipCues(opts.seed, a, b, out), lookBack: 0 }, { kind: "tail", cues: tailCues, lookBack: TAIL_S });
  }
  const scheduler: Scheduler = createScheduler(sources);
  const due: Due[] = [];
  const onsets: number[] = [];
  const memory = newMemory();
  const targets = newTargets();
  let nodes = master.nodes.length;
  let sends = 0;

  let wind: Voice | null = null;
  let windBuilt = false;
  const n = opts.n ?? 10240;
  const touch = opts.touch;
  const lanes: Lanes = createLanes({ lanes: touch ? 2 : 4, emitters: touch ? 4 : 8, seed: opts.seed });
  let surf: Surf | null = null;
  let surfBuilt = false;
  let pool: Pool | null = null;
  const waveStarts: WaveStart[] = [];
  const lapStarts: LapStart[] = [];
  const waveLog: EngineStats["waves"] = [];
  const abbeys = opts.abbeys ?? [];
  /** What the mix is told is there: the nearest abbey. */
  const census: Census = { n, sources: abbeys.length ? [{ kind: "abbey", key: 0, x: abbeys[0].x, y: abbeys[0].y, h: 0 }] : [] };
  let falls: Falls | null = null;
  const fallLog: EngineStats["fallLog"] = [];
  /** World time of the falls' last update, and the audio time of the one running. */
  let lastFalls = NaN, fallNow = 0;
  const noteFall = (x: number, y: number, handover: boolean) => {
    if (fallLog.length < 500) fallLog.push({ when: fallNow, x, y, handover });
  };
  let bells: Bells | null = null;
  let bellsBuilt = false;
  const strokeLog: EngineStats["strokes"] = [];
  let impulsed = false;
  const bellSource: CueSource = opts.impulse !== undefined
    ? { kind: "bell", lookBack: 0, cues() {} }
    : opts.oneStroke === undefined
    ? { kind: "bell", cues: (a, b, out) => bellCues(opts.seed, a, b, out), lookBack: LONGEST_RING }
    : {
      kind: "bell", lookBack: LONGEST_RING,
      cues(a, b, out) {
        const t = opts.oneStroke as number;
        if (t >= a && t < b) out.push({ t, kind: "bell", key: "one", lasts: RING_S[TENOR], soft: true, H: 0, bell: HAMMER, k: 0, take: 0, ringDb: 0, strikeDb: 5 });
      },
    };
  /** Voices built when they can be heard and let go when they cannot: the surf bed and the open sea. */
  type Make = (ctx: Ctx, kit: Kit, out: AudioNode, o: { hub: Hub; seed: number; at: number }) => Voice;
  const demand = (name: string, gains: number[], make: Make, out: AudioNode, on: number, off: number, surfKit: boolean, riverKit = false) => ({
    name, gains, make, out, on, off, surfKit, riverKit, voice: null as Voice | null, built: false, quietSince: NaN,
  });
  const beds = [
    demand("bed", [T.BED_HISS, T.BED_BODY, T.BED_RUMBLE, T.BED_RATTLE], buildSurfBed, master.bus.water, BED_ON, BED_OFF, true),
    demand("open", [T.OPEN], buildOpenSea, master.bus.water, BED_ON, BED_OFF, true),
    demand("river", [T.RIVER_FLOW, T.RIVER_BROOK, T.RIVER_RIFFLE], buildRiverBed, master.bus.water, BED_ON, BED_OFF, true, true),
    // The whistles: only when the dragon is going fast enough for them to be heard (they are 26 dB under the rush at
    // cruise). On above 30 % of their fullest (s > 1.1), off after two seconds under 25 %.
    // The whoosh: only round a turn.
    demand("whoosh", [T.W_GAIN], buildWhoosh, master.windIn, BED_ON, BED_OFF, false),
    ...(touch ? [] : [demand("whistles", [T.D_GAIN], buildWhistles, master.windIn, 0.3 * K_WIND.d, 0.25 * K_WIND.d, false)]),
  ];
  let hub: Hub | null = null;
  let toneNodes: AudioScheduledSourceNode[] = [];

  /** What `enable` asked for, done by the next frame that can (it needs that frame's targets). */
  let pending: "first" | "again" | null = null;
  let live = false;
  let fade: Fade = { kind: "still", v: 0 };
  /** True while the mute gain is on its way to 0 (a mute or a hide). */
  let falling = false;
  let o = NaN;
  /** World time of the last clock sample, the lookahead it gave, and the reading it is made into (reused). */
  let lastClock = NaN;
  let lookahead = LOOKAHEAD;
  const reading: ClockReading = { currentTime: 0, outputLatency: 0, stamp: null, now: 0 };
  let lastMix = NaN;
  let lastWaves = NaN;
  /** Which of the two took the last turn: 0 the mix, 1 the waves. */
  let lastTurn = 1;
  let lastT = NaN;
  let limiterMin: number | null = null;
  let limiterNext = 0;
  let disposed = false;
  let work = 0;
  let turn = 0;

  const timeOf = (at?: number) => at ?? ctx.currentTime;

  /**
   * Takes the mute gain over at `now` from wherever its fade has brought it: cancel, then set the value the fade has
   * reached (worked out here; the same in every browser, and at any future time). cancelAndHoldAtTime is not used:
   * Firefox lacks it, and in Chrome a ramp that follows it starts from a stale value once the earlier fade has settled.
   */
  const hold = (now: number): number => {
    const p = master.mute.gain;
    const v = fadeAt(fade, now);
    p.cancelScheduledValues(now);
    p.setValueAtTime(v, now);
    fade = { kind: "still", v };
    return v;
  };

  /** Fades the mute gain in from `v` (its held value at `now`): a straight line in decibels up to 1. */
  const fadeIn = (now: number, v: number, shape: { seconds: number; fromDb: number }) => {
    const p = master.mute.gain;
    const from = Math.max(v, dbToGain(shape.fromDb));
    // Starting part of the way up (a quick return), the line is that much shorter.
    const seconds = shape.seconds * Math.min(1, Math.log(from) / Math.log(dbToGain(shape.fromDb)));
    const pts = [now, v];
    // Up to the foot of the line in 20 ms (it is under −50 LUFS there), then along it.
    let t0 = now;
    if (from > v) {
      t0 = now + FADE_FOOT;
      p.linearRampToValueAtTime(from, t0);
      pts.push(t0, from);
    }
    for (let i = 1; i <= FADE_STEPS; i++) {
      const u = i / FADE_STEPS;
      const value = i === FADE_STEPS ? 1 : Math.pow(from, 1 - u);
      const at = t0 + Math.max(seconds, 0.02) * u;
      p.linearRampToValueAtTime(value, at);
      pts.push(at, value);
    }
    fade = { kind: "line", pts };
  };

  const startTone = (now: number) => {
    if (!opts.tone || toneNodes.length) return;
    const osc = ctx.createOscillator();
    osc.frequency.value = opts.tone.hz;
    const g = gain(ctx, dbToGain(opts.tone.db));
    osc.connect(g);
    g.connect(master.sum);
    osc.start(now);
    toneNodes = [osc];
    nodes += 2;
  };

  /** One build step of a voice (all of them offline). True when the voice is whole. */
  const stepVoice = (v: { steps: (() => void)[] }): boolean => {
    work |= WORK.build;
    do {
      const step = v.steps.shift();
      if (step) step();
    } while (offline && v.steps.length);
    return v.steps.length === 0;
  };

  /** At most one build step a frame on the page, so no frame pays for a whole graph. */
  const build = (now: number) => {
    if (opts.tone) return;
    const base = kit.ready("noise") && kit.ready("controls");
    if (base && !hub) {
      hub = buildHub(ctx, kit, opts.seed, now);
      nodes += 6;
      work |= WORK.build;
      if (!offline) return;
    }
    if (!opts.hissOnly) {
      if (!wind && base && hub) wind = buildWind(ctx, kit, master.windIn, { hub, seed: opts.seed, at: now });
      if (wind && !windBuilt) {
        if (stepVoice(wind)) {
          windBuilt = true;
          bindings.push(...wind.bindings);
          nodes += wind.nodes.length;
        }
        if (!offline) return;
      }
    } else windBuilt = true;
    if (!base || !hub) return;
    const surfReady = kit.ready("surf") && !opts.noSurf;
    if (surfReady && !surf && !opts.beds) surf = buildSurf(ctx, kit, master.bus.water, { hub, emitters: touch ? 4 : 8, seed: opts.seed, n, at: now, hissOnly: opts.hissOnly });
    if (surf && !surfBuilt) {
      if (stepVoice(surf)) {
        surfBuilt = true;
        nodes += surf.nodes;
        pool = createPool(ctx, touch ? 6 : 12, master.bus.water);
      }
      if (!offline) return;
    }
    // The falls: nothing is built until one is heard (each chain is made when its first fall is bound).
    if (!falls && !opts.noSurf && kit.ready("surf") && kit.ready("river")) falls = buildFalls(ctx, kit, master.bus.water, { hub, touch, n, seed: opts.seed, onBind: noteFall });
    if (abbeys.length && !opts.beds && !bells && kit.ready("bells")) {
      bells = buildBells(ctx, kit, master, { hub, touch });
      // The reverb with them: its response is the first thing the bells need.
      bells.steps.unshift(() => {
        nodes += buildReverb(ctx, kit, master).length;
      });
    }
    if (bells && !bellsBuilt) {
      if (stepVoice(bells)) {
        bellsBuilt = true;
        bindings.push(...bells.bindings);
        nodes += bells.nodes;
        // From here the strokes are scheduled: rings already sounding are joined in progress.
        sources.push(bellSource);
      }
      if (!offline) return;
    }
    for (const b of beds) {
      if (!b.voice || b.built) continue;
      if (stepVoice(b.voice)) {
        b.built = true;
        bindings.push(...b.voice.bindings);
        nodes += b.voice.nodes.length;
      }
      if (!offline) return;
    }
  };

  /** Builds a bed when one of its gains can be heard, and lets it go after two seconds when none can. */
  const tendBeds = (t: number, now: number) => {
    if (opts.hissOnly || !hub || !kit.ready("noise") || !kit.ready("controls")) return;
    for (const b of beds) {
      if (b.surfKit && (opts.noSurf || !kit.ready("surf"))) continue;
      if (b.riverKit && !kit.ready("river")) continue;
      let loud = false, quiet = true;
      for (const i of b.gains) {
        if (targets[i] > b.on) loud = true;
        if (targets[i] >= b.off) quiet = false;
      }
      if (!b.voice) {
        if (loud) {
          b.voice = b.make(ctx, kit, b.out, { hub, seed: opts.seed, at: now });
          b.built = false;
          b.quietSince = NaN;
        }
        continue;
      }
      if (!b.built) continue;
      if (!quiet) {
        b.quietSince = NaN;
        continue;
      }
      if (b.quietSince !== b.quietSince) b.quietSince = t;
      else if (t - b.quietSince >= BED_OFF_S) {
        // Under −60 dB for two seconds: to nothing, then its sources stop.
        const mine = new Set(b.voice.bindings);
        for (const x of mine) if (SEND[x.i].unit === "gain") for (const p of x.params) p.setTargetAtTime(0, now, 0.05);
        for (const src of b.voice.sources) src.stop(now + 0.5);
        for (let i = bindings.length - 1; i >= 0; i--) if (mine.has(bindings[i])) bindings.splice(i, 1);
        nodes -= b.voice.nodes.length;
        b.voice = null;
        b.built = false;
      }
    }
  };

  const spot = { gain: 0, hz: 0, pan: 0 };
  /** A lap at world (x, y): a one-shot through a pooled chain set for where the dragon is now. */
  const playLap = (l: LapStart, pose: Pose, calm: boolean, now: number, lookahead: number) => {
    if (!pool || !kit.ready("surf")) return;
    const cue = l.cue;
    let when: number;
    if (offline) when = Math.max(now, cue.t + o);
    else {
      if (lateness(cue.t, o, now) > 0.03) return;
      when = whenFor(cue.t, o, now, lookahead);
    }
    const at = offsetTo(pose.x, pose.y, pose.alt, l.x, l.y, 0, n);
    const b = southOf(at.dx, at.dy);
    spot.gain = K_SURF.lap * distanceGain(SMALL, at.d) * southGain(b) * dbToGain(l.db);
    if (spot.gain < 1e-4) return;
    const buffer = kit.buffer(`lap${(cue.variant ?? 0) & 3}`);
    const rate = cue.rate ?? 1;
    const chain = pool.take(now, when + buffer.duration / rate + 0.05, spot.gain, airCutoff(at.d) * southCutoff(b), panOf(at.dx, at.dy, calm));
    if (!chain) return;
    if (shots.play(buffer, chain, { when, gain: 1, rate, low: true })) onsets.push(when + PAD / rate + LIMITER_DELAY_S);
  };

  const startWave = (w: WaveStart, pose: Pose, calm: boolean, now: number, lookahead: number) => {
    if (!surf) return;
    const cue = w.cue;
    // A wave is soft: found late, it starts at once. Joined in progress, it starts now, part of the way in.
    const when = w.offset > 0 ? now + 0.005 : offline ? Math.max(now, cue.t + o) : whenFor(cue.t, o, now, lookahead);
    surf.start(w, when, now, pose, calm);
    waveLog.push({ t: cue.t, when, lane: w.lane, train: cue.train ?? 0, kind: w.kind, strength: w.strength, lasts: (cue.lasts ?? 4) - w.offset });
    // The boom of a rock wave and the crash on shingle are meant to start sharply: their moment is an onset.
    if ((w.kind === ROCK || w.kind === SHINGLE) && w.offset < leadOf(w.kind)) onsets.push(when + leadOf(w.kind) - w.offset + LIMITER_DELAY_S);
  };

  /** Sends the targets that moved. `outright` sets every parameter to its target at once: only ever under a mute gain at 0. */
  const apply = (now: number, calm: boolean, outright: boolean) => {
    const silent = outright || fadeAt(fade, now) < 1e-3;
    // Slow targets (time constants of 150 ms or more) are looked at on alternate mixes, half of them each time, so a
    // mix sends about half as much; the quick ones (the whoosh, pans, the volume) every time.
    turn ^= 1;
    for (let k = 0; k < bindings.length; k++) {
      const b = bindings[k];
      if (!outright && !offline && (k & 1) === turn && SEND[b.i].down >= 0.15 && SEND[b.i].up >= 0.15 && b.sent === b.sent) continue;
      const v = targets[b.i];
      if (outright) {
        for (let k = 0; k < b.params.length; k++) {
          b.params[k].cancelScheduledValues(now);
          b.params[k].setValueAtTime(b.map(v, k), now);
        }
        b.sent = v;
        sends += b.params.length;
        continue;
      }
      if (!moved(b.i, b.sent, v)) continue;
      const rule = SEND[b.i];
      const first = b.sent !== b.sent;
      if (first && (silent || rule.unit !== "gain")) {
        // A voice's first values: its level gains are still at 0 (or the master is), so nothing is heard to jump.
        for (let k = 0; k < b.params.length; k++) b.params[k].setValueAtTime(b.map(v, k), now);
      } else {
        const tau = first && !b.prompt ? TAU.late : (first || v > b.sent ? rule.up : rule.down) * (rule.unit === "pan" && calm ? 2 : 1);
        for (let k = 0; k < b.params.length; k++) b.params[k].setTargetAtTime(b.map(v, k), now, tau);
      }
      b.sent = v;
      sends += b.params.length;
    }
  };

  /** The abbey the mix hears: the nearest. */
  const nearestAbbey = (pose: Pose) => {
    if (abbeys.length < 2) return;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < abbeys.length; i++) {
      const dx = torusDelta(pose.x, abbeys[i].x, n), dy = torusDelta(pose.y, abbeys[i].y, n);
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    census.sources[0].x = abbeys[best].x;
    census.sources[0].y = abbeys[best].y;
  };

  const strike = (cue: Cue, when: number, offset: number, calm: boolean) => {
    // Out of earshot (beyond 1500 cells the abbey's gain is nothing), a stroke is not started at all.
    if (!bells || !(targets[T.BELL_GAIN] > 1e-4)) return;
    const started = bells.stroke(cue, when, offset, calm);
    if (started === 0) return;
    strokeLog.push({ H: cue.H ?? 0, bell: cue.bell ?? 0, k: cue.k ?? 0, t: cue.t, when, offset });
    if (started === 2) onsets.push(when + PAD + LIMITER_DELAY_S);
  };

  const play = (d: Due, worldNow: number, now: number, lookahead: number, calm: boolean) => {
    const cue = d.cue;
    let when: number, offset = 0;
    if (d.rejoin) {
      when = now + 0.005;
      offset = Math.max(0, worldNow - cue.t);
    } else if (offline) {
      when = Math.max(now, cue.t + o);
    } else {
      // A sharp cue that would start more than 30 ms late is dropped; a soft one starts at once.
      if (!cue.soft && lateness(cue.t, o, now) > 0.03) return;
      when = whenFor(cue.t, o, now, lookahead);
    }
    if (cue.kind === "pip" && kit.ready("probe")) {
      if (shots.play(kit.buffer("pip"), master.bus.moments, { when, gain: dbToGain(PIP_DB + (cue.db ?? 0)), rate: cue.rate, low: true })) onsets.push(when + PAD / (cue.rate ?? 1) + LIMITER_DELAY_S);
    } else if (cue.kind === "tail" && kit.ready("probe")) {
      const ok = shots.play(kit.buffer("tail"), master.bus.moments, { when, offset, gain: dbToGain(TAIL_DB), fadeIn: d.rejoin });
      if (ok && !d.rejoin) onsets.push(when + PAD + LIMITER_DELAY_S);
    } else if (cue.kind === "bell") {
      strike(cue, when, offset, calm);
    }
  };

  const readLimiter = (now: number) => {
    // By the context's own clock: a timeline scheduled ahead of its render has nothing to read yet.
    if (now < limiterNext || ctx.currentTime < LIMITER_METER_SETTLE_S) return;
    limiterNext = now + 0.1;
    const r = master.limiter.reduction;
    if (typeof r === "number" && r === r) limiterMin = limiterMin === null ? r : Math.min(limiterMin, r);
  };

  return {
    get live() {
      return live;
    },
    frame(pose, hearing, prefs, timing) {
      if (disposed) return;
      work = 0;
      let now: number, look = LOOKAHEAD;
      if (timing) {
        now = timing.now;
        o = timing.o;
      } else {
        now = ctx.currentTime;
        // The offset is sampled ten times a second (and at once after any gap), not every frame.
        const since = pose.t - lastClock;
        if (!(since < SAMPLE_EVERY) || since < 0) {
          const c = ctx as AudioContext;
          reading.currentTime = now;
          reading.outputLatency = c.outputLatency;
          reading.stamp = typeof c.getOutputTimestamp === "function" ? c.getOutputTimestamp() : null;
          reading.now = performance.now();
          o = since > 0 && since < STALL ? easeOffset(o, sampleOffset(reading), easeFor(since)) : sampleOffset(reading);
          lookahead = lookaheadFor(reading);
          lastClock = pose.t;
          work |= WORK.clock;
        }
        look = lookahead;
      }
      build(now);
      readLimiter(now);
      if (!live && pending === null) return;

      const dt = lastT === lastT ? pose.t - lastT : 0;
      lastT = pose.t;
      const ready = opts.tone ? true : windBuilt;

      // A fade-out still on its way down is left to finish (its stops come at its end): sound always returns from silence.
      if (pending !== null && ready && !(falling && fadeAt(fade, now) >= 1e-3)) {
        // Enabling: every parameter goes to its target under a master at 0, then the master fades in.
        const v = hold(now);
        falling = false;
        work |= WORK.enable;
        nearestAbbey(pose);
        mix(pose, hearing, census, prefs, memory, targets);
        lastMix = pose.t;
        const quiet = v < 1e-3;
        if (quiet) apply(now, prefs.calm, true);
        fadeIn(now, quiet ? 0 : v, pending === "first" ? FADE_IN.first : FADE_IN.again);
        startTone(now);
        pending = null;
        live = true;
      }
      if (!live) return;

      if (opts.impulse !== undefined && bellsBuilt && !impulsed && o === o) {
        impulsed = true;
        const click = ctx.createBuffer(1, 8, ctx.sampleRate);
        click.getChannelData(0)[0] = 1;
        const src = ctx.createBufferSource();
        src.buffer = click;
        src.connect(master.send);
        const at = Math.max(now, opts.impulse + o);
        src.start(at);
        // The response's early taps are single reflections, sharp by design: each is an onset.
        for (const tap of IR_TAPS) onsets.push(at + tap[0] + LIMITER_DELAY_S);
      }

      // The scheduler, every frame.
      if (sources.length) {
        due.length = 0;
        scheduler.pass(pose.t, dt, look, due);
        for (const d of due) play(d, pose.t, now, look, prefs.calm);
        shots.prune(now);
        bells?.prune(now);
      }

      // Thirty times a second each, on alternate turns so no frame carries both: the mix and its sends; and the
      // waves (lanes choose them, each takes an emitter where it breaks) with the emitters' own sends. Cues are
      // found a quarter of a second ahead, so a thirtieth of a second between looks loses nothing.
      const mixDue = !(pose.t - lastMix < MIX_EVERY - 1e-4) || dt < 0;
      const wavesDue = surfBuilt && surf !== null && !opts.beds && (!(pose.t - lastWaves < MIX_EVERY - 1e-4) || dt < 0 || dt > STALL);
      if (mixDue && (offline || !wavesDue || lastTurn !== 0)) {
        lastTurn = 0;
        work |= WORK.mix;
        nearestAbbey(pose);
        mix(pose, hearing, census, prefs, memory, targets);
        lastMix = pose.t;
        tendBeds(pose.t, now);
        apply(now, prefs.calm, false);
        if (falls) {
          const since = lastFalls === lastFalls ? pose.t - lastFalls : 0;
          lastFalls = pose.t;
          fallNow = now;
          sends += falls.update(pose, hearing.falls, since > 0 && since <= STALL ? since : 0, now, prefs.calm);
        }
        if (!wavesDue || !offline) return;
      }
      if (wavesDue && surf) {
        lastTurn = 1;
        work |= WORK.lanes;
        const since = lastWaves === lastWaves ? pose.t - lastWaves : 0;
        lastWaves = pose.t;
        waveStarts.length = 0;
        lapStarts.length = 0;
        lanes.step(hearing, pose.t, since, look, waveStarts, lapStarts);
        if (waveStarts.length) work |= WORK.wave;
        if (lapStarts.length) work |= WORK.lap;
        for (let i = 0; i < waveStarts.length; i++) startWave(waveStarts[i], pose, prefs.calm, now, look);
        if (!opts.hissOnly) for (let i = 0; i < lapStarts.length; i++) playLap(lapStarts[i], pose, prefs.calm, now, look);
        sends += surf.update(pose, lanes.emitters, now, prefs.calm);
        surf.prune(now);
        shots.prune(now);
      }
    },
    enable(first) {
      if (live) return;
      pending = first ? "first" : "again";
    },
    mute(at) {
      const now = timeOf(at);
      pending = null;
      if (!live) return;
      live = false;
      const v = hold(now);
      master.mute.gain.setTargetAtTime(0, now, TAU.mute);
      fade = { kind: "target", v0: v, t0: now, to: 0, tau: TAU.mute };
      falling = true;
      shots.stopAll(now + 0.25);
      surf?.stopAll(now + 0.25);
      bells?.stopAll(now + 0.25);
      falls?.stopAll(now + 0.25);
      lastFalls = NaN;
      lanes.clear();
      scheduler.clear();
      lastT = NaN;
      lastWaves = NaN;
      lastClock = NaN;
    },
    hide(at) {
      const now = timeOf(at);
      pending = null;
      if (!live) return;
      live = false;
      const v = hold(now);
      master.mute.gain.linearRampToValueAtTime(0, now + TAU.hideRamp);
      fade = { kind: "line", pts: [now, v, now + TAU.hideRamp, 0] };
      falling = true;
      shots.stopAll(now + TAU.hideRamp + 0.01);
      surf?.stopAll(now + TAU.hideRamp + 0.01);
      bells?.stopAll(now + TAU.hideRamp + 0.01);
      falls?.stopAll(now + TAU.hideRamp + 0.01);
      lastFalls = NaN;
      lanes.clear();
      scheduler.clear();
      lastT = NaN;
      lastWaves = NaN;
      lastClock = NaN;
    },
    cut() {
      const now = ctx.currentTime;
      pending = null;
      live = false;
      master.mute.gain.cancelScheduledValues(now);
      master.mute.gain.setValueAtTime(0, now);
      fade = { kind: "still", v: 0 };
      falling = false;
      shots.stopAll(now);
      surf?.stopAll(now);
      bells?.stopAll(now);
      falls?.stopAll(now);
      lastFalls = NaN;
      lanes.clear();
      scheduler.clear();
      lastT = NaN;
      lastWaves = NaN;
      lastClock = NaN;
    },
    laneMask: () => lanes.mask(),
    work: () => work,
    built: () => windBuilt && (opts.noSurf === true || opts.beds === true || surfBuilt) && (abbeys.length === 0 || opts.beds === true || bellsBuilt) && beds.every((b) => !b.voice || b.built),
    setBus(bus, on) {
      busOn[bus] = on;
      const now = ctx.currentTime;
      if (bus !== "wind" && bus !== "water") master.bus[bus].gain.setTargetAtTime(on ? 1 : 0, now, 0.03);
      else for (const b of bindings) if (b.i === T.DUCK) for (let k = 0; k < b.params.length; k++) b.params[k].setTargetAtTime(b.map(targets[T.DUCK] || 1, k), now, 0.03);
    },
    stats() {
      return { limiterMinDb: limiterMin, onsets: [...onsets], oneShots: shots.started, dropped: shots.dropped, nodes, sends, wavesByLane: [...lanes.started], waves: [...waveLog], strokes: [...strokeLog], fallsBound: falls?.tracker.bound ?? 0, fallHandovers: falls?.tracker.handovers ?? 0, fallLog: [...fallLog] };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      live = false;
      const now = ctx.currentTime;
      for (const s of [...(wind?.sources ?? []), ...toneNodes]) {
        try {
          s.stop(now);
        } catch {
          // never started
        }
      }
      shots.stopAll(now);
      bells?.stopAll(now);
      falls?.stopAll(now);
      surf?.end(now);
      for (const src of hub?.sources ?? []) src.stop(now);
      for (const b of beds) for (const src of b.voice?.sources ?? []) {
        try {
          src.stop(now);
        } catch {
          // never started
        }
      }
      try {
        master.mute.disconnect();
      } catch {
        // already disconnected
      }
    },
  };
}

// ── What the control loads lazily ────────────────────────────────────────────────────────────────────────────────────

/** Everything behind the control's lazy import: the kit, the ear and an engine on the page's context. */
export interface Runtime {
  /** One frame: the ear, the engine, then at most one slice of kit work. */
  frame(pose: Pose, prefs: Prefs, seen: Seen): void;
  /** Main-thread ms the kit took in the last frame. */
  kitMs(): number;
  /** What the last frame did, as bits (WORK). */
  work(): number;
  /** True once every buffer is made and every graph built. */
  settled(): boolean;
  /** The Hearing in force. */
  hearing(): Hearing;
  enable(first: boolean): void;
  mute(): void;
  hide(): void;
  cut(): void;
  readonly live: boolean;
  stats(): EngineStats;
  /** Stops and disconnects the engine. The kit is kept: a rebuild is graph construction only. */
  dispose(): void;
}

/** Kit work in one frame: at most this many slices, and none started after this many ms. */
const KIT_SLICES = 2;
const KIT_MS = 0.05;

/** The kit outlives engines (its buffers are not tied to a context), as long as the sample rate is the same. */
let kept: Kit | null = null;

export function createRuntime(ctx: AudioContext, opts: { touch: boolean; seed: number; n: number; land: { gN: number; ground: ArrayLike<number> } | null; abbeys?: readonly Pt[]; arm?: string }): Runtime {
  if (!kept || kept.sampleRate !== ctx.sampleRate) {
    kept?.dispose();
    kept = createKit({ sampleRate: ctx.sampleRate, seed: opts.seed, spawn: spawnWorker });
  }
  const kit = kept;
  const engine = createEngine(ctx, kit, { touch: opts.touch, seed: opts.seed, n: opts.n, abbeys: opts.abbeys, noSurf: opts.arm === "nosurf" });
  const listener = opts.arm === "earoff" ? deafEar() : opts.arm === "earlocal" ? localEar(opts.n, opts.land) : (remoteEar(opts.n, opts.land) ?? localEar(opts.n, opts.land));
  let warped = false;
  let kitMs = 0;
  return {
    frame(pose, prefs, seen) {
      if (!warped && kit.ready("surf")) {
        // The picture's own bend of the wave fronts, made by the worker: from here on shore points can be timed.
        listener.setWarp(kit.bytes("warp"));
        warped = true;
      }
      const hearing = listener.step(pose, seen, engine.laneMask());
      engine.frame(pose, hearing, prefs);
      if (kit.done()) {
        kitMs = 0;
      } else {
        // A few slices of kit work, stopped as soon as they have taken a tenth of a millisecond.
        const a = performance.now();
        let b = a;
        // None in a frame that built part of a graph; and making a buffer (megabytes) ends the frame's share.
        if ((engine.work() & WORK.build) === 0) {
          for (let i = 0; i < KIT_SLICES && b - a < KIT_MS && kit.step() && !kit.heavy(); i++) b = performance.now();
          b = performance.now();
        }
        kitMs = b - a;
      }
    },
    kitMs: () => kitMs,
    work: () => engine.work() | (kitMs > 0 || !kit.done() ? WORK.kit : 0),
    settled: () => kit.done() && engine.built(),
    hearing: () => listener.hearing(),
    enable: (first) => engine.enable(first),
    mute: () => engine.mute(),
    hide: () => engine.hide(),
    cut: () => engine.cut(),
    get live() {
      return engine.live;
    },
    stats: () => engine.stats(),
    dispose() {
      engine.dispose();
      listener.dispose();
    },
  };
}

/** What listens for the runtime: the ear in its worker, or (where no worker can be made) the ear in the frame loop. */
interface Listener {
  setWarp(warp: Uint8Array): void;
  step(pose: Pose, seen: Seen, lanes: number): Hearing;
  hearing(): Hearing;
  dispose(): void;
}

type Land = { gN: number; ground: ArrayLike<number> } | null;

/** No ear at all (a measuring arm): open, silent land. */
function deafEar(): Listener {
  const hearing = emptyHearing();
  return { setWarp() {}, step: () => hearing, hearing: () => hearing, dispose() {} };
}

function localEar(n: number, land: Land): Listener {
  const ear = createEar();
  ear.setWorld({ n, land });
  return { setWarp: (w) => ear.setWarp(w), step: (pose, seen, lanes) => ear.step(pose, seen, lanes), hearing: () => ear.hearing(), dispose() {} };
}

/**
 * The ear in its worker. Each frame the page gathers the share of the frame's lattice that the time since the last
 * frame calls for (about four thousand pixel reads at 60 Hz) into a buffer; ten times a second the buffer is handed
 * over, and the Hearing comes back a moment later. Two buffers take turns.
 */
function remoteEar(n: number, land: Land): Listener | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("../ear.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  // The Hearing is filled in place from numbers the worker hands back: nothing is cloned and nothing allocated.
  const held = pooledHearing();
  const hearing = held.hearing;
  const spare: Uint32Array[] = [];
  const heardSpare: Float64Array[] = [new Float64Array(HEARING_FLOATS), new Float64Array(HEARING_FLOATS)];
  /** The message and its transfer list, reused for every pass. */
  const message = { kind: "pass" as const, bake: null as Uint32Array | null, heard: null as Float64Array | null, rect: { x: 0, y: 0, w: 0, h: 0 }, x: 0, y: 0, alt: 0, t: 0, lanes: 0 };
  const transfer: ArrayBuffer[] = [];
  /** The pass being gathered: its buffer, the frame it began with, the dragon then, and how far it has got (0 … 1). */
  let into: Uint32Array | null = null;
  const home = { x: 0, y: 0, w: 0, h: 0 };
  const at = { x: 0, y: 0, alt: 0, t: 0, lanes: 0 };
  let progress = 0;
  let lastT = NaN;
  let made = 0;
  let dead = false;
  worker.onmessage = (e: MessageEvent) => {
    const reply = e.data as { heard: Float64Array; bake: Uint32Array };
    unpackHearing(reply.heard, held);
    heardSpare.push(reply.heard);
    spare.push(reply.bake);
  };
  worker.onerror = () => {
    dead = true;
  };
  // The land, as a byte a node: which are sea.
  let sea: Uint8Array | null = null;
  if (land) {
    sea = new Uint8Array(land.gN * land.gN);
    for (let i = 0; i < sea.length; i++) sea[i] = land.ground[i] < 0 ? 1 : 0;
  }
  worker.postMessage({ kind: "world", n, gN: land?.gN ?? 0, sea }, sea ? [sea.buffer] : []);
  return {
    setWarp(warp) {
      // A copy: the kit keeps its own.
      worker.postMessage({ kind: "warp", warp: warp.slice() });
    },
    step(pose, seen, lanes) {
      const dt = lastT === lastT ? pose.t - lastT : 0;
      lastT = pose.t;
      const bake = seen.bake, rect = seen.rect;
      if (dead || !bake || !rect || !(dt > 0)) return hearing;
      if (!into) {
        // A new pass, when a buffer is free: it begins with this frame's rect and this frame's dragon.
        const lat = latticeOf(rect);
        const size = lat.cols * lat.rows;
        if (heardSpare.length === 0) return hearing;
        let buffer = spare.pop();
        if (buffer && buffer.length !== size) buffer = undefined;
        if (!buffer && made < 2) {
          buffer = new Uint32Array(size);
          made++;
        }
        if (!buffer) return hearing;
        into = buffer;
        home.x = Math.floor(rect.x);
        home.y = Math.floor(rect.y);
        home.w = rect.w;
        home.h = rect.h;
        at.x = pose.x;
        at.y = pose.y;
        at.alt = pose.alt;
        at.t = pose.t;
        at.lanes = lanes;
        progress = 0;
      }
      const rows = latticeOf(home).rows;
      const to = Math.min(1, progress + dt / PASS);
      gatherRows(into, home, bake, rect, Math.floor(progress * rows), Math.floor(to * rows));
      progress = to;
      if (to >= 1) {
        const heard = heardSpare.pop() as Float64Array;
        message.bake = into;
        message.heard = heard;
        message.rect.x = home.x;
        message.rect.y = home.y;
        message.rect.w = home.w;
        message.rect.h = home.h;
        message.x = at.x;
        message.y = at.y;
        message.alt = at.alt;
        message.t = at.t;
        message.lanes = at.lanes;
        transfer[0] = into.buffer as ArrayBuffer;
        transfer[1] = heard.buffer as ArrayBuffer;
        worker.postMessage(message, transfer);
        into = null;
      }
      return hearing;
    },
    hearing: () => hearing,
    dispose() {
      worker.terminate();
    },
  };
}
