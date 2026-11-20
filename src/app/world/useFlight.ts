"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Device } from "../../world/controls/guides";
import type { Landmark, LandmarkSet } from "../../world/sites/landmarks";
import { getOptions } from "./optionsStore";
import { getFrameFit } from "./useFrameScale";
import { startFlight, type FlightSession, type FlightSetup, type FlightStats, type PhaseKind } from "./session";
import type { SoundControl } from "../../world/sound/control";
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

/** What a touch flight adds: the shell's pause, the phone's budgets, the touch controls and the ticks. */
export interface TouchLink {
  paused(): boolean;
  stall(): void;
  phone(): boolean;
  touch: NonNullable<FlightSetup["touch"]>;
  buzz(what: "landed" | "discovery"): void;
  /** The frame wanted, when the phone decides it (played sideways); the window's otherwise. */
  frame?(): { w: number; h: number };
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
  /** The paper's colour in the light of the moment, as CSS, for the page round the frame. */
  paper: string;
  /** The lesson is done this visit, or was already learned. False until then. */
  lessonDone: boolean;
  takeOff(): void;
  teachAgain(): void;
}

/** Runs a flight on the canvas while the page is open, and mirrors what it reports into React state. */
export function useFlight(
  canvas: RefObject<HTMLCanvasElement | null>, landmarks: LandmarkSet | null, terminal: TerminalLink, panel: PanelLink, touch: TouchLink,
  sound?: RefObject<SoundControl | null>,
): FlightView {
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState<FlightView["phase"]>({ kind: "flying", at: null });
  const [caption, setCaption] = useState<Caption>({ text: null, visible: false });
  const [say, setSay] = useState("");
  const [device, setDevice] = useState<Device>("keyboard");
  const [stats, setStats] = useState<FlightStats | null>(null);
  const [paper, setPaper] = useState("");
  const [lessonDone, setLessonDone] = useState(false);
  const session = useRef<FlightSession | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const s = startFlight(
      el,
      {
        landmarks,
        terminalOpen: terminal.isOpen,
        closeTerminal: terminal.close,
        optionsOpen: panel.isOpen,
        options: getOptions,
        paused: touch.paused,
        phone: touch.phone,
        touch: touch.touch,
        // Played sideways, the frame is fitted to the turned layer; otherwise to the window, as everywhere.
        frame: touch.frame ?? getFrameFit,
        sound: () => sound?.current ?? null,
      },
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
        paper: setPaper,
        stall: touch.stall,
        buzz: touch.buzz,
        lessonDone: () => setLessonDone(true),
      },
    );
    session.current = s;
    return () => {
      s.dispose();
      session.current = null;
    };
    // `landmarks` is a build-time prop and the links are stable: the flight runs once per page.
  }, [canvas, landmarks, terminal, panel, touch, sound]);

  const takeOff = useCallback(() => session.current?.takeOff(), []);
  const teachAgain = useCallback(() => session.current?.teachAgain(), []);
  return { failed, phase, caption, say, device, stats, paper, lessonDone, takeOff, teachAgain };
}
