"use client";

// The options: a small pixel panel (a modal dialog with native controls, drawn in the guides' glyphs) for hold or
// toggle boost, the pace, motion, the keys, the lesson, and leaving. Game layer: hand-drawn, not Astryx.

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { DEFAULT_KEYS, REMAPPABLE, rebind, type Remappable } from "../../world/controls/bindings";
import { INK_SOFT, keyCap, plate, slip, text, VERMILION } from "../../world/controls/glyphs";
import { ACTION_WORDS, keyWord, type Device } from "../../world/controls/guides";
import type { PhaseKind } from "./session";
import type { Options } from "../../world/controls/options";
import type { Platform } from "../../world/mobile/layout";
import { SOUND_UI, type SoundControl } from "../../world/sound/control";
import styles from "./options.module.css";
import PixelGlyph from "./PixelGlyph";

export interface OptionsPanelProps {
  open: boolean;
  /** CSS pixels per glyph pixel. */
  px: number;
  options: Options;
  /** The device used last: on touch the panel shows the touch controls' settings instead of the keys. */
  device: Device;
  platform: Platform;
  onChange(next: Options): void;
  /** The world's sound, once the page has mounted: its on/off and its volume live here too. */
  sound?: SoundControl | null;
  /** Shows the first-flight lesson again (and closes the panel). */
  onTeach(): void;
  onClose(): void;
  /** Leave goes back to the title instead of to "/". */
  onLeave?: () => void;
}

/** Tilt steering needs the motion permission on iOS, asked from the tap that turns it on. */
async function motionAllowed(): Promise<boolean> {
  const dm = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
  if (!dm) return false;
  if (typeof dm.requestPermission !== "function") return true;
  try {
    return (await dm.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** Words drawn in the pixel font (in palette slot `ink`), with the same words for readers. */
function Words({ children, px, say, ink }: { children: string; px: number; say?: string; ink?: number }) {
  return (
    <>
      <PixelGlyph sprite={text(children, ink)} px={px} />
      <span className={styles.sr}>{say ?? children}</span>
    </>
  );
}

/** The rubricated pilcrow before each action: soft at rest, vermilion under the pointer or the focus. */
function Mark({ px }: { px: number }) {
  return (
    <span className={styles.mark}>
      <PixelGlyph className={styles.markRest} sprite={text("¶", INK_SOFT)} px={px} />
      <PixelGlyph className={styles.markHot} sprite={text("¶", VERMILION)} px={px} />
    </span>
  );
}

interface ChoiceProps<T extends string> {
  name: string;
  legend: string;
  value: T;
  choices: readonly [T, string][];
  px: number;
  onPick(v: T): void;
}

/** Two or more ways, one picked: radio buttons drawn as plates, the picked one lit. */
function Choice<T extends string>({ name, legend, value, choices, px, onPick }: ChoiceProps<T>) {
  return (
    <fieldset className={styles.row}>
      <legend className={styles.legend}>
        <Words px={px}>{legend}</Words>
      </legend>
      <span className={styles.choices}>
        {choices.map(([v, say]) => (
          <label key={v} className={styles.choice}>
            <input className={styles.sr} type="radio" name={name} value={v} checked={value === v} onChange={() => onPick(v)} />
            <PixelGlyph sprite={plate(v, value === v)} px={px} />
            <span className={styles.sr}>{say}</span>
          </label>
        ))}
      </span>
    </fieldset>
  );
}

function Action({ children, onClick, px }: { children: ReactNode; onClick(): void; px: number }) {
  return (
    <button type="button" className={styles.action} onClick={onClick}>
      <Mark px={px} />
      {children}
    </button>
  );
}

/** The volume's steps (0–1, the slider's value before it is squared): "mute" is silence, "half" the default. */
const VOLUMES = [["mute", 0], ["soft", 0.3], ["half", 0.5], ["loud", 0.7], ["full", 1]] as const;
type VolumeStep = (typeof VOLUMES)[number][0];
const VOLUME_SAY: Record<VolumeStep, string> = {
  mute: "Volume off: no sound at all",
  soft: "Soft",
  half: "Half (the usual)",
  loud: "Loud",
  full: "Full",
};

const offOnServer = (): "off" => "off";

function nearestStep(v: number): VolumeStep {
  let best: VolumeStep = "half", d = Infinity;
  for (const [name, at] of VOLUMES) if (Math.abs(at - v) < d) [best, d] = [name, Math.abs(at - v)];
  return best;
}

/**
 * The sound's own settings: on or off (the same switch as the speaker in the corner; turning it on here is the gesture
 * that unlocks audio) and the volume, in five steps down to none. Marked as sound UI, so a click here is not taken as
 * the unlock while sound waits for a gesture.
 */
function SoundSection({ sound, px }: { sound: SoundControl; px: number }) {
  // The control's methods are closures: they keep their identity, so the store does not resubscribe on each render.
  const state = useSyncExternalStore(sound.subscribe, sound.state, offOnServer);
  const [step, setStep] = useState<VolumeStep>(() => nearestStep(sound.volume()));
  const on = state !== "off";
  return (
    <fieldset className={styles.keys} {...{ [SOUND_UI]: "" }}>
      <legend className={styles.keysTitle}>
        <Words px={px} ink={VERMILION}>
          sound
        </Words>
      </legend>
      <Choice
        name="sound"
        legend="sound"
        value={on ? "on" : "off"}
        px={px}
        choices={[["on", "Sound on"], ["off", "Sound off"]]}
        onPick={(v) => {
          if ((v === "on") !== on) sound.toggle();
        }}
      />
      <Choice
        name="volume"
        legend="volume"
        value={step}
        px={px}
        choices={VOLUMES.map(([name]) => [name, VOLUME_SAY[name]] as [VolumeStep, string])}
        onPick={(v) => {
          setStep(v);
          sound.setVolume(VOLUMES.find(([name]) => name === v)?.[1] ?? 0.7);
        }}
      />
    </fieldset>
  );
}

/** Glyph pixels as the panel's CSS unit. */
function pxVar(px: number): CSSProperties {
  return { "--px": `${px}px` } as CSSProperties;
}

export default function OptionsPanel({ open, px, options, device, platform, onChange, sound, onTeach, onClose, onLeave }: OptionsPanelProps) {
  const touch = device === "touch";
  const canBuzz = platform === "android" && typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  const dialog = useRef<HTMLDialogElement>(null);
  // The action waiting for its new key, if any.
  const [waiting, setWaiting] = useState<Remappable | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  // Takes the next key before anything else hears it: Esc gives up, a key that cannot be bound is passed over.
  const take = useEffectEvent((e: KeyboardEvent) => {
    if (!waiting || e.key === "Tab") return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setWaiting(null);
      return;
    }
    const keys = rebind(options.keys, waiting, e.key);
    if (!keys) return;
    onChange({ ...options, keys });
    setWaiting(null);
  });
  useEffect(() => {
    if (!waiting) return;
    const onKey = (e: KeyboardEvent) => take(e);
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [waiting]);

  const set = (patch: Partial<Options>) => onChange({ ...options, ...patch });

  return (
    <dialog
      ref={dialog}
      className={styles.panel}
      style={pxVar(px)}
      aria-labelledby="options-title"
      onCancel={(e) => {
        // Esc while a key is awaited gives up the wait, not the panel.
        if (waiting) e.preventDefault();
      }}
      onClose={() => {
        setWaiting(null);
        onClose();
      }}
    >
      <h2 id="options-title" className={styles.title}>
        <Words px={px}>options</Words>
      </h2>
      <Choice name="boost" legend="boost" value={options.boost} px={px} choices={[["hold", "Hold to boost"], ["toggle", "Press to start and stop boosting"]]} onPick={(boost) => set({ boost })} />
      <Choice name="pace" legend="pace" value={options.pace} px={px} choices={[["cruise", "Cruise at full speed"], ["gentle", "A gentler pace"]]} onPick={(pace) => set({ pace })} />
      <Choice name="motion" legend="motion" value={options.motion} px={px} choices={[["full", "Full motion"], ["reduced", "Reduced motion"]]} onPick={(motion) => set({ motion })} />
      {sound ? <SoundSection sound={sound} px={px} /> : null}
      {touch ? (
        <fieldset className={styles.keys}>
          <legend className={styles.keysTitle}>
            <Words px={px} ink={VERMILION}>
              touch
            </Words>
          </legend>
          <Choice name="hand" legend="hand" value={options.hand} px={px} choices={[["right", "Right-handed: the stick on the left"], ["left", "Left-handed: the stick on the right"]]} onPick={(hand) => set({ hand })} />
          <Choice name="size" legend="size" value={options.size} px={px} choices={[["s", "Small controls"], ["m", "Normal controls"], ["l", "Large controls"], ["xl", "Largest controls"]]} onPick={(size) => set({ size })} />
          <Choice name="fade" legend="at rest" value={options.fade} px={px} choices={[["fade", "Controls fade when untouched"], ["solid", "Controls stay solid"]]} onPick={(fade) => set({ fade })} />
          <Choice name="thumb" legend="thumbs" value={options.thumb} px={px} choices={[["two", "Boost with its button"], ["one", "One thumb: push the stick to its rim to boost"]]} onPick={(thumb) => set({ thumb })} />
          {canBuzz ? <Choice name="buzz" legend="buzz" value={options.buzz} px={px} choices={[["on", "Light ticks on"], ["off", "No ticks"]]} onPick={(buzz) => set({ buzz })} /> : null}
          <Choice
            name="tilt"
            legend="tilt"
            value={options.tilt}
            px={px}
            choices={[["off", "Steer with the stick"], ["on", "Also steer by tilting the phone like a wheel"]]}
            onPick={(tilt) => {
              if (tilt === "off") set({ tilt });
              else void motionAllowed().then((ok) => ok && set({ tilt: "on" }));
            }}
          />
        </fieldset>
      ) : (
        <fieldset className={styles.keys}>
          <legend className={styles.keysTitle}>
            <Words px={px} ink={VERMILION}>
              keys
            </Words>
          </legend>
          <ul className={styles.keyGrid}>
            {REMAPPABLE.map((a) => (
              <li key={a} className={styles.keyRow}>
                <span className={styles.keyWord}>
                  <Words px={px}>{ACTION_WORDS[a]}</Words>
                </span>
                <button
                  type="button"
                  className={styles.key}
                  aria-label={waiting === a ? `Press a key for ${ACTION_WORDS[a]}, or Esc to keep ${keyWord(options.keys[a])}` : `${ACTION_WORDS[a]}: ${keyWord(options.keys[a])}. Change`}
                  onClick={() => setWaiting(waiting === a ? null : a)}
                >
                  <PixelGlyph sprite={waiting === a ? plate("press a key", true) : keyCap(options.keys[a])} px={px} />
                </button>
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            <PixelGlyph sprite={text("arrows, shift, enter and esc always work")} px={px} />
            <span className={styles.sr}>The arrow keys, Shift, Enter and Esc always work.</span>
          </p>
        </fieldset>
      )}
      <p className={styles.actions}>
        {touch ? null : (
          <Action px={px} onClick={() => set({ keys: { ...DEFAULT_KEYS } })}>
            <Words px={px}>reset the keys</Words>
          </Action>
        )}
        <Action px={px} onClick={onTeach}>
          <Words px={px}>show the lesson again</Words>
        </Action>
        <Link className={styles.action} href="/" onClick={onLeave && ((e) => {
          e.preventDefault();
          onLeave();
        })}>
          <Mark px={px} />
          <Words px={px}>leave the world</Words>
        </Link>
        <Action px={px} onClick={() => dialog.current?.close()}>
          {touch ? (
            <Words px={px} say="Close the options and fly on">fly on</Words>
          ) : (
            <Words px={px} say="Close the options">close</Words>
          )}
        </Action>
      </p>
    </dialog>
  );
}

export interface CornerProps {
  px: number;
  device: Device;
  /** Esc leaves only while flying: coming down it pulls up, and landed it takes off. */
  phase: PhaseKind;
  /** Shown while the pointer moves, for a while after the page opens, and always on a touch screen. */
  shown: boolean;
  onOpen(): void;
  /** Leave goes back to the title instead of to "/". */
  onLeave?: () => void;
}

/**
 * The ways out of the flight from the corner of the world: "[esc] leave" (while flying) and "[O] options" by keyboard,
 * the pad's own buttons by gamepad, and on a touch screen one plate that opens the options (where Leave is).
 */
export function Corner({ px, device, phase, shown, onOpen, onLeave }: CornerProps) {
  const touch = device === "touch";
  const pad = device === "gamepad";
  return (
    <nav className={`${styles.corner} ${shown || touch ? styles.cornerShown : ""}`} style={pxVar(px)} aria-label="Leave or open the options">
      {touch || phase !== "flying" ? null : (
        <Link className={styles.cornerItem} href="/" aria-keyshortcuts="Escape" onClick={onLeave && ((e) => {
          e.preventDefault();
          onLeave();
        })}>
          <PixelGlyph sprite={pad ? plate("view") : keyCap("Escape")} px={px} />
          <PixelGlyph sprite={slip("leave")} px={px} />
          <span className={styles.sr}>Leave the world</span>
        </Link>
      )}
      <button type="button" className={styles.cornerItem} onClick={onOpen} aria-keyshortcuts="O">
        <PixelGlyph sprite={touch ? plate("options") : pad ? plate("menu") : keyCap("o")} px={px} />
        {touch ? null : <PixelGlyph sprite={slip("options")} px={px} />}
        <span className={styles.sr}>Options</span>
      </button>
    </nav>
  );
}
