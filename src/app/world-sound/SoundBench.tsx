"use client";

// The sound bench (/world-sound): every scene of the world's sound, to play through the real engine or, with ?render,
// to render offline for scripts/world-sound.mjs. Game layer, Ink & Glyph: hand-made CSS, not Astryx.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BUSES, type Bus } from "../../world/sound/engine/graph";
import { createKit, spawnWorker, type Kit } from "../../world/sound/engine/kit";
import { render, type RenderMode, type RenderStats } from "../../world/sound/bench/render";
import { renderNames, SCENES, type Scene } from "../../world/sound/bench/scenes";
import { encodeWav, toBase64 } from "../../world/sound/bench/wav";
import { fell } from "../world/fonts";
import styles from "./bench.module.css";
import { createSceneStore, playScene, readDroppedLog, SEED, type Playing } from "./player";

/** What scripts/world-sound.mjs drives (set only with ?render). */
interface SoundProbe {
  scenes: { name: string; seconds: number; about: string }[];
  render(name: string, opts: { sampleRate: number; mode?: RenderMode; set?: Record<string, number> }): Promise<{ wav: string; onsets: number[]; stats: RenderStats }>;
}

const ALL_ON: Record<Bus, boolean> = { wind: true, water: true, life: true, moments: true, bells: true };
const store = createSceneStore();
const fixedScenes = () => SCENES;

export default function SoundBench() {
  const scenes = useSyncExternalStore(store.subscribe, store.get, fixedScenes);
  const [playing, setPlaying] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const [volume, setVolume] = useState(70);
  const [calm, setCalm] = useState(false);
  const [buses, setBuses] = useState<Record<Bus, boolean>>(ALL_ON);
  const live = useRef<{ playing: Playing | null; volume: number; calm: boolean; buses: Record<Bus, boolean>; kits: Map<number, Kit> }>({
    playing: null, volume: 70, calm: false, buses: ALL_ON, kits: new Map(),
  });

  useEffect(() => {
    const state = live.current;
    if (new URLSearchParams(window.location.search).has("render")) {
      // The render contract waits for the recorded flight, so the script sees every scene.
      void store.whenLoaded().then((all) => {
        const probe: SoundProbe = {
          scenes: renderNames(all),
          async render(name, opts) {
            const beds = name.endsWith("-beds");
            const scene = all.find((s) => s.name === (beds ? name.slice(0, -5) : name));
            if (!scene) throw new Error(`no scene ${name}`);
            let kit = state.kits.get(opts.sampleRate);
            if (!kit) {
              kit = createKit({ sampleRate: opts.sampleRate, seed: SEED, spawn: spawnWorker });
              state.kits.set(opts.sampleRate, kit);
            }
            await kit.whenDone();
            const r = await render(scene, kit, { sampleRate: opts.sampleRate, mode: opts.mode, beds, set: opts.set });
            return { wav: toBase64(encodeWav(r.channels, r.sampleRate)), onsets: r.onsets, stats: r.stats };
          },
        };
        (window as unknown as { __sound: SoundProbe }).__sound = probe;
      });
    }
    return () => {
      state.playing?.stop();
      state.playing = null;
      for (const kit of state.kits.values()) kit.dispose();
      state.kits.clear();
    };
  }, []);

  const stop = () => {
    live.current.playing?.stop();
    live.current.playing = null;
    setPlaying(null);
    setStatus("Stopped");
  };

  const play = (scene: Scene) => {
    const state = live.current;
    state.playing?.stop();
    state.playing = playScene(scene, {
      kits: state.kits,
      desk: () => state,
      onEnd: () => {
        state.playing = null;
        setPlaying(null);
        setStatus("Done");
      },
    });
    setPlaying(scene.name);
    setStatus(`Playing ${scene.name}`);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    readDroppedLog(file).then(
      (replay) => {
        store.setReplay(replay);
        setStatus("Recorded flight loaded");
      },
      (err: unknown) => setStatus(err instanceof Error ? err.message : "That file is not a recorded flight"),
    );
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
                live.current.playing?.engine.setBus(b, on);
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
