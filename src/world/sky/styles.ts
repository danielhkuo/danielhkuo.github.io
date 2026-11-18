// The three cloud styles the owner compares. Each is a painter plus how strongly its layers show.

import { paintLayered } from "./paint/layered.ts";
import { paintStorybook } from "./paint/storybook.ts";
import { paintWatercolour } from "./paint/watercolour.ts";
import type { Painter } from "./sprite.ts";

export interface CloudStyle {
  name: "watercolour" | "storybook" | "layered";
  paint: Painter;
  /** Draw the high streak layer. */
  high: boolean;
  /** 0–255: how strongly low clouds and banks show over what is under them. */
  lowAlpha: number;
  bankAlpha: number;
}

export const STYLES: Readonly<Record<CloudStyle["name"], CloudStyle>> = {
  watercolour: { name: "watercolour", paint: paintWatercolour, high: false, lowAlpha: 235, bankAlpha: 190 },
  storybook: { name: "storybook", paint: paintStorybook, high: false, lowAlpha: 255, bankAlpha: 200 },
  layered: { name: "layered", paint: paintLayered, high: true, lowAlpha: 225, bankAlpha: 185 },
};

/** The style a `?clouds=` value names; watercolour when it names none. */
export function styleFrom(query: string | null): CloudStyle {
  return query === "storybook" || query === "layered" ? STYLES[query] : STYLES.watercolour;
}
