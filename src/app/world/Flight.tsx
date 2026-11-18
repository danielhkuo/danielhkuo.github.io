"use client";

import { IM_Fell_English } from "next/font/google";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buildPalette, MIDDAY } from "../../world/render/palette";
import type { FlightInput, FlightState } from "../../world/runtime/flight";
import { startState, stepFlight } from "../../world/runtime/flight";
import { fitScale } from "../../world/runtime/fit";
import { makeLayers } from "../../world/live/registry";
import { wondersOf } from "../../world/pack/manifest";
import { LOAD_FAILED, loadWorld } from "../../world/runtime/load";
import { createPool, type WorkerLike } from "../../world/runtime/pool";
import { createDragon } from "../../world/dragon/index";
import { createDiscoveries, type KeyValue } from "../../world/runtime/discoveries";
import { createStreamView } from "../../world/runtime/stream";
import type { StreamView } from "../../world/runtime/stream";
import { createSky } from "../../world/sky/sky";
import { styleFrom } from "../../world/sky/styles";

const fell = IM_Fell_English({ weight: "400", subsets: ["latin"] });

const FRAME_W = 400;
const FRAME_H = 225;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function inputFromKeys(keys: Set<string>): FlightInput {
  let turn: -1 | 0 | 1 = 0;
  if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) turn = -1;
  if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) turn = turn === -1 ? 0 : 1;
  const boost = keys.has("ArrowUp") || keys.has("w") || keys.has("W") || keys.has("Shift");
  const brake = keys.has("ArrowDown") || keys.has("s") || keys.has("S");
  return { turn, boost, brake };
}

interface FlightProbe {
  navStart: number;
  readyAt: number | null;
  frameMs: number[];
  /** Main-thread ms the sky's two passes took, per frame. */
  skyMs: number[];
  hazeFrames: number;
  frames: number;
  baked: () => number;
  error: string | null;
  workerErrors: string[];
}

export default function Flight() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // CSS pixels per frame pixel: a whole number of device pixels, so the frame stays hard-edged at any display scaling.
  const [scale, setScale] = useState(1);
  const [failed, setFailed] = useState(false);
  // Filled from the frame loop when the page is opened with ?stats.
  const [stats, setStats] = useState<{ fps: number; pool: string; view: string } | null>(null);
  const [discoveryCaption, setDiscoveryCaption] = useState<string | null>(null);
  const [discoveryCaptionVisible, setDiscoveryCaptionVisible] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const statsOn = new URLSearchParams(window.location.search).has("stats");
    // With ?stats the page reports to scripts/world-fly.mjs through window.__flight.
    const probe: FlightProbe | null = statsOn
      ? { navStart: 0, readyAt: null, frameMs: [], skyMs: [], hazeFrames: 0, frames: 0, baked: () => pool?.stats().baked ?? 0, error: null, workerErrors: [] }
      : null;
    if (probe) (window as unknown as { __flight: FlightProbe }).__flight = probe;
    const recomputeScale = () => {
      const dpr = window.devicePixelRatio || 1;
      setScale(fitScale(window.innerWidth * dpr, window.innerHeight * dpr, FRAME_W, FRAME_H) / dpr);
    };
    recomputeScale();
    window.addEventListener("resize", recomputeScale);

    const keys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        window.location.href = "/";
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
      }
      keys.add(e.key);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.key);
    };
    const onBlur = () => {
      keys.clear();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    let alive = true;
    let raf = 0;
    let pool: ReturnType<typeof createPool> | null = null;
    let view: StreamView | null = null;
    let flight: FlightState | null = null;
    let worldN = 0;
    const frame = new Uint32Array(FRAME_W * FRAME_H);
    let imageData: ImageData | null = null;
    let readyFrame = false;
    let lastT = 0;
    let fpsFrames = 0;
    let fpsLast = 0;
    let lastCaptionPoll = 0;
    let lastPolledCaption: string | null | undefined;

    let storageOrNull: KeyValue | null = null;
    try {
      storageOrNull = window.localStorage;
    } catch {
      storageOrNull = null;
    }
    const discoveries = createDiscoveries(storageOrNull, () => performance.now());

    // Stops the frame loop and the workers, and shows the message in place of the canvas.
    const fail = () => {
      if (probe) probe.error = LOAD_FAILED;
      cancelAnimationFrame(raf);
      pool?.dispose();
      if (alive) setFailed(true);
    };

    void (async () => {
      try {
        const loaded = await loadWorld(fetch, "/world");
        if (!alive) return;

        const maskRes = await fetch("/world/bluenoise.bin");
        if (!maskRes.ok) throw new Error("mask");
        const mask = new Uint8Array(await maskRes.arrayBuffer());
        if (!alive) return;

        const size = clamp((navigator.hardwareConcurrency ?? 2) - 1, 1, 4);
        pool = createPool(
          () =>
            new Worker(new URL("../../world/runtime/bake.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike,
          size,
          // Workers load from blob: URLs, where a root-relative path does not resolve.
          { url: new URL(loaded.binUrl, window.location.href).href, mask },
        );
        pool.onError = (message) => {
          if (probe) probe.workerErrors.push(message);
          // Before the first full view any failure is fatal; after it, only losing every worker is, since the
          // land would never be painted again.
          if (!readyFrame || (pool && pool.stats().workers === 0)) fail();
        };

        const palette = buildPalette(MIDDAY);
        view = createStreamView(loaded.data, pool, palette, mask, {
          width: FRAME_W,
          height: FRAME_H,
          sites: loaded.manifest.sites,
          layers: makeLayers({
            seed: loaded.manifest.seed,
            n: loaded.data.n,
            sites: loaded.manifest.sites,
            land: loaded.data,
            wonders: wondersOf(loaded.manifest),
            discover: (id, label) => {
              discoveries.discover(id, label);
            },
            // ?sights=all shows every rare sight at once, to look them over without waiting for them.
            forceSights: new URLSearchParams(window.location.search).get("sights") === "all",
          }),
          onLayerError: (name, message) => console.warn(`live layer ${name}: ${message}`),
        });
        flight = startState(loaded.manifest.start, view);
        worldN = loaded.data.n;
        const sky = createSky(
          loaded.manifest.seed,
          loaded.data.n,
          styleFrom(new URLSearchParams(window.location.search).get("clouds")),
          loaded.manifest.start,
        );

        const dragon = createDragon(worldN);

        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2d");
        imageData = ctx.createImageData(FRAME_W, FRAME_H);
        const buffer = new Uint32Array(imageData.data.buffer);

        const tick = (t: number) => {
          if (!alive || !view || !flight || !pool || !imageData) return;
          const work = performance.now();
          const dt = lastT ? (t - lastT) / 1000 : 0;
          lastT = t;

          flight = stepFlight(flight, inputFromKeys(keys), dt, view, worldN);
          view.setCamera(flight.x, flight.y - flight.alt / 0.8);
          view.update(Math.cos(flight.heading) * flight.speed, Math.sin(flight.heading) * flight.speed);
          view.frame(frame, t / 1000, {
            x: flight.x,
            y: flight.y,
            alt: flight.alt,
            heading: flight.heading,
            speed: flight.speed,
          });
          const skyStart = performance.now();
          sky.draw(frame, view.rect(), t / 1000, "below");
          const skyBelow = performance.now() - skyStart;
          dragon.step(flight, Math.min(dt, 0.1));
          dragon.draw(frame, view.rect(), flight, view);
          const skyAgain = performance.now();
          sky.draw(frame, view.rect(), t / 1000, "above");
          if (probe) probe.skyMs.push(skyBelow + performance.now() - skyAgain);
          buffer.set(frame);
          ctx.putImageData(imageData, 0, 0);

          const ready = view.ready();
          if (ready) readyFrame = true;
          if (probe) {
            probe.frameMs.push(performance.now() - work);
            probe.frames++;
            if (!ready) probe.hazeFrames++;
            else if (probe.readyAt === null) probe.readyAt = performance.now();
          }

          if (t - lastCaptionPoll >= 250) {
            lastCaptionPoll = t;
            const cap = discoveries.caption();
            if (cap !== lastPolledCaption) {
              lastPolledCaption = cap;
              if (cap !== null) {
                setDiscoveryCaption(cap);
                setDiscoveryCaptionVisible(true);
              } else {
                setDiscoveryCaptionVisible(false);
              }
            }
          }

          if (statsOn) {
            fpsFrames++;
            if (t - fpsLast >= 500) {
              const ps = pool.stats();
              const vs = view.stats();
              setStats({
                fps: Math.round((fpsFrames * 1000) / (t - fpsLast)),
                pool: `in ${ps.inFlight} q ${ps.queued} baked ${ps.baked} ${ps.bakeMs.toFixed(0)}ms`,
                view: `chunks ${vs.chunks} ${vs.bakeMs.toFixed(0)}ms cache ${view.cached()}`,
              });
              fpsFrames = 0;
              fpsLast = t;
            }
          }

          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        fail();
      }
    })();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      pool?.dispose();
      window.removeEventListener("resize", recomputeScale);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  if (failed) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#f0e8d2",
          fontFamily: fell.style.fontFamily,
          color: "#2e2a24",
        }}
      >
        <p>{LOAD_FAILED}</p>
        <Link href="/" style={{ color: "#2e2a24", marginTop: "1rem" }}>
          Back to the site
        </Link>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#f0e8d2",
        position: "relative",
      }}
    >
      <canvas
        ref={canvasRef}
        width={FRAME_W}
        height={FRAME_H}
        style={{
          width: FRAME_W * scale,
          height: FRAME_H * scale,
          imageRendering: "pixelated",
        }}
      />
      {discoveryCaption !== null ? (
        <p
          style={{
            position: "fixed",
            top: "1.25rem",
            left: "50%",
            transform: "translateX(-50%)",
            margin: 0,
            fontFamily: fell.style.fontFamily,
            color: "#2e2a24",
            fontSize: "0.95rem",
            pointerEvents: "none",
            background: "rgba(240, 232, 210, 0.85)",
            padding: "0.25rem 0.9rem",
            borderRadius: "2px",
            opacity: discoveryCaptionVisible ? 1 : 0,
            transition: "opacity 400ms",
          }}
        >
          {discoveryCaption}
        </p>
      ) : null}
      <p
        style={{
          position: "fixed",
          bottom: "1.25rem",
          left: "50%",
          transform: "translateX(-50%)",
          margin: 0,
          fontFamily: fell.style.fontFamily,
          color: "rgba(46, 42, 36, 0.8)",
          fontSize: "0.95rem",
          pointerEvents: "none",
          // A strip of paper behind the line, so it reads over the land.
          background: "rgba(240, 232, 210, 0.82)",
          padding: "0.15rem 0.7rem",
          borderRadius: "2px",
        }}
      >
        Arrow keys steer · Up to speed up · Down to slow · Esc to leave
      </p>
      {stats ? (
        <div
          style={{
            position: "fixed",
            top: "0.5rem",
            left: "0.5rem",
            fontFamily: "monospace",
            fontSize: "11px",
            color: "#2e2a24",
            background: "rgba(240, 232, 210, 0.85)",
            padding: "0.35rem 0.5rem",
            lineHeight: 1.4,
          }}
        >
          <div>fps {stats.fps}</div>
          <div>{stats.pool}</div>
          <div>{stats.view}</div>
        </div>
      ) : null}
    </div>
  );
}