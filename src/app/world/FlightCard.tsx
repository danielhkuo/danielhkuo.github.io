"use client";

// The cards over a touch flight (spec 1, 5): "before you fly" with Take wing, "turn your phone" while a phone is held
// upright, and "paused" with Fly on. Drawn like the options panel, in the guides' pixel words and plates, on a sheet of
// Ink & Glyph paper. Game layer: hand-drawn, not Astryx.

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { INK_SOFT, text, VERMILION } from "../../world/controls/glyphs";
import type { Card } from "../../world/mobile/lifecycle";
import { cardPlate, phoneTurn, titleFoil } from "../../world/mobile/art";
import styles from "./card.module.css";
import PixelGlyph from "./PixelGlyph";

/** Where "read the short version" goes: the whole site on one plain page. */
export const SHORT_VERSION = "/recruiter";

export interface FlightCardProps {
  card: Card;
  /** CSS pixels per glyph pixel. */
  px: number;
  phone: boolean;
  /** An iPhone in a Safari tab: the Home Screen is the only way to the whole screen. */
  homeScreenHint: boolean;
  /** Played sideways: the paused card offers to turn the other way. */
  sideways: boolean;
  /** Bytes fetched before the first view, from the build; 0 when unknown. */
  startBytes: number;
  onTakeWing(): void;
  onFlyOn(): void;
  onSideways(): void;
  onOtherWay(): void;
  onOptions(): void;
}

function Words({ children, px, ink, say }: { children: string; px: number; ink?: number; say?: string }) {
  return (
    <>
      <PixelGlyph sprite={text(children, ink)} px={px} />
      <span className={styles.sr}>{say ?? children}</span>
    </>
  );
}

function Button({ word, say, lit, px, onClick }: { word: string; say: string; lit?: boolean; px: number; onClick(): void }) {
  return (
    <button type="button" className={`${styles.button} ${lit ? styles.primary : ""}`} onClick={onClick} data-act={word.replace(/ /g, "-")}>
      <PixelGlyph sprite={cardPlate(word, lit)} px={px} />
      <span className={styles.sr}>{say}</span>
    </button>
  );
}

function Leave({ px }: { px: number }) {
  return (
    <Link className={styles.action} href="/">
      <PixelGlyph sprite={text("¶", INK_SOFT)} px={px} />
      <Words px={px}>leave the world</Words>
    </Link>
  );
}

function megabytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return mb >= 10 ? `${Math.round(mb)} mb` : `${mb.toFixed(1)} mb`;
}

export default function FlightCard(p: FlightCardProps) {
  if (!p.card) return null;
  const px = p.px;
  let body: ReactNode;
  let title: string;
  if (p.card === "gate") {
    title = "before you fly";
    body = (
      <>
        {p.phone ? (
          <p className={styles.line}>
            <PixelGlyph sprite={phoneTurn()} px={px} />
            <Words px={px}>hold your phone sideways</Words>
          </p>
        ) : null}
        {p.startBytes > 0 ? (
          <p className={styles.line}>
            <Words px={px} say={`About ${megabytes(p.startBytes).replace("mb", "megabytes")} to start.`}>{`about ${megabytes(p.startBytes)} to start`}</Words>
          </p>
        ) : null}
        <p className={styles.buttons}>
          <Button word="take wing" say="Take wing: start flying" lit px={px} onClick={p.onTakeWing} />
        </p>
        <Link className={styles.action} href={SHORT_VERSION}>
          <PixelGlyph sprite={text("¶", INK_SOFT)} px={px} />
          <Words px={px}>read the short version instead</Words>
        </Link>
      </>
    );
  } else if (p.card === "upright") {
    title = "turn your phone";
    body = (
      <>
        <p className={styles.line}>
          <PixelGlyph sprite={phoneTurn()} px={px} />
          <Words px={px}>sideways to fly on</Words>
        </p>
        <p className={styles.note}>
          <Words px={px} say="If the screen will not turn, its rotation lock may be on.">{"screen won't turn?"}</Words>
        </p>
        <p className={styles.buttons}>
          <Button word="play sideways anyway" say="Play sideways anyway" px={px} onClick={p.onSideways} />
        </p>
        <Leave px={px} />
      </>
    );
  } else {
    title = "paused";
    body = (
      <>
        <p className={styles.buttons}>
          <Button word="fly on" say="Fly on" lit px={px} onClick={p.onFlyOn} />
          <Button word="options" say="Options" px={px} onClick={p.onOptions} />
          {p.sideways ? <Button word="other way round" say="Turn the picture the other way round" px={px} onClick={p.onOtherWay} /> : null}
        </p>
        {p.homeScreenHint ? (
          <p className={styles.note}>
            <Words px={px} say="For the whole screen, add this page to your Home Screen: Share, then Add to Home Screen.">
              for the whole screen:
            </Words>
            <PixelGlyph sprite={text("share → add to home screen")} px={px} />
          </p>
        ) : null}
        <Leave px={px} />
      </>
    );
  }
  return (
    <div className={styles.veil} data-touch-skip="" data-card={p.card}>
      {/* A dialog left in the page (open, not modal), so it turns with the flight when played sideways. */}
      <dialog open className={styles.card} style={{ "--px": `${px}px` } as CSSProperties} aria-labelledby="flight-card-title">
        <h2 id="flight-card-title" className={styles.title}>
          <PixelGlyph sprite={titleFoil()} px={px} />
          <Words px={px} ink={VERMILION}>
            {title}
          </Words>
        </h2>
        {body}
      </dialog>
    </div>
  );
}
