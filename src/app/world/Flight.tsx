"use client";

import { useRef, type CSSProperties } from "react";
import Terminal from "../../components/terminal/Terminal";
import { registerFrom, type LandmarkSet } from "../../world/sites/landmarks";
import Codex from "./Codex";
import styles from "./flight.module.css";
import OptionsPanel, { Corner } from "./OptionsPanel";
import { setOptions, useOptions } from "./optionsStore";
import { DiscoveryCaption, GuideLine, LoadFailed, StatsReadout } from "./Overlays";
import { FRAME_H, FRAME_W } from "./session";
import { useFlight } from "./useFlight";
import { useFrameScale } from "./useFrameScale";
import { usePanel, useReveal } from "./usePanel";
import { useTerminalDrawer, type TerminalProps } from "./useTerminalDrawer";

/** The corner shows this long after the page opens and after the pointer last moved, ms. */
const REVEAL_MS = 4000;

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
  const panel = usePanel();
  const flight = useFlight(canvasRef, landmarks, drawer.link, panel.link);
  const options = useOptions();
  const revealed = useReveal(REVEAL_MS);

  if (flight.failed) return <LoadFailed />;

  const at = flight.phase.at;
  // The panel and the corner draw their glyphs a step finer than the world's pixel, 2 or 3 CSS pixels, so the panel
  // stays small on any window.
  const px = Math.max(2, Math.min(3, Math.round(scale) - 1));
  const stage = { width: FRAME_W * scale, height: FRAME_H * scale } as CSSProperties;
  // Round the frame the page takes the paper's colour in the hour's light: dark at night, as the frame is.
  const page = flight.paper ? ({ background: flight.paper } as CSSProperties) : undefined;
  return (
    <div className={styles.page} style={page} data-motion={options.motion}>
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
          onOpenTerminal={drawer.show}
        />
      ) : null}
      {at?.holds.kind === "about" ? <Terminal open={drawer.open} onClose={drawer.link.close} api={drawer.api} /> : null}
      <OptionsPanel
        open={panel.open}
        px={px}
        options={options}
        onChange={setOptions}
        onTeach={() => {
          flight.teachAgain();
          panel.link.toggle();
        }}
        onClose={panel.closed}
      />
      {flight.stats ? <StatsReadout stats={flight.stats} /> : null}
    </div>
  );
}
