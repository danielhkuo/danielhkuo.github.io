"use client";

import { useRef, type CSSProperties } from "react";
import Terminal from "../../components/terminal/Terminal";
import { registerFrom, type LandmarkSet } from "../../world/sites/landmarks";
import Codex from "./Codex";
import styles from "./flight.module.css";
import OptionsPanel, { OptionsButton } from "./OptionsPanel";
import { setOptions, useOptions } from "./optionsStore";
import { DiscoveryCaption, GuideLine, LoadFailed, StatsReadout } from "./Overlays";
import { FRAME_H, FRAME_W } from "./session";
import { useFlight } from "./useFlight";
import { useFrameScale } from "./useFrameScale";
import { usePanel, useReveal } from "./usePanel";
import { useTerminalDrawer, type TerminalProps } from "./useTerminalDrawer";

/** The corner button shows this long after the page opens and after the pointer last moved, ms. */
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
  // The panel and the corner button share the world's pixel, kept between 2 and 3 CSS pixels so the panel stays small.
  const px = Math.max(2, Math.min(3, Math.round(scale)));
  const stage = { width: FRAME_W * scale, height: FRAME_H * scale } as CSSProperties;
  return (
    <div className={styles.page}>
      <div className={styles.stage} style={stage}>
        <canvas ref={canvasRef} width={FRAME_W} height={FRAME_H} className={styles.canvas} />
        {panel.open ? null : <OptionsButton px={px} device={flight.device} shown={revealed} onOpen={panel.show} />}
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
