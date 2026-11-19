"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Terminal from "../../components/terminal/Terminal";
import type { SiteInfo, SlimProject, TerminalApi } from "../../components/terminal/types";
import { getTheme, setTheme } from "../../lib/theme";
import { buildPalette, MIDDAY } from "../../world/render/palette";
import type { FlightInput, FlightState } from "../../world/runtime/flight";
import { startState } from "../../world/runtime/flight";
import { fitScale } from "../../world/runtime/fit";
import { makeLayers } from "../../world/live/registry";
import { LOAD_FAILED, loadWorld } from "../../world/runtime/load";
import { createPool, type WorkerLike } from "../../world/runtime/pool";
import { createRegionLand } from "../../world/runtime/regionLand";
import { createDragon } from "../../world/dragon/index";
import { createDiscoveries, type KeyValue } from "../../world/runtime/discoveries";
import { createStreamView } from "../../world/runtime/stream";
import type { StreamView } from "../../world/runtime/stream";
import { createSky } from "../../world/sky/sky";
import { styleFrom } from "../../world/sky/styles";
import { anchorOf, restRadius, type Anchor } from "../../world/sites/anchor";
import { advance, cameraAt, easeFocus, land, offered, pullUp, restShare, takeOff, type Phase, type Target } from "../../world/sites/landing";
import { discoveryOf, registerFrom, type Landmark, type LandmarkSet } from "../../world/sites/landmarks";
import Codex, { LandPrompt } from "./Codex";
import { fell } from "./fonts";

const FRAME_W = 400;
const FRAME_H = 225;
/** ?at=<site id> starts this many cells south of the site, heading north. */
const AT_SOUTH = 150;
/** The camera settles on this share of the landmark's height over its pad. */
const FOCUS_HEIGHT = 0.35;
/** Below this width the Codex is a sheet along the bottom (codex.module.css). */
const NARROW = 760;

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

/** True when a key pressed on `target` belongs to it: a control, a field, or the terminal. */
function ownsKeys(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a, input, textarea, select, [contenteditable], dialog") !== null;
}

/** Where the camera sits off the landmark so it shows clear of the Codex: west of a side panel, above a bottom sheet. */
function codexShift(): { x: number; y: number } {
  return window.innerWidth >= NARROW ? { x: 0.16 * FRAME_W, y: 0 } : { x: 0, y: 50 };
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

/** What the page drives from outside the frame loop: the prompt's tap and the Codex's buttons. */
interface Controls {
  land(): void;
  takeOff(): void;
}

export interface FlightProps {
  /** The landmarks and what each holds, worked out at build time; null when the build had no world. */
  landmarks: LandmarkSet | null;
  /** What the terminal at the abbey is handed, as on the home page. */
  terminal: { projects: SlimProject[]; site: SiteInfo };
}

export default function Flight({ landmarks, terminal }: FlightProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // CSS pixels per frame pixel: a whole number of device pixels, so the frame stays hard-edged at any display scaling.
  const [scale, setScale] = useState(1);
  const [failed, setFailed] = useState(false);
  // Filled from the frame loop when the page is opened with ?stats.
  const [stats, setStats] = useState<{ fps: number; pool: string; view: string } | null>(null);
  const [discoveryCaption, setDiscoveryCaption] = useState<string | null>(null);
  const [discoveryCaptionVisible, setDiscoveryCaptionVisible] = useState(false);
  // The landmark on offer, the phase (for the hint), and the landmark landed at (for the Codex).
  const [prompt, setPrompt] = useState<Landmark | null>(null);
  const [phaseKind, setPhaseKind] = useState<Phase["kind"]>("flying");
  const [landedAt, setLandedAt] = useState<Landmark | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const controls = useRef<Controls | null>(null);
  // Read by the key handler, which outlives renders.
  const terminalOpenRef = useRef(false);
  const terminalTrigger = useRef<HTMLElement | null>(null);

  const api: TerminalApi = useMemo(
    () => ({
      openUrl: (url) => {
        window.open(url, "_blank", "noopener");
      },
      getProjects: () => terminal.projects,
      getTheme,
      setTheme,
      close: () => {
        terminalOpenRef.current = false;
        setTerminalOpen(false);
      },
      site: terminal.site,
    }),
    [terminal],
  );

  const openTerminal = (trigger: HTMLElement) => {
    terminalTrigger.current = trigger;
    terminalOpenRef.current = true;
    setTerminalOpen(true);
  };
  const closeTerminal = () => {
    terminalOpenRef.current = false;
    setTerminalOpen(false);
    const trigger = terminalTrigger.current;
    if (trigger) window.setTimeout(() => trigger.focus(), 0);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const params = new URLSearchParams(window.location.search);
    const statsOn = params.has("stats");
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

    // Landing: the phase, the landmarks it can land at, and where the camera settles while it does.
    let phase: Phase = { kind: "flying", quiet: null };
    const targets: Target[] = [];
    const byId = new Map<string, Landmark>();
    const anchors = new Map<string, Anchor | null>();
    let focus = 0;
    let focusSite: { x: number; y: number; alt: number } | null = null;
    let lastOffer: string | null = null;

    const doLand = () => {
      if (!flight || !view) return;
      const next = land(phase, flight, targets, worldN);
      if (next.kind !== "landing") return;
      phase = next;
      const id = next.approach.id;
      const t = targets.find((x) => x.id === id);
      if (t) {
        const shift = codexShift();
        const height = anchors.get(id)?.height ?? 20;
        focusSite = { x: t.x + shift.x, y: t.y + shift.y, alt: view.groundHeight(t.x, t.y) + FOCUS_HEIGHT * height };
      }
      lastOffer = null;
      setPrompt(null);
      setPhaseKind("landing");
    };
    const doTakeOff = () => {
      const next = takeOff(phase);
      if (next === phase) return;
      phase = next;
      terminalOpenRef.current = false;
      setTerminalOpen(false);
      setLandedAt(null);
      setPhaseKind("flying");
    };
    const doPullUp = () => {
      const next = pullUp(phase);
      if (next === phase) return;
      phase = next;
      setPhaseKind("flying");
    };
    controls.current = { land: doLand, takeOff: doTakeOff };

    const keys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      // The terminal takes every key while it is open; Esc closes it.
      if (terminalOpenRef.current) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeTerminal();
        }
        return;
      }
      if (e.key === "Escape") {
        if (phase.kind === "landing") doPullUp();
        else if (phase.kind === "landed") doTakeOff();
        else window.location.href = "/";
        return;
      }
      if (e.key === " " || e.key === "Enter") {
        // A focused button or link acts on its own key; held keys land or take off once.
        if (ownsKeys(e.target)) return;
        e.preventDefault();
        if (e.repeat) return;
        if (phase.kind === "flying") doLand();
        else if (phase.kind === "landed") doTakeOff();
        return;
      }
      // Landed, the arrow keys read down the Codex.
      if (phase.kind !== "landed" && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
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

        const regions = createRegionLand(loaded.core, (rx, ry) => loaded.fetchRegion(rx, ry));
        // Boats plan on the overview: sea is 0 there, and a route treats anything under 0 as water.
        const coast = new Float32Array(loaded.core.overview.length);
        for (let i = 0; i < coast.length; i++) coast[i] = loaded.core.overview[i] === 0 ? -1 : loaded.core.overview[i];

        const size = clamp((navigator.hardwareConcurrency ?? 2) - 1, 1, 4);
        pool = createPool(
          () =>
            new Worker(new URL("../../world/runtime/bake.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike,
          size,
          // Workers load from blob: URLs, where a root-relative path does not resolve.
          { url: new URL(loaded.coreUrl, window.location.href).href, mask },
        );
        pool.onError = (message) => {
          if (probe) probe.workerErrors.push(message);
          // Before the first full view any failure is fatal; after it, only losing every worker is, since the
          // land would never be painted again.
          if (!readyFrame || (pool && pool.stats().workers === 0)) fail();
        };

        const palette = buildPalette(MIDDAY);
        view = createStreamView(regions, pool, palette, mask, {
          width: FRAME_W,
          height: FRAME_H,
          sites: loaded.manifest.sites,
          layers: makeLayers({
            seed: loaded.manifest.seed,
            n: regions.n,
            sites: loaded.manifest.sites,
            land: { gN: regions.n / 8, ground: coast },
            discover: (id, label) => {
              discoveries.discover(id, label);
            },
            // ?sights=all shows every rare sight at once, to look them over without waiting for them.
            forceSights: params.get("sights") === "all",
          }),
          onLayerError: (name, message) => console.warn(`live layer ${name}: ${message}`),
        });
        worldN = regions.n;

        // The landmarks the build placed, if they belong to this world: each coils round its own building.
        if (landmarks && landmarks.worldId === loaded.manifest.worldId) {
          const structures = loaded.core.world.built?.built.structures ?? [];
          for (const l of landmarks.landmarks) {
            const a = anchorOf(l, structures, worldN);
            byId.set(l.id, l);
            anchors.set(l.id, a);
            targets.push({ id: l.id, x: a?.x ?? l.x, y: a?.y ?? l.y, radius: restRadius(a, l.type) });
          }
        }

        // ?at=<site id> starts just south of a site, heading for it: a preview, like ?sights=all.
        const at = params.get("at");
        const atSite = at ? loaded.manifest.sites.find((s) => s.id === at) : undefined;
        const start = atSite ? { x: atSite.x, y: (atSite.y + AT_SOUTH) % worldN, dx: 0, dy: -1 } : loaded.manifest.start;
        flight = startState(start, view);
        const sky = createSky(
          loaded.manifest.seed,
          regions.n,
          styleFrom(params.get("clouds")),
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

          const stepped = advance(phase, flight, inputFromKeys(keys), dt, view, worldN, targets);
          phase = stepped.phase;
          flight = stepped.s;
          if (stepped.landed) {
            const l = byId.get(stepped.landed);
            if (l) {
              const d = discoveryOf(l);
              discoveries.discover(d.id, d.label);
              setLandedAt(l);
            }
            setPhaseKind("landed");
          }
          focus = easeFocus(focus, phase.kind !== "flying", dt);
          const camera = cameraAt(flight, focusSite, focus, worldN);
          view.setCamera(camera.x, camera.y);
          const moving = phase.kind === "landed" ? 0 : flight.speed;
          view.update(Math.cos(flight.heading) * moving, Math.sin(flight.heading) * moving);
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
          dragon.step(flight, Math.min(dt, 0.1), restShare(phase));
          dragon.draw(frame, view.rect(), flight, view);
          const skyAgain = performance.now();
          sky.draw(frame, view.rect(), t / 1000, "above");
          if (probe) probe.skyMs.push(skyBelow + performance.now() - skyAgain);
          buffer.set(frame);
          ctx.putImageData(imageData, 0, 0);

          const offer = offered(phase, flight.x, flight.y, targets, worldN)?.id ?? null;
          if (offer !== lastOffer) {
            lastOffer = offer;
            setPrompt(offer === null ? null : (byId.get(offer) ?? null));
          }

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
      controls.current = null;
      cancelAnimationFrame(raf);
      pool?.dispose();
      window.removeEventListener("resize", recomputeScale);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
    // `landmarks` is a build-time prop: it never changes while the page is open.
  }, [landmarks]);

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

  const hint =
    phaseKind === "landing"
      ? "Coming down · Esc to pull up"
      : phaseKind === "landed"
        ? "Space or Esc to take off"
        : "Arrow keys steer · Up to speed up · Down to slow · Esc to leave";

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
      {prompt && phaseKind === "flying" ? <LandPrompt landmark={prompt} onLand={() => controls.current?.land()} /> : null}
      {landedAt ? (
        <Codex
          landmark={landedAt}
          register={landmarks ? registerFrom(landedAt, landmarks) : []}
          onTakeOff={() => controls.current?.takeOff()}
          onOpenTerminal={openTerminal}
        />
      ) : null}
      {landedAt?.holds.kind === "about" ? <Terminal open={terminalOpen} onClose={closeTerminal} api={api} /> : null}
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
          maxWidth: "calc(100vw - 2rem)",
          textAlign: "center",
        }}
      >
        {hint}
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
