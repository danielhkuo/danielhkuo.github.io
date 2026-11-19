// The phone's own title screen (mobile spec 2): "a page of an illuminated book". A small rose window heads the page,
// then the name, an inked rule, and the ways in as a short contents page. The minimal version, the whole site as plain
// text on one page, leads and is preselected, so a phone gets it first; flying is the second choice. Plain links,
// so it reads as a list to a screen reader and works without JavaScript. Game layer: hand-drawn SVG and CSS, not
// Astryx.

import Link from "next/link";
import type { ReactNode } from "react";
import { PROFILE } from "../../terminal/content";
import { fell } from "../../../app/world/fonts";
import styles from "./PhoneTitle.module.css";

export interface PhoneEntry {
  id: string;
  label: string;
  /** The few words set beside the label. */
  hint: string;
  href: string;
  /** A line under a lead entry. */
  meta?: string;
  /** Drawn as a large card rather than a row. */
  lead?: boolean;
  /** Shows the turn-your-phone mark: the flight is played sideways. */
  sideways?: boolean;
}

export interface PhoneTitleProps {
  entries: readonly PhoneEntry[];
  /** Shown under the name. */
  tagline: string;
  /** The entry selected as the page opens: the minimal version. */
  selected: string;
}

/** A true quatrefoil about (cx, cy): four equal lobes of radius r, meeting in cusps. */
function foilPath(cx: number, cy: number, r: number): string {
  const arc = (x: number, y: number) => `A${r} ${r} 0 1 1 ${cx + x} ${cy + y}`;
  return `M${cx - r} ${cy - r}${arc(r, -r)}${arc(r, r)}${arc(-r, r)}${arc(-r, -r)}Z`;
}

/** A quatrefoil bullet, filled vermilion on the selected entry and while pressed. */
function Quatrefoil() {
  return (
    <svg className={styles.foil} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={foilPath(8, 8, 3)} />
      <circle className={styles.foilEye} cx="8" cy="8" r="1.1" />
    </svg>
  );
}

/** The inked rule under the name, with a lozenge at its middle and a bead either side. */
function Rule() {
  return (
    <svg className={styles.rule} viewBox="0 0 120 8" aria-hidden="true" focusable="false">
      <path d="M4 4H49M71 4H116" />
      <path className={styles.ruleMark} d="M60 0.8l3.2 3.2-3.2 3.2-3.2-3.2z" />
      <circle className={styles.ruleBead} cx="53" cy="4" r="1.2" />
      <circle className={styles.ruleBead} cx="67" cy="4" r="1.2" />
    </svg>
  );
}

/** The tailpiece that closes the page: three small quatrefoils on a short rule. */
function Tailpiece() {
  return (
    <svg className={styles.tail} viewBox="0 0 120 14" aria-hidden="true" focusable="false">
      <path className={styles.tailRule} d="M14 7H40M80 7H106" />
      <path className={styles.tailFoil} d={foilPath(49, 7, 1.8)} />
      <path className={styles.tailFoilMid} d={foilPath(60, 7, 2.6)} />
      <path className={styles.tailFoil} d={foilPath(71, 7, 1.8)} />
    </svg>
  );
}

/** A phone upright, a turning arrow, and the phone on its side: the flight is held sideways. */
function Turn() {
  return (
    <svg className={styles.turn} viewBox="0 -2 36 18" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="8.5" height="14" rx="1.6" />
      <rect x="20" y="6.5" width="15" height="8.5" rx="1.6" />
      <path className={styles.turnArrow} d="M11.5 4.5Q17 -0.5 24 3.5m0 0l-3.3-.2M24 3.5l-1.4-2.9" />
    </svg>
  );
}

/** A small boss at each corner of a lead card, where its inner rule turns. */
function Corners() {
  return (
    <>
      {[styles.tl, styles.tr, styles.bl, styles.br].map((at) => (
        <svg key={at} className={`${styles.corner} ${at}`} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d={foilPath(6, 6, 2.3)} />
        </svg>
      ))}
    </>
  );
}

/**
 * A small rose window as the page's headpiece: twelve pointed lights round a quatrefoil eye, a roundel in each
 * spandrel, in a stained-glass wash under inked tracery. Church-built ornament only.
 */
export function RoseHeadpiece() {
  const twelfths = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg className={styles.rose} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <circle className={styles.roseStone} cx="60" cy="60" r="57" />
      {twelfths.map((a, i) => (
        <g key={a} transform={`rotate(${a} 60 60)`}>
          {/* A light: a lancet widening from the eye to a pointed head at the rim. */}
          <path className={i % 2 ? styles.roseTeal : styles.roseGold} d="M57 43.3L52.7 28A13.5 13.5 0 0 1 60 16A13.5 13.5 0 0 1 67.3 28L63 43.3Q60 42.6 57 43.3Z" />
          <g transform="rotate(15 60 60)">
            <circle className={styles.roseRed} cx="60" cy="13.6" r="2.9" />
          </g>
        </g>
      ))}
      <circle className={styles.roseEye} cx="60" cy="60" r="14" />
      <path className={styles.roseCentre} d={foilPath(60, 60, 4.6)} />
      <circle className={styles.roseBoss} cx="60" cy="60" r="1.9" />
      <circle className={styles.roseRim} cx="60" cy="60" r="57" />
      <circle className={styles.roseRim} cx="60" cy="60" r="52.5" />
    </svg>
  );
}

function Entry({ entry, on }: { entry: PhoneEntry; on: boolean }): ReactNode {
  const face = (
    <>
      {entry.lead ? <Corners /> : null}
      <Quatrefoil />
      <span className={styles.words}>
        <span className={styles.label}>{entry.label}</span>
        <span className={styles.vh}>, </span>
        {entry.lead ? null : <span className={styles.leader} aria-hidden="true" />}
        <em className={styles.hint}>{entry.hint}</em>
        {entry.meta ? (
          <span className={styles.meta}>
            {entry.sideways ? (
              <Turn />
            ) : (
              <span className={styles.pilcrow} aria-hidden="true">
                ¶
              </span>
            )}
            {entry.meta}
          </span>
        ) : null}
      </span>
    </>
  );
  const cls = `${entry.lead ? styles.card : styles.row} ${on ? styles.on : ""}`;
  // A page of this app is reached without a reload; a file (/agents.md) or a deep link loads whole.
  return /^\/[\w-]*$/.test(entry.href) ? (
    <Link className={cls} href={entry.href} aria-current={on ? "true" : undefined}>
      {face}
    </Link>
  ) : (
    <a className={cls} href={entry.href} aria-current={on ? "true" : undefined}>
      {face}
    </a>
  );
}

export default function PhoneTitle({ entries, tagline, selected }: PhoneTitleProps) {
  return (
    <main className={`${styles.root} ${fell.variable}`}>
      <header className={styles.head}>
        <RoseHeadpiece />
        <h1 className={styles.name}>{PROFILE.name}</h1>
        <Rule />
        <p className={styles.tagline}>{tagline}</p>
      </header>
      <nav className={styles.menu} aria-label="Ways in">
        <ul className={styles.list}>
          {entries.map((e) => (
            <li key={e.id} className={e.lead ? styles.leadItem : styles.rowItem}>
              <Entry entry={e} on={e.id === selected} />
            </li>
          ))}
        </ul>
      </nav>
      <Tailpiece />
    </main>
  );
}
