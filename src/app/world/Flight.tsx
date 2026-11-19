"use client";

import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";
import Terminal from "../../components/terminal/Terminal";
import { fitScale } from "../../world/runtime/fit";
import { layerTransform } from "../../world/mobile/turned";
import { registerFrom, type LandmarkSet } from "../../world/sites/landmarks";
import Codex from "./Codex";
import FlightCard from "./FlightCard";
import styles from "./flight.module.css";
import mobile from "./mobile.module.css";
import OptionsPanel, { Corner } from "./OptionsPanel";
import { getOptions, setOptions, useOptions } from "./optionsStore";
import { DiscoveryCaption, GuideLine, LoadFailed, StatsReadout } from "./Overlays";
import { FRAME_H, FRAME_W } from "./session";
import { createTouchLayer } from "./touchLayer";
import { useFlight, type TouchLink } from "./useFlight";
import { useFrameScale } from "./useFrameScale";
import { usePanel, useReveal } from "./usePanel";
import { useShell } from "./useShell";
import { useTerminalDrawer, type TerminalProps } from "./useTerminalDrawer";

/** The corner shows this long after the page opens and after the pointer last moved, ms. */
const REVEAL_MS = 4000;
/** On a phone the abbey's terminal opens on its own page, upright, where a keyboard leaves room to read (spec 11). */
export const TERMINAL_PAGE = "/artificer#terminal";

/** Light ticks on a phone that can (Android): a landing touching down, a discovery. */
const BUZZ = { landed: [25], discovery: [8, 40, 8] } as const;

export interface FlightProps {
  /** The landmarks and what each holds, worked out at build time; null when the build had no world. */
  landmarks: LandmarkSet | null;
  /** What the terminal at the abbey is handed, as on the home page. */
  terminal: TerminalProps;
  /** Bytes fetched before the first view (the core and the start's regions), from the build; 0 when unknown. */
  startBytes: number;
}

export default function Flight({ landmarks, terminal, startBytes }: FlightProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const shared = useFrameScale(FRAME_W, FRAME_H);
  const drawer = useTerminalDrawer(terminal);
  const panel = usePanel();
  const shell = useShell(rootRef);
  const { link: shellLink, view: shellView, platform, panel: shellPanel } = shell;
  const phoneRef = useRef(false);
  useEffect(() => {
    phoneRef.current = shell.phone;
  }, [shell.phone]);

  const buzz = useCallback((what: keyof typeof BUZZ) => {
    if (getOptions().buzz !== "on" || typeof navigator.vibrate !== "function") return;
    try {
      navigator.vibrate([...BUZZ[what]]);
    } catch {
      // vibration refused: nothing to do
    }
  }, []);

  const touchLink = useMemo<TouchLink>(
    () => ({
      paused: shellLink.paused,
      stall: shellLink.stall,
      phone: () => phoneRef.current,
      buzz,
      touch: (canvas, hooks) => {
        const root = rootRef.current;
        if (!root) return null;
        return createTouchLayer({ root, canvas, options: hooks.options, platform, view: shellView, ghost: hooks.ghost, touched: hooks.touched });
      },
    }),
    [shellLink, shellView, platform, buzz],
  );
  const flight = useFlight(canvasRef, landmarks, drawer.link, panel.link, touchLink);
  const options = useOptions();
  const revealed = useReveal(REVEAL_MS);

  // On a touch screen the options panel holds the flight while it is open.
  useEffect(() => {
    shellPanel(panel.open);
  }, [panel.open, shellPanel]);

  if (flight.failed) return <LoadFailed />;

  const touchFirst = shell.touchFirst === true;
  const turned = touchFirst && shell.turn !== 0;
  // Played sideways, the frame is fitted to the turned layer, whose sides are the screen's swapped.
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const scale = turned ? fitScale(shell.layer.w * dpr, shell.layer.h * dpr, FRAME_W, FRAME_H) / dpr : shared;
  const at = flight.phase.at;
  // The panel and the corner draw their glyphs a step finer than the world's pixel, 2 or 3 CSS pixels, so the panel
  // stays small on any window.
  const px = Math.max(2, Math.min(3, Math.round(scale) - 1));
  const stage = { width: FRAME_W * scale, height: FRAME_H * scale } as CSSProperties;
  // On a touch screen the page is exactly the visible area, fixed, and takes every touch itself (spec 5).
  const page: CSSProperties | undefined = touchFirst
    ? ({
        "--layer-w": `${shell.layer.w}px`,
        "--layer-h": `${shell.layer.h}px`,
        "--vvh": `${shell.layer.h}px`,
        minHeight: 0,
        transform: turned ? layerTransform(shell.layer.h, shell.layer.w, shell.turn) : undefined,
      } as CSSProperties)
    : undefined;
  const openTerminal = shell.phone
    ? () => {
        window.location.href = TERMINAL_PAGE;
      }
    : drawer.show;
  return (
    <div ref={rootRef} className={`${styles.page} ${touchFirst ? mobile.touchPage : ""}`} style={page} data-motion={options.motion}>
      <div className={styles.stage} style={stage}>
        <canvas ref={canvasRef} width={FRAME_W} height={FRAME_H} className={styles.canvas} />
        {panel.open ? null : <Corner px={px} device={flight.device} phase={flight.phase.kind} shown={revealed} onOpen={panel.show} />}
      </div>
      <GuideLine say={flight.say} />
      <DiscoveryCaption caption={flight.caption} />
      {at ? (
        <Codex
          landmark={at}
          register={landmarks ? registerFrom(at, landmarks) : []}
          onTakeOff={flight.takeOff}
          onOpenTerminal={openTerminal}
        />
      ) : null}
      {at?.holds.kind === "about" && !shell.phone ? <Terminal open={drawer.open} onClose={drawer.link.close} api={drawer.api} /> : null}
      <OptionsPanel
        open={panel.open}
        px={px}
        options={options}
        device={flight.device}
        platform={platform}
        onChange={setOptions}
        onTeach={() => {
          flight.teachAgain();
          panel.link.toggle();
        }}
        onClose={panel.closed}
      />
      <FlightCard
        card={shell.card}
        px={px}
        phone={shell.phone}
        homeScreenHint={platform === "ios" && shell.phone && !shell.standalone}
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
