"use client";

// The phone's part of the flight page (mobile spec): the shell (cards, lock, pauses), the touch controls the session
// draws, the light ticks, and how the frame sits on a touch screen, played sideways or not. Kept out of Flight so the
// page reads as it did on a desktop.

import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type RefObject } from "react";
import { fitScale } from "../../world/runtime/fit";
import { layerTransform } from "../../world/mobile/turned";
import { getOptions } from "./optionsStore";
import { createTouchLayer } from "./touchLayer";
import type { TouchLink } from "./useFlight";
import { useShell, type Shell } from "./useShell";

/** Light ticks on a phone that can (Android): a landing touching down, a discovery. */
const BUZZ = { landed: [25], discovery: [8, 40, 8] } as const;

export interface PhoneFlight {
  shell: Shell;
  touch: TouchLink;
}

export function usePhoneFlight(root: RefObject<HTMLDivElement | null>, panelOpen: boolean): PhoneFlight {
  const shell = useShell(root);
  const { link, view, platform, panel } = shell;
  const phoneRef = useRef(false);
  useEffect(() => {
    phoneRef.current = shell.phone;
  }, [shell.phone]);

  // On a touch screen the options panel holds the flight while it is open.
  useEffect(() => {
    panel(panelOpen);
  }, [panelOpen, panel]);

  const buzz = useCallback((what: keyof typeof BUZZ) => {
    if (getOptions().buzz !== "on" || typeof navigator.vibrate !== "function") return;
    try {
      navigator.vibrate([...BUZZ[what]]);
    } catch {
      // vibration refused: nothing to do
    }
  }, []);

  const touch = useMemo<TouchLink>(
    () => ({
      paused: link.paused,
      stall: link.stall,
      phone: () => phoneRef.current,
      buzz,
      touch: (canvas, hooks) => {
        const el = root.current;
        if (!el) return null;
        return createTouchLayer({ root: el, canvas, options: hooks.options, platform, view, ghost: hooks.ghost, touched: hooks.touched });
      },
    }),
    [link, view, platform, buzz, root],
  );
  return { shell, touch };
}

export interface PhoneFrame {
  /** CSS pixels per frame pixel. */
  scale: number;
  /** The page's own style on a touch screen: exactly the visible area, turned if played sideways. */
  page: CSSProperties | undefined;
  turned: boolean;
}

/** How the frame sits on the page: the shared fitting, except on a turned layer, whose sides are the screen's swapped. */
export function phoneFrame(shell: Shell, shared: number, frameW: number, frameH: number): PhoneFrame {
  if (shell.touchFirst !== true) return { scale: shared, page: undefined, turned: false };
  const turned = shell.turn !== 0;
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const scale = turned ? fitScale(shell.layer.w * dpr, shell.layer.h * dpr, frameW, frameH) / dpr : shared;
  const page = {
    "--layer-w": `${shell.layer.w}px`,
    "--layer-h": `${shell.layer.h}px`,
    "--vvh": `${shell.layer.h}px`,
    minHeight: 0,
    transform: turned ? layerTransform(shell.layer.h, shell.layer.w, shell.turn) : undefined,
  } as CSSProperties;
  return { scale, page, turned };
}
