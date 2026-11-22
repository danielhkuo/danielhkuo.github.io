"use client";

// The quest offer: a small card a few seconds after the lesson. It asks one thing. On a desktop it does not stop the
// flight and takes no focus, so Space and the arrows still fly: Q follows, Esc is not now, or a click. On a phone the
// thumbs are on the glass where the card would sit, so it holds the flight like the phone's other cards, centred over
// the frame, until it is answered.
// Game layer: hand-drawn, not Astryx.

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { text, VERMILION } from "../../world/controls/glyphs";
import { cardPlate, titleFoil } from "../../world/mobile/art";
import { choose, offerDue } from "../../world/story/quest";
import styles from "./card.module.css";
import PixelGlyph from "./PixelGlyph";
import { getQuest, setQuest, setQuestCardUp, useQuest } from "./questStore";

/** The offer waits this long after the lesson, so the two do not arrive together. */
const OFFER_AFTER = 4000;

export interface QuestCardProps {
  /** CSS pixels per glyph pixel. */
  px: number;
  /** The lesson has finished this visit, or was already learned. */
  lessonDone: boolean;
  /** The options, a flight card, the terminal or the Codex is open. */
  covered: boolean;
  /**
   * A phone: the card is centred on a veil and holds the flight while it is up (`hold(true)`, then `hold(false)` when
   * it is answered or goes). Without it the card sits at the foot of the frame and the flight goes on.
   */
  hold?: (up: boolean) => void;
}

function Words({ children, px, ink }: { children: string; px: number; ink?: number }) {
  return (
    <>
      <PixelGlyph sprite={text(children, ink)} px={px} />
      <span className={styles.sr}>{children}</span>
    </>
  );
}

/** The words of `s`, each keyed by itself and how many times it has come before (a word may repeat). */
function wordsOf(s: string): { word: string; key: string }[] {
  const seen = new Map<string, number>();
  return s.split(" ").map((word) => {
    const n = (seen.get(word) ?? 0) + 1;
    seen.set(word, n);
    return { word, key: `${word}#${n}` };
  });
}

/** A sentence that wraps between its words as the card narrows: a glyph a word, one string for readers. */
function Sentence({ children, px }: { children: string; px: number }) {
  return (
    <span className={styles.sentence}>
      {wordsOf(children).map(({ word, key }) => (
        <PixelGlyph key={key} sprite={text(word)} px={px} />
      ))}
      <span className={styles.sr}>{children}</span>
    </span>
  );
}

export default function QuestCard({ px, lessonDone, covered, hold }: QuestCardProps) {
  const quest = useQuest();
  const [waited, setWaited] = useState(false);
  const shown = offerDue(quest, lessonDone) && waited && !covered;

  useEffect(() => {
    if (!lessonDone) return;
    const id = window.setTimeout(() => setWaited(true), OFFER_AFTER);
    return () => window.clearTimeout(id);
  }, [lessonDone]);

  useEffect(() => {
    if (!shown) return;
    const take = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const mode = e.key === "Escape" ? "off" : e.key === "q" || e.key === "Q" ? "on" : null;
      if (!mode) return;
      e.preventDefault();
      e.stopPropagation();
      setQuest(choose(getQuest(), mode));
    };
    window.addEventListener("keydown", take, true);
    setQuestCardUp(true);
    hold?.(true);
    return () => {
      setQuestCardUp(false);
      hold?.(false);
      window.removeEventListener("keydown", take, true);
    };
  }, [shown, hold]);

  if (!shown) return null;

  const pick = (mode: "on" | "off") => setQuest(choose(getQuest(), mode));
  const card: ReactNode = (
    // Non-modal, as the Codex is: on a desktop the flight keeps its keys.
    <dialog
      open
      className={`${styles.card} ${styles.offer} ${hold ? "" : styles.quest}`}
      style={{ "--px": `${px}px` } as CSSProperties}
      aria-labelledby="quest-title"
      aria-live="polite"
      data-touch-skip=""
    >
      <h2 id="quest-title" className={styles.title}>
        <PixelGlyph sprite={titleFoil()} px={px} />
        <Words px={px} ink={VERMILION}>
          the rose window
        </Words>
      </h2>
      <p className={styles.line}>
        <Sentence px={px}>{"the hall's window is missing five panes of glass."}</Sentence>
      </p>
      <p className={styles.buttons}>
        <button type="button" className={styles.button} onClick={() => pick("off")}>
          <PixelGlyph sprite={cardPlate("not now")} px={px} />
          <span className={styles.sr}>not now</span>
        </button>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => pick("on")}>
          <PixelGlyph sprite={cardPlate("look for them", true)} px={px} />
          <span className={styles.sr}>look for them</span>
        </button>
      </p>
    </dialog>
  );
  // On a phone the card stands on the same veil as the phone's other cards, and turns with the flight when played
  // sideways. It is not one of the shell's cards: [data-card] stays theirs.
  return hold ? (
    <div className={styles.veil} data-touch-skip="">
      {card}
    </div>
  ) : (
    card
  );
}
