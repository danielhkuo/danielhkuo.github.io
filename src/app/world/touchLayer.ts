// Touch flight in the browser (spec 4): pointer events on the game layer feed the touch state machine, the controls
// are laid out from the layer's size, its safe areas and where the frame sits, and each frame they are read for the
// flight and drawn into the frame in its own pixels. Plain TypeScript: the session owns one.

import { SIZE_SCALE, type Options } from "../../world/controls/options";
import { knobAt, STICK, type StickRead } from "../../world/controls/stick";
import { createTouch, type Pad } from "../../world/controls/touch";
import { drawControls } from "../../world/mobile/art";
import { layoutControls, targetsOf, type ControlLayout, type Insets, type Platform } from "../../world/mobile/layout";
import { smooth, tiltTurn, wheelAngle } from "../../world/mobile/tilt";
import { toLayer, type Turn } from "../../world/mobile/turned";

/** The game layer as the controls see it: its size and safe areas, how it is turned, and the screen under it. */
export interface LayerView {
  w: number;
  h: number;
  insets: Insets;
  turn: Turn;
  screenW: number;
  screenH: number;
}

export interface TouchLayerSetup {
  /** The game layer: pointer events are heard here. */
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  options(): Options;
  platform: Platform;
  view(): LayerView;
  /** The stick shows faintly at rest until the first-flight lesson is learned. */
  ghost(): boolean;
  /** A finger came down on the layer. */
  touched(): void;
}

/** What touch asks of the flight this frame. */
export interface TouchFrame {
  stick: StickRead;
  boost: boolean;
  brake: boolean;
  /** One-thumb boost: the stick held at its rim. */
  rim: boolean;
  /** The tilt wheel's turn, when tilt steering is on and the phone is not lying flat. */
  tilt: number | null;
  /** Buttons newly pressed and Land taps since the last frame. */
  presses: Pad[];
  taps: "land"[];
}

export interface TouchLayer {
  frame(dt: number): TouchFrame;
  /** Draws the controls into the frame, if they are shown. */
  draw(out: Uint32Array, fw: number, fh: number): void;
  /** Whether the controls show and take touches: flying, not paused, touch the last device used. */
  setLive(on: boolean): void;
  /** A landmark is in reach: Land joins the cluster. */
  setLand(on: boolean): void;
  /** Lets go of every finger: a pause. */
  clear(): void;
  dispose(): void;
}

/** Seconds untouched before the controls fade, and how far. */
const FADE_AFTER = 3;
const FADED = 0.55;
/** One-thumb boost: the stick past this deflection for RIM_HOLD seconds. */
const RIM = 0.9;
const RIM_HOLD = 0.2;

/** True for a pointer on one of the page's own controls: those keep their events. */
function onDomControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a, input, select, textarea, dialog, [data-touch-skip]") !== null;
}

export function createTouchLayer(setup: TouchLayerSetup): TouchLayer {
  const touch = createTouch();
  let live = false;
  let land = false;
  let presses: Pad[] = [];
  let taps: "land"[] = [];
  let lastTouch = -Infinity;
  let rimFor = 0;
  let tiltRaw: number | null = null;
  let tiltSmooth = 0;
  let neutral: number | null = null;
  let layout: ControlLayout | null = null;
  let frameRect = { x: 0, y: 0, w: 0, h: 0 };

  /** The frame's rectangle in the layer's coordinates (a quarter turn keeps a rectangle a rectangle). */
  const frameOnLayer = (v: LayerView) => {
    const r = setup.canvas.getBoundingClientRect();
    const a = toLayer(r.left, r.top, v.screenW, v.screenH, v.turn);
    const b = toLayer(r.right, r.bottom, v.screenW, v.screenH, v.turn);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  };

  const relayout = () => {
    const v = setup.view();
    const o = setup.options();
    frameRect = frameOnLayer(v);
    layout = layoutControls({ width: v.w, height: v.h, insets: v.insets, platform: setup.platform, hand: o.hand, size: SIZE_SCALE[o.size], frame: frameRect, land });
    touch.setFeel({ ...STICK, travel: layout.travel });
    return layout;
  };

  const point = (e: PointerEvent) => {
    const v = setup.view();
    return toLayer(e.clientX, e.clientY, v.screenW, v.screenH, v.turn);
  };
  const isFinger = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";

  const onDown = (e: PointerEvent) => {
    if (!isFinger(e) || e.defaultPrevented || onDomControl(e.target)) return;
    setup.touched();
    if (!live) return;
    lastTouch = performance.now();
    const p = point(e);
    const effect = touch.down(e.pointerId, p.x, p.y, targetsOf(layout ?? relayout()));
    if (effect.pressed) presses.push(effect.pressed);
  };
  const onMove = (e: PointerEvent) => {
    if (!isFinger(e) || !live) return;
    const p = point(e);
    const effect = touch.move(e.pointerId, p.x, p.y, targetsOf(layout ?? relayout()));
    if (effect.pressed) presses.push(effect.pressed);
  };
  const onUp = (e: PointerEvent) => {
    if (!isFinger(e)) return;
    lastTouch = performance.now();
    const p = point(e);
    const effect = touch.up(e.pointerId, p.x, p.y, targetsOf(layout ?? relayout()));
    if (effect.tapped && live) taps.push(effect.tapped);
  };
  const onCancel = (e: PointerEvent) => touch.cancel(e.pointerId);

  // Tilt steering, while the option is on: gravity in the screen's plane is the wheel.
  const onMotion = (e: DeviceMotionEvent) => {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null) return;
    const angle = screen.orientation?.angle ?? 0;
    tiltRaw = wheelAngle(g.x, g.y, angle + (setup.view().turn === 90 ? 90 : setup.view().turn === -90 ? -90 : 0));
  };
  let listeningMotion = false;
  const motion = (on: boolean) => {
    if (on === listeningMotion) return;
    listeningMotion = on;
    if (on) window.addEventListener("devicemotion", onMotion);
    else {
      window.removeEventListener("devicemotion", onMotion);
      tiltRaw = null;
      neutral = null;
    }
  };

  const root = setup.root;
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onCancel);
  root.addEventListener("lostpointercapture", onCancel);

  return {
    frame(dt) {
      relayout();
      const o = setup.options();
      motion(o.tilt === "on" && live);
      const read = live ? touch.read() : { stick: { x: 0, y: 0, mag: 0 }, boost: false, brake: false };
      rimFor = o.thumb === "one" && read.stick.mag >= RIM ? rimFor + dt : 0;
      let tilt: number | null = null;
      if (live && tiltRaw !== null) {
        if (neutral === null) neutral = tiltRaw;
        tiltSmooth = smooth(tiltSmooth, tiltTurn(tiltRaw, neutral), dt);
        tilt = tiltSmooth;
      }
      const out: TouchFrame = { stick: read.stick, boost: read.boost, brake: read.brake, rim: rimFor >= RIM_HOLD, tilt, presses, taps };
      presses = [];
      taps = [];
      return out;
    },
    draw(out, fw, fh) {
      if (!live || !layout) return;
      const o = setup.options();
      const touched = touch.active();
      const idle = (performance.now() - lastTouch) / 1000;
      const alpha = touched || o.fade === "solid" || idle < FADE_AFTER ? 1 : Math.max(FADED, 1 - (idle - FADE_AFTER) * 0.9);
      const s = touch.stick();
      const knob = s ? knobAt(s, { ...STICK, travel: layout.travel }) : null;
      drawControls(out, fw, fh, {
        layout,
        frame: frameRect,
        stick: s && knob ? { baseX: s.baseX, baseY: s.baseY, knobX: knob.x, knobY: knob.y } : null,
        ghost: setup.ghost(),
        pressed: { boost: touch.holding("boost"), brake: touch.holding("brake"), land: touch.holding("land") },
        alpha,
      });
    },
    setLive(on) {
      if (on === live) return;
      live = on;
      if (!on) touch.clear();
      // A new stretch of flying starts from the pose the phone is held in.
      neutral = null;
    },
    setLand(on) {
      land = on;
    },
    clear() {
      touch.clear();
      presses = [];
      taps = [];
    },
    dispose() {
      motion(false);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onCancel);
      root.removeEventListener("lostpointercapture", onCancel);
    },
  };
}
