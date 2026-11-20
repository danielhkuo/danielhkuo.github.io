"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import Terminal from "../../components/terminal/Terminal";
import { registerFrom, type LandmarkSet } from "../../world/sites/landmarks";
import Codex from "./Codex";
import FlightCard from "./FlightCard";
import styles from "./flight.module.css";
import mobile from "./mobile.module.css";
import OptionsPanel, { Corner } from "./OptionsPanel";
import { setOptions, useOptions } from "./optionsStore";
import { DiscoveryCaption, GuideLine, LoadFailed, StatsReadout } from "./Overlays";
import SoundToggle from "./SoundToggle";
import { HOLD_AT, type HoldAt } from "../../world/runtime/hold";
import { useFlight, type TitleLink } from "./useFlight";
import { useSound } from "./useSound";
import { useFrameFit } from "./useFrameScale";
import { usePanel, useReveal } from "./usePanel";
import { phoneFrame, usePhoneFlight } from "./usePhoneFlight";
import { useTerminalDrawer, type TerminalProps } from "./useTerminalDrawer";
import { MINIMAL_PAGE } from "../../components/title/phone/copy";

/** The corner shows this long after the page opens and after the pointer last moved, ms. */
const REVEAL_MS = 4000;

/**
 * On a phone the abbey has no terminal (the shell lives in the desktop title's): its button opens the minimal version
 * instead, the whole site as one text file, and says so.
 */
const PHONE_ABOUT = {
  open: (): void => {
    window.location.href = MINIMAL_PAGE;
  },
  label: "Read the minimal version",
};

export interface FlightProps {
  /** The landmarks and what each holds, worked out at build time; null when the build had no world. */
  landmarks: LandmarkSet | null;
  /** What the terminal at the abbey is handed, as on the home page. */
  terminal: TerminalProps;
  /** Bytes fetched before the first view (the core and the start's regions), from the build; 0 when unknown. */
  startBytes: number;
  /** The world waits behind the title. */
  held?: boolean;
  /** Where the held head is drawn, as shares of the frame from its top-left corner (beside the title's button). */
  holdAt?: HoldAt;
  /** Esc and Leave go back to the title instead of to "/". */
  onLeave?: () => void;
  /** The first full view is drawn. */
  onReady?: () => void;
}

export default function Flight({ landmarks, terminal, startBytes, held, holdAt, onLeave, onReady }: FlightProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const windowFit = useFrameFit();
  const drawer = useTerminalDrawer(terminal);
  const panel = usePanel();
  const { shell, touch } = usePhoneFlight(rootRef, panel.open);
  // The sound's control is made first, so the flight finds it when the world has loaded.
  const sound = useSound();
  // The latest values, so the flight's link can be built once and still see this render's.
  const heldRef = useRef(held);
  const holdAtRef = useRef(holdAt);
  const leaveRef = useRef(onLeave);
  const readyRef = useRef(onReady);
  heldRef.current = held;
  holdAtRef.current = holdAt;
  leaveRef.current = onLeave;
  readyRef.current = onReady;
  const title = useMemo<TitleLink | undefined>(() => {
    // Built once from the first values. /world passes none, so it gets no link and the flight is unchanged.
    if (heldRef.current === undefined && leaveRef.current === undefined && readyRef.current === undefined) return undefined;
    return {
      held: () => heldRef.current ?? false,
      holdAt: () => holdAtRef.current ?? HOLD_AT,
      leave: () => leaveRef.current?.(),
      ready: () => readyRef.current?.(),
    };
  }, []);
  // The title's Settings opens the world's options. show is stable, so the listener is added once.
  const openOptions = panel.show;
  useEffect(() => {
    const open = () => openOptions();
    window.addEventListener("world:options", open);
    return () => window.removeEventListener("world:options", open);
  }, [openOptions]);
  const flight = useFlight(canvasRef, landmarks, drawer.link, panel.link, touch, sound.ref, title);
  const options = useOptions();
  const revealed = useReveal(REVEAL_MS);
  // What the abbey's button opens, and says it opens.
  const about = shell.phone ? PHONE_ABOUT : { open: drawer.show, label: "Open the terminal" };

  if (flight.failed) return <LoadFailed />;

  const { fit, page: touchPage, turned } = phoneFrame(shell, windowFit);
  const at = flight.phase.at;
  // The panel and the corner draw their glyphs a step finer than the world's pixel, 2 or 3 CSS pixels, so the panel
  // stays small on any window.
  const px = Math.max(2, Math.min(3, Math.round(fit.css) - 1));
  // The frame covers the window from its top-left corner; the session sizes the canvas itself to fit.w × fit.h.
  const stage = { width: fit.w * fit.css, height: fit.h * fit.css } as CSSProperties;
  // Round the frame the page takes the paper's colour in the hour's light: dark at night, as the frame is.
  const paper = flight.paper ? ({ background: flight.paper } as CSSProperties) : undefined;
  // On a touch-first screen the page is also the game layer: sized to the visible area, and turned when played sideways.
  const page = paper || touchPage ? { ...paper, ...touchPage } : undefined;
  return (
    <div ref={rootRef} className={`${styles.page} ${touchPage ? mobile.touchPage : ""}`} style={page} data-motion={options.motion}>
      {held ? null : <SoundToggle control={sound.control} />}
      <div className={styles.stage} style={stage}>
        <canvas ref={canvasRef} className={styles.canvas} />
        {panel.open || held ? null : <Corner px={px} device={flight.device} phase={flight.phase.kind} shown={revealed} onOpen={panel.show} onLeave={onLeave} />}
      </div>
      <GuideLine say={flight.say} />
      {held ? null : <DiscoveryCaption caption={flight.caption} />}
      {at ? (
        <Codex
          landmark={at}
          register={landmarks ? registerFrom(at, landmarks) : []}
          onTakeOff={flight.takeOff}
          onOpenTerminal={about.open}
          openLabel={about.label}
        />
      ) : null}
      {at?.holds.kind === "about" && !shell.phone ? <Terminal open={drawer.open} onClose={drawer.link.close} api={drawer.api} /> : null}
      <OptionsPanel
        open={panel.open}
        px={px}
        options={options}
        device={flight.device}
        platform={shell.platform}
        onChange={setOptions}
        sound={sound.control}
        onTeach={() => {
          flight.teachAgain();
          panel.link.toggle();
        }}
        onClose={panel.closed}
        onLeave={onLeave}
      />
      <FlightCard
        card={shell.card}
        px={px}
        phone={shell.phone}
        homeScreenHint={shell.platform === "ios" && shell.phone && !shell.standalone}
        sideways={turned}
        startBytes={startBytes}
        onTakeWing={shell.takeWing}
        onFlyOn={shell.flyOn}
        onSideways={shell.playSideways}
        onOtherWay={shell.otherWay}
        onOptions={panel.show}
      />
      {flight.stats ? <StatsReadout stats={flight.stats} /> : null}
    </div>
  );
}
