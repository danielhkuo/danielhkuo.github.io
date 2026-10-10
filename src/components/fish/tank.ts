// Browser side of the fish cards: decides when the project cards become fish
// and animates them. Loaded lazily by FishLayer, so none of it is in the page's
// first-load JavaScript, and the drawings themselves (/fish.json) are only
// fetched on a device that can show them once a card is on screen.
//
// Behaviour: a card turns into its project's fish once the visitor has pointed
// at it and moved on — its border bends into the fish's outline — and from then
// on it is a fish whenever nobody is on it. Point at it again (or tab into it)
// and it is a card for as long as you stay. Leave the page alone for IDLE_MS
// and the cards nobody has visited turn too. Scroll, click or type and every
// fish goes back to being a card. Only the project name stays up on a fish,
// moved down to a caption.
//
// The animation is a requestAnimationFrame loop that rewrites one path's `d`
// per card, deliberately not the Web Animations API: interrupting a WAAPI
// `d: path()` animation on hover visibly glitches, and a hand-run timeline
// reverses from wherever it is for free.

import { buildKeyframes, fitBox, layersAt, outlinePath, shapeAt, type Keyframes } from "@/lib/fish/morph";
import type { FishData, FishSheet } from "@/lib/fish/types";

/** How long the page must be left alone before the cards nobody has visited turn. */
const IDLE_MS = 15_000;
/**
 * After a scroll, how long a pointer "leaving" a card is put down to the page
 * moving under it rather than the visitor moving on.
 */
const SCROLL_SETTLE_MS = 250;
/** Card → fish, and fish → card. Coming back is faster: it is answering the visitor. */
const TURN_MS = 1400;
const RETURN_MS = 800;
/** The project name's size as a caption under its fish, and the gap above it, in px. */
const CAPTION_PX = 18;
const CAPTION_GAP = 8;

/**
 * What counts as the visitor being here. All but pointermove also send the
 * fish back: moving the pointer has to be free, or no fish could be reached.
 */
const ACTIVITY = ["pointermove", "pointerdown", "keydown", "wheel", "scroll", "touchstart"] as const;

interface Tenant {
  name: string;
  card: HTMLElement;
  outline: SVGPathElement;
  strokes: SVGGElement;
  /** Where the card is on the timeline: 0 a card, 1 a fish. */
  at: number;
  /** A fish whenever nobody is on it: set by a visit or by the idle turn. */
  turned: boolean;
  hovered: boolean;
  /** Null until measured, and again whenever the card changes size. */
  keys: Keyframes | null;
  points: Float32Array;
  /** The last layer amounts written, so unchanged ones are not written again. */
  shown: Record<string, number>;
  leave: () => void;
}

const tenants = new Set<Tenant>();
const onScreen = new Set<Element>();
let sheet: FishSheet | null = null;
let sheetRequested = false;
let lastActive = 0;
let lastScroll = -Infinity;
let idleTimer = 0;
let frame = 0;
let lastFrame = 0;

let finePointer: MediaQueryList;
let plainPage: MediaQueryList;
let watchSize: ResizeObserver;
let watchScreen: IntersectionObserver;

/** Fish need a pointer that can hover, and a visitor who has not asked for a plainer page. */
const allowed = () => finePointer.matches && !plainPage.matches;

/**
 * Whether the keyboard is on something in the card. Asked fresh each time
 * rather than tracked from focus events: a link focused by a mouse click only
 * becomes :focus-visible at the next key press, with no event of its own, and
 * a card must not sit pinned open because its link was once clicked.
 */
const keyboardOn = (t: Tenant) => t.card.querySelector(":focus-visible") !== null;

/** A turned card is headed for fish unless the visitor is on it or its drawing is missing. */
const goal = (t: Tenant) => (t.turned && !t.hovered && sheet?.[t.name] && !keyboardOn(t) ? 1 : 0);

const everyCard = (test: (t: Tenant) => boolean) => {
  for (const t of tenants) if (!test(t)) return false;
  return true;
};

async function loadSheet() {
  if (sheetRequested) return;
  sheetRequested = true;
  try {
    const response = await fetch("/fish.json");
    if (!response.ok) return;
    sheet = (await response.json()) as FishSheet;
  } catch {
    // No drawings, no fish: the cards simply stay cards.
    return;
  }
  for (const t of tenants) ink(t);
  // A card visited before its drawing arrived has been waiting for this.
  move();
  arm();
}

/** Put a project's strokes into its layer. They stay invisible until the timeline shows them. */
function ink(t: Tenant) {
  const data = sheet?.[t.name];
  if (!data) return;
  t.strokes.querySelector(".fish-ink")?.setAttribute("d", data.ink);
  t.strokes.querySelector(".fish-hatch")?.setAttribute("d", data.hatch);
}

/**
 * Measure a card and work out where its fish sits and how its border gets
 * there. The fish takes the card's content box, less a strip along the bottom
 * for the project name.
 */
function measure(t: Tenant, data: FishData) {
  const { card } = t;
  const style = getComputedStyle(card);
  const pad = {
    top: parseFloat(style.paddingTop),
    right: parseFloat(style.paddingRight),
    bottom: parseFloat(style.paddingBottom),
    left: parseFloat(style.paddingLeft),
  };
  const edge = card.clientLeft;
  const name = card.querySelector<HTMLElement>(".fish-name");

  // Everything below is measured from the card's padding edge. offsetTop and
  // offsetHeight ignore transforms, so the name can be mid-move while this runs.
  const floor = card.clientHeight - pad.bottom;
  let fishFloor = floor;
  if (name) {
    let nameTop = 0;
    for (let el: HTMLElement | null = name; el && el !== card; el = el.offsetParent as HTMLElement | null) {
      nameTop += el.offsetTop;
    }
    const shrink = Math.min(1, CAPTION_PX / parseFloat(getComputedStyle(name).fontSize));
    const captionTop = floor - name.offsetHeight * shrink;
    fishFloor = captionTop - CAPTION_GAP;
    card.style.setProperty("--fish-name-drop", `${captionTop - nameTop}px`);
    card.style.setProperty("--fish-name-shrink", String(1 - shrink));
  }

  // The layer's own origin is the card's border edge, hence `edge`.
  const fit = fitBox(data.w, data.h, {
    x: edge + pad.left,
    y: edge + pad.top,
    w: card.clientWidth - pad.left - pad.right,
    h: fishFloor - pad.top,
  });
  // The resting outline has to sit exactly on the CSS border it replaces, and
  // the browser paints that on whole device pixels. Cards are fractions of a
  // pixel wide in most windows, so size the outline from the snapped edges;
  // offsetWidth rounds to CSS pixels and puts a border one device pixel out.
  const rect = card.getBoundingClientRect();
  const snapped = (from: number, to: number) =>
    (Math.round(to * devicePixelRatio) - Math.round(from * devicePixelRatio)) / devicePixelRatio;
  t.keys = buildKeyframes(data, fit, snapped(rect.left, rect.right), snapped(rect.top, rect.bottom));
  t.points = new Float32Array(t.keys.n * 2);
  t.strokes.setAttribute("transform", `translate(${fit.dx} ${fit.dy}) scale(${fit.scale})`);
}

/** Write one layer amount to the card, as a custom property the stylesheet reads. */
function show(t: Tenant, layer: string, amount: number) {
  if (t.shown[layer] === amount) return;
  t.shown[layer] = amount;
  t.card.style.setProperty(`--fish-${layer}`, String(Math.round(amount * 1000) / 1000));
}

function draw(t: Tenant) {
  if (t.at <= 0 || !t.keys) {
    // A plain card again: hand the border and background back to CSS.
    t.card.removeAttribute("data-fish");
    return;
  }
  shapeAt(t.keys, t.at, t.points);
  t.outline.setAttribute("d", outlinePath(t.points, t.keys.n));
  const layers = layersAt(t.at);
  show(t, "copy", layers.copy);
  show(t, "settle", layers.settle);
  show(t, "ink", layers.ink);
  show(t, "hatch", layers.hatch);
  // "bare" once the copy is fully gone, so the stylesheet can stop it taking clicks.
  const state = layers.copy === 0 ? "bare" : "";
  if (t.card.getAttribute("data-fish") !== state) t.card.setAttribute("data-fish", state);
}

function tick(now: number) {
  // A background tab stops the loop for as long as it likes; do not leap on return.
  const elapsed = Math.min(now - lastFrame, 50);
  lastFrame = now;
  let moving = false;
  for (const t of tenants) {
    const to = goal(t);
    if (t.at === to) continue;
    if (to > t.at) {
      const data = sheet?.[t.name];
      if (!t.keys && data) measure(t, data);
      t.at = Math.min(to, t.at + elapsed / TURN_MS);
    } else {
      t.at = Math.max(to, t.at - elapsed / RETURN_MS);
    }
    draw(t);
    if (t.at !== to) moving = true;
  }
  frame = moving ? requestAnimationFrame(tick) : 0;
}

/** Start the loop if any card is not where it should be. */
function move() {
  if (frame) return;
  for (const t of tenants) {
    if (t.at !== goal(t)) {
      lastFrame = performance.now();
      frame = requestAnimationFrame(tick);
      return;
    }
  }
}

/** (Re)start the wait for the page to go quiet. Pointless once every card has turned. */
function arm() {
  window.clearTimeout(idleTimer);
  if (!sheet || !allowed() || document.hidden || !onScreen.size || everyCard((t) => t.turned)) return;
  idleTimer = window.setTimeout(() => {
    const quiet = performance.now() - lastActive;
    // Activity only stamps the time; the timer is the one place that checks it.
    // The shell is a <dialog>: a visitor typing in it is not away, and one
    // watching a program in it is not looking at the cards.
    if (quiet < IDLE_MS || document.querySelector("dialog[open]")) {
      if (quiet >= IDLE_MS) lastActive = performance.now();
      arm();
      return;
    }
    for (const t of tenants) t.turned = true;
    move();
  }, Math.max(0, lastActive + IDLE_MS - performance.now()));
}

/** Send every fish back to being a card and start waiting again. */
function release() {
  if (everyCard((t) => !t.turned)) return;
  for (const t of tenants) t.turned = false;
  move();
  arm();
}

function onActivity(event: Event) {
  lastActive = performance.now();
  if (event.type === "scroll" || event.type === "wheel") lastScroll = lastActive;
  if (event.type !== "pointermove") release();
}

/** The tab was hidden or shown, or the device's pointer or motion setting changed. */
function onConditions() {
  if (!allowed()) release();
  // The cards may have come on screen while fish were not allowed.
  else if (onScreen.size) void loadSheet();
  // Coming back to the tab is the visitor arriving, not the page sitting idle.
  if (!document.hidden) lastActive = performance.now();
  arm();
}

function start() {
  finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  // Reduced motion, or forced colours — where the card's border is repainted
  // in a system colour and a second, bending outline would only be noise.
  plainPage = window.matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)");
  lastActive = performance.now();
  watchSize = new ResizeObserver((entries) => {
    for (const entry of entries) {
      for (const t of tenants) {
        if (t.card !== entry.target || !t.keys) continue;
        // Re-measure now if the fish is showing; otherwise the next turn will.
        t.keys = null;
        const data = sheet?.[t.name];
        if (t.at > 0 && data) {
          measure(t, data);
          draw(t);
        }
      }
    }
  });
  watchScreen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= 0.5) onScreen.add(entry.target);
        else onScreen.delete(entry.target);
      }
      if (onScreen.size && allowed()) void loadSheet();
      arm();
    },
    { threshold: 0.5 },
  );
  for (const type of ACTIVITY) window.addEventListener(type, onActivity, { capture: true, passive: true });
  document.addEventListener("visibilitychange", onConditions);
  finePointer.addEventListener("change", onConditions);
  plainPage.addEventListener("change", onConditions);
}

function stop() {
  window.clearTimeout(idleTimer);
  cancelAnimationFrame(frame);
  frame = 0;
  onScreen.clear();
  watchSize.disconnect();
  watchScreen.disconnect();
  for (const type of ACTIVITY) window.removeEventListener(type, onActivity, { capture: true });
  document.removeEventListener("visibilitychange", onConditions);
  finePointer.removeEventListener("change", onConditions);
  plainPage.removeEventListener("change", onConditions);
}

/**
 * Hand a card's fish layer to the tank. Returns the function that takes it
 * back out and leaves the card exactly as it was.
 */
export function register(layer: SVGSVGElement, name: string): () => void {
  const card = layer.closest<HTMLElement>(".fish-card");
  const outline = layer.querySelector<SVGPathElement>(".fish-outline");
  const strokes = layer.querySelector<SVGGElement>(".fish-strokes");
  if (!card || !outline || !strokes) return () => {};
  if (!tenants.size) start();

  const t: Tenant = {
    name,
    card,
    outline,
    strokes,
    at: 0,
    turned: false,
    hovered: card.matches(":hover"),
    keys: null,
    points: new Float32Array(0),
    shown: {},
    leave: () => {},
  };
  // A touch has no "leave": a tap would pin the card as hovered for good.
  const enter = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    t.hovered = true;
    move();
  };
  const exit = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    t.hovered = false;
    // The visitor has looked at this card and moved on: from here it is a
    // fish. Not when the pointer "left" without the visitor moving on, though:
    // the page scrolled out from under it (scrolling is what sends fish back,
    // and must not make new ones as it goes), a text selection was dragged out
    // of the card, or the shell opened on top of it.
    const movedOn =
      performance.now() - lastScroll > SCROLL_SETTLE_MS && event.buttons === 0 && !document.querySelector("dialog[open]");
    if (allowed() && movedOn) {
      t.turned = true;
      arm();
    }
    move();
  };
  const focusIn = (event: FocusEvent) => {
    // Keyboard focus must land on something visible, and the copy only fades
    // back in at the end of the return: skip the tween for this one card.
    if (t.at > 0 && (event.target as Element).matches(":focus-visible")) {
      t.at = 0;
      draw(t);
    }
    move();
  };
  // The element is still focused while focusout runs; look again once it is not.
  const focusOut = () => window.setTimeout(move, 0);
  card.addEventListener("pointerenter", enter);
  card.addEventListener("pointerleave", exit);
  card.addEventListener("focusin", focusIn);
  card.addEventListener("focusout", focusOut);
  watchSize.observe(card);
  watchScreen.observe(card);

  t.leave = () => {
    card.removeEventListener("pointerenter", enter);
    card.removeEventListener("pointerleave", exit);
    card.removeEventListener("focusin", focusIn);
    card.removeEventListener("focusout", focusOut);
    watchSize.unobserve(card);
    watchScreen.unobserve(card);
    onScreen.delete(card);
    card.removeAttribute("data-fish");
    for (const property of ["copy", "settle", "ink", "hatch", "name-drop", "name-shrink"]) {
      card.style.removeProperty(`--fish-${property}`);
    }
    tenants.delete(t);
    if (!tenants.size) stop();
  };
  tenants.add(t);
  ink(t);
  return t.leave;
}
