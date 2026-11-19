// The flight itself: loads the world, runs the frame loop and takes the dragon through its landing phases. Plain
// TypeScript with no React in it: the page's hooks start a session and mirror what it reports.

import { buildPalette, MIDDAY } from "../../world/render/palette";
import type { FlightInput, FlightState } from "../../world/runtime/flight";
import { startState } from "../../world/runtime/flight";
import { makeLayers } from "../../world/live/registry";
import { wondersOf } from "../../world/pack/manifest";
import { LOAD_FAILED, loadWorld } from "../../world/runtime/load";
import { createPool, type WorkerLike } from "../../world/runtime/pool";
import { createRegionLand } from "../../world/runtime/regionLand";
import { createDragon } from "../../world/dragon/index";
import { createDiscoveries, type KeyValue } from "../../world/runtime/discoveries";
import { createStreamView } from "../../world/runtime/stream";
import { createSky } from "../../world/sky/sky";
import { styleFrom } from "../../world/sky/styles";
import { anchorOf, restRadius, type Anchor } from "../../world/sites/anchor";
import { advance, cameraAt, easeFocus, land, offered, pullUp, restShare, takeOff, type Phase, type Target } from "../../world/sites/landing";
import { discoveryOf, type Landmark, type LandmarkSet } from "../../world/sites/landmarks";

export const FRAME_W = 400;
export const FRAME_H = 225;
/** ?at=<site id> starts this many cells south of the site, heading north. */
const AT_SOUTH = 150;
/** The camera settles on this share of the landmark's height over its pad. */
const FOCUS_HEIGHT = 0.35;
/** Below this width the Codex is a sheet along the bottom (codex.module.css). */
const NARROW = 760;

export type PhaseKind = Phase["kind"];

export interface FlightStats {
  fps: number;
  pool: string;
  view: string;
}

/** What a session reports to the page. */
export interface FlightEvents {
  /** The world could not be loaded, or every worker was lost: the page shows LOAD_FAILED instead. */
  failed(): void;
  /** The landmark on offer changed; null when none is. */
  offer(landmark: Landmark | null): void;
  /** The phase changed. `at` is the landmark rested at, once landed; null otherwise. */
  phase(kind: PhaseKind, at: Landmark | null): void;
  /** The discovery caption: a line to show, or null to let it fade. */
  caption(text: string | null): void;
  /** With ?stats, twice a second. */
  stats(stats: FlightStats): void;
}

export interface FlightSetup {
  /** The landmarks and what each holds, worked out at build time; null when the build had no world. */
  landmarks: LandmarkSet | null;
  /** True while the terminal is open: it takes every key, and Esc closes it. */
  terminalOpen(): boolean;
  closeTerminal(): void;
}

export interface FlightSession {
  /** Lands at the landmark on offer, if any. */
  land(): void;
  /** Takes off from the landmark the dragon rests at. */
  takeOff(): void;
  /** Stops the frame loop and the workers, and lets go of the window's keys. */
  dispose(): void;
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

/** True when a key pressed on `target` belongs to it: a control or a field. (The terminal takes keys by its own flag.) */
function ownsKeys(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a, input, textarea, select, [contenteditable]") !== null;
}

/** Where the camera sits off the landmark so it shows clear of the Codex: west of a side panel, above a bottom sheet. */
function codexShift(): { x: number; y: number } {
  return window.innerWidth >= NARROW ? { x: 0.16 * FRAME_W, y: 0 } : { x: 0, y: 50 };
}

function storage(): KeyValue | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function fetchMask(): Promise<Uint8Array> {
  const res = await fetch("/world/bluenoise.bin");
  if (!res.ok) throw new Error("mask");
  return new Uint8Array(await res.arrayBuffer());
}

/** Starts a flight on `canvas`: the world loads, then the frame loop runs until `dispose`. */
export function startFlight(canvas: HTMLCanvasElement, setup: FlightSetup, events: FlightEvents): FlightSession {
  const { landmarks } = setup;
  const params = new URLSearchParams(window.location.search);
  const statsOn = params.has("stats");

  let alive = true;
  let raf = 0;
  let pool: ReturnType<typeof createPool> | null = null;
  // With ?stats the page reports to scripts/world-fly.mjs through window.__flight.
  const probe: FlightProbe | null = statsOn
    ? { navStart: 0, readyAt: null, frameMs: [], skyMs: [], hazeFrames: 0, frames: 0, baked: () => pool?.stats().baked ?? 0, error: null, workerErrors: [] }
    : null;
  if (probe) (window as unknown as { __flight: FlightProbe }).__flight = probe;

  let flight: FlightState | null = null;
  let worldN = 0;
  let groundHeight: ((x: number, y: number) => number) | null = null;

  // Landing: the phase, the landmarks it can land at, and where the camera settles while it does.
  let phase: Phase = { kind: "flying", quiet: null };
  const targets: Target[] = [];
  const byId = new Map<string, Landmark>();
  const anchors = new Map<string, Anchor | null>();
  let focusSite: { x: number; y: number; alt: number } | null = null;
  let lastOffer: string | null = null;

  const doLand = () => {
    if (!flight || !groundHeight) return;
    const next = land(phase, flight, targets, worldN);
    if (next.kind !== "landing") return;
    phase = next;
    const id = next.approach.id;
    const t = targets.find((x) => x.id === id);
    if (t) {
      const shift = codexShift();
      const height = anchors.get(id)?.height ?? 20;
      focusSite = { x: t.x + shift.x, y: t.y + shift.y, alt: groundHeight(t.x, t.y) + FOCUS_HEIGHT * height };
    }
    lastOffer = null;
    events.offer(null);
    events.phase("landing", null);
  };
  const doTakeOff = () => {
    const next = takeOff(phase);
    if (next === phase) return;
    phase = next;
    events.phase("flying", null);
  };
  const doPullUp = () => {
    const next = pullUp(phase);
    if (next === phase) return;
    phase = next;
    events.phase("flying", null);
  };

  const keys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => {
    // The terminal takes every key while it is open; Esc closes it.
    if (setup.terminalOpen()) {
      if (e.key === "Escape") {
        e.preventDefault();
        setup.closeTerminal();
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

  const discoveries = createDiscoveries(storage(), () => performance.now());

  // Stops the frame loop and the workers, and has the page show the message in place of the canvas.
  const fail = () => {
    if (probe) probe.error = LOAD_FAILED;
    cancelAnimationFrame(raf);
    pool?.dispose();
    if (alive) events.failed();
  };

  const begin = async () => {
    const loaded = await loadWorld(fetch, "/world");
    if (!alive) return;
    const mask = await fetchMask();
    if (!alive) return;

    const regions = createRegionLand(loaded.core, (rx, ry) => loaded.fetchRegion(rx, ry));
    // Boats plan on the overview: sea is 0 there, and a route treats anything under 0 as water.
    const coast = new Float32Array(loaded.core.overview.length);
    for (let i = 0; i < coast.length; i++) coast[i] = loaded.core.overview[i] === 0 ? -1 : loaded.core.overview[i];

    const size = clamp((navigator.hardwareConcurrency ?? 2) - 1, 1, 4);
    const workers = createPool(
      () => new Worker(new URL("../../world/runtime/bake.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike,
      size,
      // Workers load from blob: URLs, where a root-relative path does not resolve.
      { url: new URL(loaded.coreUrl, window.location.href).href, mask },
    );
    pool = workers;
    let readyFrame = false;
    workers.onError = (message) => {
      if (probe) probe.workerErrors.push(message);
      // Before the first full view any failure is fatal; after it, only losing every worker is, since the land would
      // never be painted again.
      if (!readyFrame || workers.stats().workers === 0) fail();
    };

    const view = createStreamView(regions, workers, buildPalette(MIDDAY), mask, {
      width: FRAME_W,
      height: FRAME_H,
      sites: loaded.manifest.sites,
      layers: makeLayers({
        seed: loaded.manifest.seed,
        n: regions.n,
        sites: loaded.manifest.sites,
        land: { gN: regions.n / 8, ground: coast },
        wonders: wondersOf(loaded.manifest),
        discover: (id, label) => {
          discoveries.discover(id, label);
        },
        // ?sights=all shows every rare sight at once, to look them over without waiting for them.
        forceSights: params.get("sights") === "all",
      }),
      onLayerError: (name, message) => console.warn(`live layer ${name}: ${message}`),
    });
    worldN = regions.n;
    groundHeight = (x, y) => view.groundHeight(x, y);

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
    const sky = createSky(loaded.manifest.seed, regions.n, styleFrom(params.get("clouds")), loaded.manifest.start);
    const dragon = createDragon(worldN);

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d");
    const imageData = ctx.createImageData(FRAME_W, FRAME_H);
    const buffer = new Uint32Array(imageData.data.buffer);
    const frame = new Uint32Array(FRAME_W * FRAME_H);
    const clock = { last: 0, focus: 0, fpsFrames: 0, fpsLast: 0, captionPoll: 0, caption: undefined as string | null | undefined };

    const tick = (t: number) => {
      if (!alive || !flight) return;
      const work = performance.now();
      const dt = clock.last ? (t - clock.last) / 1000 : 0;
      clock.last = t;

      const stepped = advance(phase, flight, inputFromKeys(keys), dt, view, worldN, targets);
      phase = stepped.phase;
      flight = stepped.s;
      if (stepped.landed) {
        const l = byId.get(stepped.landed) ?? null;
        if (l) {
          const d = discoveryOf(l);
          discoveries.discover(d.id, d.label);
        }
        events.phase("landed", l);
      }
      clock.focus = easeFocus(clock.focus, phase.kind !== "flying", dt);
      const camera = cameraAt(flight, focusSite, clock.focus, worldN);
      view.setCamera(camera.x, camera.y);
      const moving = phase.kind === "landed" ? 0 : flight.speed;
      view.update(Math.cos(flight.heading) * moving, Math.sin(flight.heading) * moving);
      view.frame(frame, t / 1000, { x: flight.x, y: flight.y, alt: flight.alt, heading: flight.heading, speed: flight.speed });
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
        events.offer(offer === null ? null : (byId.get(offer) ?? null));
      }

      const ready = view.ready();
      if (ready) readyFrame = true;
      if (probe) {
        probe.frameMs.push(performance.now() - work);
        probe.frames += 1;
        if (!ready) probe.hazeFrames += 1;
        else if (probe.readyAt === null) probe.readyAt = performance.now();
      }

      if (t - clock.captionPoll >= 250) {
        clock.captionPoll = t;
        const cap = discoveries.caption();
        if (cap !== clock.caption) {
          clock.caption = cap;
          events.caption(cap);
        }
      }

      if (statsOn) {
        clock.fpsFrames += 1;
        if (t - clock.fpsLast >= 500) {
          const ps = workers.stats();
          const vs = view.stats();
          events.stats({
            fps: Math.round((clock.fpsFrames * 1000) / (t - clock.fpsLast)),
            pool: `in ${ps.inFlight} q ${ps.queued} baked ${ps.baked} ${ps.bakeMs.toFixed(0)}ms`,
            view: `chunks ${vs.chunks} ${vs.bakeMs.toFixed(0)}ms cache ${view.cached()}`,
          });
          clock.fpsFrames = 0;
          clock.fpsLast = t;
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  begin().catch(fail);

  return {
    land: doLand,
    takeOff: doTakeOff,
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      pool?.dispose();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    },
  };
}
