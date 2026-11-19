"use client";

// The sound bench (/world-sound): every scene of the world's sound, to play through the real engine or, with ?render,
// to render offline for scripts/world-sound.mjs. Game layer, Ink & Glyph: hand-made CSS, not Astryx.

import { useEffect, useRef, useState } from "react";
import { BUSES, type Bus } from "../../world/sound/engine/graph";
import { createEngine, type Engine } from "../../world/sound/engine/engine";
import { createKit, spawnWorker, type Kit } from "../../world/sound/engine/kit";
import { render, type RenderMode, type RenderStats } from "../../world/sound/bench/render";
import { isSoundLog, renderNames, replayScene, SCENES, type Scene } from "../../world/sound/bench/scenes";
import { encodeWav, toBase64 } from "../../world/sound/bench/wav";
import type { Pose, Prefs } from "../../world/sound/types";
import { fell } from "../world/fonts";
import styles from "./bench.module.css";

/** What scripts/world-sound.mjs drives (set only with ?render). */
interface SoundProbe {
  scenes: { name: string; seconds: number; about: string }[];
  render(name: string, opts: { sampleRate: number; mode?: RenderMode; set?: Record<string, number> }): Promise<{ wav: string; onsets: number[]; stats: RenderStats }>;
}

const SEED = 3;

/** The recorded flight, if there is one and it was flown over the shipped world. */
async function loadReplay(): Promise<Scene | null> {
  try {
    const [logRes, worldRes] = await Promise.all([fetch("/world-sound/flight.json"), fetch("/world/current.json")]);
    if (!logRes.ok || !worldRes.ok) return null;
    const log: unknown = await logRes.json();
    const world = (await worldRes.json()) as { worldId?: string };
    if (!isSoundLog(log) || log.worldId !== world.worldId) return null;
    return replayScene(log);
  } catch {
    return null;
  }
}

/** A live play of one scene: its own context, the real engine, the scene's timeline at the display rate. */
interface Playing {
  name: string;
  stop(): void;
}

export default function SoundBench() {
  const [scenes, setScenes] = useState<Scene[]>(SCENES);
  const [playing, setPlaying] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const [volume, setVolume] = useState(70);
  const [calm, setCalm] = useState(false);
  const [buses, setBuses] = useState<Record<Bus, boolean>>({ wind: true, water: true, life: true, moments: true, bells: true });
  const live = useRef<{ playing: Playing | null; engine: Engine | null; volume: number; calm: boolean; buses: Record<Bus, boolean>; kits: Map<number, Kit>; scenes: Scene[] }>({
    playing: null, engine: null, volume: 70, calm: false, buses: { wind: true, water: true, life: true, moments: true, bells: true }, kits: new Map(), scenes: SCENES,
  });

  useEffect(() => {
    const state = live.current;
    const kitFor = (rate: number): Kit => {
      let kit = state.kits.get(rate);
      if (!kit) {
        kit = createKit({ sampleRate: rate, seed: SEED, spawn: spawnWorker });
        state.kits.set(rate, kit);
      }
      return kit;
    };
    let alive = true;
    void loadReplay().then((replay) => {
      if (!alive) return;
      const all = replay ? [...SCENES, replay] : SCENES;
      state.scenes = all;
      setScenes(all);
      if (!new URLSearchParams(window.location.search).has("render")) return;
      const probe: SoundProbe = {
        scenes: renderNames(all),
        async render(name, opts) {
          const beds = name.endsWith("-beds");
          const scene = all.find((s) => s.name === (beds ? name.slice(0, -5) : name));
          if (!scene) throw new Error(`no scene ${name}`);
          const kit = kitFor(opts.sampleRate);
          await kit.whenDone();
          const r = await render(scene, kit, { sampleRate: opts.sampleRate, mode: opts.mode, beds, set: opts.set });
          return { wav: toBase64(encodeWav(r.channels, r.sampleRate)), onsets: r.onsets, stats: r.stats };
        },
      };
      (window as unknown as { __sound: SoundProbe }).__sound = probe;
    });
    return () => {
      alive = false;
      state.playing?.stop();
      for (const kit of state.kits.values()) kit.dispose();
      state.kits.clear();
    };
  }, []);

  const stop = () => {
    live.current.playing?.stop();
    live.current.playing = null;
    live.current.engine = null;
    setPlaying(null);
    setStatus("Stopped");
  };

  const play = (scene: Scene) => {
    const state = live.current;
    state.playing?.stop();
    const ctx = new AudioContext({ latencyHint: "playback" });
    void ctx.resume();
    let kit = state.kits.get(ctx.sampleRate);
    if (!kit) {
      kit = createKit({ sampleRate: ctx.sampleRate, seed: SEED, spawn: spawnWorker });
      state.kits.set(ctx.sampleRate, kit);
    }
    const engine = createEngine(ctx, kit, { touch: scene.prefs.touch, seed: SEED, probe: scene.probe, tone: scene.tone });
    for (const b of BUSES) if (!state.buses[b]) engine.setBus(b, false);
    const actions = [...(scene.actions ?? [])].sort((a, b) => a.at - b.at);
    let next = 0, hidden = false, stalledUntil = -Infinity, raf = 0, startMs = NaN, over = false;
    if (!actions.some((a) => a.do === "on")) engine.enable(true);
    const pose: Pose = { t: 0, dt: 0, x: 0, y: 0, alt: 0, heading: 0, speed: 0, bank: 0, rest: 0 };
    const tick = (ms: number) => {
      if (over) return;
      if (startMs !== startMs) startMs = ms;
      const tau = (ms - startMs) / 1000;
      // The kit is made while the scene waits at its start.
      if (!kit.done()) for (let i = 0; i < 8 && kit.step(); i++);
      if (tau >= scene.seconds) {
        end();
        setPlaying(null);
        setStatus("Done");
        return;
      }
      while (next < actions.length && actions[next].at <= tau) {
        const a = actions[next++];
        if (a.do === "on") engine.enable(true);
        else if (a.do === "mute") engine.mute();
        else if (a.do === "unmute") engine.enable(false);
        else if (a.do === "hide") {
          engine.hide();
          hidden = true;
        } else if (a.do === "show") {
          hidden = false;
          engine.enable(false);
        } else if (a.do === "stall") stalledUntil = a.at + a.for;
      }
      if (!hidden && tau >= stalledUntil) {
        const f = scene.at(tau);
        Object.assign(pose, f.pose);
        // The page clock is the world's clock here, as in the game.
        pose.t = ms / 1000;
        const prefs: Prefs = { ...scene.prefs, volume: state.volume / 100, calm: scene.prefs.calm || state.calm };
        engine.frame(pose, f.hearing, prefs);
      }
      raf = requestAnimationFrame(tick);
    };
    const end = () => {
      over = true;
      cancelAnimationFrame(raf);
      engine.dispose();
      void ctx.close();
    };
    raf = requestAnimationFrame(tick);
    state.playing = { name: scene.name, stop: end };
    state.engine = engine;
    setPlaying(scene.name);
    setStatus(`Playing ${scene.name}`);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    void file.text().then(async (text) => {
      try {
        const log: unknown = JSON.parse(text);
        const world = (await (await fetch("/world/current.json")).json()) as { worldId?: string };
        if (!isSoundLog(log)) throw new Error("not a sound log");
        if (log.worldId !== world.worldId) throw new Error("that flight was recorded over another world");
        const replay = replayScene(log);
        const all = [...SCENES, replay];
        live.current.scenes = all;
        setScenes(all);
        setStatus("Recorded flight loaded");
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "That file is not a recorded flight");
      }
    });
  };

  return (
    <main className={`${styles.bench} ${fell.variable}`} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <h1>The world&rsquo;s sound</h1>
      <p className={styles.lede}>Each scene runs its timeline through the real engine. Drop a recorded flight on the page to replay it.</p>
      <section className={styles.desk} aria-label="Desk">
        <label>
          Volume
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              live.current.volume = v;
              setVolume(v);
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={calm}
            onChange={(e) => {
              live.current.calm = e.target.checked;
              setCalm(e.target.checked);
            }}
          />
          Reduced motion
        </label>
        {BUSES.map((b) => (
          <label key={b}>
            <input
              type="checkbox"
              checked={buses[b]}
              onChange={(e) => {
                const on = e.target.checked;
                live.current.buses = { ...live.current.buses, [b]: on };
                live.current.engine?.setBus(b, on);
                setBuses((prev) => ({ ...prev, [b]: on }));
              }}
            />
            {b}
          </label>
        ))}
        <span className={styles.status} role="status">
          {status}
        </span>
      </section>
      <ul className={styles.scenes}>
        {scenes.map((s) => (
          <li key={s.name} className={styles.scene}>
            <span className={styles.name}>{s.name}</span>
            <span className={styles.seconds}>{s.seconds} s</span>
            <span className={styles.about}>{s.about}</span>
            <button type="button" className={styles.button} aria-pressed={playing === s.name} onClick={() => (playing === s.name ? stop() : play(s))}>
              {playing === s.name ? "Stop" : "Play"}
            </button>
          </li>
        ))}
      </ul>
      <p className={styles.note}>
        Renders for the checker: <code>npm run build &amp;&amp; node scripts/world-sound.mjs</code>.
      </p>
    </main>
  );
}
