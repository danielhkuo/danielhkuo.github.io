"use client";

// The quest offer: a small card a few seconds after the lesson. It asks one thing and does not stop the flight. It
// takes no focus, so Space and the arrows still fly: Q follows, Esc is not now, or a click.
// Game layer: hand-drawn, not Astryx.

import { useEffect, useState, type CSSProperties } from "react";
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
}

function Words({ children, px, ink }: { children: string; px: number; ink?: number }) {
  return (
    <>
      <PixelGlyph sprite={text(children, ink)} px={px} />
      <span className={styles.sr}>{children}</span>
    </>
  );
}

export default function QuestCard({ px, lessonDone, covered }: QuestCardProps) {
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
    return () => {
      setQuestCardUp(false);
      window.removeEventListener("keydown", take, true);
    };
  }, [shown]);

  if (!shown) return null;

  const pick = (mode: "on" | "off") => setQuest(choose(getQuest(), mode));
  return (
    // Non-modal, as the Codex is: the flight keeps its keys.
    <dialog
      open
      className={`${styles.card} ${styles.quest}`}
      style={{ "--px": `${px}px` } as CSSProperties}
      aria-labelledby="quest-title"
      aria-live="polite"
      data-touch-skip=""
    >
      <h2 id="quest-title" className={styles.title}>
        <PixelGlyph sprite={titleFoil()} px={px} />
        <Words px={px} ink={VERMILION}>
          the quest
        </Words>
      </h2>
      <p className={styles.line}>
        <Words px={px}>five odd things, each a fact about daniel.</Words>
      </p>
      <p className={styles.buttons}>
        <button type="button" className={styles.button} onClick={() => pick("off")}>
          <PixelGlyph sprite={cardPlate("not now")} px={px} />
          <span className={styles.sr}>not now</span>
        </button>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => pick("on")}>
          <PixelGlyph sprite={cardPlate("follow the quest", true)} px={px} />
          <span className={styles.sr}>follow the quest</span>
        </button>
      </p>
    </dialog>
  );
}
