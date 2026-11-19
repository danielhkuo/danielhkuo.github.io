// Renders a scene offline through the real engine (design §8). Two modes:
//
//   stepped   suspend(k / 60) → engine.frame(scene.at(k / 60)) → resume(): the page's own path, a frame at a time.
//             Needs OfflineAudioContext.suspend (Chrome has it; Firefox does not).
//   ahead     the whole timeline is run first, every setTargetAtTime and start scheduled at its future time, then one
//             startRendering(). How Firefox renders, and how the audio thread is timed (render wall time over
//             duration, with no round trips in it).
//
//   chunks    as ahead, a second at a time: the context is suspended once a second and the next second's frames are
//             scheduled. For timing the audio thread as the page loads it: scheduled all at once, a long scene's
//             hundreds of sources sit in the graph waiting (or ended) for the whole render, and each one costs a
//             little every quantum (measured: 300 waiting sources take 2.2 % of real time), which the page, starting
//             each a quarter of a second ahead, never pays. Needs suspend, so Chrome.
//
// Actions emulate the frozen clock: a mute or a hide runs the real fades and stops with the device's suspend()
// skipped; while hidden or stalled no frames are sent and the context renders on; then world time has moved on by
// the gap while context time simply carried on, exactly as a real resume looks to the engine.

import { createEngine } from "../engine/engine.ts";
import type { Kit } from "../engine/kit.ts";
import { K_BELL, K_RIVER, K_SURF, K_WIND } from "../levels.ts";
import { repeatCheck } from "./repeat.ts";
import type { Pose } from "../types.ts";
import type { Action, Mark, Scene } from "./scenes.ts";

export type RenderMode = "stepped" | "ahead" | "chunks";

export interface RenderOptions {
  sampleRate: number;
  mode?: RenderMode;
  /** Mutes waves and every one-shot (the `-beds` renders). */
  beds?: boolean;
  /** For calibration only: level constants to try in this render, as "K_WIND.a": 0.2 (see `withLevels`). */
  set?: Record<string, number>;
}

/** The level tables a calibration render may touch. */
const TABLES: Record<string, Record<string, number>> = { K_WIND, K_SURF: K_SURF as unknown as Record<string, number>, K_BELL, K_RIVER };

/** Runs `run` with some level constants replaced, and puts them back: how a layer is soloed to calibrate it. */
export async function withLevels<R>(set: Record<string, number> | undefined, run: () => Promise<R>): Promise<R> {
  const undo: (() => void)[] = [];
  for (const [path, value] of Object.entries(set ?? {})) {
    const [table, key] = path.split(".");
    const t = TABLES[table];
    if (!t || !(key in t)) throw new Error(`no level ${path}`);
    const was = t[key];
    t[key] = value;
    undo.push(() => {
      t[key] = was;
    });
  }
  try {
    return await run();
  } finally {
    for (const u of undo) u();
  }
}

export interface RenderStats {
  mode: RenderMode;
  /** The most the limiter pulled down, dB; null when it could not be read (the ahead mode cannot look mid-render). */
  limiterMinDb: number | null;
  /** Render wall time over duration: in the ahead mode, the audio thread's share of real time. */
  audioThreadShare: number;
  renderMs: number;
  oneShots: number;
  dropped: number;
  nodes: number;
  sends: number;
  marks: Mark[];
  /** Waves started a minute in each lane that started any, and the closest two starts of one train in one lane, seconds. */
  wavesPerMinute: number[];
  closestTrainGap: number | null;
  /** Every bell stroke started: hour, bell (5 the hour's hammer), number, seconds into the scene it was started at, and how far into its ring (0: from its top). */
  strokes: { H: number; bell: number; k: number; at: number; offset: number }[];
  /** Seconds into the scene of every mute and hide: everything sounding was stopped then. */
  stops: number[];
  /** Falls given a chain outright, falls that took the spare chain from a weaker one, and each of those moments (seconds into the scene; the fall's place). */
  fallsBound: number;
  fallHandovers: number;
  falls: { at: number; x: number; y: number; handover: boolean }[];
  /** The repetition check, where the scene asks for it: see bench/repeat.ts. `control` is the same check with one wave copied over another: it must find it. */
  repeatMax?: number;
  repeatPairs?: number;
  repeatWaves?: number;
  repeatControl?: number;
}

export interface RenderResult {
  sampleRate: number;
  channels: Float32Array[];
  /** Seconds into the scene of every one-shot's start. */
  onsets: number[];
  stats: RenderStats;
}

const FPS = 60;
/** A scene that starts already on is given this long to settle before its first sample, seconds (cut from the result). */
const PRE = 1;

export function canStep(): boolean {
  return typeof OfflineAudioContext !== "undefined" && typeof OfflineAudioContext.prototype.suspend === "function";
}

export function render(scene: Scene, kit: Kit, opts: RenderOptions): Promise<RenderResult> {
  return withLevels({ ...scene.set, ...opts.set }, () => renderScene(scene, kit, opts));
}

async function renderScene(scene: Scene, kit: Kit, opts: RenderOptions): Promise<RenderResult> {
  const mode: RenderMode = opts.mode ?? (canStep() ? "stepped" : "ahead");
  if (mode !== "ahead" && !canStep()) throw new Error("this browser cannot step an offline render: use mode \"ahead\"");
  const rate = opts.sampleRate;
  const actions: Action[] = [...(scene.actions ?? [])].sort((a, b) => a.at - b.at);
  const pre = actions.some((a) => a.do === "on") ? 0 : PRE;
  const total = pre + scene.seconds;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * rate), rate);
  const engine = createEngine(ctx, kit, {
    touch: scene.prefs.touch, seed: 3, offline: true, probe: scene.probe, beds: opts.beds, tone: scene.tone, hissOnly: scene.hissOnly, n: scene.places?.n, abbeys: scene.places?.abbeys,
    oneStroke: scene.stroke === undefined ? undefined : scene.t0 + scene.stroke,
    impulse: scene.impulse === undefined ? undefined : scene.t0 + scene.impulse,
  });
  /** Audio time minus world time: exact offline. */
  const o = pre - scene.t0;
  const pose: Pose = { t: 0, dt: 0, x: 0, y: 0, alt: 0, heading: 0, speed: 0, bank: 0, rest: 0 };
  let next = 0;
  /** Frames are sent only while the scene is neither hidden nor stalled. */
  let hidden = false;
  let stalledUntil = -Infinity;
  if (pre > 0) engine.enable(false);

  const frame = (k: number, now: number) => {
    const tau = k / FPS - pre;
    while (next < actions.length && actions[next].at <= tau + 1e-9) {
      const a = actions[next++];
      if (a.do === "on") engine.enable(true);
      else if (a.do === "mute") engine.mute(now);
      else if (a.do === "unmute") engine.enable(false);
      else if (a.do === "hide") {
        engine.hide(now);
        hidden = true;
      } else if (a.do === "show") {
        hidden = false;
        engine.enable(false);
      } else if (a.do === "stall") stalledUntil = a.at + a.for;
    }
    if (hidden || tau < stalledUntil - 1e-9) return;
    const f = scene.at(Math.max(0, tau));
    Object.assign(pose, f.pose);
    pose.t = scene.t0 + tau;
    engine.frame(pose, f.hearing, scene.prefs, { now, o });
  };

  const frames = Math.floor(total * FPS);
  const started = performance.now();
  let rendered: AudioBuffer;
  if (mode === "ahead") {
    for (let k = 0; k < frames; k++) frame(k, k / FPS);
    const a = performance.now();
    rendered = await ctx.startRendering();
    const renderMs = performance.now() - a;
    return finish(rendered, renderMs, renderMs);
  }
  if (mode === "chunks") {
    // A second of frames at a time, each at its own audio time.
    const PER = FPS;
    let done = 0;
    const fill = () => {
      const to = Math.min(frames, done + PER);
      for (let k = done; k < to; k++) frame(k, k / FPS);
      done = to;
    };
    fill();
    const next = () => {
      if (done >= frames) return;
      void ctx.suspend(done / FPS - 0.02).then(() => {
        fill();
        next();
        void ctx.resume();
      });
    };
    next();
    const a = performance.now();
    rendered = await ctx.startRendering();
    const ms = performance.now() - a;
    return finish(rendered, ms, ms);
  }
  frame(0, 0);
  let k = 1;
  const step = () => {
    if (k >= frames) return;
    const at = k;
    void ctx.suspend(at / FPS).then(() => {
      frame(at, ctx.currentTime);
      k++;
      step();
      void ctx.resume();
    });
  };
  step();
  rendered = await ctx.startRendering();
  return finish(rendered, performance.now() - started, performance.now() - started);

  function finish(buffer: AudioBuffer, renderMs: number, wallMs: number): RenderResult {
    const cut = Math.round(pre * rate);
    const whole = [0, 1].map((c) => buffer.getChannelData(c));
    const st = engine.stats();
    engine.dispose();
    // Pace: waves a minute in each lane, and the closest two starts of one train in one lane.
    const minutes = scene.seconds / 60;
    const wavesPerMinute = st.wavesByLane.filter((n) => n > 0).map((n) => Math.round((n / minutes) * 10) / 10);
    let closest: number | null = null;
    const lastOf = new Map<string, number>();
    // (A mute or a hide stops every wave and the lanes are chosen afresh: what follows is not compared with what went before.)
    const stops = actions.filter((x) => x.do === "mute" || x.do === "hide").map((x) => pre + x.at);
    let stop = 0;
    for (const w of st.waves) {
      while (stop < stops.length && w.when >= stops[stop]) {
        lastOf.clear();
        stop++;
      }
      const key = `${w.lane}:${w.train}`;
      const prev = lastOf.get(key);
      if (prev !== undefined && (closest === null || w.t - prev < closest)) closest = w.t - prev;
      lastOf.set(key, w.t);
    }
    let repeat: { repeatMax?: number; repeatPairs?: number; repeatWaves?: number; repeatControl?: number } = {};
    if (scene.repeat) {
      const mono = new Float32Array(whole[0].length);
      for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (whole[0][i] + whole[1][i]);
      const starts = st.waves.filter((w) => w.lasts > 3.9).map((w) => w.when);
      const r = repeatCheck(mono, rate, starts);
      // The control: the same check with one wave's four seconds copied over another's. It must be found.
      let control: number | undefined;
      const len = 4 * rate;
      const other = starts.findIndex((t) => t - starts[0] >= 4 && Math.round(t * rate) + len <= mono.length);
      if (other > 0) {
        const a = Math.round(starts[0] * rate), b = Math.round(starts[other] * rate);
        mono.copyWithin(b, a, a + len);
        control = repeatCheck(mono, rate, [starts[0], starts[other]]).repeatMax;
      }
      repeat = { repeatMax: r.repeatMax, repeatPairs: r.pairs, repeatWaves: r.waves, repeatControl: control };
    }
    const keep = Math.round(Math.min(scene.keep ?? scene.seconds, scene.seconds) * rate);
    const channels = whole.map((c) => c.slice(cut, cut + keep));
    return {
      sampleRate: rate,
      channels,
      onsets: st.onsets.map((t) => t - pre).filter((t) => t >= 0 && t < keep / rate),
      stats: {
        mode,
        limiterMinDb: st.limiterMinDb,
        audioThreadShare: wallMs / 1000 / total,
        renderMs,
        oneShots: st.oneShots,
        dropped: st.dropped,
        nodes: st.nodes,
        sends: st.sends,
        marks: scene.marks ?? [],
        wavesPerMinute,
        closestTrainGap: closest,
        fallsBound: st.fallsBound,
        fallHandovers: st.fallHandovers,
        falls: st.fallLog.map((f) => ({ at: Math.round((f.when - pre) * 100) / 100, x: Math.round(f.x), y: Math.round(f.y), handover: f.handover })),
        stops: actions.filter((x) => x.do === "mute" || x.do === "hide").map((x) => x.at),
        strokes: st.strokes.map((b) => ({ H: b.H, bell: b.bell, k: b.k, at: Math.round((b.when - pre) * 1000) / 1000, offset: Math.round(b.offset * 1000) / 1000 })),
        ...repeat,
      },
    };
  }
}
