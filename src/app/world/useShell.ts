"use client";

// The phone shell round a touch flight (spec 1, 5): the view locked down, the flight held still behind the first card,
// a pause, or a phone held upright, and let go by Take wing or Fly on. Fullscreen and the landscape lock where the
// browser allows them, Back caught as a pause, the screen kept awake while flying, and "play sideways anyway" for a
// phone whose own rotation lock keeps the page upright. Only on a touch-first screen: a desktop is left as it was.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { cardOf, lifeAfter, running, startLife, type Card, type Life, type LifeEvent } from "../../world/mobile/lifecycle";
import { NO_INSETS, type Insets, type Platform } from "../../world/mobile/layout";
import { layerInsets, layerSize, type Turn } from "../../world/mobile/turned";
import { getOptions, setOptions } from "./optionsStore";
import type { LayerView } from "./touchLayer";

/** What the session reads each frame. */
export interface ShellLink {
  paused(): boolean;
  stall(): void;
}

export interface Shell {
  /** A touch-first screen (no hover, a coarse pointer): the shell is on. Null until the page has hydrated. */
  touchFirst: boolean | null;
  /** A phone: a touch-first screen whose short side is under 500 px. Flight on a phone is landscape only. */
  phone: boolean;
  platform: Platform;
  /** Opened from the Home Screen: no browser toolbar. */
  standalone: boolean;
  card: Card;
  turn: Turn;
  /** The game layer's size, CSS px: the visible area, turned if played sideways. */
  layer: { w: number; h: number };
  link: ShellLink;
  view(): LayerView;
  takeWing(): void;
  flyOn(): void;
  playSideways(): void;
  otherWay(): void;
  /** The options panel opened or closed: on a touch screen it holds the flight. */
  panel(open: boolean): void;
}

const TOUCH_FIRST = "(hover: none) and (pointer: coarse)";
/** After Take wing or Fly on, a blur or a stall is the browser's own doing (a permission prompt, the toolbar), ms. */
const SETTLE_MS = 1500;
/** The short side under which a touch screen is a phone, CSS px. */
const PHONE_SIDE = 500;

function media(q: string): MediaQueryList | null {
  try {
    return window.matchMedia(q);
  } catch {
    return null;
  }
}

function subscribeTouch(onChange: () => void): () => void {
  const m = media(TOUCH_FIRST);
  m?.addEventListener("change", onChange);
  return () => m?.removeEventListener("change", onChange);
}

export function platformOf(ua: string, maxTouchPoints: number, platform: string): Platform {
  if (/iPhone|iPad|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/** The visible area, CSS px: the visual viewport where there is one. */
function visible(): { w: number; h: number } {
  const v = window.visualViewport;
  return v ? { w: Math.round(v.width), h: Math.round(v.height) } : { w: window.innerWidth, h: window.innerHeight };
}

/** The safe-area insets, read through a probe padded by env(). */
function readInsets(probe: HTMLElement | null): Insets {
  if (!probe) return NO_INSETS;
  const cs = getComputedStyle(probe);
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}

/** Styles the lock puts on <html> and <body>, and puts back on leaving: the rest of the site stays zoomable. */
const LOCK: [string, string][] = [
  ["height", "100%"],
  ["overflow", "hidden"],
  ["overscroll-behavior", "none"],
  ["user-select", "none"],
  ["-webkit-user-select", "none"],
  ["-webkit-touch-callout", "none"],
  ["-webkit-tap-highlight-color", "transparent"],
];

function lockStyles(el: HTMLElement): () => void {
  const before = LOCK.map(([k]) => [k, el.style.getPropertyValue(k)] as const);
  for (const [k, v] of LOCK) el.style.setProperty(k, v);
  return () => {
    for (const [k, v] of before) {
      if (v) el.style.setProperty(k, v);
      else el.style.removeProperty(k);
    }
  };
}

function onDomControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a, input, select, textarea, dialog, [data-touch-skip]") !== null;
}

type WakeLock = { release(): Promise<void> };

export function useShell(root: RefObject<HTMLElement | null>): Shell {
  const touchFirst = useSyncExternalStore(subscribeTouch, () => media(TOUCH_FIRST)?.matches ?? false, () => null);
  const on = touchFirst === true;
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [turn, setTurn] = useState<Turn>(0);
  const [life, setLife] = useState<Life>(() => startLife(true));
  const lifeRef = useRef<Life>(life);
  const turnRef = useRef<Turn>(0);
  const sizeRef = useRef(size);
  const insetsRef = useRef<Insets>(NO_INSETS);
  const settledAt = useRef(0);
  const touchFirstRef = useRef(false);
  const fullscreened = useRef(false);
  const armed = useRef(false);
  const wake = useRef<WakeLock | null>(null);

  const platform = useMemo<Platform>(
    () => (typeof navigator === "undefined" ? "other" : platformOf(navigator.userAgent, navigator.maxTouchPoints ?? 0, navigator.platform ?? "")),
    [],
  );
  const standalone = useMemo(() => {
    if (typeof window === "undefined") return false;
    return media("(display-mode: standalone)")?.matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  }, []);
  const phone = on && size.w > 0 && Math.min(size.w, size.h) < PHONE_SIDE;

  const dispatch = useCallback((e: LifeEvent) => {
    const next = lifeAfter(lifeRef.current, e);
    lifeRef.current = next;
    setLife(next);
  }, []);

  // The visible area and the safe areas, kept current; a phone held upright pauses, unless it is played sideways.
  useEffect(() => {
    if (!on) return;
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
    document.body.appendChild(probe);
    const update = () => {
      const s = visible();
      sizeRef.current = s;
      setSize(s);
      insetsRef.current = readInsets(probe);
      const isPhone = Math.min(s.w, s.h) < PHONE_SIDE;
      if (!isPhone) return;
      if (s.w > s.h && turnRef.current !== 0) {
        // The phone turned for real: no need to play sideways any more.
        turnRef.current = 0;
        setTurn(0);
      }
      const upright = s.h > s.w && turnRef.current === 0;
      if (upright !== lifeRef.current.has("upright")) dispatch(upright ? "upright" : "level");
    };
    update();
    // An orientation change settles over a frame or two before the viewport reports its new size.
    const later = () => requestAnimationFrame(() => requestAnimationFrame(update));
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", later);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", later);
      window.visualViewport?.removeEventListener("resize", update);
      probe.remove();
    };
  }, [on, dispatch]);

  // The lock: nothing zooms, scrolls, bounces, refreshes, selects or opens a menu while the flight is up.
  useEffect(() => {
    const el = root.current;
    if (!on || !el) return;
    const unlockHtml = lockStyles(document.documentElement);
    const unlockBody = lockStyles(document.body);
    const stop = (e: Event) => e.preventDefault();
    const onTouchStart = (e: TouchEvent) => {
      // Cancelling the touch stops the iOS loupe and callout (and, in the Simulator, Safari's edge swipe back). The
      // page's own buttons keep their taps.
      if (!onDomControl(e.target)) e.preventDefault();
    };
    // WebKit's own pinch events: cancelled, they stop the page zooming where touch-action alone lets a pinch through.
    document.addEventListener("gesturestart", stop, { passive: false });
    document.addEventListener("gesturechange", stop, { passive: false });
    document.addEventListener("gestureend", stop, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("contextmenu", stop);
    el.addEventListener("dblclick", stop);
    return () => {
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
      document.removeEventListener("gestureend", stop);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("contextmenu", stop);
      el.removeEventListener("dblclick", stop);
      unlockHtml();
      unlockBody();
    };
  }, [on, root]);

  // Interruptions: the page hidden or frozen, the window blurred, Back, fullscreen lost.
  useEffect(() => {
    if (!on) return;
    const settled = () => performance.now() - settledAt.current > SETTLE_MS;
    const onHidden = () => {
      if (document.visibilityState === "hidden") dispatch("hidden");
    };
    const onPageHide = () => dispatch("hidden");
    const onBlur = () => {
      if (settled()) dispatch("blur");
    };
    const onPop = () => {
      if (!armed.current) return;
      dispatch("back");
      // Back again from here leaves for real: the entry is pushed once more so the first Back is always a pause.
      history.pushState(history.state, "");
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement && fullscreened.current) {
        fullscreened.current = false;
        dispatch("fullscreenLost");
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    document.addEventListener("freeze", onPageHide);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("blur", onBlur);
    window.addEventListener("popstate", onPop);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      document.removeEventListener("freeze", onPageHide);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [on, dispatch]);

  // The screen stays awake while flying (a visitor may let go and watch); the lock lapses when the page is hidden.
  const flying = on && running(life);
  useEffect(() => {
    if (!flying) return;
    let alive = true;
    const request = () => {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<WakeLock> } }).wakeLock;
      wl?.request("screen")
        .then((s) => {
          if (alive) wake.current = s;
          else void s.release();
        })
        .catch(() => undefined);
    };
    request();
    const onVisible = () => {
      if (document.visibilityState === "visible") request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      void wake.current?.release().catch(() => undefined);
      wake.current = null;
    };
  }, [flying]);

  /** Fullscreen (Android and iPad), then the landscape lock on an Android phone. Each may fail quietly. */
  const goFullscreen = useCallback(() => {
    const el = document.documentElement;
    if (platform === "ios" && phone) return;
    if (!document.fullscreenEnabled || document.fullscreenElement || typeof el.requestFullscreen !== "function") return;
    el.requestFullscreen({ navigationUI: "hide" })
      .then(() => {
        fullscreened.current = true;
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        if (phone && typeof o?.lock === "function") o.lock("landscape").catch(() => undefined);
      })
      .catch(() => undefined);
  }, [platform, phone]);

  const takeWing = useCallback(() => {
    settledAt.current = performance.now();
    goFullscreen();
    // Tilt steering needs the motion permission on iOS, asked from this tap.
    const dm = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    if (getOptions().tilt === "on" && typeof dm?.requestPermission === "function") {
      dm.requestPermission()
        .then((r) => {
          if (r !== "granted") setOptions({ ...getOptions(), tilt: "off" });
        })
        .catch(() => setOptions({ ...getOptions(), tilt: "off" }));
    }
    if (!armed.current) {
      armed.current = true;
      history.pushState(history.state, "");
    }
    dispatch("takeWing");
  }, [dispatch, goFullscreen]);

  const flyOn = useCallback(() => {
    settledAt.current = performance.now();
    if (!document.fullscreenElement && platform === "android") goFullscreen();
    dispatch("flyOn");
  }, [dispatch, goFullscreen, platform]);

  const playSideways = useCallback(() => {
    turnRef.current = 90;
    setTurn(90);
    dispatch("level");
  }, [dispatch]);
  const otherWay = useCallback(() => {
    const next: Turn = turnRef.current === 90 ? -90 : 90;
    turnRef.current = next;
    setTurn(next);
  }, []);
  const panel = useCallback((open: boolean) => dispatch(open ? "optionsOpen" : "optionsClose"), [dispatch]);

  const link = useMemo<ShellLink>(
    () => ({
      paused: () => (touchFirstRef.current ? !running(lifeRef.current) : false),
      stall: () => {
        if (performance.now() - settledAt.current > SETTLE_MS) dispatch("stall");
      },
    }),
    [dispatch],
  );
  useEffect(() => {
    touchFirstRef.current = on;
  }, [on]);

  const view = useCallback((): LayerView => {
    const s = sizeRef.current;
    const t = turnRef.current;
    const l = layerSize(s.w, s.h, t);
    return { w: l.w, h: l.h, insets: layerInsets(insetsRef.current, t), turn: t, screenW: s.w, screenH: s.h };
  }, []);

  return {
    touchFirst,
    phone,
    platform,
    standalone,
    card: on ? cardOf(life) : null,
    turn,
    layer: layerSize(size.w, size.h, turn),
    link,
    view,
    takeWing,
    flyOn,
    playSideways,
    otherWay,
    panel,
  };
}
