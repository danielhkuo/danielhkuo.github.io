// What the sound bench does outside React: loading the recorded flight, reading a dropped one, and playing a scene
// live through the real engine. Plain functions, so the page component only wires them to buttons.

import { BUSES, type Bus } from "../../world/sound/engine/graph";
import { createEngine, type Engine } from "../../world/sound/engine/engine";
import { createKit, spawnWorker, type Kit } from "../../world/sound/engine/kit";
import { isSoundLog, replayScene, SCENES, type Scene } from "../../world/sound/bench/scenes";
import type { SoundLog } from "../../world/sound/control";
import type { Pose, Prefs } from "../../world/sound/types";

export const SEED = 3;

/** The shipped world's id, or null when it cannot be read. */
async function shippedWorldId(): Promise<string | null> {
  const res = await fetch("/world/current.json");
  if (!res.ok) return null;
  const world = (await res.json()) as { worldId?: string };
  return world.worldId ?? null;
}

/** A recorded flight, if the file is there and was flown over the shipped world. */
async function loadLog(url: string, worldId: string | null): Promise<SoundLog | null> {
  try {
    const res = await fetch(url);
    if (!res.ok || worldId === null) return null;
    const log: unknown = await res.json();
    return isSoundLog(log) && log.worldId === worldId ? log : null;
  } catch {
    return null;
  }
}

/**
 * The recorded flights: the world-fly route's first 30 s (`flight-replay`), and two minutes of it over the world as
 * it now is, the whole mix's measure (`long-flight`, design §13).
 */
export async function loadReplays(): Promise<Scene[]> {
  const worldId = await shippedWorldId().catch(() => null);
  const [short, long] = await Promise.all([loadLog("/world-sound/flight.json", worldId), loadLog("/world-sound/long-flight.json", worldId)]);
  const out: Scene[] = [];
  if (short) out.push(replayScene(short));
  if (long) out.push(replayScene(long, 120, "long-flight", "Two minutes of the world-fly route over the world as it is now, by day in clear air: the whole mix, measured for its loudness and range."));
  return out;
}

/** A dropped file as a replay scene; throws with a sentence for the status line when it is not one for this world. */
export async function readDroppedLog(file: File): Promise<Scene> {
  let log: unknown;
  try {
    log = JSON.parse(await file.text());
  } catch {
    throw new Error("That file is not a recorded flight");
  }
  if (!isSoundLog(log)) throw new Error("That file is not a recorded flight");
  const worldId = await shippedWorldId().catch(() => null);
  if (log.worldId !== worldId) throw new Error("That flight was recorded over another world");
  return replayScene(log);
}

/**
 * The bench's scenes as a store: the fixed scenes at once, and the recorded flight once it has loaded (the fetch
 * starts with the first subscriber). `set` replaces the replay (a dropped file).
 */
export function createSceneStore(): { subscribe(fn: () => void): () => void; get(): Scene[]; setReplay(scene: Scene): void; whenLoaded(): Promise<Scene[]> } {
  let scenes: Scene[] = SCENES;
  const subscribers = new Set<() => void>();
  let loaded: Promise<Scene[]> | null = null;
  const load = () =>
    (loaded ??= loadReplays().then((replays) => {
      if (replays.length) {
        scenes = [...SCENES, ...replays];
        for (const fn of subscribers) fn();
      }
      return scenes;
    }));
  return {
    subscribe(fn) {
      subscribers.add(fn);
      void load();
      return () => {
        subscribers.delete(fn);
      };
    },
    get: () => scenes,
    setReplay(scene) {
      scenes = [...SCENES, scene];
      for (const fn of subscribers) fn();
    },
    whenLoaded: load,
  };
}

export interface PlayOptions {
  kits: Map<number, Kit>;
  /** Read each frame: the desk's volume (0–100), reduced motion, and which buses are on. */
  desk(): { volume: number; calm: boolean; buses: Record<Bus, boolean> };
  onEnd(): void;
}

/** A live play of one scene: its own context, the real engine, the scene's timeline at the display rate. */
export interface Playing {
  name: string;
  engine: Engine;
  stop(): void;
}

export function playScene(scene: Scene, opts: PlayOptions): Playing {
  const ctx = new AudioContext({ latencyHint: "playback" });
  void ctx.resume();
  let kit = opts.kits.get(ctx.sampleRate);
  if (!kit) {
    kit = createKit({ sampleRate: ctx.sampleRate, seed: SEED, spawn: spawnWorker });
    opts.kits.set(ctx.sampleRate, kit);
  }
  const theKit = kit;
  const engine = createEngine(ctx, theKit, { touch: scene.prefs.touch, seed: SEED, probe: scene.probe, tone: scene.tone, n: scene.places?.n });
  const desk = opts.desk();
  for (const b of BUSES) if (!desk.buses[b]) engine.setBus(b, false);
  const actions = [...(scene.actions ?? [])].sort((a, b) => a.at - b.at);
  const state = { next: 0, hidden: false, stalledUntil: -Infinity, raf: 0, startMs: NaN, over: false };
  if (!actions.some((a) => a.do === "on")) engine.enable(true);
  const pose: Pose = { t: 0, dt: 0, x: 0, y: 0, alt: 0, heading: 0, speed: 0, bank: 0, rest: 0 };
  const end = () => {
    state.over = true;
    cancelAnimationFrame(state.raf);
    engine.dispose();
    void ctx.close();
  };
  const tick = (ms: number) => {
    if (state.over) return;
    if (Number.isNaN(state.startMs)) state.startMs = ms;
    const tau = (ms - state.startMs) / 1000;
    // The kit is made while the scene waits at its start.
    if (!theKit.done()) for (let i = 0; i < 8 && theKit.step(); i++);
    if (tau >= scene.seconds) {
      end();
      opts.onEnd();
      return;
    }
    while (state.next < actions.length && actions[state.next].at <= tau) {
      const a = actions[state.next];
      state.next += 1;
      if (a.do === "on") engine.enable(true);
      else if (a.do === "mute") engine.mute();
      else if (a.do === "unmute") engine.enable(false);
      else if (a.do === "hide") {
        engine.hide();
        state.hidden = true;
      } else if (a.do === "show") {
        state.hidden = false;
        engine.enable(false);
      } else if (a.do === "stall") state.stalledUntil = a.at + a.for;
    }
    if (!state.hidden && tau >= state.stalledUntil) {
      const f = scene.at(tau);
      Object.assign(pose, f.pose);
      // The page clock is the world's clock here, as in the game; the scene's own clock is carried as an offset.
      pose.t = ms / 1000;
      const now = opts.desk();
      const prefs: Prefs = { ...scene.prefs, volume: now.volume / 100, calm: scene.prefs.calm || now.calm };
      engine.frame(pose, f.hearing, prefs);
    }
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
  return { name: scene.name, engine, stop: end };
}
