"use client";

import { IM_Fell_English } from "next/font/google";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buildPalette } from "../../world/render/palette";
import type { FlightInput, FlightState } from "../../world/runtime/flight";
import { startState, stepFlight } from "../../world/runtime/flight";
import { fitScale } from "../../world/runtime/fit";
import { LOAD_FAILED, loadWorld } from "../../world/runtime/load";
import { createPool, type WorkerLike } from "../../world/runtime/pool";
import { drawFlier } from "../../world/runtime/standin";
import { createStreamView } from "../../world/runtime/stream";
import type { StreamView } from "../../world/runtime/stream";

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

export default function Flight() {
  const searchParams = useSearchParams();
  const showStats = searchParams.has("stats");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const [failed, setFailed] = useState(false);
  const [stats, setStats] = useState({ fps: 0, pool: "", view: "" });

  useEffect(() => {
    const recomputeScale = () => {
      setScale(fitScale(window.innerWidth, window.innerHeight, FRAME_W, FRAME_H));
    };
    recomputeScale();
    window.addEventListener("resize", recomputeScale);

    const canvas = canvasRef.current;
    if (!canvas) {
      window.removeEventListener("resize", recomputeScale);
      return;
    }

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

    const fail = () => {
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
          { url: loaded.binUrl, mask },
        );
        pool.onError = () => {
          if (!readyFrame) fail();
        };

        const palette = buildPalette({ time: 0.5, season: 0.25, overcast: 0 });
        view = createStreamView(loaded.data, pool, palette, mask, {
          width: FRAME_W,
          height: FRAME_H,
          sites: loaded.manifest.sites,
        });
        flight = startState(loaded.manifest.start, view);
        worldN = loaded.data.n;

        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2d");
        imageData = ctx.createImageData(FRAME_W, FRAME_H);
        const buffer = new Uint32Array(imageData.data.buffer);

        const tick = (t: number) => {
          if (!alive || !view || !flight || !pool || !imageData) return;
          const dt = lastT ? (t - lastT) / 1000 : 0;
          lastT = t;

          flight = stepFlight(flight, inputFromKeys(keys), dt, view, worldN);
          view.setCamera(flight.x, flight.y - flight.alt / 0.8);
          view.update(Math.cos(flight.heading) * flight.speed, Math.sin(flight.heading) * flight.speed);
          view.frame(frame, t / 1000);
          drawFlier(frame, view.rect(), flight, view);
          buffer.set(frame);
          ctx.putImageData(imageData, 0, 0);

          if (view.ready()) readyFrame = true;

          if (showStats) {
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
  }, [showStats]);

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
      <p
        style={{
          position: "fixed",
          bottom: "1.25rem",
          left: "50%",
          transform: "translateX(-50%)",
          margin: 0,
          fontFamily: fell.style.fontFamily,
          color: "rgba(46, 42, 36, 0.7)",
          fontSize: "0.95rem",
          pointerEvents: "none",
        }}
      >
        Arrow keys steer · Up to speed up · Down to slow · Esc to leave
      </p>
      {showStats ? (
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