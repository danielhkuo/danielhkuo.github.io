"use client";

// The small pieces of the flight page round the canvas: the failure screen, the discovery caption, the hint line and the
// ?stats readout. Game layer: hand-drawn CSS, not Astryx.

import Link from "next/link";
import { LOAD_FAILED } from "../../world/runtime/load";
import styles from "./flight.module.css";
import { fell } from "./fonts";
import type { FlightStats, PhaseKind } from "./session";
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

const HINTS: Record<PhaseKind, string> = {
  flying: "Arrow keys steer · Up to speed up · Down to slow · Esc to leave",
  landing: "Coming down · Esc to pull up",
  landed: "Space or Esc to take off",
};

/** What the keys do in this phase, along the bottom of the page. */
export function Hint({ phase }: { phase: PhaseKind }) {
  return <p className={`${styles.hint} ${fell.className}`}>{HINTS[phase]}</p>;
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
