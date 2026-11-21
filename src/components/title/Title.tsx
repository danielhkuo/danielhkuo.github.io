"use client";

// The desktop title. One mode, shown as data-title: the window over a held world, then the genie down into flight,
// then the genie back. The world arrives behind the window pixel by pixel (ArrivalPaper.tsx) once the intro has finished and
// the world has drawn its first view, and the ways in come up while it does. A phone never mounts the world.

import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Flight, { type FlightProps } from "../../app/world/Flight";
import { fell } from "../../app/world/fonts";
import { getTheme, setTheme } from "../../lib/theme";
import NeofetchHeader, { type HeaderProject } from "../NeofetchHeader";
import type { SiteInfo, TerminalApi } from "../terminal/types";
import type { Project } from "../../lib/projects";
import { useFrameFit } from "../../app/world/useFrameScale";
import ArrivalPaper, { type ArrivalStart } from "./ArrivalPaper";
import { runGenie } from "./genieRun";
import { growToScreen } from "./grow";
import { MINIMAL_PAGE } from "./phone/copy";
import { PHONE_QUERY } from "./phone/phone";
import ReturnKey from "./ReturnKey";
import TitleTerminal from "./TitleTerminal";
import { useHoldPlace } from "./useHoldPlace";
import { useLiveBody } from "./useLiveBody";
import { titleKey } from "./titleKeys";
import styles from "./title.module.css";

type Mode = "title" | "leaving" | "flying" | "returning";


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

/** The title's own prompt, not a program's input and not a field elsewhere on the page. */
function promptIsFocused(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && el.getAttribute("aria-label") === "terminal input" && el.closest("#about") !== null;
}

export default function Title({ world, header, shell }: TitleProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const enterRef = useRef<HTMLButtonElement>(null);
  const waysEl = useRef<HTMLElement>(null);
  const growCancel = useRef<(() => void) | null>(null);
  const modeRef = useRef<Mode>("title");
  // True once the ways in are up: until then a key only skips the opening.
  const waysRef = useRef(false);
  // True while the world arrives after the opening: ⏎ then cuts it short and goes in, as the terminal has just said.
  const arrivingRef = useRef(false);
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
  // The ways in come up once the world has arrived, all of it.
  const [arrived, setArrived] = useState(false);
  const waysShown = arrived;
  // The prompt stays live once it has been: the shell is mounted for the page, and the scrollback survives a flight.
  const [live, setLive] = useState(false);
  const [focusN, setFocusN] = useState(0);
  const [insert, setInsert] = useState("");
  // `clear`, or a full-screen program: the neofetch rows above the prompt go.
  const [bare, setBare] = useState(false);
  const liveRef = useRef(false);
  const fit = useFrameFit();
  // Once live, the window keeps its height and scrolls within itself; `lockBody` fixes the height as it goes live.
  const lockBody = useLiveBody(rootRef, live);

  const reduced = useSyncExternalStore(subscribeReduced, reducedNow, () => false);
  const phone = useSyncExternalStore(subscribePhone, phoneNow, phoneAtFirstPaint);
  const introDone = useSyncExternalStore(subscribeIntro, introFinished, () => false);
  const desk = !phone;
  const start: ArrivalStart = !(introDone && worldReady) ? "wait" : skipped || reduced ? "cut" : "play";

  const frame = (): HTMLElement | null => {
    const el = rootRef.current?.querySelector(".nf-frame");
    return el instanceof HTMLElement ? el : null;
  };

  // The held dragon waits beside the ways in, facing them.
  const holdAt = useHoldPlace(
    { frame, ways: waysEl, button: enterRef, steady: () => modeRef.current === "title" && !grew.current },
    desk,
    fit,
  );

  const makeLive = (text: string) => {
    lockBody();
    liveRef.current = true;
    setLive(true);
    setInsert(text);
    setFocusN((n) => n + 1);
  };

  // Enter pushes /world and lets the dragon go. Forward, already on /world, enters again without pushing.
  // modeRef moves here, before setState, so a second key in the same turn sees "leaving".
  const enter = (push: boolean, slow: boolean) => {
    const current = modeRef.current;
    if (current === "leaving" || current === "flying") return;
    if (!waysRef.current && !arrivingRef.current) return;
    if (arrivingRef.current) setSkipped(true);
    slowRef.current = slow;
    if (push && pathNow() !== "/world") {
      window.history.pushState(null, "", "/world" + window.location.search);
    }
    atWorld.current = true;
    modeRef.current = "leaving";
    setMode("leaving");
  };
  const enterLive = useRef(enter);
  useLayoutEffect(() => {
    enterLive.current = enter;
  });

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

  // The abbey's "Open the terminal": this window is the terminal, so come back to it the way Leave does.
  // The prompt takes focus once the window is back (the return below), not while the genie is still playing.
  const onTerminal = () => {
    lockBody();
    liveRef.current = true;
    setLive(true);
    leave();
  };

  const api = useMemo<TerminalApi>(
    () => ({
      openUrl: (url) => {
        window.open(url, "_blank", "noopener");
      },
      getProjects: () => shell.projects,
      getTheme,
      setTheme,
      close: () => {
        const el = document.querySelector("#about input.term-input");
        if (el instanceof HTMLElement) el.blur();
      },
      site: shell.site,
      enterWorld: () => enterLive.current(true, false),
    }),
    [shell.projects, shell.site],
  );

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
    arrivingRef.current = start === "play" && !arrived;
  }, [mode, waysShown, start, arrived]);

  // A key in the intro skips the opening. This listens in the capture phase on the window, which runs before the
  // layout's own listener on the root element takes the intro away.
  useEffect(() => {
    const onSkip = () => {
      if (document.documentElement.getAttribute("data-intro") === "play") setSkipped(true);
    };
    window.addEventListener("keydown", onSkip, true);
    return () => window.removeEventListener("keydown", onSkip, true);
  }, []);


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

  // Back, Esc in flight, and the abbey: the prompt when the terminal is live, otherwise Enter world as before.
  const focusBack = useEffectEvent(() => {
    if (!focusEnter.current) return;
    focusEnter.current = false;
    if (liveRef.current) makeLive("");
    else enterRef.current?.focus({ preventScroll: true });
  });
  useEffect(() => {
    if (mode === "title") focusBack();
  }, [mode]);

  useEffect(() => () => growCancel.current?.(), []);

  // Subscribed once. Effect events, so they call the enter of the latest render; the decision itself is the refs.
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Shift") shiftRef.current = true;
    // A phone shows its own title. This one is display:none there, and must not take the keys.
    if (phone) return;
    const action = titleKey(
      {
        mode: modeRef.current,
        opening: document.documentElement.getAttribute("data-intro") === "play",
        ready: waysRef.current || arrivingRef.current,
        dialogOpen: document.querySelector("dialog[open]") !== null,
        promptFocused: promptIsFocused(),
        target: fieldOrControl(e.target) ?? "other",
      },
      e,
    );
    if (action.kind === "focus") {
      e.preventDefault();
      makeLive(action.insert);
    } else if (action.kind === "enter") {
      e.preventDefault();
      enter(true, e.shiftKey);
    }
  });
  // A click on the window body, or its ./shell button: the same as focusing the prompt and typing nothing.
  const onOpen = useEffectEvent(() => {
    if (phone || modeRef.current !== "title") return;
    if (document.querySelector("dialog[open]")) return;
    makeLive("");
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
    window.addEventListener("terminal:open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("terminal:open", onOpen);
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
            // Let go once the window has gone: the dragon's take-off, and the world's own prompts, come after the
            // genie rather than under it. (The Enter that started it is taken, and the flight leaves a taken key alone.)
            held={mode !== "flying"}
            holdAt={holdAt}
            onLeave={leave}
            onReady={() => setWorldReady(true)}
            onTerminal={onTerminal}
          />
        </main>
      ) : null}
      <div className={styles.paper} data-arrival="" data-arrived={arrived ? "true" : "false"} data-state={start} aria-hidden="true">
        {desk ? <ArrivalPaper start={start} at={holdAt} onArrived={() => setArrived(true)} /> : null}
      </div>
      <div className={styles.front} hidden={mode === "flying"}>
        <NeofetchHeader
          projects={header}
          world
          onMinimize={() => enter(true, shiftRef.current)}
          onZoom={grow}
          bare={bare}
          terminal={
            live ? (
              <TitleTerminal
                api={api}
                onEnterWorld={(slow) => enter(true, slow)}
                focusRequest={focusN}
                insert={insert}
                onBare={setBare}
              />
            ) : undefined
          }
        />
        <nav ref={waysEl} className={styles.ways} aria-label="Ways in" hidden={!waysShown || mode !== "title" || covering}>
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
    </div>
  );
}
