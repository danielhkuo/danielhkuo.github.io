import assert from "node:assert/strict";
import { test } from "node:test";
import { createSoundControl, SOUND_UI, type ContextLike, type ControlEnv, type SoundModule, type SoundRuntime } from "./control.ts";
import { KEY_WANTED } from "./prefs.ts";
import { emptyHearing } from "./types.ts";

type Fn = (e: Event) => void;

/** A stand-in browser: listeners, timers, a context whose state the test moves, and a runtime that records its calls. */
function world(opts: { stored?: string | null; storage?: boolean; resumes?: boolean; hidden?: boolean; log?: boolean } = {}) {
  const store = new Map<string, string>();
  if (opts.stored) store.set(KEY_WANTED, opts.stored);
  const listeners = new Map<string, Set<Fn>>();
  const target = () => ({
    addEventListener: (type: string, fn: Fn) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    removeEventListener: (type: string, fn: Fn) => void listeners.get(type)?.delete(fn),
  });
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let clock = 0, ids = 0;
  const contexts: (ContextLike & { resumed: number; suspended: number; closed: boolean; set(state: string): void })[] = [];
  const calls: string[] = [];
  let loads = 0;
  let resolveLoad: (() => void) | null = null;
  const runtime: SoundRuntime = {
    frame: () => void calls.push("frame"),
    kitMs: () => 0.01,
    work: () => 4,
    settled: () => true,
    hearing: () => emptyHearing(),
    enable: (first) => void calls.push(first ? "enable:first" : "enable:again"),
    mute: () => void calls.push("mute"),
    hide: () => void calls.push("hide"),
    cut: () => void calls.push("cut"),
    dispose: () => void calls.push("dispose"),
  };
  const mod: SoundModule = { createRuntime: () => (calls.push("create"), runtime) };
  const doc = { ...target(), visibilityState: opts.hidden ? "hidden" : "visible" };
  const env: ControlEnv = {
    storage: opts.storage === false ? null : { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    makeContext() {
      const c = {
        state: "suspended", currentTime: 0, resumed: 0, suspended: 0, closed: false, onstatechange: null as (() => void) | null,
        resume() {
          c.resumed++;
          if (opts.resumes !== false) c.set("running");
          return Promise.resolve();
        },
        suspend() {
          c.suspended++;
          c.set("suspended");
          return Promise.resolve();
        },
        close() {
          c.closed = true;
          c.state = "closed";
          return Promise.resolve();
        },
        set(state: string) {
          if (c.closed) return;
          c.state = state;
          c.onstatechange?.();
        },
      };
      contexts.push(c);
      return c;
    },
    load() {
      loads++;
      return new Promise<SoundModule>((resolve) => {
        resolveLoad = () => resolve(mod);
      });
    },
    win: target(),
    doc,
    now: () => clock,
    setTimeout(fn, ms) {
      timers.push({ at: clock + ms, fn, id: ++ids });
      return ids;
    },
    clearTimeout(id) {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    touch: false,
    calm: () => false,
    log: opts.log,
  };
  const fire = (type: string, init: Record<string, unknown> = {}) => {
    for (const fn of [...(listeners.get(type) ?? [])]) fn({ type, target: null, ...init } as unknown as Event);
  };
  return {
    env, store, contexts, calls, doc,
    get loads() {
      return loads;
    },
    armed: () => ["keydown", "pointerup", "click"].every((t) => (listeners.get(t)?.size ?? 0) > 0),
    listening: (type: string) => listeners.get(type)?.size ?? 0,
    fire,
    key: (key: string, target: unknown = null) => fire("keydown", { key, target }),
    /** Lets the lazy import arrive. */
    async loaded() {
      resolveLoad?.();
      await new Promise((r) => setTimeout(r, 0));
    },
    /** Moves the clock on, running the timers that fall due. */
    advance(ms: number) {
      const end = clock + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        clock = next.at;
        next.fn();
      }
      clock = end;
    },
    async settle() {
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

const FLIGHT = { x: 1, y: 2, alt: 30, heading: 0, speed: 60, bank: 0 };
const inUi = { closest: (sel: string) => (sel === `[${SOUND_UI}]` ? {} : null) };

test("missing or unreadable storage is off: no context, no engine, no listeners, and a frame costs nothing", () => {
  for (const w of [world({ storage: false }), world({ stored: null }), world({ stored: "off" })]) {
    const c = createSoundControl(w.env);
    assert.equal(c.state(), "off");
    assert.equal(c.frame(1, FLIGHT, 0), 0);
    w.key("ArrowUp");
    assert.equal(w.contexts.length, 0, "no AudioContext exists");
    assert.equal(w.loads, 0, "the engine is not fetched");
    assert.ok(!w.armed());
    assert.equal(c.log(), null);
  }
});

test("a stored on waits for a gesture: the engine is fetched, listeners are armed, no context is made", () => {
  const w = world({ stored: "on" });
  const c = createSoundControl(w.env);
  c.world({ seed: 3, n: 10240, sites: [] }, "w");
  assert.equal(c.state(), "waiting");
  assert.equal(w.loads, 1);
  assert.ok(w.armed());
  assert.equal(w.contexts.length, 0);
  assert.equal(c.frame(1, FLIGHT, 0), 0);
});

test("Shift, Control and Escape do not unlock, and do not disarm the listeners", () => {
  const w = world({ stored: "on" });
  const c = createSoundControl(w.env);
  c.world({ seed: 3, n: 10240, sites: [] }, "w");
  for (const key of ["Shift", "Control", "Alt", "Meta", "Escape", "CapsLock"]) w.key(key);
  assert.equal(w.contexts.length, 0);
  assert.ok(w.armed());
  assert.equal(c.state(), "waiting");
});

test("events inside the sound UI are ignored by the unlock listeners", () => {
  const w = world({ stored: "on" });
  createSoundControl(w.env).world({ seed: 3, n: 10240, sites: [] }, "w");
  w.key("Enter", inUi);
  w.fire("click", { target: inUi });
  w.fire("pointerup", { target: inUi });
  assert.equal(w.contexts.length, 0);
  assert.ok(w.armed());
});

test("a context that is not running keeps the listeners armed, and every later gesture resumes again", async () => {
  const w = world({ stored: "on", resumes: false });
  const c = createSoundControl(w.env);
  c.world({ seed: 3, n: 10240, sites: [] }, "w");
  await w.loaded();
  w.key("ArrowUp");
  assert.equal(w.contexts.length, 1);
  assert.equal(w.contexts[0].resumed, 1);
  assert.ok(w.armed(), "still armed");
  assert.equal(c.state(), "waiting");
  w.fire("pointerup");
  w.key("ArrowLeft");
  assert.equal(w.contexts.length, 1, "the same context");
  assert.equal(w.contexts[0].resumed, 3);
  assert.ok(!w.calls.includes("create"));
  // It runs at last: only now are the listeners removed.
  w.contexts[0].set("running");
  assert.ok(!w.armed());
  assert.equal(c.state(), "running");
  assert.deepEqual(w.calls, ["create", "enable:first"]);
});

test("a key press unlocks; frames then reach the engine and report its time", async () => {
  const w = world({ stored: "on" });
  const c = createSoundControl(w.env);
  c.world({ seed: 3, n: 10240, sites: [] }, "w");
  w.key("ArrowUp");
  assert.equal(c.state(), "running");
  assert.ok(!w.armed());
  // The engine has not arrived yet: nothing to run.
  assert.equal(c.frame(1, FLIGHT, 0), 0);
  await w.loaded();
  assert.deepEqual(w.calls, ["create", "enable:first"]);
  assert.ok(c.frame(1.016, FLIGHT, 0) >= 0);
  assert.equal(w.calls.at(-1), "frame");
  assert.equal(c.kitMs(), 0.01);
});

test("a click on the toggle while waiting ends running, not off", async () => {
  const w = world({ stored: "on" });
  const c = createSoundControl(w.env);
  c.world({ seed: 3, n: 10240, sites: [] }, "w");
  await w.loaded();
  assert.equal(c.state(), "waiting");
  c.toggle();
  assert.equal(c.state(), "running");
  assert.equal(w.store.get(KEY_WANTED), "on");
  assert.deepEqual(w.calls, ["create", "enable:first"]);
});

test("the toggle from off makes the context in the gesture and remembers the choice", async () => {
  const w = world();
  const c = createSoundControl(w.env);
  c.world({ seed: 3, n: 10240, sites: [] }, "w");
  let changes = 0;
  c.subscribe(() => changes++);
  c.toggle();
  assert.equal(w.contexts.length, 1, "made synchronously, in the handler");
  assert.equal(w.contexts[0].resumed, 1);
  assert.equal(w.store.get(KEY_WANTED), "on");
  assert.equal(c.state(), "running");
  assert.ok(changes >= 1);
  await w.loaded();
  assert.deepEqual(w.calls, ["create", "enable:first"]);
});

test("off: the mute fade, the device suspended after 300 ms, the engine let go after 30 s still off", async () => {
  const w = world();
  const c = createSoundControl(w.env);
  c.world({ seed: 3, n: 10240, sites: [] }, "w");
  c.toggle();
  await w.loaded();
  c.toggle();
  assert.equal(c.state(), "off");
  assert.equal(w.store.get(KEY_WANTED), "off");
  assert.equal(w.calls.at(-1), "mute");
  assert.equal(w.contexts[0].suspended, 0);
  w.advance(299);
  assert.equal(w.contexts[0].suspended, 0);
  w.advance(2);
  assert.equal(w.contexts[0].suspended, 1);
  assert.equal(c.frame(5, FLIGHT, 0), 0, "nothing runs while off");
  w.advance(30000);
  assert.equal(w.calls.at(-1), "dispose");
  assert.ok(w.contexts[0].closed);
});

test("on again while the engine is alive: resume and a quick fade, no rebuild", async () => {
  const w = world();
  const c = createSoundControl(w.env);
  c.world({ seed: 3, n: 10240, sites: [] }, "w");
  c.toggle();
  await w.loaded();
  c.toggle();
  w.advance(1000);
  c.toggle();
  assert.equal(c.state(), "running");
  assert.equal(w.contexts.length, 1);
  assert.deepEqual(w.calls, ["create", "enable:first", "mute", "enable:again"]);
  w.advance(60000);
  assert.ok(!w.contexts[0].closed, "the dispose timer was cancelled");
});

test("tab hidden: the hide fade in the handler, suspend at 250 ms; shown: resume and a quick fade", async () => {
  const w = world();
  const c = createSoundControl(w.env);
  c.world({ seed: 3, n: 10240, sites: [] }, "w");
  c.toggle();
  await w.loaded();
  w.doc.visibilityState = "hidden";
  w.fire("visibilitychange");
  assert.equal(w.calls.at(-1), "hide");
  assert.equal(c.state(), "suspended");
  assert.equal(c.frame(2, FLIGHT, 0), 0, "no frames while hidden");
  w.advance(251);
  assert.equal(w.contexts[0].suspended, 1);
  assert.equal(c.state(), "suspended");
  w.doc.visibilityState = "visible";
  w.fire("visibilitychange");
  assert.equal(c.state(), "running");
  assert.equal(w.calls.at(-1), "enable:again");
  assert.ok(!w.armed());
});

test("a return that does not recover lets the engine go and waits for a gesture again", async () => {
  const w = world();
  const c = createSoundControl(w.env);
  c.world({ seed: 3, n: 10240, sites: [] }, "w");
  c.toggle();
  await w.loaded();
  w.doc.visibilityState = "hidden";
  w.fire("visibilitychange");
  w.advance(300);
  // From here on the context will not run, whatever is asked of it.
  w.contexts[0].resume = () => (w.contexts[0].resumed++, Promise.resolve());
  w.doc.visibilityState = "visible";
  w.fire("visibilitychange");
  assert.notEqual(c.state(), "running");
  w.advance(500);
  await w.settle();
  w.advance(500);
  assert.equal(w.calls.at(-1), "dispose");
  assert.ok(w.contexts[0].closed);
  assert.equal(c.state(), "waiting");
  assert.ok(w.armed());
  // The next key press starts over with a new context.
  w.key("ArrowUp");
  assert.equal(w.contexts.length, 2);
  assert.equal(c.state(), "running");
});

test("an interruption stops everything at once and is a suspension; running again fades back in", async () => {
  const w = world();
  const c = createSoundControl(w.env);
  c.world({ seed: 3, n: 10240, sites: [] }, "w");
  c.toggle();
  await w.loaded();
  w.contexts[0].set("interrupted");
  assert.equal(w.calls.at(-1), "cut");
  assert.equal(c.state(), "suspended");
  w.contexts[0].set("running");
  assert.equal(w.calls.at(-1), "enable:again");
  assert.equal(c.state(), "running");
});

test("pagehide that is not for the back/forward cache disposes", async () => {
  const w = world();
  const c = createSoundControl(w.env);
  c.world({ seed: 3, n: 10240, sites: [] }, "w");
  c.toggle();
  await w.loaded();
  w.fire("pagehide", { persisted: false });
  assert.ok(w.contexts[0].closed);
  assert.ok(w.calls.includes("dispose"));
  assert.notEqual(c.state(), "running");
});

test("dispose removes every listener and closes the context", async () => {
  const w = world({ stored: "on" });
  const c = createSoundControl(w.env);
  c.world({ seed: 3, n: 10240, sites: [] }, "w");
  w.key("ArrowUp");
  await w.loaded();
  c.dispose();
  for (const type of ["keydown", "pointerup", "click", "visibilitychange", "pagehide", "pageshow"]) assert.equal(w.listening(type), 0, type);
  assert.ok(w.contexts[0].closed);
  assert.equal(c.frame(9, FLIGHT, 0), 0);
});

test("?soundlog records the flight whether sound is on or off, for at most 120 s", () => {
  const w = world({ log: true });
  const c = createSoundControl(w.env);
  c.world({ seed: 3, n: 10240, sites: [] }, "w");
  c.world({ seed: 3, n: 10240, sites: [{ id: "abbey-0", type: "abbey", x: 5, y: 6 }] }, "abc");
  for (let k = 0; k < 10; k++) c.frame(10 + k / 60, { ...FLIGHT, x: k }, 0.25, k === 3 ? { mist: 0.4, night: 1, rain: 0.25 } : undefined);
  c.frame(10 + 121, FLIGHT, 0);
  const log = c.log()!;
  assert.equal(log.v, 1);
  assert.equal(log.worldId, "abc");
  assert.deepEqual(log.places?.abbeys, [{ x: 5, y: 6 }]);
  assert.equal(log.frames.length, 10, "the frame past two minutes is not kept");
  // t, dt, x, y, alt, heading, speed, bank, rest, the Hearing's index, then the air: mist, night, rain.
  assert.equal(log.frames[3].length, 13);
  assert.deepEqual(log.frames[3].slice(2, 9), [3, 2, 30, 0, 60, 0, 0.25]);
  assert.deepEqual(log.frames[3].slice(10), [0.4, 1, 0.25]);
  assert.deepEqual(log.frames[4].slice(10), [0, 0, 0], "a frame without the air is clear daylight");
  assert.equal(w.contexts.length, 0, "recording makes no context");
  assert.equal(c.state(), "off");
});
