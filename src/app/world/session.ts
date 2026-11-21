// The flight itself: loads the world, runs the frame loop, takes the dragon through its landing phases and draws the
// guides by it. Plain TypeScript with no React in it: the page's hooks start a session and mirror what it reports.

import type { FlightState } from "../../world/runtime/flight";
import { startState } from "../../world/runtime/flight";
import { easeHold, HELD_INPUT, holdCamera, holdStep, type HoldAt } from "../../world/runtime/hold";
import { makeLayers, type LayerContext } from "../../world/live/registry";
import type { SoundControl, SoundLog } from "../../world/sound/control";
import type { SoundState } from "../../world/sound/types";
import { wondersOf } from "../../world/pack/manifest";
import { LOAD_FAILED, loadWorld } from "../../world/runtime/load";
import { createPool, type WorkerLike } from "../../world/runtime/pool";
import { createRegionLand } from "../../world/runtime/regionLand";
import { createDragon, flownDragon } from "../../world/dragon/index";
import { RIVER_LENGTH } from "../../world/dragon/river";
import { createDiscoveries } from "../../world/runtime/discoveries";
import { createStreamView } from "../../world/runtime/stream";
import { airOf, lightFor, lightMoved, type Air } from "../../world/sky/air";
import { dayOfYear, parseTime, SEASONS, sunPhase } from "../../world/sky/clock";
import { createRain } from "../../world/sky/rain";
import { createSky } from "../../world/sky/sky";
import { styleFrom } from "../../world/sky/styles";
import { parseWeather, weatherAt } from "../../world/sky/weather";
import { restingPlaces, type Anchor } from "../../world/sites/anchor";
import { advance, cameraAt, easeFocus, land, offered, pullUp, restShare, takeOff, type Phase, type Target } from "../../world/sites/landing";
import { discoveryOf, type Landmark, type LandmarkSet } from "../../world/sites/landmarks";
import { arrowAt } from "../../world/story/arrow";
import { drawQuest, SHOW } from "../../world/story/overlay";
import { HALL_ROSE, HALL_YARD, PIECE_AT } from "../../world/gen/monuments";
import { complete, find, nextStop, type StopPlace } from "../../world/story/quest";
import { STOPS } from "../../world/story/stops";
import { blit } from "../../world/controls/blit";
import { bodyOnScreen, guideAnchor, guideFor, NO_PLACEMENT, placeGuide, SLOTS, SLOTS_HIGH, type Device } from "../../world/controls/guides";
import { LESSON_KEY, newLesson, stepLesson } from "../../world/controls/lesson";
import type { Options } from "../../world/controls/options";
import { createPacer, phoneWorkers } from "../../world/mobile/perf";
import { createControls } from "./controls";
import { storage } from "./optionsStore";
import { getQuest, setQuest } from "./questStore";
import type { TouchLayer } from "./touchLayer";

/** The frame before the window is measured (and on the server): the window's own is in runtime/fit.ts. */
export const FRAME_W = 400;
export const FRAME_H = 225;
/** ?at=<site id> starts this many cells south of the site, heading north. */
const AT_SOUTH = 150;
/** The camera settles on this share of the landmark's height over its pad. */
const FOCUS_HEIGHT = 0.35;
/** Below this width the Codex is a sheet along the bottom (codex.module.css). */
const NARROW = 760;
/** The body's joints a guide keeps clear of: this many cells apart, and this many of them (about the dragon's length). */
const BODY_SPACING = 3.5;
const BODY_JOINTS = Math.ceil(RIVER_LENGTH / BODY_SPACING) + 1;
/** A gap this long between frames, while flying on a touch screen, is a stall: the page was frozen, s. */
const STALL = 0.25;
/** Where a touch flight was, kept every so often so a reload after the phone reclaims the tab starts there. */
const WHERE_KEY = "world:where";
const WHERE_EVERY = 2;
/** Milliseconds between reads of the clock for the light and the weather (they change slowly). */
const AIR_EVERY = 200;
/** The palette is built again at most this often, ms, however fast the light moves. */
const PALETTE_EVERY = 400;
/** Let go by the title, the dragon is offered no landing for this long, ms: it has just set off, not come to land. */
const RELEASE_QUIET = 1500;

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
  /** The paper's colour in the light of the moment, as CSS: the page round the frame takes it. */
  paper(css: string): void;
  /** A touch flight's frames stopped for a while (the page was frozen): the page pauses it. */
  stall?(): void;
  /** Something worth a light tick on a phone: a landing touched down, or a discovery. */
  buzz?(what: "landed" | "discovery"): void;
  /** The lesson is done this visit, once: it just finished, or it was already learned when the world loaded. */
  lessonDone?(): void;
  /** The first full view of the land has been drawn (once): the title starts the world's arrival then. */
  ready?(): void;
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
  /** True while the flight is held still: the first card, a pause, the phone upright. The world still loads. */
  paused?(): boolean;
  /**
   * True while the world waits behind the title: the dragon holds still, low in the frame, with no guide, caption or
   * lesson by it, and no key, pad or touch reaches the flight. The world still loads, lives and draws.
   */
  held?(): boolean;
  /** Where the held head is drawn, as shares of the frame from its top-left corner: by the title's button. */
  holdAt?(): HoldAt;
  /**
   * Where Esc (flying) and the corner's Leave take the visitor: the title, on the home page. Without it the page goes
   * to "/" as now.
   */
  leave?(): void;
  /** A phone (read when the world has loaded): two bake workers, and a frame rate that steps down to 30. */
  phone?(): boolean;
  /** The touch controls, made once the canvas is in the page; null without touch flight. */
  touch?: (canvas: HTMLCanvasElement, hooks: { options(): Options; ghost(): boolean; touched(): void }) => TouchLayer | null;
  /** The frame size wanted, in frame pixels, read each frame: the session resizes its frame when it changes. */
  frame(): { w: number; h: number };
  /** The world's sound, if the page has it: its ear joins the live layers, and it is given each frame. */
  sound?(): SoundControl | null;
}

export interface FlightSession {
  /** Lands at the landmark on offer, if any. */
  land(): void;
  /** Takes off from the landmark the dragon rests at. */
  takeOff(): void;
  /** Starts the first-flight lesson again. */
  teachAgain(): void;
  /** The frame being drawn, in frame pixels (the canvas's own size). */
  frameSize(): { w: number; h: number };
  /** Stops the frame loop and the workers, and lets go of the window's keys. */
  dispose(): void;
}

interface FlightProbe {
  /** The air at the last frame: sun phase, darkness, rain, mist, cloud. */
  air: Air | null;
  /** Main-thread ms each palette rebuild took. */
  paletteMs: number[];
  navStart: number;
  readyAt: number | null;
  frameMs: number[];
  /** Main-thread ms the sky's two passes took, per frame. */
  skyMs: number[];
  /** Main-thread ms the controls, the lesson and the guide took, per frame. */
  guideMs: number[];
  /** Where the guide was drawn, frame by frame: x, y, and its slot's number (−1 with no guide). */
  guideAt: number[];
  /** Main-thread ms the sound took, per frame (0 while it is off), and the kit's share of it. */
  soundMs: number[];
  soundKit: number[];
  /** What the sound did each frame, as bits (see SoundControl.work). */
  soundWork: number[];
  /** True once the sound's buffers and graphs are all made. */
  soundSettled: boolean;
  soundState: SoundState;
  /** The flight as recorded for the sound bench, with ?soundlog. */
  soundLog: SoundLog | null;
  hazeFrames: number;
  frames: number;
  baked: () => number;
  error: string | null;
  workerErrors: string[];
  /** Where the flight is, for the tests: position, heading, speed, phase, whether a pause holds it still, and whether the title holds it. */
  state?: () => { x: number; y: number; heading: number; speed: number; phase: string; paused: boolean; workers: number; rate: number; held: boolean };
  /** The quest's arrow this frame (null when none shows), the stop it points to, and the stops found: for the tests. */
  quest?: { arrow: { mode: string; x: number; y: number; angle: number } | null; next: string | null; nextAt: { x: number; y: number } | null; found: string[]; offer: string | null };
  /** The landmarks the build placed, and what each holds, for the end-to-end tests. */
  landmarks?: { id: string; holds: string; name: string | null }[];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Where the camera sits off the landmark so it shows clear of the Codex, in a frame `w` pixels wide: west of a side
 * panel, above a bottom sheet.
 */
function codexShift(w: number): { x: number; y: number } {
  return window.innerWidth >= NARROW ? { x: 0.16 * w, y: 0 } : { x: 0, y: 50 };
}

/** What the land prompt names: about me, the projects, or the stop's own name. */
function offerName(l: Landmark | undefined): string {
  if (!l) return "";
  if (l.holds.kind === "about") return "about me";
  if (l.holds.kind === "hall") return "the projects";
  for (const stop of STOPS) if (stop.key === l.holds.stop) return stop.name;
  return "";
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
    ? {
      air: null, paletteMs: [], navStart: 0, readyAt: null, frameMs: [], skyMs: [], guideMs: [], guideAt: [], soundMs: [], soundKit: [], soundWork: [], soundSettled: false, soundState: "off", soundLog: null, hazeFrames: 0, frames: 0,
      baked: () => pool?.stats().baked ?? 0, error: null, workerErrors: [],
    }
    : null;
  if (probe) (window as unknown as { __flight: FlightProbe }).__flight = probe;
  if (probe) {
    probe.state = () => ({
      x: flight?.x ?? 0,
      y: flight?.y ?? 0,
      heading: flight?.heading ?? 0,
      speed: flight?.speed ?? 0,
      phase: phase.kind,
      paused: isPaused(),
      workers: pool?.stats().workers ?? 0,
      rate: pacerRate(),
      held: setup.held?.() ?? false,
    });
    probe.landmarks = (landmarks?.landmarks ?? []).map((l) => ({
      id: l.id,
      holds: l.holds.kind,
      name: l.holds.kind === "stop" ? l.holds.stop : null,
    }));
  }

  let flight: FlightState | null = null;
  let worldN = 0;
  let groundHeight: ((x: number, y: number) => number) | null = null;

  // Landing: the phase, the landmarks it can land at, and where the camera settles while it does.
  let phase: Phase = { kind: "flying", quiet: null };
  const targets: Target[] = [];
  const byId = new Map<string, Landmark>();
  const anchors = new Map<string, Anchor | null>();
  let focusSite: { x: number; y: number; alt: number } | null = null;
  // The frame: its size now, which the frame loop changes when the page asks for another.
  let fw = FRAME_W, fh = FRAME_H;

  // The first-flight lesson, until it has been learned once.
  let lesson = newLesson(store?.getItem(LESSON_KEY) === "learned");
  let lessonStored = lesson.stage === "done";
  // Told to the page once this visit.
  let lessonNoted = false;
  const noteLesson = () => {
    if (lessonNoted) return;
    lessonNoted = true;
    events.lessonDone?.();
  };

  // Touch flight: the controls, whether they take touches this frame, and the frame's dt for them.
  const isPaused = setup.paused ?? (() => false);
  // The phone pacer's cap, for the probe; 60 where there is none.
  let pacerRate: () => number = () => 60;
  let touchLive = false;
  let touchDt = 0;
  const touchLayer = setup.touch
    ? setup.touch(canvas, { options: setup.options, ghost: () => lesson.stage !== "done", touched: () => undefined })
    : null;

  const doLand = () => {
    if (!flight || !groundHeight) return;
    const next = land(phase, flight, targets, worldN);
    if (next.kind !== "landing") return;
    phase = next;
    const id = next.approach.id;
    const t = targets.find((x) => x.id === id);
    if (t) {
      const shift = codexShift(fw);
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

  const controls = createControls(canvas, {
    busy: () => (setup.optionsOpen() ? "options" : setup.terminalOpen() ? "terminal" : setup.held?.() ? "held" : null),
    closeTerminal: setup.closeTerminal,
    phase: () => phase.kind,
    options: setup.options,
    land: doLand,
    takeOff: doTakeOff,
    pullUp: doPullUp,
    leave: () => {
      if (setup.leave) setup.leave();
      else window.location.href = "/";
    },
    toggleOptions: events.toggleOptions,
    device: events.device,
    touch: () => (touchLayer && touchLive ? touchLayer.frame(touchDt) : null),
    heading: () => flight?.heading ?? 0,
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

    // A phone bakes with two workers: iOS reports four cores on every iPhone, and each worker holds 30–50 MB.
    const isPhone = setup.phone?.() ?? false;
    const size = isPhone
      ? phoneWorkers((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
      : clamp((navigator.hardwareConcurrency ?? 2) - 1, 1, 4);
    const workers = createPool(
      () => new Worker(new URL("../../world/runtime/bake.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike,
      size,
      // Workers load from blob: URLs, where a root-relative path does not resolve.
      { url: new URL(loaded.coreUrl, window.location.href).href, mask },
    );
    pool = workers;
    let readyFrame = false;
    // The title is told once, on the first frame the land is fully drawn.
    let readySent = false;
    workers.onError = (message) => {
      if (probe) probe.workerErrors.push(message);
      // Before the first full view any failure is fatal; after it, only losing every worker is, since the land would
      // never be painted again.
      if (!readyFrame || workers.stats().workers === 0) fail();
    };

    // The light and weather: the visitor's own clock (its date sets how long the day is) and the weather everyone
    // shares at this moment. ?time= and ?weather= hold either still, for testing and screenshots.
    const today = new Date();
    const fixedTime = parseTime(params.get("time"), dayOfYear(today.getFullYear(), today.getMonth() + 1, today.getDate()));
    const fixedWeather = parseWeather(params.get("weather"));
    const seed = loaded.manifest.seed;
    const airNow = (): Air => {
      const d = new Date();
      const doy = dayOfYear(d.getFullYear(), d.getMonth() + 1, d.getDate());
      const hour = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
      // Always summer, the season the world was tuned in: seasons do not follow the clock.
      return airOf(fixedTime ?? sunPhase(hour, doy), SEASONS.summer, fixedWeather ?? weatherAt(d.getTime() / 1000, seed));
    };
    const paperCss = (cream: number): string => `rgb(${cream & 255} ${(cream >>> 8) & 255} ${(cream >>> 16) & 255})`;
    const light = { built: airNow(), air: null as Air | null, airAt: 0, buildAt: 0, lit: null as ReturnType<typeof lightFor> | null };
    light.air = light.built;
    light.lit = lightFor(light.built);
    events.paper(paperCss(light.lit.cream));

    const wanted = setup.frame();
    fw = wanted.w;
    fh = wanted.h;
    // The stops, read into byId with the other landmarks. The live layer is fixed with the view below, so this is
    // before that; the landing places are filled once the world size is known.
    const stops: StopPlace[] = [];
    // A find being taken: its key, where its piece sat (cells, and height over the ground), and when.
    let taking: { key: StopPlace["key"]; x: number; y: number; z: number; t0: number } | null = null;
    const drawnStops: { key: StopPlace["key"]; x: number; y: number; baked: boolean }[] = [];
    let liveHall: { x: number; y: number } | undefined;
    let bakedHall: { id: string; x: number; y: number } | undefined;
    if (landmarks && landmarks.worldId === loaded.manifest.worldId) {
      for (const l of landmarks.landmarks) {
        byId.set(l.id, l);
        if (l.holds.kind === "stop") {
          stops.push({ key: l.holds.stop, x: l.x, y: l.y });
          // From the manifest, its monument is baked into the world; from places.json, the layer draws it whole.
          drawnStops.push({ key: l.holds.stop, x: l.x, y: l.y, baked: !l.live });
        }
        if (l.holds.kind === "hall" && l.live) liveHall = { x: l.x, y: l.y };
        else if (l.holds.kind === "hall" && l.type === "hall") bakedHall = { id: l.id, x: l.x, y: l.y };
      }
    }
    const layerContext: LayerContext = {
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
      structures: loaded.core.world.built?.built.structures,
      ...(stops.length > 0 || liveHall || bakedHall
        ? { story: { stops: drawnStops, hall: liveHall, bakedHall, found: () => getQuest().found } }
        : {}),
    };
    const sound = setup.sound?.() ?? null;
    if (probe) probe.soundLog = sound?.log() ?? null;
    const view = createStreamView(regions, workers, light.lit.palette, mask, {
      width: fw,
      height: fh,
      sites: loaded.manifest.sites,
      // The sound's ear comes last: it draws nothing, and keeps what the frame saw.
      layers: sound ? [...makeLayers(layerContext), sound.ear] : makeLayers(layerContext),
      onLayerError: (name, message) => console.warn(`live layer ${name}: ${message}`),
    });
    view.setLight(light.lit.palette, light.lit.cream, light.built);
    sound?.world(layerContext, loaded.manifest.worldId);
    worldN = regions.n;
    groundHeight = (x, y) => view.groundHeight(x, y);

    // The landmarks the build placed, if they belong to this world: each coils round its own building, the town
    // in its harbour (sites/anchor.ts).
    if (landmarks && landmarks.worldId === loaded.manifest.worldId) {
      const places = restingPlaces(landmarks.landmarks, loaded.core.world.built?.built, worldN);
      for (const t of places.targets) targets.push(t);
      for (const [id, a] of places.anchors) anchors.set(id, a);
    }
    // With the five found, the dragon comes down at the hall in its yard, where the rose window's light falls, and
    // curls up there: the hall's landing rings the yard, close.
    const toYard = () => {
      if (!bakedHall || !complete(getQuest())) return;
      const t = targets.find((x) => x.id === bakedHall!.id);
      if (!t) return;
      t.x = bakedHall.x + HALL_YARD.dx;
      // The middle of the light on the ground (live/story.ts, a fan 13 px deep from the gable), ringed once: the
      // dragon lies in one loop round it, head to tail, and the window's colours show inside and either side.
      t.y = bakedHall.y + HALL_ROSE.dy + 9;
      t.radius = HALL_YARD.rx;
    };
    toYard();

    // ?at=<id> starts just south of a site, heading for it: a preview, like ?sights=all. A stop's id is not a
    // site in the manifest; the landmark of that id is started the same way.
    const at = params.get("at");
    const atSite = at ? loaded.manifest.sites.find((s) => s.id === at) : undefined;
    const atMark = !atSite && at ? byId.get(at) : undefined;
    const where = !atSite && !atMark && setup.touch ? savedWhere(worldN) : null;
    const southOf = (x: number, y: number) => ({ x, y: (y + AT_SOUTH) % worldN, dx: 0, dy: -1 });
    const start = atSite ? southOf(atSite.x, atSite.y) : atMark ? southOf(atMark.x, atMark.y) : where ?? loaded.manifest.start;
    // Held from the start, it is already stopped, and its body lies behind its head: with no path the body would trail
    // due west.
    const heldAtStart = setup.held?.() ?? false;
    flight = startState(start, view);
    if (heldAtStart) flight = { ...flight, speed: 0 };
    const sky = createSky(loaded.manifest.seed, regions.n, styleFrom(params.get("clouds")), loaded.manifest.start);
    const dragon = heldAtStart ? flownDragon(worldN, flight) : createDragon(worldN);
    const rain = createRain(seed);

    canvas.width = fw;
    canvas.height = fh;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d");
    let imageData = ctx.createImageData(fw, fh);
    let buffer = new Uint32Array(imageData.data.buffer);
    let frame = new Uint32Array(fw * fh);
    /** A frame of w × h from now on: the canvas, the buffers and the view, on the same camera point. */
    const resize = (w: number, h: number) => {
      fw = w;
      fh = h;
      canvas.width = w;
      canvas.height = h;
      imageData = ctx.createImageData(w, h);
      buffer = new Uint32Array(imageData.data.buffer);
      frame = new Uint32Array(w * h);
      view.resize(w, h);
    };
    const clock = {
      last: 0, focus: 0, fpsFrames: 0, fpsLast: 0, captionPoll: 0, caption: undefined as string | null | undefined, say: "", where: 0, wasPaused: true,
      // When the title last let the dragon go (never, on /world).
      wasHeld: heldAtStart, released: -Infinity,
      // The camera's share of the way down to the title's framing. It starts there when the world opens held.
      hold: heldAtStart ? 1 : 0,
    };
    const pacer = isPhone ? createPacer() : null;
    if (pacer) pacerRate = () => pacer.rate();
    // Where the guide stands: its slot round the head, where it was drawn, and what is left of a glide between slots.
    let place = NO_PLACEMENT;

    const tick = (t: number) => {
      if (!alive || !flight) return;
      if (pacer && !pacer.want(t)) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const work = performance.now();
      const want = setup.frame();
      if (want.w !== fw || want.h !== fh) resize(want.w, want.h);
      const paused = isPaused();
      const held = setup.held?.() ?? false;
      const gap = clock.last ? (t - clock.last) / 1000 : 0;
      // Held still, the flight does not move; coming back, it starts from now, not from the pause.
      const dt = paused || clock.wasPaused ? 0 : gap;
      if (!paused && !clock.wasPaused && setup.touch && gap > STALL && document.visibilityState === "visible") events.stall?.();
      clock.wasPaused = paused;
      if (clock.wasHeld && !held) clock.released = t;
      clock.wasHeld = held;
      clock.last = t;
      touchDt = dt;
      // Touch counts only while flying with touch the last device used: a desktop never pays for the layout.
      touchLive = touchLayer !== null && !paused && !held && phase.kind === "flying" && controls.device() === "touch";
      touchLayer?.setLive(touchLive);
      const options = setup.options();
      const reduced = options.motion === "reduced";

      // The air, read from the clock a few times a second. The palette is built again only once the light has moved a
      // step you could see.
      if (t - light.airAt >= AIR_EVERY) {
        light.air = airNow();
        light.airAt = t;
      }
      const air = light.air ?? light.built;
      if (lightMoved(light.built, air) && t - light.buildAt >= PALETTE_EVERY) {
        const p0 = performance.now();
        light.lit = lightFor(air);
        light.built = air;
        light.buildAt = t;
        events.paper(paperCss(light.lit.cream));
        if (probe) probe.paletteMs.push(performance.now() - p0);
      }
      if (light.lit) view.setLight(light.lit.palette, light.lit.cream, air);
      sky.setAir(air);
      dragon.setAir(air);
      if (probe) probe.air = air;
      const controlsStart = performance.now();
      const asked = controls.frame();
      const controlsMs = performance.now() - controlsStart;

      // Behind the title the dragon is always flying, then glides to a stop: a landing pulls up, a rest takes off.
      if (held && phase.kind === "landing") doPullUp();
      else if (held && phase.kind === "landed") doTakeOff();
      const stepped = advance(phase, flight, held ? HELD_INPUT : asked.input, dt, view, worldN, targets);
      phase = stepped.phase;
      flight = holdStep(stepped.s, held, dt);
      if (stepped.landed) {
        const l = byId.get(stepped.landed) ?? null;
        if (l) {
          const d = discoveryOf(l);
          discoveries.discover(d.id, d.label);
          if (l.holds.kind === "stop") {
            const key = l.holds.stop;
            // The first time only, its piece is taken: it flies from its place on the monument to its slot.
            if (!getQuest().found.includes(key)) {
              const o = PIECE_AT[key];
              taking = { key, x: l.x + o.dx, y: l.y + o.dy, z: o.z, t0: t / 1000 };
            }
            setQuest(find(getQuest(), key));
            toYard();
          }
        }
        events.phase("landed", l);
        events.buzz?.("landed");
      }
      if (setup.touch && phase.kind === "flying" && t / 1000 - clock.where >= WHERE_EVERY) {
        clock.where = t / 1000;
        saveWhere(flight, worldN);
      }
      const settling = phase.kind !== "flying";
      // Under reduced motion the camera cuts to the landmark and back instead of swooping.
      clock.focus = reduced ? (settling ? 1 : 0) : easeFocus(clock.focus, settling, dt);
      // The camera eases down while the title holds the world, and back up once it is let go.
      clock.hold = easeHold(clock.hold, held, dt, reduced);
      const camera = holdCamera(cameraAt(flight, focusSite, clock.focus, worldN), clock.hold, fw, fh, setup.holdAt?.());
      view.setCamera(camera.x, camera.y);
      const moving = phase.kind === "landed" ? 0 : flight.speed;
      view.update(Math.cos(flight.heading) * moving, Math.sin(flight.heading) * moving);
      view.frame(frame, t / 1000, { x: flight.x, y: flight.y, alt: flight.alt, heading: flight.heading, speed: flight.speed });
      const rect = view.rect();
      const skyStart = performance.now();
      // The rain falls under the clouds and the flier: they hide it, never it them.
      // Landing, the clouds part over the place, as far as the camera has settled on it, so what is there is seen.
      const landingAt = phase.kind === "landing" ? phase.approach.id : phase.kind === "landed" ? phase.id : null;
      const spot = landingAt && groundHeight ? targets.find((x) => x.id === landingAt) : undefined;
      sky.clear(spot && groundHeight ? { ...guideAnchor({ x: spot.x, y: spot.y, alt: groundHeight(spot.x, spot.y) }, camera, fw, fh, worldN), r: 70, amount: clock.focus } : null);
      rain(frame, rect, t / 1000, air);
      sky.draw(frame, rect, t / 1000, "below");
      const skyBelow = performance.now() - skyStart;
      if (dt > 0) dragon.step(flight, Math.min(dt, 0.1), restShare(phase));
      dragon.draw(frame, rect, flight, view, !reduced);
      const skyAgain = performance.now();
      sky.draw(frame, rect, t / 1000, "above");
      if (probe) probe.skyMs.push(skyBelow + performance.now() - skyAgain);

      // The guide by the dragon: a prompt when there is something to press, else the lesson while it is taught.
      const guideStart = performance.now();
      const offer = t - clock.released < RELEASE_QUIET ? null : offered(phase, flight.x, flight.y, targets, worldN);
      touchLayer?.setLand(offer !== null);
      const prompting = phase.kind !== "flying" || offer !== null;
      const teachable = readyFrame && !paused && !held && (asked.device !== "touch" || touchLayer !== null) && !setup.optionsOpen();
      lesson = stepLesson(lesson, dt, asked.held, teachable && !prompting, reduced);
      if (lesson.stage === "done" && !lessonStored) {
        lessonStored = true;
        try {
          store?.setItem(LESSON_KEY, "learned");
        } catch {
          // storage refused: the lesson shows again next visit
        }
        noteLesson();
      }
      const guide = paused || held ? null : guideFor({
        device: asked.device,
        phase: phase.kind,
        offer: offer ? offerName(byId.get(offer.id)) : null,
        lesson,
        keys: options.keys,
        family: asked.family,
        pad: asked.pad,
        lit: asked.lit,
        reduced,
        landedPrompt: phase.kind !== "landed" || (asked.device !== "touch" && window.innerWidth >= NARROW),
      });
      if (guide) {
        // The head in whole pixels from the camera, which sits on it in flight: the guide holds its pixel while the
        // dragon flies, and steps a whole pixel at a time as the camera eases onto a landmark.
        const anchor = guideAnchor(flight, camera, fw, fh, worldN);
        const body = bodyOnScreen(anchor, flight, dragon.pose.chain.joints(BODY_JOINTS, BODY_SPACING).slice(1), worldN);
        const { w, h } = guide.sprite;
        // Over a bottom sheet the Codex covers the foot of the frame: the take-off prompt goes above the dragon.
        const order = phase.kind === "landed" && window.innerWidth < NARROW ? SLOTS_HIGH : SLOTS;
        place = placeGuide(place, anchor, w, h, fw, fh, body, order, dt, reduced);
        blit(frame, fw, fh, guide.sprite, place.x, place.y, guide.alpha);
        controls.target({ x: place.x, y: place.y, w, h, tap: guide.tap });
        if (probe) probe.guideAt.push(place.x, place.y, place.slot === null ? -1 : SLOTS.indexOf(place.slot));
      } else {
        place = NO_PLACEMENT;
        controls.target(null);
        if (probe) probe.guideAt.push(0, 0, -1);
      }
      // The quest's marks and its arrow, over the guide and under the touch controls.
      if (!paused) {
        const quest = getQuest();
        const ground = groundHeight;
        // With the land prompt up, the place is in reach: the pointer stands down and leaves the head clear.
        const next = phase.kind === "flying" && offer === null && ground ? nextStop(quest, flight, stops, worldN) : null;
        const arrow = next && ground
          ? arrowAt(guideAnchor({ x: next.x, y: next.y, alt: ground(next.x, next.y) }, camera, fw, fh, worldN), fw, fh, 12)
          : null;
        const took = taking && ground
          ? { key: taking.key, since: t / 1000 - taking.t0, from: guideAnchor({ x: taking.x, y: taking.y, alt: ground(taking.x, taking.y) + taking.z }, camera, fw, fh, worldN) }
          : null;
        if (took && took.since > SHOW) taking = null;
        if (probe) probe.quest = { arrow, next: next?.key ?? null, nextAt: next ? { x: next.x, y: next.y } : null, found: quest.found.slice(), offer: offer?.id ?? null };
        drawQuest(frame, fw, fh, quest, arrow, t / 1000, reduced, took);
      }
      touchLayer?.draw(frame, fw, fh);
      const say = guide?.say ?? "";
      if (say !== clock.say) {
        clock.say = say;
        events.say(say);
      }
      if (probe) probe.guideMs.push(performance.now() - guideStart + controlsMs);

      buffer.set(frame);
      ctx.putImageData(imageData, 0, 0);

      // The sound, after the picture: the ear has what this frame saw.
      if (sound) {
        const soundMs = sound.frame(t / 1000, flight, restShare(phase), air);
        if (probe) {
          probe.soundMs.push(soundMs);
          probe.soundKit.push(sound.kitMs());
          probe.soundWork.push(sound.work());
          probe.soundSettled = sound.settled();
          probe.soundState = sound.state();
        }
      }
      pacer?.worked(performance.now() - work);
      const ready = view.ready();
      // Already learned before this visit: the page hears it once the land is up.
      if (ready && !readyFrame && lesson.stage === "done") noteLesson();
      if (ready) readyFrame = true;
      if (ready && !readySent) {
        readySent = true;
        events.ready?.();
      }
      if (probe) {
        probe.frameMs.push(performance.now() - work);
        probe.frames += 1;
        if (!ready) probe.hazeFrames += 1;
        else if (probe.readyAt === null) probe.readyAt = performance.now();
      }

      // No caption while the title holds the world: the poll picks up again when it is let go.
      if (!held && t - clock.captionPoll >= 250) {
        clock.captionPoll = t;
        const cap = discoveries.caption();
        if (cap !== clock.caption) {
          if (cap !== null && clock.caption !== undefined) events.buzz?.("discovery");
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
    frameSize: () => ({ w: fw, h: fh }),
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
      touchLayer?.dispose();
    },
  };
}

/** The touch flight's last saved place, if it is in this world. */
function savedWhere(n: number): { x: number; y: number; dx: number; dy: number } | null {
  try {
    const raw = window.sessionStorage.getItem(WHERE_KEY);
    if (!raw) return null;
    const w = JSON.parse(raw) as { x?: unknown; y?: unknown; h?: unknown; n?: unknown };
    if (typeof w.x !== "number" || typeof w.y !== "number" || typeof w.h !== "number" || w.n !== n) return null;
    if (!Number.isFinite(w.x) || !Number.isFinite(w.y) || !Number.isFinite(w.h)) return null;
    return { x: w.x, y: w.y, dx: Math.cos(w.h), dy: Math.sin(w.h) };
  } catch {
    return null;
  }
}

function saveWhere(s: FlightState, n: number): void {
  try {
    window.sessionStorage.setItem(WHERE_KEY, JSON.stringify({ x: s.x, y: s.y, h: s.heading, n }));
  } catch {
    // storage refused: a reload starts at the start
  }
}
