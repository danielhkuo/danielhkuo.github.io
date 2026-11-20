"use client";

// The desktop title. One mode, shown as data-title: the window over a held world, then the genie down into flight,
// then the genie back. The world arrives behind the window pixel by pixel (ArrivalPaper.tsx) once the intro has finished and
// the world has drawn its first view, and the ways in come up while it does. A phone never mounts the world.

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Flight, { type FlightProps } from "../../app/world/Flight";
import { fell } from "../../app/world/fonts";
import NeofetchHeader, { type HeaderProject } from "../NeofetchHeader";
import TerminalLauncher from "../terminal/TerminalLauncher";
import type { SiteInfo } from "../terminal/types";
import type { Project } from "../../lib/projects";
import { useFrameFit } from "../../app/world/useFrameScale";
import { HOLD_AT, type HoldAt } from "../../world/runtime/hold";
import ArrivalPaper, { type ArrivalStart } from "./ArrivalPaper";
import { runGenie } from "./genieRun";
import { growToScreen } from "./grow";
import { MINIMAL_PAGE } from "./phone/copy";
import { PHONE_QUERY } from "./phone/phone";
import ReturnKey from "./ReturnKey";
import styles from "./title.module.css";

type Mode = "title" | "leaving" | "flying" | "returning";

/** The ways in come up while the world is still arriving, as in the approved mock: 1.9 s into its 2.8. */
const WAYS_AT = 1900;
/**
 * Where the held dragon's head is drawn, in CSS pixels from the window's bottom centre: just right of the Enter world
 * button, so its body trails off under the links and none of it hides behind the window.
 */
const HEAD_RIGHT = 125;
const HEAD_BELOW = 46;

export interface TitleProps {
  world: Omit<FlightProps, "held" | "holdAt" | "onLeave" | "onReady">;
  header: HeaderProject[];
  shell: { projects: Project[]; site: SiteInfo };
}

function subscribePhone(onChange: () => void): () => void {
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function phoneNow(): boolean {
  return window.matchMedia(PHONE_QUERY).matches;
}

// The server and the first paint say phone, so neither renders Flight. A desktop mounts it after hydration.
function phoneAtFirstPaint(): boolean {
  return true;
}

function subscribeIntro(onChange: () => void): () => void {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-intro"] });
  return () => obs.disconnect();
}

function introFinished(): boolean {
  return document.documentElement.getAttribute("data-intro") !== "play";
}

function subscribeReduced(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function reducedNow(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function pathNow(): string {
  const path = window.location.pathname;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path || "/";
}

function fieldOrControl(target: EventTarget | null): "field" | "control" | null {
  if (!(target instanceof HTMLElement)) return null;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return "field";
  if (tag === "BUTTON" || tag === "A") return "control";
  return null;
}

export default function Title({ world, header, shell }: TitleProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const enterRef = useRef<HTMLButtonElement>(null);
  const growCancel = useRef<(() => void) | null>(null);
  const modeRef = useRef<Mode>("title");
  // True once the ways in are up: until then a key only skips the opening.
  const waysRef = useRef(false);
  const atWorld = useRef(false);
  const slowRef = useRef(false);
  const shiftRef = useRef(false);
  const focusEnter = useRef(false);
  const grew = useRef(false);
  const [mode, setMode] = useState<Mode>("title");
  const [worldReady, setWorldReady] = useState(false);
  const [covering, setCovering] = useState(false);
  // A key pressed while the intro plays skips the opening: the world then cuts in as soon as it is ready.
  const [skipped, setSkipped] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [waysShown, setWaysShown] = useState(false);
  const [holdAt, setHoldAt] = useState<HoldAt>(HOLD_AT);
  const fit = useFrameFit();
  const reduced = useSyncExternalStore(subscribeReduced, reducedNow, () => false);
  const phone = useSyncExternalStore(subscribePhone, phoneNow, phoneAtFirstPaint);
  const introDone = useSyncExternalStore(subscribeIntro, introFinished, () => false);
  const desk = !phone;
  const start: ArrivalStart = !(introDone && worldReady) ? "wait" : skipped || reduced ? "cut" : "play";

  const frame = (): HTMLElement | null => {
    const el = rootRef.current?.querySelector(".nf-frame");
    return el instanceof HTMLElement ? el : null;
  };

  // Enter pushes /world and lets the dragon go. Forward, already on /world, enters again without pushing.
  // modeRef moves here, before setState, so a second key in the same turn sees "leaving".
  const enter = (push: boolean, slow: boolean) => {
    const current = modeRef.current;
    if (current === "leaving" || current === "flying") return;
    if (!waysRef.current) return;
    slowRef.current = slow;
    if (push && pathNow() !== "/world") {
      window.history.pushState(null, "", "/world" + window.location.search);
    }
    atWorld.current = true;
    modeRef.current = "leaving";
    setMode("leaving");
  };

  // Esc in flight and Leave. Back through the entry this page pushed; otherwise the address is simply /.
  // modeRef moves before history.back(), whose popstate runs in this same turn.
  const leave = () => {
    const current = modeRef.current;
    if (current !== "leaving" && current !== "flying") return;
    slowRef.current = shiftRef.current;
    modeRef.current = "returning";
    setMode("returning");
    if (atWorld.current) {
      atWorld.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, "", "/" + window.location.search);
    }
  };

  const grow = () => {
    if (grew.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      router.push(MINIMAL_PAGE);
      return;
    }
    const el = frame();
    if (!el) {
      router.push(MINIMAL_PAGE);
      return;
    }
    grew.current = true;
    setCovering(true);
    growCancel.current = growToScreen(el, () => router.push(MINIMAL_PAGE));
  };

  // The ways in have no handler of their own, and the genie finishes by setting state. This puts the refs the listeners
  // read back in step with both, after the handlers above have written the mode they just chose.
  useLayoutEffect(() => {
    modeRef.current = mode;
    waysRef.current = waysShown;
  }, [mode, waysShown]);

  // The ways in come up part way through the arrival, or with the world at once when it cuts in.
  useEffect(() => {
    if (start === "wait") return;
    const timer = window.setTimeout(() => setWaysShown(true), start === "play" ? WAYS_AT : 0);
    return () => window.clearTimeout(timer);
  }, [start]);

  // A key in the intro skips the opening. This listens in the capture phase on the window, which runs before the
  // layout's own listener on the root element takes the intro away.
  useEffect(() => {
    const onSkip = () => {
      if (document.documentElement.getAttribute("data-intro") === "play") setSkipped(true);
    };
    window.addEventListener("keydown", onSkip, true);
    return () => window.removeEventListener("keydown", onSkip, true);
  }, []);

  // The held dragon's place follows the window: measured whenever the window's box changes (the observer reports once
  // as it starts), as shares of the world's frame. Not while the window is leaving or growing: the dragon stays put.
  useLayoutEffect(() => {
    const el = desk ? frame() : null;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (modeRef.current !== "title" || grew.current) return;
      const r = el.getBoundingClientRect();
      const w = fit.w * fit.css;
      const h = fit.h * fit.css;
      if (!w || !h) return;
      setHoldAt({ x: (r.left + r.width / 2 + HEAD_RIGHT) / w, y: Math.min(0.92, (r.bottom + HEAD_BELOW) / h) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [desk, fit.w, fit.h, fit.css]);

  useLayoutEffect(() => {
    if (mode !== "leaving" && mode !== "returning") return;
    const reverse = mode === "returning";
    const done = () => {
      if (reverse) {
        modeRef.current = "title";
        focusEnter.current = true;
        setMode("title");
      } else {
        modeRef.current = "flying";
        setMode("flying");
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
      }
    };
    const el = frame();
    if (!el) {
      done();
      return;
    }
    return runGenie(el, { reverse, slow: slowRef.current, onDone: done });
  }, [mode]);

  useEffect(() => {
    if (mode === "title" && focusEnter.current) {
      focusEnter.current = false;
      enterRef.current?.focus({ preventScroll: true });
    }
  }, [mode]);

  useEffect(() => () => growCancel.current?.(), []);

  // Subscribed once. Effect events, so they call the enter of the latest render; the decision itself is the refs.
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Shift") shiftRef.current = true;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (document.querySelector("dialog[open]")) return;
    const kind = fieldOrControl(e.target);
    if (kind === "field") return;
    // A button or a link acts on its own Enter. Before the world has arrived, a key only skips the opening,
    // which the layout's script already does.
    if (kind === "control" && e.key === "Enter") return;
    if (modeRef.current !== "title" || !waysRef.current) return;
    if (e.key === "Enter") {
      e.preventDefault();
      enter(true, e.shiftKey);
    }
  });
  const onKeyUp = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Shift") shiftRef.current = false;
  });
  const onBlur = useEffectEvent(() => {
    shiftRef.current = false;
  });
  const onPop = useEffectEvent(() => {
    const path = pathNow();
    const current = modeRef.current;
    if (path === "/world" && (current === "title" || current === "returning")) {
      enter(false, shiftRef.current);
      return;
    }
    if (path === "/" && (current === "leaving" || current === "flying")) {
      atWorld.current = false;
      slowRef.current = shiftRef.current;
      modeRef.current = "returning";
      setMode("returning");
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  const onMinimal = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    e.preventDefault();
    grow();
  };

  return (
    <div ref={rootRef} className={`${styles.title} ${fell.variable}`} data-title={mode}>
      {/* The world is the page's main content, held behind the title until the visitor goes in. */}
      {desk ? (
        // A plain block: the world lays itself out, fixed, behind everything, so this adds nothing to the layout.
        <main aria-label="The world">
          <Flight
            {...world}
            // Let go as the window starts to go, so the dragon sets off while it tucks away. The Enter that started it
            // is taken (preventDefault), and the flight leaves a taken key alone.
            held={mode === "title" || mode === "returning"}
            holdAt={holdAt}
            onLeave={leave}
            onReady={() => setWorldReady(true)}
          />
        </main>
      ) : null}
      <div className={styles.paper} data-arrival="" data-arrived={arrived ? "true" : "false"} data-state={start} aria-hidden="true">
        {desk ? <ArrivalPaper start={start} at={holdAt} onArrived={() => setArrived(true)} /> : null}
      </div>
      <div className={styles.front} hidden={mode === "flying"}>
        <NeofetchHeader projects={header} world onMinimize={() => enter(true, shiftRef.current)} onZoom={grow} />
        <nav className={styles.ways} aria-label="Ways in" hidden={!waysShown || mode !== "title" || covering}>
          <button ref={enterRef} type="button" className={styles.enter} onClick={(e) => enter(true, e.shiftKey)}>
            Enter world <ReturnKey decorative />
          </button>
          <ul className={styles.links}>
            <li>
              <Link href={MINIMAL_PAGE} onClick={onMinimal}>
                Minimal version
              </Link>
            </li>
            <li>
              {/* A file at the site's root, not a page of the app: a plain link. */}
              <a href="/agents.md">agents.md</a>
            </li>
            <li>
              <button type="button" onClick={() => window.dispatchEvent(new Event("world:options"))}>
                Settings
              </button>
            </li>
          </ul>
        </nav>
      </div>
      <TerminalLauncher projects={shell.projects} site={shell.site} button={false} enabled={mode === "title"} />
    </div>
  );
}
