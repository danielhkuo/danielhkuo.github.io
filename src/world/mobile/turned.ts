// "Play sideways anyway" (spec 5): when a phone's own rotation lock keeps the page upright, the game layer is turned
// a quarter with CSS inside the portrait screen and the visitor turns the phone. Pure: the layer's size, the CSS that
// turns it, and pointer and inset positions mapped between the screen and the layer.

import type { Insets } from "./layout.ts";

/** 0: not turned. 90: the visitor turned the phone anticlockwise (its top to the left); -90: clockwise. */
export type Turn = 0 | 90 | -90;

/** The layer's size for a screen of w × h: a quarter turn swaps the sides. */
export function layerSize(w: number, h: number, turn: Turn): { w: number; h: number } {
  return turn === 0 ? { w, h } : { w: h, h: w };
}

/** The CSS transform (origin top left) that lays the layer onto a w × h screen. */
export function layerTransform(w: number, h: number, turn: Turn): string {
  if (turn === 90) return `translate(${w}px, 0) rotate(90deg)`;
  if (turn === -90) return `translate(0, ${h}px) rotate(-90deg)`;
  return "none";
}

/** A point on the screen (CSS px from the top left) in the layer's own coordinates. */
export function toLayer(x: number, y: number, w: number, h: number, turn: Turn): { x: number; y: number } {
  if (turn === 90) return { x: y, y: w - x };
  if (turn === -90) return { x: h - y, y: x };
  return { x, y };
}

/** A point in the layer back on the screen: the inverse of `toLayer`. */
export function toScreen(x: number, y: number, w: number, h: number, turn: Turn): { x: number; y: number } {
  if (turn === 90) return { x: w - y, y: x };
  if (turn === -90) return { x: y, y: h - x };
  return { x, y };
}

/** The screen's safe-area insets as the turned layer sees them. */
export function layerInsets(i: Insets, turn: Turn): Insets {
  if (turn === 90) return { top: i.right, right: i.bottom, bottom: i.left, left: i.top };
  if (turn === -90) return { top: i.left, right: i.top, bottom: i.right, left: i.bottom };
  return i;
}
