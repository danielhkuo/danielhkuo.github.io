"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Landmark, LandmarkSet } from "../../world/sites/landmarks";
import { startFlight, type FlightSession, type FlightStats, type PhaseKind } from "./session";
import type { TerminalLink } from "./useTerminalDrawer";

export interface Caption {
  /** The last line shown; kept while it fades. */
  text: string | null;
  visible: boolean;
}

export interface FlightView {
  failed: boolean;
  /** The landmark on offer while flying. */
  offer: Landmark | null;
  /** The phase, and the landmark rested at once landed. */
  phase: { kind: PhaseKind; at: Landmark | null };
  caption: Caption;
  /** With ?stats. */
  stats: FlightStats | null;
  land(): void;
  takeOff(): void;
}

/** Runs a flight on the canvas while the page is open, and mirrors what it reports into React state. */
export function useFlight(canvas: RefObject<HTMLCanvasElement | null>, landmarks: LandmarkSet | null, terminal: TerminalLink): FlightView {
  const [failed, setFailed] = useState(false);
  const [offer, setOffer] = useState<Landmark | null>(null);
  const [phase, setPhase] = useState<FlightView["phase"]>({ kind: "flying", at: null });
  const [caption, setCaption] = useState<Caption>({ text: null, visible: false });
  const [stats, setStats] = useState<FlightStats | null>(null);
  const session = useRef<FlightSession | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const s = startFlight(
      el,
      { landmarks, terminalOpen: terminal.isOpen, closeTerminal: terminal.close },
      {
        failed: () => setFailed(true),
        offer: setOffer,
        phase: (kind, at) => {
          setPhase({ kind, at });
          // Taking off puts the terminal away with the Codex.
          if (kind === "flying") terminal.dismiss();
        },
        caption: (text) => setCaption((c) => (text === null ? { text: c.text, visible: false } : { text, visible: true })),
        stats: setStats,
      },
    );
    session.current = s;
    return () => {
      s.dispose();
      session.current = null;
    };
    // `landmarks` is a build-time prop and the terminal's link is stable: the flight runs once per page.
  }, [canvas, landmarks, terminal]);

  const land = useCallback(() => session.current?.land(), []);
  const takeOff = useCallback(() => session.current?.takeOff(), []);
  return { failed, offer, phase, caption, stats, land, takeOff };
}
