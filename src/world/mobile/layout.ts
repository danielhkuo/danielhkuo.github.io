// Where the touch controls go (spec 4.1): one pure function of the visible area, the safe-area insets, the platform,
// the hand and the size setting. Everything is CSS pixels of the game layer. The controls stay inside the frame as it
// sits on screen, so they work over a letterboxed frame and over one that fills the window.

import type { Circle, Rect, TouchTargets } from "../controls/touch.ts";

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export type Platform = "ios" | "android" | "other";
export type Hand = "right" | "left";

/** The size setting: 80, 100, 125 or 150%. */
export const SIZES = [0.8, 1, 1.25, 1.5] as const;

export interface LayoutInput {
  /** The visible area, CSS px. */
  width: number;
  height: number;
  insets: Insets;
  platform: Platform;
  hand: Hand;
  size: number;
  /** Where the frame is drawn on screen, CSS px: the controls stay inside it. */
  frame: { x: number; y: number; w: number; h: number };
  /** A landmark is in reach: Land joins the cluster. */
  land: boolean;
}

export interface ControlLayout {
  /** The rectangle the controls keep inside. */
  usable: Rect;
  /** Where a thumb puts the stick down. */
  zone: Rect;
  /** Where the stick waits, faintly, before it has been learned. */
  rest: { x: number; y: number };
  /** Drawn radii of the stick's ring and knob, and how far the knob travels. */
  ring: number;
  knob: number;
  travel: number;
  /** Drawn circles. */
  boost: Circle;
  brake: Circle;
  land: Circle | null;
  /** The size actually used: the setting, shrunk if the screen cannot hold it. */
  scale: number;
}

/** Room kept from a screen edge with a system back gesture, px: Android's strip is wider. */
export const EDGE_BUDGET: Record<Platform, number> = { ios: 24, android: 32, other: 16 };
/** Room kept inside the safe area, px. */
export const MARGIN = 16;
/** A finger hits a control this far outside its drawn edge, px. */
export const SLOP = 8;
/** The stick never starts in the bottom strip, px (the home indicator and gesture bar). */
export const BOTTOM_STRIP = 24;
/** No stick in the top band, where the corner and captions are, px. */
export const TOP_BAND = 64;
/** The stick zone is this share of the usable width, on the thumb's side. */
export const ZONE_SHARE = 0.45;

/** At 100%: radii, and centres from the usable rectangle's lower outer corner (x in, y up), px. */
const BASE = {
  ring: 56,
  knob: 22,
  travel: 48,
  rest: { x: 72, y: 72 },
  boost: { r: 36, x: 48, y: 48 },
  brake: { r: 28, x: 140, y: 34 },
  land: { r: 36, x: 56, y: 140 },
};

/** The space the right-hand cluster needs at scale 1: width from the outer edge, height from the bottom. */
const CLUSTER_W = BASE.brake.x + BASE.brake.r;
const CLUSTER_H = BASE.land.y + BASE.land.r;

function intersect(a: Rect, b: Rect): Rect {
  return { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
}

/** The visible area less the safe areas, the margins and the back-gesture strips, inside the frame. */
export function usableRect(i: LayoutInput): Rect {
  const side = EDGE_BUDGET[i.platform];
  const screen: Rect = {
    x0: Math.max(i.insets.left + MARGIN, side),
    y0: i.insets.top + MARGIN,
    x1: i.width - Math.max(i.insets.right + MARGIN, side),
    y1: i.height - Math.max(i.insets.bottom + MARGIN, BOTTOM_STRIP),
  };
  const f = i.frame;
  return intersect(screen, { x0: f.x + 4, y0: f.y + 4, x1: f.x + f.w - 4, y1: f.y + f.h - 4 });
}

/** Lays the controls out. Left-handed is the exact mirror of right-handed across the usable rectangle. */
export function layoutControls(i: LayoutInput): ControlLayout {
  const u = usableRect(i);
  const uw = Math.max(0, u.x1 - u.x0);
  const uh = Math.max(0, u.y1 - u.y0);
  // The cluster and the stick share the width; the cluster's height must fit with the top band clear.
  const fitW = uw / (CLUSTER_W + 2 * BASE.ring + 24);
  const fitH = (uh - TOP_BAND) / CLUSTER_H;
  const scale = Math.max(0.5, Math.min(i.size, fitW, fitH));
  const s = (n: number) => Math.round(n * scale);
  const right = i.hand === "right";
  // x measured in from the cluster's edge of the usable rectangle, mirrored for the left hand.
  const fromOuter = (dx: number) => (right ? u.x1 - dx : u.x0 + dx);
  const fromInner = (dx: number) => (right ? u.x0 + dx : u.x1 - dx);
  const circle = (c: { r: number; x: number; y: number }): Circle => ({ x: fromOuter(s(c.x)), y: u.y1 - s(c.y), r: s(c.r) });

  const zoneW = Math.round(uw * ZONE_SHARE);
  const zone: Rect = right
    ? { x0: u.x0, y0: u.y0 + TOP_BAND, x1: u.x0 + zoneW, y1: u.y1 }
    : { x0: u.x1 - zoneW, y0: u.y0 + TOP_BAND, x1: u.x1, y1: u.y1 };
  return {
    usable: u,
    zone,
    rest: { x: fromInner(s(BASE.rest.x)), y: u.y1 - s(BASE.rest.y) },
    ring: s(BASE.ring),
    knob: s(BASE.knob),
    travel: s(BASE.travel),
    boost: circle(BASE.boost),
    brake: circle(BASE.brake),
    land: i.land ? circle(BASE.land) : null,
    scale,
  };
}

/** The hit areas the touch state machine tests against: each drawn circle grown by SLOP. */
export function targetsOf(l: ControlLayout): TouchTargets {
  const grow = (c: Circle): Circle => ({ x: c.x, y: c.y, r: c.r + SLOP });
  return { zone: l.zone, boost: grow(l.boost), brake: grow(l.brake), land: l.land ? grow(l.land) : null };
}
