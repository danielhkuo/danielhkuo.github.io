"use client";

// The phone's part of the flight page (mobile spec): the shell (cards, lock, pauses), the touch controls the session
// draws, the light ticks, and how the frame sits on a touch screen, played sideways or not. Kept out of Flight so the
// page reads as it did on a desktop.

import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type RefObject } from "react";
import { fitFrame } from "../../world/runtime/fit";
import { layerTransform, toLayer } from "../../world/mobile/turned";
import type { KeepClear } from "../../world/story/overlay";
import { getOptions } from "./optionsStore";
import { createTouchLayer, type LayerView } from "./touchLayer";
import type { TouchLink } from "./useFlight";
import { getFrameFit, type WindowFrame } from "./useFrameScale";
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

  // Played sideways, the frame is fitted to the turned layer (its sides the screen's swapped); the session reads it here.
  const turnedFit = useRef<WindowFrame | null>(null);
  const { turn, layer } = shell;
  useEffect(() => {
    turnedFit.current = turn !== 0 ? layerFit(layer) : null;
  }, [turn, layer]);

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

  // The last measure of the controls, and when it was taken. Reading them forces a layout, so a second must pass first.
  const kept = useRef<{ at: number; rects: readonly KeepClear[] }>({ at: -Infinity, rects: [] });

  const touch = useMemo<TouchLink>(() => {
    return {
      paused: link.paused,
      stall: link.stall,
      phone: () => phoneRef.current,
      buzz,
      frame: () => turnedFit.current ?? getFrameFit(),
      // The layer's safe areas are CSS pixels; the frame counts them in its own pixels, rounded up.
      insets: () => {
        const css = (turnedFit.current ?? getFrameFit()).css;
        const src = view().insets;
        const side = (px: number) => (css > 0 ? Math.ceil(px / css) : 0);
        return { top: side(src.top), right: side(src.right), bottom: side(src.bottom), left: side(src.left) };
      },
      // The corner and the sound toggle, in frame pixels.
      keepClear: () => {
        const now = performance.now();
        if (now - kept.current.at < 1000) return kept.current.rects;
        kept.current.at = now;
        const el = root.current;
        kept.current.rects = el ? controlsOnFrame(el, view()) : [];
        return kept.current.rects;
      },
      touch: (canvas, hooks) => {
        const el = root.current;
        if (!el) return null;
        return createTouchLayer({ root: el, canvas, options: hooks.options, platform, view, ghost: hooks.ghost, touched: hooks.touched });
      },
    };
  }, [link, view, platform, buzz, root, kept]);
  return { shell, touch };
}

export interface PhoneFrame {
  /** The frame on the page: frame pixels across and down, and CSS pixels per frame pixel. */
  fit: WindowFrame;
  /** The page's own style on a touch screen: exactly the visible area, turned if played sideways. */
  page: CSSProperties | undefined;
  turned: boolean;
}

/** The frame for a turned layer of w × h CSS pixels: the window's fitting, on the layer's own sides. */
function layerFit(layer: { w: number; h: number }): WindowFrame {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const f = fitFrame(layer.w, layer.h, dpr);
  return { ...f, css: f.scale / dpr };
}

/** How the frame sits on the page: the window's frame, except on a turned layer, which has its own. */
export function phoneFrame(shell: Shell, windowFit: WindowFrame): PhoneFrame {
  if (shell.touchFirst !== true) return { fit: windowFit, page: undefined, turned: false };
  const turned = shell.turn !== 0;
  const page = {
    "--layer-w": `${shell.layer.w}px`,
    "--layer-h": `${shell.layer.h}px`,
    "--vvh": `${shell.layer.h}px`,
    minHeight: 0,
    transform: turned ? layerTransform(shell.layer.h, shell.layer.w, shell.turn) : undefined,
  } as CSSProperties;
  return { fit: turned ? layerFit(shell.layer) : windowFit, page, turned };
}

/** A screen rectangle in the layer's coordinates. With no turn `toLayer` leaves each corner where it is. */
function rectOnLayer(r: DOMRect, v: LayerView): { left: number; top: number; right: number; bottom: number } {
  const a = toLayer(r.left, r.top, v.screenW, v.screenH, v.turn);
  const b = toLayer(r.right, r.bottom, v.screenW, v.screenH, v.turn);
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

/**
 * The page's own controls, each element marked `data-keep-clear`, as rectangles of the frame in frame pixels. One
 * that is hidden, faded out, or empty is not in the way. The canvas's width in the layer is one frame across.
 */
function controlsOnFrame(root: HTMLElement, v: LayerView): KeepClear[] {
  const canvas = root.querySelector("canvas");
  if (!canvas || canvas.width === 0) return [];
  const c = rectOnLayer(canvas.getBoundingClientRect(), v);
  const canvasWidth = c.right - c.left;
  if (canvasWidth === 0) return [];
  const k = canvasWidth / canvas.width;
  const out: KeepClear[] = [];
  for (const el of root.querySelectorAll("[data-keep-clear]")) {
    const box = rectOnLayer(el.getBoundingClientRect(), v);
    if (box.right === box.left || box.bottom === box.top) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || Number(style.opacity) === 0) continue;
    out.push({
      x0: Math.floor((box.left - c.left) / k),
      y0: Math.floor((box.top - c.top) / k),
      x1: Math.ceil((box.right - c.left) / k),
      y1: Math.ceil((box.bottom - c.top) / k),
    });
  }
  return out;
}
