// The five keepsakes, drawn in the Codex's ink with one vermilion or gold accent. Game layer: inline SVG, not Astryx.

import type { ReactNode } from "react";
import type { StopKey } from "../../world/story/stops";

const ICON: Record<StopKey, ReactNode> = {
  pine: (
    <>
      <path d="M8 1.3 11.3 8.2H4.7Z" />
      <path d="M8 8.2v2.5" strokeWidth="1.7" />
      <path d="M3.3 10.7 5.1 14.7h5.8l1.8-4" />
      <path d="M2.7 10.7h10.6" stroke="var(--gold)" strokeWidth="1.45" />
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
      <path strokeWidth="1.6" d="M8 6.6v7.6" />
      <path strokeWidth="1.75" d="M4.2 2.6 6.7 5.1M11.8 2.6 9.3 5.1M4.2 10.6 6.7 8.1M11.8 10.6 9.3 8.1" />
      <circle cx="8" cy="6.6" r="1.5" fill="var(--gold)" stroke="none" />
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
