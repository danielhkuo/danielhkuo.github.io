"use client";

import { useRef } from "react";
import Terminal from "../../components/terminal/Terminal";
import { registerFrom, type LandmarkSet } from "../../world/sites/landmarks";
import Codex, { LandPrompt } from "./Codex";
import styles from "./flight.module.css";
import { DiscoveryCaption, Hint, LoadFailed, StatsReadout } from "./Overlays";
import { FRAME_H, FRAME_W } from "./session";
import { useFlight } from "./useFlight";
import { useFrameScale } from "./useFrameScale";
import { useTerminalDrawer, type TerminalProps } from "./useTerminalDrawer";

export interface FlightProps {
  /** The landmarks and what each holds, worked out at build time; null when the build had no world. */
  landmarks: LandmarkSet | null;
  /** What the terminal at the abbey is handed, as on the home page. */
  terminal: TerminalProps;
}

export default function Flight({ landmarks, terminal }: FlightProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scale = useFrameScale(FRAME_W, FRAME_H);
  const drawer = useTerminalDrawer(terminal);
  const flight = useFlight(canvasRef, landmarks, drawer.link);

  if (flight.failed) return <LoadFailed />;

  const at = flight.phase.at;
  return (
    <div className={styles.page}>
      <canvas
        ref={canvasRef}
        width={FRAME_W}
        height={FRAME_H}
        className={styles.canvas}
        style={{ width: FRAME_W * scale, height: FRAME_H * scale }}
      />
      <DiscoveryCaption caption={flight.caption} />
      {flight.offer && flight.phase.kind === "flying" ? <LandPrompt landmark={flight.offer} onLand={flight.land} /> : null}
      {at ? (
        <Codex
          landmark={at}
          register={landmarks ? registerFrom(at, landmarks) : []}
          onTakeOff={flight.takeOff}
          onOpenTerminal={drawer.show}
        />
      ) : null}
      {at?.holds.kind === "about" ? <Terminal open={drawer.open} onClose={drawer.link.close} api={drawer.api} /> : null}
      <Hint phase={flight.phase.kind} />
      {flight.stats ? <StatsReadout stats={flight.stats} /> : null}
    </div>
  );
}
