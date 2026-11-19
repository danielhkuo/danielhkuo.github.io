"use client";

// The small pieces of the flight page round the canvas: the failure screen, the discovery caption, the guide in words
// and the ?stats readout. Game layer: hand-drawn CSS, not Astryx.

import Link from "next/link";
import { LOAD_FAILED } from "../../world/runtime/load";
import styles from "./flight.module.css";
import { fell } from "./fonts";
import type { FlightStats } from "./session";
import type { Caption } from "./useFlight";

/** Shown in place of the canvas when the world could not be loaded. */
export function LoadFailed() {
  return (
    <div className={`${styles.failed} ${fell.className}`}>
      <p>{LOAD_FAILED}</p>
      <Link href="/">Back to the site</Link>
    </div>
  );
}

/** The line that names something seen for the first time, fading out when it is done. */
export function DiscoveryCaption({ caption }: { caption: Caption }) {
  if (caption.text === null) return null;
  return <p className={`${styles.caption} ${caption.visible ? styles.captionShown : ""} ${fell.className}`}>{caption.text}</p>;
}

/** The guide by the dragon in words, for screen readers: the guides themselves are drawn into the world. */
export function GuideLine({ say }: { say: string }) {
  return (
    <p className={styles.sr} aria-live="polite">
      {say}
    </p>
  );
}

/** With ?stats: frames a second, the pool and the view. */
export function StatsReadout({ stats }: { stats: FlightStats }) {
  return (
    <div className={styles.stats}>
      <p>fps {stats.fps}</p>
      <p>{stats.pool}</p>
      <p>{stats.view}</p>
    </div>
  );
}
