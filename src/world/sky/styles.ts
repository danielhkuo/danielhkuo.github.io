// The cloud styles. Each is a painter plus how its layers show.

import { paintCumulus } from "./paint/cumulus.ts";
import type { Painter } from "./sprite.ts";

export interface CloudStyle {
  name: "cumulus";
  paint: Painter;
  /** 0–255: how much of a bank lies over the flier inside it. 255 hides the flier; 0 leaves it clear. */
  veil: number;
  /** Of 256, per channel (red, green, blue): how much of the land's colour a cloud's shadow keeps. 256 draws no shadow. */
  shadowKeep: readonly [number, number, number];
}

export const STYLES: Readonly<Record<CloudStyle["name"], CloudStyle>> = {
  cumulus: { name: "cumulus", paint: paintCumulus, veil: 150, shadowKeep: [192, 204, 228] },
};

export const STYLE_NAMES: readonly CloudStyle["name"][] = ["cumulus"];

/** The style a `?clouds=` value names; cumulus when it names none. */
export function styleFrom(query: string | null): CloudStyle {
  for (const name of STYLE_NAMES) if (name === query) return STYLES[name];
  return STYLES.cumulus;
}
