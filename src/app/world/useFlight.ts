"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Device } from "../../world/controls/guides";
import type { Landmark, LandmarkSet } from "../../world/sites/landmarks";
import { getOptions } from "./optionsStore";
import { getFrameFit } from "./useFrameScale";
import { startFlight, type FlightSession, type FlightStats, type PhaseKind } from "./session";
import type { TerminalLink } from "./useTerminalDrawer";

export interface Caption {
  /** The last line shown; kept while it fades. */
  text: string | null;
  visible: boolean;
}

/** The options panel, as the flight sees it: whether it holds the keys, and how to open or close it. */
export interface PanelLink {
  isOpen(): boolean;
  toggle(): void;
}

export interface FlightView {
  failed: boolean;
  /** The phase, and the landmark rested at once landed. */
  phase: { kind: PhaseKind; at: Landmark | null };
  caption: Caption;
  /** The guide by the dragon, in words, for the live region. */
  say: string;
  /** The device the guides are drawn for. */
  device: Device;
  /** With ?stats. */
  stats: FlightStats | null;
  takeOff(): void;
  teachAgain(): void;
}

/** Runs a flight on the canvas while the page is open, and mirrors what it reports into React state. */
export function useFlight(
  canvas: RefObject<HTMLCanvasElement | null>, landmarks: LandmarkSet | null, terminal: TerminalLink, panel: PanelLink,
): FlightView {
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState<FlightView["phase"]>({ kind: "flying", at: null });
  const [caption, setCaption] = useState<Caption>({ text: null, visible: false });
  const [say, setSay] = useState("");
  const [device, setDevice] = useState<Device>("keyboard");
  const [stats, setStats] = useState<FlightStats | null>(null);
  const session = useRef<FlightSession | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const s = startFlight(
      el,
      { landmarks, terminalOpen: terminal.isOpen, closeTerminal: terminal.close, optionsOpen: panel.isOpen, options: getOptions, frame: getFrameFit },
      {
        failed: () => setFailed(true),
        phase: (kind, at) => {
          setPhase({ kind, at });
          // Taking off puts the terminal away with the Codex.
          if (kind === "flying") terminal.dismiss();
        },
        caption: (text) => setCaption((c) => (text === null ? { text: c.text, visible: false } : { text, visible: true })),
        stats: setStats,
        say: setSay,
        device: setDevice,
        toggleOptions: panel.toggle,
      },
    );
    session.current = s;
    return () => {
      s.dispose();
      session.current = null;
    };
    // `landmarks` is a build-time prop and the links are stable: the flight runs once per page.
  }, [canvas, landmarks, terminal, panel]);

  const takeOff = useCallback(() => session.current?.takeOff(), []);
  const teachAgain = useCallback(() => session.current?.teachAgain(), []);
  return { failed, phase, caption, say, device, stats, takeOff, teachAgain };
}
