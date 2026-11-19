// The control: the small, always-loaded part of the world's sound (design §1.5, §6.7, §6.8, §7). It holds the
// listener's choice, the state machine, the gesture that unlocks audio, the ear's layer and the probe; the engine
// arrives by a lazy import only once sound is wanted. With sound off nothing here costs anything: `frame` returns 0
// at once and no AudioContext exists.
//
// States (probe.soundState):
//   off        not wanted
//   waiting    wanted, but no gesture has started it yet (or a rebuild needs one)
//   running    wanted, context running
//   suspended  wanted, but hidden, frozen or interrupted

import type { LiveFrame, LiveLayer } from "../live/live.ts";
import type { LayerContext } from "../live/registry.ts";
import { placesOf } from "./places.ts";
import { readPrefs, writeVolume, writeWanted, type PrefStore } from "./prefs.ts";
import { copyHearing, type Hearing, type Places, type Pose, type Prefs, type SoundState } from "./types.ts";

/** The slice of the lazy module the control uses (engine/engine.ts). */
export interface SoundRuntime {
  frame(pose: Pose, prefs: Prefs, seen: { bake: Uint32Array | null; rect: { x: number; y: number; w: number; h: number } | null; t: number }): void;
  kitMs(): number;
  work(): number;
  /** True once every buffer is made and every graph built. */
  settled(): boolean;
  hearing(): Hearing;
  enable(first: boolean): void;
  mute(): void;
  hide(): void;
  cut(): void;
  dispose(): void;
}

export interface SoundModule {
  createRuntime(ctx: AudioContext, opts: { touch: boolean; seed: number; n: number; land: { gN: number; ground: ArrayLike<number> } | null; abbeys?: readonly { x: number; y: number }[]; arm?: string }): SoundRuntime;
}

/** The slice of AudioContext the control uses. */
export interface ContextLike {
  state: string;
  currentTime: number;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
  onstatechange: (() => void) | null;
}

interface Listenable {
  addEventListener(type: string, fn: (e: Event) => void, opts?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, fn: (e: Event) => void, opts?: boolean | EventListenerOptions): void;
}

/** Everything the control touches outside itself, so the tests can stand in for the browser. */
export interface ControlEnv {
  storage: PrefStore | null;
  makeContext(): ContextLike;
  load(): Promise<SoundModule>;
  win: Listenable;
  doc: Listenable & { visibilityState: string };
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  /** A touch device: the lighter profile. */
  touch: boolean;
  /** Reduced motion, read live. */
  calm(): boolean;
  /** Records a flight for the bench (?soundlog), whether sound is on or off. */
  log?: boolean;
  /**
   * A measuring arm (?stats&soundarm=…), for bisecting what the sound costs a frame. "noctx": wanted, but no context
   * is ever made. "frozen": everything runs, then the context is suspended once the kit is done (no audio thread).
   * "earoff", "earlocal", "nosurf": handed to the runtime (no ear; the ear in the frame loop; no waves or beds).
   */
  arm?: string;
}

/** A recorded flight: one row a frame (t, dt, x, y, alt, heading, speed, bank, rest, index of the Hearing in force). */
export interface SoundLog {
  v: 1;
  worldId: string;
  places: Places | null;
  prefs: Prefs;
  frames: number[][];
  hearings: Hearing[];
}

export interface FlightLike {
  x: number;
  y: number;
  alt: number;
  heading: number;
  speed: number;
  bank: number;
}

export interface SoundControl {
  /** The ear's live layer: it keeps what the frame saw. Returns at once when sound is off. */
  ear: LiveLayer;
  /** Once the world has loaded: its places. */
  world(ctx: LayerContext, worldId: string): void;
  /** One frame, after view.frame. Returns the main-thread ms it took (0 when off). */
  frame(t: number, flight: FlightLike, rest: number): number;
  /** The kit's share of the last frame's ms. */
  kitMs(): number;
  /** What the last frame did, as bits (engine WORK): 1 a build step, 2 kit, 4 the mix, 8 a wave started, 16 a lap, 32 enabling, 64 a clock sample, 128 the waves' turn. */
  work(): number;
  /** True once the sound's buffers and graphs are all made. */
  settled(): boolean;
  state(): SoundState;
  /** The toggle's activation: off → on (the context is made here, in the gesture); waiting → start; on → off. */
  toggle(): void;
  volume(): number;
  setVolume(v: number): void;
  /** Calls `fn` whenever the state changes; returns the unsubscribe. */
  subscribe(fn: () => void): () => void;
  /** The recorded flight, when ?soundlog asked for one. */
  log(): SoundLog | null;
  dispose(): void;
}

/** Marks the sound's own UI (toggle, hint, panel): the unlock listeners leave events inside it alone. */
export const SOUND_UI = "data-sound-ui";

/** Keys that grant no activation (Chromium), or that mean something else here: they never unlock. */
const DEAD_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "ScrollLock", "Fn", "FnLock", "Hyper", "Super", "Symbol", "SymbolLock", "OS", "ContextMenu", "Dead", "Unidentified", "Escape"]);
const UNLOCK_EVENTS = ["keydown", "pointerup", "click"] as const;
/** A recording stops after this long, seconds. */
const LOG_SECONDS = 120;

function insideSoundUi(target: EventTarget | null): boolean {
  const el = target as { closest?: (sel: string) => unknown } | null;
  return !!el && typeof el.closest === "function" && el.closest(`[${SOUND_UI}]`) != null;
}

export function browserEnv(log = false, arm?: string): ControlEnv {
  let storage: PrefStore | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  // Reduced motion is followed live, by its change event (the frame loop reads a boolean, not the media query).
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let calm = motion.matches;
  motion.addEventListener("change", () => {
    calm = motion.matches;
  });
  return {
    storage,
    makeContext: () => {
      // The ambient session lets the phone's silent switch and the listener's own music win.
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      try {
        if (nav.audioSession) nav.audioSession.type = "ambient";
      } catch {
        // not settable here
      }
      return new AudioContext({ latencyHint: "playback" }) as unknown as ContextLike;
    },
    load: () => import("./engine/engine.ts") as unknown as Promise<SoundModule>,
    win: window,
    doc: document,
    now: () => performance.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
    touch: window.matchMedia("(pointer: coarse)").matches,
    calm: () => calm,
    log,
    arm,
  };
}

export function createSoundControl(env: ControlEnv): SoundControl {
  const stored = readPrefs(env.storage);
  let wanted = stored.wanted;
  let volume = stored.volume;
  let ctx: ContextLike | null = null;
  let mod: SoundModule | null = null;
  let loading = false;
  let rt: SoundRuntime | null = null;
  /** True once this context has run with sound on: a later stop is a suspension, not a wait for a gesture. */
  let started = false;
  /** True while the engine has been told sound is on (so it is told once). */
  let enabled = false;
  let hidden = env.doc.visibilityState === "hidden";
  let armed = false;
  let disposed = false;
  /** The world, once it has loaded: the engine is not made before it (its kit is seeded by the world's seed). */
  let land: { seed: number; n: number; land: { gN: number; ground: ArrayLike<number> } | null; abbeys: { x: number; y: number }[] } | null = null;
  let suspendTimer: unknown = null;
  let disposeTimer: unknown = null;
  let recoverTimer: unknown = null;
  const subscribers = new Set<() => void>();
  let lastState: SoundState = "off";

  const seen: { bake: Uint32Array | null; rect: { x: number; y: number; w: number; h: number } | null; t: number } = { bake: null, rect: null, t: 0 };
  const pose: Pose = { t: 0, dt: 0, x: 0, y: 0, alt: 0, heading: 0, speed: 0, bank: 0, rest: 0 };
  const prefs: Prefs = { volume, headphones: false, calm: false, touch: env.touch };
  let lastT = NaN;
  let kitMs = 0;
  let lastWork = 0;

  const record: SoundLog | null = env.log ? { v: 1, worldId: "", places: null, prefs: { ...prefs }, frames: [], hearings: [] } : null;
  let logFrom = NaN;
  let lastHearing: Hearing | null = null;

  const measuring = env.arm ?? "";
  /** The "frozen" arm: the context has been suspended on purpose, and the frame loop carries on as if it ran. */
  let frozen = false;
  const running = () => ctx !== null && (ctx.state === "running" || frozen);

  const state = (): SoundState => {
    if (!wanted) return "off";
    if (running() && !hidden) return "running";
    if (started && (hidden || (ctx !== null && ctx.state === "interrupted"))) return "suspended";
    return "waiting";
  };

  const notify = () => {
    const s = state();
    if (s === lastState) return;
    lastState = s;
    for (const fn of subscribers) fn();
  };

  const clear = (id: unknown) => {
    if (id !== null) env.clearTimeout(id);
  };

  const onGesture = (e: Event) => {
    if (e.type === "keydown" && DEAD_KEYS.has((e as KeyboardEvent).key)) return;
    if (insideSoundUi(e.target)) return;
    unlock();
  };

  const arm = () => {
    if (armed || disposed) return;
    armed = true;
    for (const type of UNLOCK_EVENTS) env.win.addEventListener(type, onGesture, true);
  };

  const disarm = () => {
    if (!armed) return;
    armed = false;
    for (const type of UNLOCK_EVENTS) env.win.removeEventListener(type, onGesture, true);
  };

  const ensureModule = () => {
    if (mod || loading) return;
    loading = true;
    env.load().then(
      (m) => {
        loading = false;
        mod = m;
        check();
      },
      () => {
        // The chunk did not load: the next gesture tries again.
        loading = false;
      },
    );
  };

  /** Stops and forgets the engine and its context. */
  const teardown = () => {
    clear(suspendTimer);
    clear(disposeTimer);
    clear(recoverTimer);
    suspendTimer = disposeTimer = recoverTimer = null;
    rt?.dispose();
    rt = null;
    enabled = false;
    if (ctx) {
      ctx.onstatechange = null;
      void ctx.close().catch(() => undefined);
    }
    ctx = null;
    started = false;
  };

  /** Brings what is running into line with what is wanted. Called on every state change, gesture and load. */
  function check(): void {
    if (disposed) return;
    if (wanted && !hidden) {
      if (running()) {
        // Only a running context ends the wait: until then every later gesture calls resume() again.
        disarm();
        clear(suspendTimer);
        clear(disposeTimer);
        suspendTimer = disposeTimer = null;
        if (mod && ctx && land) {
          const first = rt === null;
          rt ??= mod.createRuntime(ctx as unknown as AudioContext, { touch: env.touch, seed: land.seed, n: land.n, land: land.land, abbeys: land.abbeys, arm: measuring });
          if (!enabled) rt.enable(first);
          enabled = true;
          started = true;
        }
      } else {
        // Interrupted (a call, the lock screen): the device is silent and its clock frozen. Nothing that was started
        // may sound on return, so everything is stopped now; `running` brings it back as a return to the tab does.
        if (enabled && rt && ctx && ctx.state !== "closed") rt.cut();
        enabled = false;
        arm();
      }
    }
    notify();
  }

  /** In a gesture: make the context if there is none, and ask it to run. resume()'s promise is never trusted; ctx.state is. */
  function unlock(): void {
    if (disposed || !wanted || measuring === "noctx") return;
    if (!ctx) {
      try {
        ctx = env.makeContext();
      } catch {
        ctx = null;
        return;
      }
      ctx.onstatechange = check;
    }
    ensureModule();
    void ctx.resume().then(check, () => undefined);
    check();
  }

  const turnOff = () => {
    wanted = false;
    writeWanted(env.storage, false);
    disarm();
    clear(recoverTimer);
    recoverTimer = null;
    if (rt && ctx) {
      // The mute fade, then the device stops; the engine is let go after half a minute still off.
      rt.mute();
      enabled = false;
      const c = ctx;
      clear(suspendTimer);
      suspendTimer = env.setTimeout(() => {
        suspendTimer = null;
        if (!wanted && ctx === c) void c.suspend().catch(() => undefined);
      }, 300);
      clear(disposeTimer);
      disposeTimer = env.setTimeout(() => {
        disposeTimer = null;
        if (!wanted) teardown();
      }, 30000);
    } else {
      teardown();
    }
    notify();
  };

  const turnOn = () => {
    wanted = true;
    writeWanted(env.storage, true);
    clear(suspendTimer);
    clear(disposeTimer);
    suspendTimer = disposeTimer = null;
    unlock();
    notify();
  };

  const onHide = () => {
    if (hidden) return;
    hidden = true;
    clear(recoverTimer);
    recoverTimer = null;
    if (wanted && rt && running() && ctx) {
      // rAF has stopped: the fade is scheduled on the audio clock, here, and the device stops after it.
      rt.hide();
      enabled = false;
      const c = ctx;
      clear(suspendTimer);
      suspendTimer = env.setTimeout(() => {
        suspendTimer = null;
        if (hidden && ctx === c) void c.suspend().catch(() => undefined);
      }, 250);
    }
    notify();
  };

  const onShow = () => {
    if (!hidden) return;
    hidden = false;
    clear(suspendTimer);
    suspendTimer = null;
    if (wanted && ctx) {
      const c = ctx;
      const before = c.currentTime;
      void c.resume().then(check, () => undefined);
      // Recovery (§6.8): not running, or not advancing, after half a second → suspend then resume; still stuck after
      // another → let it go and wait for a gesture again.
      const stuck = () => ctx === c && (c.state !== "running" || c.currentTime - before < 0.1);
      clear(recoverTimer);
      recoverTimer = env.setTimeout(() => {
        recoverTimer = null;
        if (!wanted || hidden || !stuck()) return;
        void c.suspend().then(() => c.resume()).then(check, () => undefined);
        recoverTimer = env.setTimeout(() => {
          recoverTimer = null;
          if (!wanted || hidden || !stuck()) return;
          teardown();
          arm();
          notify();
        }, 500);
      }, 500);
    }
    check();
  };

  const onVisibility = () => (env.doc.visibilityState === "hidden" ? onHide() : onShow());
  const onPageHide = (e: Event) => {
    onHide();
    // Not going into the back/forward cache: nothing will come back for this context.
    if ((e as PageTransitionEvent).persisted === false) teardown();
  };
  const onPageShow = () => onShow();

  env.doc.addEventListener("visibilitychange", onVisibility);
  env.win.addEventListener("pagehide", onPageHide);
  env.win.addEventListener("pageshow", onPageShow);

  // A stored "on": fetch the engine now, and wait for the first gesture.
  if (wanted) {
    ensureModule();
    arm();
  }
  lastState = state();

  return {
    ear: {
      name: "ear",
      draw(f: LiveFrame) {
        if (!wanted && !record) return;
        seen.bake = f.bake;
        seen.rect = f.rect;
        seen.t = f.t;
      },
    },
    world(layers, worldId) {
      land = { seed: layers.seed, n: layers.n, land: layers.land ?? null, abbeys: placesOf(layers, worldId).abbeys };
      check();
      if (record) {
        record.worldId = worldId;
        record.places = placesOf(layers, worldId);
      }
    },
    frame(t, flight, rest) {
      const live = rt !== null && wanted && !hidden && running();
      if (!live && !record) return 0;
      const a = env.now();
      pose.dt = lastT === lastT ? t - lastT : 0;
      lastT = t;
      pose.t = t;
      pose.x = flight.x;
      pose.y = flight.y;
      pose.alt = flight.alt;
      pose.heading = flight.heading;
      pose.speed = flight.speed;
      pose.bank = flight.bank;
      pose.rest = rest;
      kitMs = 0;
      lastWork = 0;
      if (live && rt) {
        prefs.volume = volume;
        prefs.calm = env.calm();
        rt.frame(pose, prefs, seen);
        if (measuring === "frozen" && !frozen && ctx && rt.settled()) {
          frozen = true;
          void ctx.suspend().catch(() => undefined);
        }
        kitMs = rt.kitMs();
        lastWork = rt.work();
      }
      if (record) {
        if (logFrom !== logFrom) logFrom = t;
        if (t - logFrom <= LOG_SECONDS) {
          const h = live && rt ? rt.hearing() : null;
          if (h && h !== lastHearing) {
            // The log copies: the ear reuses its Hearings.
            lastHearing = h;
            record.hearings.push(copyHearing(h));
          }
          const r = (v: number, k: number) => Math.round(v * k) / k;
          record.frames.push([r(t, 1e4), r(pose.dt, 1e4), r(pose.x, 100), r(pose.y, 100), r(pose.alt, 100), r(pose.heading, 1e4), r(pose.speed, 100), r(pose.bank, 1e4), r(rest, 1e4), record.hearings.length - 1]);
        }
      }
      return env.now() - a;
    },
    kitMs: () => kitMs,
    work: () => lastWork,
    settled: () => rt !== null && rt.settled(),
    state,
    toggle() {
      if (disposed) return;
      const s = state();
      // While waiting, the toggle starts sound; it does not turn it off.
      if (s === "off") turnOn();
      else if (s === "waiting") unlock();
      else turnOff();
    },
    volume: () => volume,
    setVolume(v) {
      volume = Math.min(1, Math.max(0, v));
      writeVolume(env.storage, volume);
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    log: () => record,
    dispose() {
      if (disposed) return;
      disarm();
      disposed = true;
      env.doc.removeEventListener("visibilitychange", onVisibility);
      env.win.removeEventListener("pagehide", onPageHide);
      env.win.removeEventListener("pageshow", onPageShow);
      teardown();
      subscribers.clear();
    },
  };
}
