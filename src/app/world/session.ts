// The flight itself: loads the world, runs the frame loop, takes the dragon through its landing phases and draws the
// guides by it. Plain TypeScript with no React in it: the page's hooks start a session and mirror what it reports.

import { buildPalette, MIDDAY } from "../../world/render/palette";
import type { FlightState } from "../../world/runtime/flight";
import { startState } from "../../world/runtime/flight";
import { makeLayers } from "../../world/live/registry";
import { wondersOf } from "../../world/pack/manifest";
import { LOAD_FAILED, loadWorld } from "../../world/runtime/load";
import { createPool, type WorkerLike } from "../../world/runtime/pool";
import { createRegionLand } from "../../world/runtime/regionLand";
import { createDragon } from "../../world/dragon/index";
import { imageOn } from "../../world/dragon/parts";
import { createDiscoveries } from "../../world/runtime/discoveries";
import { createStreamView } from "../../world/runtime/stream";
import { createSky } from "../../world/sky/sky";
import { styleFrom } from "../../world/sky/styles";
import { anchorOf, restRadius, type Anchor } from "../../world/sites/anchor";
import { advance, cameraAt, easeFocus, land, offered, pullUp, restShare, takeOff, type Phase, type Target } from "../../world/sites/landing";
import { discoveryOf, kindName, type Landmark, type LandmarkSet } from "../../world/sites/landmarks";
import { blit } from "../../world/controls/blit";
import { chooseSlot, clampInto, guideFor, slotAt, SLOTS, SLOTS_HIGH, type Device, type Slot } from "../../world/controls/guides";
import { LESSON_KEY, newLesson, stepLesson } from "../../world/controls/lesson";
import type { Options } from "../../world/controls/options";
import { createControls } from "./controls";
import { storage } from "./optionsStore";

export const FRAME_W = 400;
export const FRAME_H = 225;
/** ?at=<site id> starts this many cells south of the site, heading north. */
const AT_SOUTH = 150;
/** The camera settles on this share of the landmark's height over its pad. */
const FOCUS_HEIGHT = 0.35;
/** Below this width the Codex is a sheet along the bottom (codex.module.css). */
const NARROW = 760;
/** The body's joints a guide keeps clear of: this many, this many cells apart (about the dragon's length). */
const BODY_JOINTS = 16;
const BODY_SPACING = 5.5;
/** How fast a guide that has moved to another slot glides there: the share left after a second is e^−GLIDE. */
const GLIDE = 10;

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
  /** The phase changed. `at` is the landmark rested at, once landed; null otherwise. */
  phase(kind: PhaseKind, at: Landmark | null): void;
  /** The discovery caption: a line to show, or null to let it fade. */
  caption(text: string | null): void;
  /** With ?stats, twice a second. */
  stats(stats: FlightStats): void;
  /** The guide by the dragon in words, when it changes; "" when none shows. */
  say(text: string): void;
  /** The device the guides are drawn for. */
  device(d: Device): void;
  /** The options key or the pad's Menu was pressed. */
  toggleOptions(): void;
}

export interface FlightSetup {
  /** The landmarks and what each holds, worked out at build time; null when the build had no world. */
  landmarks: LandmarkSet | null;
  /** True while the terminal is open: it takes every key, and Esc closes it. */
  terminalOpen(): boolean;
  closeTerminal(): void;
  /** True while the options panel is open: the flight takes no keys, and the dragon cruises on. */
  optionsOpen(): boolean;
  /** The options in force, read each frame. */
  options(): Options;
}

export interface FlightSession {
  /** Lands at the landmark on offer, if any. */
  land(): void;
  /** Takes off from the landmark the dragon rests at. */
  takeOff(): void;
  /** Starts the first-flight lesson again. */
  teachAgain(): void;
  /** Stops the frame loop and the workers, and lets go of the window's keys. */
  dispose(): void;
}

interface FlightProbe {
  navStart: number;
  readyAt: number | null;
  frameMs: number[];
  /** Main-thread ms the sky's two passes took, per frame. */
  skyMs: number[];
  /** Main-thread ms the controls, the lesson and the guide took, per frame. */
  guideMs: number[];
  hazeFrames: number;
  frames: number;
  baked: () => number;
  error: string | null;
  workerErrors: string[];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Where the camera sits off the landmark so it shows clear of the Codex: west of a side panel, above a bottom sheet. */
function codexShift(): { x: number; y: number } {
  return window.innerWidth >= NARROW ? { x: 0.16 * FRAME_W, y: 0 } : { x: 0, y: 50 };
}

/** What the land prompt names: the project kept there, About me at the abbey, or the landmark itself. */
function offerName(l: Landmark | undefined): string {
  if (!l) return "";
  if (l.holds.kind === "project") return l.holds.project.name;
  if (l.holds.kind === "about") return "about me";
  return `the ${kindName(l.type)}`;
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
  const store = storage();

  let alive = true;
  let raf = 0;
  let pool: ReturnType<typeof createPool> | null = null;
  // With ?stats the page reports to scripts/world-fly.mjs through window.__flight.
  const probe: FlightProbe | null = statsOn
    ? { navStart: 0, readyAt: null, frameMs: [], skyMs: [], guideMs: [], hazeFrames: 0, frames: 0, baked: () => pool?.stats().baked ?? 0, error: null, workerErrors: [] }
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

  // The first-flight lesson, until it has been learned once.
  let lesson = newLesson(store?.getItem(LESSON_KEY) === "learned");
  let lessonStored = lesson.stage === "done";

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

  const controls = createControls(canvas, FRAME_W, FRAME_H, {
    busy: () => (setup.optionsOpen() ? "options" : setup.terminalOpen() ? "terminal" : null),
    closeTerminal: setup.closeTerminal,
    phase: () => phase.kind,
    options: setup.options,
    land: doLand,
    takeOff: doTakeOff,
    pullUp: doPullUp,
    leave: () => {
      window.location.href = "/";
    },
    toggleOptions: events.toggleOptions,
    device: events.device,
  });

  const discoveries = createDiscoveries(store, () => performance.now());

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
    const clock = { last: 0, focus: 0, fpsFrames: 0, fpsLast: 0, captionPoll: 0, caption: undefined as string | null | undefined, say: "" };
    // Where the guide stands: its slot round the head, where it was drawn, and what is left of a glide between slots.
    const place = { slot: null as Slot | null, x: 0, y: 0, carryX: 0, carryY: 0 };

    const tick = (t: number) => {
      if (!alive || !flight) return;
      const work = performance.now();
      const dt = clock.last ? (t - clock.last) / 1000 : 0;
      clock.last = t;
      const options = setup.options();
      const reduced = options.motion === "reduced";
      const controlsStart = performance.now();
      const asked = controls.frame();
      const controlsMs = performance.now() - controlsStart;

      const stepped = advance(phase, flight, asked.input, dt, view, worldN, targets);
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
      const settling = phase.kind !== "flying";
      // Under reduced motion the camera cuts to the landmark and back instead of swooping.
      clock.focus = reduced ? (settling ? 1 : 0) : easeFocus(clock.focus, settling, dt);
      const camera = cameraAt(flight, focusSite, clock.focus, worldN);
      view.setCamera(camera.x, camera.y);
      const moving = phase.kind === "landed" ? 0 : flight.speed;
      view.update(Math.cos(flight.heading) * moving, Math.sin(flight.heading) * moving);
      view.frame(frame, t / 1000, { x: flight.x, y: flight.y, alt: flight.alt, heading: flight.heading, speed: flight.speed });
      const rect = view.rect();
      const skyStart = performance.now();
      sky.draw(frame, rect, t / 1000, "below");
      const skyBelow = performance.now() - skyStart;
      dragon.step(flight, Math.min(dt, 0.1), restShare(phase));
      dragon.draw(frame, rect, flight, view, !reduced);
      const skyAgain = performance.now();
      sky.draw(frame, rect, t / 1000, "above");
      if (probe) probe.skyMs.push(skyBelow + performance.now() - skyAgain);

      // The guide by the dragon: a prompt when there is something to press, else the lesson while it is taught.
      const guideStart = performance.now();
      const offer = offered(phase, flight.x, flight.y, targets, worldN);
      const prompting = phase.kind !== "flying" || offer !== null;
      const teachable = readyFrame && asked.device !== "touch" && !setup.optionsOpen();
      lesson = stepLesson(lesson, dt, asked.held, teachable && !prompting, reduced);
      if (lesson.stage === "done" && !lessonStored) {
        lessonStored = true;
        try {
          store?.setItem(LESSON_KEY, "learned");
        } catch {
          // storage refused: the lesson shows again next visit
        }
      }
      const guide = guideFor({
        device: asked.device,
        phase: phase.kind,
        offer: offer ? offerName(byId.get(offer.id)) : null,
        lesson,
        keys: options.keys,
        family: asked.family,
        pad: asked.pad,
        lit: asked.lit,
        reduced,
      });
      if (guide) {
        const onScreen = (x: number, y: number, alt: number) => ({
          x: imageOn(Math.round(x), rect.x, worldN, FRAME_W, 1),
          y: imageOn(Math.round(y * 0.8 - alt), rect.y, worldN * 0.8, FRAME_H, 1),
        });
        const head = onScreen(flight.x, flight.y, flight.alt);
        const body = dragon.pose.chain.joints(BODY_JOINTS, BODY_SPACING).slice(1).map((j) => onScreen(j.x, j.y, j.alt));
        const { w, h } = guide.sprite;
        // Over a bottom sheet the Codex covers the foot of the frame: the take-off prompt goes above the dragon.
        const order = phase.kind === "landed" && window.innerWidth < NARROW ? SLOTS_HIGH : SLOTS;
        const slot = chooseSlot(place.slot, head, w, h, FRAME_W, FRAME_H, body, order);
        const target = slotAt(slot, head, w, h);
        // A guide that moves to another slot glides there from where it stood; one that has just appeared does not.
        if (place.slot === null || reduced) {
          place.carryX = 0;
          place.carryY = 0;
        } else if (slot !== place.slot) {
          place.carryX = place.x - target.x;
          place.carryY = place.y - target.y;
        }
        const keep = Math.exp(-GLIDE * dt);
        place.carryX *= keep;
        place.carryY *= keep;
        place.slot = slot;
        const at = clampInto({ x: Math.round(target.x + place.carryX), y: Math.round(target.y + place.carryY) }, w, h, FRAME_W, FRAME_H);
        place.x = at.x;
        place.y = at.y;
        blit(frame, FRAME_W, FRAME_H, guide.sprite, at.x, at.y, guide.alpha);
        controls.target({ x: at.x, y: at.y, w, h, tap: guide.tap });
      } else {
        place.slot = null;
        controls.target(null);
      }
      const say = guide?.say ?? "";
      if (say !== clock.say) {
        clock.say = say;
        events.say(say);
      }
      if (probe) probe.guideMs.push(performance.now() - guideStart + controlsMs);

      buffer.set(frame);
      ctx.putImageData(imageData, 0, 0);

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
    teachAgain() {
      lesson = newLesson(false);
      lessonStored = false;
      try {
        store?.setItem(LESSON_KEY, "again");
      } catch {
        // storage refused: the lesson still shows this visit
      }
    },
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      pool?.dispose();
      controls.dispose();
    },
  };
}
