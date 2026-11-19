// The engine: the only code that touches Web Audio (design §6). It takes a BaseAudioContext, so the page and the
// offline render run the same code. Each frame it runs the scheduler; thirty times a second it runs the mix and sends
// the targets that moved. Every method takes the audio time to act at, so a whole timeline can be scheduled ahead and
// rendered in one go (the bench's unstepped mode, and how Firefox renders).

import { easeFor, easeOffset, lateness, LOOKAHEAD, lookaheadFor, SAMPLE_EVERY, sampleOffset, whenFor, type ClockReading } from "../clock.ts";
import { FADE_IN, LIMITER_DELAY_S, LIMITER_METER_SETTLE_S, TAU } from "../levels.ts";
import { mix, moved, newMemory, newTargets, SEND, T } from "../mix.ts";
import { pipCues, tailCues } from "../schedule/probe.ts";
import { dbToGain } from "../space.ts";
import { TAIL_S } from "../synth/probe.ts";
import { EMPTY_CENSUS, type Hearing, type Pose, type Prefs } from "../types.ts";
import { bind, buildMaster, gain, type Binding, type Bus, type Ctx, type Master } from "./graph.ts";
import { createEar, type Seen } from "../ear.ts";
import { createKit, spawnWorker, type Kit } from "./kit.ts";
import { createScheduler, STALL, type CueSource, type Due, type Scheduler } from "./scheduler.ts";
import { createOneShots, type OneShots } from "./slots.ts";
import { buildWind, type Voice } from "./wind.ts";

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
  /** A calibration tone into the master chain: dBFS peak and Hz. */
  tone?: { db: number; hz: number };
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
  let lastT = NaN;
  let limiterMin: number | null = null;
  let limiterNext = 0;
  let disposed = false;

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

  const build = (now: number) => {
    if (opts.tone) return;
    if (!wind && kit.ready("noise") && kit.ready("controls")) wind = buildWind(ctx, kit, master.bus.wind, { touch: opts.touch, seed: opts.seed, at: now });
    if (wind && !windBuilt) {
      // One layer a frame on the page; the whole voice at once offline.
      do {
        const step = wind.steps.shift();
        if (step) step();
      } while (offline && wind.steps.length);
      if (!wind.steps.length) {
        windBuilt = true;
        bindings.push(...wind.bindings);
        nodes += wind.nodes.length;
      }
    }
  };

  /** Sends the targets that moved. `outright` sets every parameter to its target at once: only ever under a mute gain at 0. */
  const apply = (now: number, calm: boolean, outright: boolean) => {
    const silent = outright || fadeAt(fade, now) < 1e-3;
    for (const b of bindings) {
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
        const tau = first ? TAU.late : (v > b.sent ? rule.up : rule.down) * (rule.unit === "pan" && calm ? 2 : 1);
        for (let k = 0; k < b.params.length; k++) b.params[k].setTargetAtTime(b.map(v, k), now, tau);
      }
      b.sent = v;
      sends += b.params.length;
    }
  };

  const play = (d: Due, worldNow: number, now: number, lookahead: number) => {
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
        mix(pose, hearing, EMPTY_CENSUS, prefs, memory, targets);
        lastMix = pose.t;
        const quiet = v < 1e-3;
        if (quiet) apply(now, prefs.calm, true);
        fadeIn(now, quiet ? 0 : v, pending === "first" ? FADE_IN.first : FADE_IN.again);
        startTone(now);
        pending = null;
        live = true;
      }
      if (!live) return;

      // The scheduler, every frame.
      if (sources.length) {
        due.length = 0;
        scheduler.pass(pose.t, dt, look, due);
        for (const d of due) play(d, pose.t, now, look);
        shots.prune(now);
      }

      // The mix and its sends, thirty times a second.
      if (!(pose.t - lastMix < MIX_EVERY - 1e-4) || dt < 0) {
        mix(pose, hearing, EMPTY_CENSUS, prefs, memory, targets);
        lastMix = pose.t;
        apply(now, prefs.calm, false);
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
      scheduler.clear();
      lastT = NaN;
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
      scheduler.clear();
      lastT = NaN;
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
      scheduler.clear();
      lastT = NaN;
      lastClock = NaN;
    },
    setBus(bus, on) {
      busOn[bus] = on;
      const now = ctx.currentTime;
      if (bus !== "wind" && bus !== "water") master.bus[bus].gain.setTargetAtTime(on ? 1 : 0, now, 0.03);
      else for (const b of bindings) if (b.i === T.DUCK) for (let k = 0; k < b.params.length; k++) b.params[k].setTargetAtTime(b.map(targets[T.DUCK] || 1, k), now, 0.03);
    },
    stats() {
      return { limiterMinDb: limiterMin, onsets: [...onsets], oneShots: shots.started, dropped: shots.dropped, nodes, sends };
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
const KIT_SLICES = 4;
const KIT_MS = 0.1;

/** The kit outlives engines (its buffers are not tied to a context), as long as the sample rate is the same. */
let kept: Kit | null = null;

export function createRuntime(ctx: AudioContext, opts: { touch: boolean; seed: number }): Runtime {
  if (!kept || kept.sampleRate !== ctx.sampleRate) {
    kept?.dispose();
    kept = createKit({ sampleRate: ctx.sampleRate, seed: opts.seed, spawn: spawnWorker });
  }
  const kit = kept;
  const engine = createEngine(ctx, kit, { touch: opts.touch, seed: opts.seed });
  const ear = createEar();
  let kitMs = 0;
  return {
    frame(pose, prefs, seen) {
      const hearing = ear.step(pose, seen);
      engine.frame(pose, hearing, prefs);
      if (kit.done()) {
        kitMs = 0;
      } else {
        // A few slices of kit work, stopped as soon as they have taken a tenth of a millisecond.
        const a = performance.now();
        let b = a;
        for (let i = 0; i < KIT_SLICES && b - a < KIT_MS && kit.step(); i++) b = performance.now();
        kitMs = b - a;
      }
    },
    kitMs: () => kitMs,
    hearing: () => ear.hearing(),
    enable: (first) => engine.enable(first),
    mute: () => engine.mute(),
    hide: () => engine.hide(),
    cut: () => engine.cut(),
    get live() {
      return engine.live;
    },
    stats: () => engine.stats(),
    dispose: () => engine.dispose(),
  };
}
