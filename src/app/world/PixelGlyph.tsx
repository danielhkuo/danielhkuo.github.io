"use client";

// A guide sprite in the DOM: SVG with one path per colour, hard-edged at any size. The frame loop draws the same sprites
// into the world with `blit`, so a glyph looks the same in both. Decorative: give the words beside it to readers.

import { COLOURS, type Sprite } from "../../world/controls/glyphs";

/** One path per palette slot: each row's runs of that slot as unit-high rectangles. */
function pathsOf(s: Sprite): [number, string][] {
  const by = new Map<number, string>();
  for (let y = 0; y < s.h; y++) {
    let x = 0;
    while (x < s.w) {
      const c = s.px[y * s.w + x];
      if (c === 0) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < s.w && s.px[y * s.w + x + run] === c) run += 1;
      by.set(c, `${by.get(c) ?? ""}M${x} ${y}h${run}v1h-${run}z`);
      x += run;
    }
  }
  return [...by];
}

export interface PixelGlyphProps {
  sprite: Sprite;
  /** CSS pixels per sprite pixel. */
  px: number;
  className?: string;
}

export default function PixelGlyph({ sprite, px, className }: PixelGlyphProps) {
  return (
    <svg
      className={className}
      width={sprite.w * px}
      height={sprite.h * px}
      viewBox={`0 0 ${sprite.w} ${sprite.h}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {pathsOf(sprite).map(([c, d]) => {
        const [r, g, b, a] = COLOURS[c];
        return <path key={c} d={d} fill={`rgb(${r} ${g} ${b} / ${(a / 255).toFixed(3)})`} />;
      })}
    </svg>
  );
}
