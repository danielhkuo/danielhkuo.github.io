// The five keepsakes, drawn in the Codex's ink with one vermilion or gold accent. Game layer: inline SVG, not Astryx.

import type { ReactNode } from "react";
import type { StopKey } from "../../world/story/stops";

const ICON: Record<StopKey, ReactNode> = {
  pine: (
    <>
      <path d="M8 1.3v2.1" stroke="var(--gold)" strokeWidth="1.45" />
      <path d="M8 3.1c2.7.45 4.2 2.7 3.7 5.9-.55 3.15-1.9 5.5-3.7 5.5s-3.15-2.35-3.7-5.5C3.8 5.8 5.3 3.55 8 3.1z" />
      <path d="M5.15 7.35c1.7-.7 3.95-.7 5.7 0M5 9.85c1.85-.65 4.15-.65 6 0" />
    </>
  ),
  desk: (
    <>
      <path d="M3.15 1.7h6.05L12.9 5.35V14.3H3.15z" />
      <path d="M9.2 1.7V5.35H12.9" stroke="var(--gold)" />
      <path d="M5.05 8h5.5M5.05 10.15h5.5M5.05 12.3h3.15" />
    </>
  ),
  bell: (
    <>
      <path d="M8 1.35v1.35" />
      <path d="M4.35 11.85c.1-3.55 1.15-6.15 3.65-6.15s3.55 2.6 3.65 6.15" />
      <path d="M3.15 11.85h9.7" strokeWidth="1.35" />
      <circle cx="8" cy="13.85" r="1.1" fill="var(--gold)" stroke="none" />
    </>
  ),
  mill: (
    <>
      <circle cx="8" cy="8" r="3.05" strokeWidth="1.35" />
      <circle cx="8" cy="8" r="1.15" fill="var(--gold)" stroke="none" />
      <path d="M8 1.45v2.15M8 12.4v2.15M1.45 8h2.15M12.4 8h2.15M3.25 3.25l1.55 1.55M11.2 11.2l1.55 1.55M12.75 3.25l-1.55 1.55M4.8 11.2l-1.55 1.55" strokeWidth="1.5" />
    </>
  ),
  basket: (
    <>
      <circle cx="8" cy="8" r="5.65" />
      <path d="M8 2.35v11.3M2.45 8h11.1" />
      <path d="M3.55 4.25c1.65 1.15 2.5 2.35 2.5 3.75s-.85 2.6-2.5 3.75M12.45 4.25c-1.65 1.15-2.5 2.35-2.5 3.75s.85 2.6 2.5 3.75" stroke="var(--vermilion)" />
    </>
  ),
};

/** One keepsake, in `currentColor`, with a single gold or vermilion accent. */
export function Keepsake({ stop, className }: { stop: StopKey; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICON[stop]}
    </svg>
  );
}
