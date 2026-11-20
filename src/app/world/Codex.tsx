"use client";

// The Codex: what is kept at the landmark the dragon has landed on, on a leaf of Ink & Glyph paper. Game layer: hand
// drawn in CSS and SVG, not Astryx. (The prompt that offers a landing is drawn into the world: controls/guides.ts.)

import { useEffect, useRef, type ReactNode } from "react";
import { LINKS, PROFILE } from "../../components/terminal/content";
import { kindName, type Landmark } from "../../world/sites/landmarks";
import { STOPS } from "../../world/story/stops";
import styles from "./codex.module.css";
import { fell } from "./fonts";

/** Four overlapping circles: the quatrefoil, inked, filled with `fill`. */
function Quatrefoil({ className }: { className?: string }) {
  const lobes = [
    [2.2, 0],
    [-2.2, 0],
    [0, 2.2],
    [0, -2.2],
  ].map(([cx, cy]) => <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={2.4} />);
  return (
    <svg className={className} viewBox="-6 -6 12 12" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth={1.5}>
        {lobes}
      </g>
      <g className={styles.lobes}>{lobes}</g>
    </svg>
  );
}

/** A flourished corner: an inner rule that turns the corner in a curve, a scroll at each end, and a quatrefoil with a gold boss. */
function Corner({ className }: { className: string }) {
  const lobes = [
    [2.3, 0],
    [-2.3, 0],
    [0, 2.3],
    [0, -2.3],
  ].map(([cx, cy]) => <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={2.5} />);
  return (
    <svg className={`${styles.corner} ${className}`} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <path d="M4 38 V17 C4 9.5 9.5 4 17 4 H38" fill="none" stroke="currentColor" strokeWidth={1.4} />
      <path d="M9 38 V20 C9 14 14 9 20 9 H38" fill="none" stroke="currentColor" strokeWidth={0.7} />
      <path d="M38 4 C34 4 33 7.5 35.5 8.5" fill="none" stroke="currentColor" strokeWidth={1} />
      <path d="M4 38 C4 34 7.5 33 8.5 35.5" fill="none" stroke="currentColor" strokeWidth={1} />
      <g transform="translate(14.5 14.5)">
        <g fill="none" stroke="currentColor" strokeWidth={1.6}>
          {lobes}
        </g>
        <g className={styles.lobes}>{lobes}</g>
        <circle className={styles.boss} r={1.2} />
      </g>
    </svg>
  );
}

/**
 * A title whose first letter is illuminated: vermilion, gold-ruled. The initial is an inline block, which splits the
 * word in the accessible name ("E mpty-state-repo"), so the heading, and the Codex it labels, is named by the text.
 */
function Illuminated({ text }: { text: string }) {
  return (
    <h2 id="codex-title" className={styles.title} aria-label={text}>
      <span className={styles.initial}>{text.charAt(0)}</span>
      {text.slice(1)}
    </h2>
  );
}

function Ledger({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className={styles.ledger}>
      {rows.map(([k, v]) => (
        <div key={k} className={styles.row}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Links({ links }: { links: { href: string; label: string; external: boolean }[] }) {
  return (
    <ul className={styles.links}>
      {links.map((l) => (
        <li key={l.href}>
          <Quatrefoil className={styles.bullet} />
          <a href={l.href} {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {l.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export interface CodexProps {
  landmark: Landmark;
  onTakeOff: () => void;
  /**
   * The abbey's button: opens the terminal, which gives focus back to `trigger` when it closes; on a phone, which has
   * no terminal, the minimal version.
   */
  onOpenTerminal: (trigger: HTMLElement) => void;
  /** What that button says: "Open the terminal", or on a phone "Read the minimal version". */
  openLabel: string;
}

/** The Codex for the landmark the dragon rests at: a labelled, non-modal dialog that takes focus when it opens. */
export default function Codex({ landmark, onTakeOff, onOpenTerminal, openLabel }: CodexProps) {
  const leaf = useRef<HTMLDivElement>(null);
  useEffect(() => {
    leaf.current?.focus({ preventScroll: true });
  }, [landmark.id]);

  const kind = kindName(landmark.type);
  let body: ReactNode;
  if (landmark.holds.kind === "hall") {
    body = (
      <>
        <p className={styles.rubric}>
          <span aria-hidden="true">¶ </span>The hall
        </p>
        <Illuminated text="Projects" />
        <ul>
          {landmark.holds.projects.map((p) => (
            <li key={p.slug}>{p.name}</li>
          ))}
        </ul>
      </>
    );
  } else if (landmark.holds.kind === "about") {
    body = (
      <>
        <p className={styles.rubric}>
          <span aria-hidden="true">¶ </span>The {kind}
        </p>
        <Illuminated text={PROFILE.name} />
        <p className={styles.lede}>{PROFILE.title}</p>
        <Ledger
          rows={[
            ["Previously", PROFILE.previously],
            ["Studies", PROFILE.school],
            ["Lives in", PROFILE.location],
            ["Builds", PROFILE.building],
          ]}
        />
        <Links
          links={[
            { href: LINKS.github, label: "GitHub", external: true },
            { href: LINKS.linkedin, label: "LinkedIn", external: true },
            { href: LINKS.email, label: "Email", external: false },
            { href: LINKS.resume, label: "Résumé", external: true },
          ]}
        />
      </>
    );
  } else {
    const key = landmark.holds.stop;
    const stop = STOPS.find((s) => s.key === key);
    body = (
      <>
        <p className={styles.rubric}>
          <span aria-hidden="true">¶ </span>Found
        </p>
        <Illuminated text={stop ? stop.name : key} />
      </>
    );
  }

  return (
    // Non-modal: the scene stays live round it, and the page's keys still reach the dragon.
    <dialog open className={`${styles.codex} ${fell.variable}`} aria-labelledby="codex-title">
      <Corner className={styles.tl} />
      <Corner className={styles.tr} />
      <Corner className={styles.br} />
      <Corner className={styles.bl} />
      {/* The leaf scrolls and takes focus, so arrow keys read down it. */}
      <div ref={leaf} className={styles.leaf} tabIndex={-1}>
        {body}
        <p className={styles.actions}>
          {landmark.holds.kind === "about" ? (
            <button type="button" className={styles.button} data-terminal-trigger="" onClick={(e) => onOpenTerminal(e.currentTarget)}>
              {openLabel}
            </button>
          ) : null}
          <button type="button" className={styles.button} onClick={onTakeOff} aria-keyshortcuts="Space">
            Take off <kbd>Space</kbd>
          </button>
        </p>
      </div>
    </dialog>
  );
}
