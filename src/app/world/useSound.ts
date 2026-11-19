"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { browserEnv, createSoundControl, type SoundControl } from "../../world/sound/control";
import { getOptions } from "./optionsStore";

export interface SoundLink {
  /** The control, for the toggle and the options panel: null until the page has mounted. */
  control: SoundControl | null;
  /** The same, for the flight's frame loop to read when the world has loaded. */
  ref: RefObject<SoundControl | null>;
}

/**
 * The world's sound for this page: made when the page mounts (off until asked for, so nothing of it is loaded before),
 * disposed when it leaves. With ?stats&soundlog the flight is recorded for the sound bench; ?soundarm picks a
 * measuring arm. Call it before `useFlight`, so the control exists when the flight's own effect runs.
 */
export function useSound(): SoundLink {
  const [control, setControl] = useState<SoundControl | null>(null);
  const ref = useRef<SoundControl | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const statsOn = params.has("stats");
    const made = createSoundControl(
      browserEnv(statsOn && params.has("soundlog"), statsOn ? (params.get("soundarm") ?? undefined) : undefined, () => getOptions().motion === "reduced"),
    );
    ref.current = made;
    // The toggle is drawn once the control exists (the server and the first paint have none).
    const publish = () => setControl(made);
    publish();
    return () => {
      ref.current = null;
      made.dispose();
    };
  }, []);
  return { control, ref };
}
