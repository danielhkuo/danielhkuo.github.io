import assert from "node:assert/strict";
import { test } from "node:test";
import { followSystemTheme, getTheme, onThemeChange, setTheme } from "./theme.ts";
import { ATTR, STORAGE_KEY, type ThemeMode } from "./theme-constants.ts";

/**
 * The slice of a browser lib/theme.ts touches — <html>'s attribute, the
 * theme-color meta, storage, and the system's colour scheme — installed as
 * globals, in the state the pre-paint script leaves a freshly loaded page in.
 */
function browser({
  system = "light",
  stored = null,
  storage = "works",
}: { system?: ThemeMode; stored?: ThemeMode | null; storage?: "works" | "refuses" } = {}) {
  const attrs = new Map<string, string>([[ATTR, stored ?? system]]);
  const meta = new Map<string, string>();
  const store = new Map<string, string>();
  if (stored) store.set(STORAGE_KEY, stored);
  let scheme = system;

  const query = new EventTarget();
  Object.defineProperty(query, "matches", { get: () => scheme === "dark" });
  const win = new EventTarget();
  Object.assign(win, { matchMedia: () => query });

  const refuse = () => {
    throw new Error("SecurityError");
  };
  const globals = {
    window: win,
    document: {
      documentElement: {
        getAttribute: (name: string) => attrs.get(name) ?? null,
        setAttribute: (name: string, value: string) => void attrs.set(name, value),
      },
      querySelector: (selector: string) =>
        selector === 'meta[name="theme-color"]'
          ? { setAttribute: (name: string, value: string) => void meta.set(name, value) }
          : null,
    },
    localStorage:
      storage === "refuses"
        ? { getItem: refuse, setItem: refuse, removeItem: refuse }
        : {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => void store.set(key, value),
            removeItem: (key: string) => void store.delete(key),
          },
  };
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  return {
    /** What the page is showing. */
    showing: () => attrs.get(ATTR),
    /** The colour handed to the browser's own chrome. */
    chrome: () => meta.get("content"),
    /** The choice a reload would find. */
    remembered: () => store.get(STORAGE_KEY) ?? null,
    /** The OS or browser switches scheme. */
    systemBecomes(mode: ThemeMode) {
      scheme = mode;
      query.dispatchEvent(new Event("change"));
    },
  };
}

test("choosing a mode shows it, recolours the browser chrome, and remembers it", () => {
  const page = browser({ system: "light" });
  assert.equal(setTheme("dark"), "dark");
  assert.equal(page.showing(), "dark");
  assert.equal(getTheme(), "dark");
  assert.equal(page.chrome(), "#100F0F");
  assert.equal(page.remembered(), "dark");
});

test("toggle flips whatever is showing, and that is a choice too", () => {
  const page = browser({ system: "dark" });
  assert.equal(setTheme("toggle"), "light");
  assert.equal(page.showing(), "light");
  assert.equal(page.remembered(), "light");
  assert.equal(setTheme("toggle"), "dark");
  assert.equal(page.remembered(), "dark");
});

test("auto forgets the choice and shows the system's scheme", () => {
  const page = browser({ system: "dark", stored: "light" });
  assert.equal(page.showing(), "light");
  assert.equal(setTheme("auto"), "dark");
  assert.equal(page.showing(), "dark");
  assert.equal(page.chrome(), "#100F0F");
  assert.equal(page.remembered(), null);
});

test("with nothing chosen, the page follows the system as it changes", () => {
  const page = browser({ system: "light" });
  followSystemTheme();
  page.systemBecomes("dark");
  assert.equal(page.showing(), "dark");
  assert.equal(page.chrome(), "#100F0F");
  page.systemBecomes("light");
  assert.equal(page.showing(), "light");
  assert.equal(page.chrome(), "#FFFCF0");
});

test("following the system is not a choice: nothing is remembered", () => {
  const page = browser({ system: "light" });
  followSystemTheme();
  page.systemBecomes("dark");
  assert.equal(page.remembered(), null);
});

test("a chosen mode holds when the system changes", () => {
  const page = browser({ system: "light" });
  followSystemTheme();
  setTheme("light");
  page.systemBecomes("dark");
  assert.equal(page.showing(), "light");
});

test("a choice remembered from an earlier visit holds too", () => {
  const page = browser({ system: "light", stored: "light" });
  followSystemTheme();
  page.systemBecomes("dark");
  assert.equal(page.showing(), "light");
});

test("after auto, the page follows the system again", () => {
  const page = browser({ system: "light" });
  followSystemTheme();
  setTheme("dark");
  setTheme("auto");
  assert.equal(page.showing(), "light");
  page.systemBecomes("dark");
  assert.equal(page.showing(), "dark");
});

test("the returned function stops the following", () => {
  const page = browser({ system: "light" });
  const stop = followSystemTheme();
  stop();
  page.systemBecomes("dark");
  assert.equal(page.showing(), "light");
});

test("subscribers hear every change, chosen or followed", () => {
  const page = browser({ system: "light" });
  followSystemTheme();
  const heard: ThemeMode[] = [];
  const unsubscribe = onThemeChange((mode) => heard.push(mode));
  setTheme("dark");
  setTheme("auto");
  page.systemBecomes("dark");
  unsubscribe();
  setTheme("light");
  assert.deepEqual(heard, ["dark", "light", "dark"]);
});

test("a browser that refuses storage still switches, for this visit", () => {
  const page = browser({ system: "light", storage: "refuses" });
  assert.equal(setTheme("dark"), "dark");
  assert.equal(page.showing(), "dark");
  assert.equal(setTheme("auto"), "light");
  assert.equal(page.showing(), "light");
});
