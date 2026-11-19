// The mobile flight in a browser (mobile spec 9, layer 3): headless Chrome in phone emulation, driven with real
// multi-touch (Puppeteer's touch handles give trusted pointer events, one id per finger). Serves out/ as GitHub Pages
// would, opens /world?stats, and reads the flight through window.__flight.state().
//
//   npm run build && npm run test:mobile [-- --port 4360]
//
// What emulation cannot show (Safari's toolbars, real gestures, memory, heat) is the Simulator's and a real phone's.

import assert from "node:assert/strict";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { layoutControls } from "../src/world/mobile/layout.ts";
import { toScreen } from "../src/world/mobile/turned.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../out");
const portArg = process.argv.indexOf("--port");
const PORT = portArg > 0 ? Number(process.argv[portArg + 1]) : 4360;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".bin": "application/octet-stream",
};

function resolveFile(urlPath) {
  const rel = decodeURIComponent((urlPath ?? "/").split("?")[0]).replace(/^\/+/, "");
  for (const file of [path.join(root, rel), path.join(root, `${rel}.html`), path.join(root, rel, "index.html")]) {
    const r = path.relative(root, path.normalize(file));
    if (r.startsWith("..") || path.isAbsolute(r)) continue;
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      // the next spelling
    }
  }
  return null;
}

// Measured in the iOS 26.5 Simulator (iPhone 17, Safari, landscape, one tab): 874×338 at DPR 3, insets 0/62/20/62.
const IPHONE = {
  viewport: { width: 874, height: 338, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true },
  upright: { width: 402, height: 714, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false },
  ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1",
  insets: { top: 0, right: 62, bottom: 20, left: 62 },
  platform: "ios",
};
const PIXEL = {
  viewport: { width: 915, height: 412, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, isLandscape: true },
  upright: { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, isLandscape: false },
  ua: "Mozilla/5.0 (Linux; Android 16; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36",
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
  platform: "android",
};

let server;
let browser;

before(async () => {
  statSync(path.join(root, "world.html"));
  server = createServer((req, res) => {
    const file = resolveFile(req.url);
    if (!file) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  browser = await puppeteer.launch({ headless: "shell", args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A phone page on /world?stats (plus `query`), loaded to its first full view. Spies on fullscreen and the lock. */
async function phone(device, query = "") {
  const page = await browser.newPage();
  await page.setUserAgent(device.ua);
  await page.setViewport(device.viewport);
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: device.insets });
  await page.evaluateOnNewDocument(() => {
    window.__calls = { fullscreen: [], lock: [] };
    const fs = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function (opts) {
      window.__calls.fullscreen.push(opts ?? null);
      return fs ? fs.call(this, opts) : Promise.reject(new Error("none"));
    };
    if (screen.orientation) {
      screen.orientation.lock = (o) => {
        window.__calls.lock.push(o);
        return Promise.resolve();
      };
    }
  });
  await page.goto(`${ORIGIN}/world?stats${query}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__flight?.readyAt != null || window.__flight?.error, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.__flight.error), null);
  return { page, cdp };
}

const state = (page) => page.evaluate(() => window.__flight.state());
const card = (page) => page.evaluate(() => document.querySelector("[data-card]")?.getAttribute("data-card") ?? null);
const act = async (page, name) => {
  await page.waitForSelector(`[data-act="${name}"]`, { timeout: 5000 });
  await page.tap(`[data-act="${name}"]`);
};

/** Where the controls are on this page, as the page lays them out. */
async function controls(page, device, turn = 0) {
  const view = await page.evaluate(() => {
    const r = document.querySelector("canvas").getBoundingClientRect();
    const v = window.visualViewport;
    return { w: Math.round(v.width), h: Math.round(v.height), frame: { x: r.left, y: r.top, w: r.width, h: r.height } };
  });
  let { w, h, frame } = view;
  if (turn !== 0) {
    // In the turned layer the frame is a quarter round: its rectangle swaps sides about the layer.
    const a = toScreenInverse(frame.x, frame.y, w, h, turn);
    const b = toScreenInverse(frame.x + frame.w, frame.y + frame.h, w, h, turn);
    frame = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    [w, h] = [h, w];
  }
  return { layout: layoutControls({ width: w, height: h, insets: turn ? { top: 0, right: 0, bottom: 0, left: 0 } : device.insets, platform: device.platform, hand: "right", size: 1, frame, land: true }), screen: view };
}

function toScreenInverse(x, y, w, h, turn) {
  // Screen to layer, for a frame rectangle measured on the screen.
  if (turn === 90) return { x: y, y: w - x };
  if (turn === -90) return { x: h - y, y: x };
  return { x, y };
}

function wrapPi(a) {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

test("a phone opens on the before-you-fly card, held still until Take wing", async () => {
  const { page } = await phone(IPHONE);
  assert.equal(await card(page), "gate");
  const a = await state(page);
  await sleep(600);
  const b = await state(page);
  assert.equal(a.paused, true);
  assert.deepEqual([b.x, b.y], [a.x, a.y], "the dragon waits behind the card");
  await act(page, "take-wing");
  await page.waitForFunction(() => !document.querySelector("[data-card]"));
  await sleep(600);
  const c = await state(page);
  assert.equal(c.paused, false);
  assert.ok(Math.hypot(c.x - b.x, c.y - b.y) > 10, "flying after Take wing");
  // A phone bakes with two workers and paces itself.
  assert.equal(c.workers, 2);
  assert.equal(c.rate, 60);
  await page.close();
});

test("two fingers fly at once: the stick points the way, Boost speeds up, and letting go flies straight", async () => {
  const { page } = await phone(IPHONE);
  await act(page, "take-wing");
  await sleep(300);
  const { layout } = await controls(page, IPHONE);
  const sx = Math.round((layout.zone.x0 + layout.zone.x1) / 2);
  const sy = Math.round((layout.zone.y0 + layout.zone.y1) / 2);
  const thumb = await page.touchscreen.touchStart(sx, sy);
  // Up and to the right on screen: the world heading that direction has, through the 0.8 foreshortening.
  for (let i = 1; i <= 6; i++) await thumb.move(sx + i * 8, sy - i * 8);
  const boost = await page.touchscreen.touchStart(Math.round(layout.boost.x), Math.round(layout.boost.y));
  await sleep(2200);
  const held = await state(page);
  const want = Math.atan2(-1 / 0.8, 1);
  assert.ok(Math.abs(wrapPi(held.heading - want)) < 0.08, `heading ${held.heading.toFixed(3)}, want ${want.toFixed(3)}`);
  assert.ok(held.speed > 90, `boosted to ${held.speed.toFixed(1)}`);
  await boost.end();
  await thumb.end();
  await sleep(1500);
  const let_go = await state(page);
  assert.ok(Math.abs(wrapPi(let_go.heading - held.heading)) < 0.05, "straight on once let go");
  assert.ok(let_go.speed < held.speed - 10, "slowing back to cruise");
  await page.close();
});

test("a CDP touch cancel lets go of every finger", async () => {
  const { page, cdp } = await phone(IPHONE);
  await act(page, "take-wing");
  await sleep(200);
  const { layout } = await controls(page, IPHONE);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: layout.boost.x, y: layout.boost.y, id: 1 }] });
  await sleep(1200);
  const boosted = await state(page);
  assert.ok(boosted.speed > 75, `boosting ${boosted.speed}`);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await sleep(1500);
  assert.ok((await state(page)).speed < boosted.speed - 5, "Boost let go on cancel");
  await page.close();
});

test("upright, the flight waits behind the turn card; level again, Fly on resumes", async () => {
  const { page } = await phone(IPHONE);
  await act(page, "take-wing");
  await sleep(300);
  await page.setViewport(IPHONE.upright);
  await page.waitForFunction(() => document.querySelector("[data-card]")?.getAttribute("data-card") === "upright");
  const a = await state(page);
  await sleep(500);
  const b = await state(page);
  assert.equal(b.paused, true);
  assert.deepEqual([b.x, b.y], [a.x, a.y]);
  await page.setViewport(IPHONE.viewport);
  await page.waitForFunction(() => document.querySelector("[data-card]")?.getAttribute("data-card") === "paused");
  await act(page, "fly-on");
  await page.waitForFunction(() => !document.querySelector("[data-card]"));
  await sleep(400);
  assert.equal((await state(page)).paused, false);
  await page.close();
});

test("played sideways on an upright phone, the turned layer flies and a turned touch steers", async () => {
  const { page } = await phone(IPHONE);
  await page.setViewport(IPHONE.upright);
  await act(page, "take-wing");
  await page.waitForFunction(() => document.querySelector("[data-card]")?.getAttribute("data-card") === "upright");
  await act(page, "play-sideways-anyway");
  await page.waitForFunction(() => document.querySelector("[data-card]")?.getAttribute("data-card") === "paused");
  await act(page, "fly-on");
  await page.waitForFunction(() => !document.querySelector("[data-card]"));
  await sleep(300);
  const { layout, screen } = await controls(page, IPHONE, 90);
  const lx = (layout.zone.x0 + layout.zone.x1) / 2;
  const ly = (layout.zone.y0 + layout.zone.y1) / 2;
  const s0 = toScreen(lx, ly, screen.w, screen.h, 90);
  const thumb = await page.touchscreen.touchStart(Math.round(s0.x), Math.round(s0.y));
  // Pushed toward the layer's own right: the dragon heads east in the world.
  for (let i = 1; i <= 6; i++) {
    const p = toScreen(lx + i * 9, ly, screen.w, screen.h, 90);
    await thumb.move(Math.round(p.x), Math.round(p.y));
  }
  await sleep(2500);
  const s = await state(page);
  await thumb.end();
  assert.equal(s.paused, false);
  assert.ok(Math.abs(wrapPi(s.heading - 0)) < 0.1, `heading ${s.heading.toFixed(3)}, want 0`);
  await page.close();
});

test("nothing zooms or scrolls: a pinch and a two-finger drag leave the page as it was", async () => {
  const { page, cdp } = await phone(PIXEL);
  await act(page, "take-wing");
  await sleep(200);
  await cdp.send("Input.synthesizePinchGesture", { x: 450, y: 200, scaleFactor: 2.5, relativeSpeed: 600, gestureSourceType: "touch" });
  await sleep(300);
  const a = await page.touchscreen.touchStart(300, 150);
  const b = await page.touchscreen.touchStart(400, 150);
  for (let i = 1; i <= 8; i++) {
    await a.move(300, 150 + i * 20);
    await b.move(400, 150 + i * 20);
  }
  await a.end();
  await b.end();
  const v = await page.evaluate(() => ({ scale: window.visualViewport.scale, y: window.scrollY, top: window.visualViewport.offsetTop }));
  assert.deepEqual(v, { scale: 1, y: 0, top: 0 });
  await page.close();
});

test("Back while flying is a pause, not a way off the page", async () => {
  const { page } = await phone(IPHONE);
  await act(page, "take-wing");
  await sleep(300);
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => document.querySelector("[data-card]")?.getAttribute("data-card") === "paused");
  assert.match(page.url(), /\/world/);
  assert.equal((await state(page)).paused, true);
  await page.close();
});

test("a hidden page pauses, a blur pauses, and each comes back to Fly on", async () => {
  const { page } = await phone(IPHONE);
  await act(page, "take-wing");
  await sleep(1700);
  // The headless shell has no other tab to switch to, and its frozen pages never wake: the page is told it was hidden,
  // as switching apps tells it. Real hiding is checked in the Simulator and on a phone.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.visibilityState;
  });
  await page.waitForFunction(() => document.querySelector("[data-card]")?.getAttribute("data-card") === "paused");
  assert.equal((await state(page)).paused, true);
  await act(page, "fly-on");
  await page.waitForFunction(() => !document.querySelector("[data-card]"));
  assert.equal((await state(page)).paused, false);
  // Safari's tab switcher fires only blur.
  await sleep(1700);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForFunction(() => document.querySelector("[data-card]")?.getAttribute("data-card") === "paused");
  await page.close();
});

test("near a landmark Land joins the cluster, and a tap on it lands; Take off flies on", async () => {
  const { page } = await phone(IPHONE, "&at=abbey-0");
  await act(page, "take-wing");
  const { layout } = await controls(page, IPHONE);
  await page.waitForFunction(() => window.__flight.state().phase === "flying", { timeout: 5000 });
  // Flying north from 150 cells south of the abbey, it comes into reach within a couple of seconds.
  let landed = false;
  for (let i = 0; i < 40 && !landed; i++) {
    await sleep(150);
    await page.touchscreen.tap(Math.round(layout.land.x), Math.round(layout.land.y));
    landed = (await state(page)).phase !== "flying";
  }
  assert.ok(landed, "the Land tap started a landing");
  await page.waitForFunction(() => window.__flight.state().phase === "landed", { timeout: 20000 });
  await page.waitForSelector("dialog[open]", { timeout: 5000 });
  const takeOff = await page.evaluateHandle(() => [...document.querySelectorAll("dialog[open] button")].find((b) => /take off/i.test(b.textContent ?? "")));
  await takeOff.asElement().tap();
  await page.waitForFunction(() => window.__flight.state().phase === "flying", { timeout: 5000 });
  await page.close();
});

test("Android: Take wing asks for fullscreen with the navigation hidden, then the landscape lock", async () => {
  const { page } = await phone(PIXEL);
  await act(page, "take-wing");
  await sleep(500);
  const calls = await page.evaluate(() => window.__calls);
  assert.deepEqual(calls.fullscreen, [{ navigationUI: "hide" }]);
  // Headless Chrome may refuse fullscreen; when it grants it, the lock follows.
  const inFullscreen = await page.evaluate(() => document.fullscreenElement !== null);
  if (inFullscreen) assert.deepEqual(calls.lock, ["landscape"]);
  await page.close();
});

test("an iPhone asks for neither: it has no element fullscreen and no lock", async () => {
  const { page } = await phone(IPHONE);
  await act(page, "take-wing");
  await sleep(300);
  const calls = await page.evaluate(() => window.__calls);
  assert.deepEqual(calls, { fullscreen: [], lock: [] });
  await page.close();
});

test("leaving lifts the lock: the next page zooms and scrolls as it always did", async () => {
  const { page } = await phone(IPHONE);
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("overflow")), "hidden");
  await page.evaluate(() => document.querySelector("a[href='/']")?.click());
  await page.waitForFunction(() => location.pathname === "/", { timeout: 10000 });
  await sleep(300);
  const after = await page.evaluate(() => ({
    html: document.documentElement.style.getPropertyValue("overflow"),
    body: document.body.style.getPropertyValue("overflow"),
    select: document.documentElement.style.getPropertyValue("user-select"),
  }));
  assert.deepEqual(after, { html: "", body: "", select: "" });
  await page.close();
});

test("a desktop goes straight into flight, with no card and no lock", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${ORIGIN}/world?stats`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__flight?.readyAt != null, { timeout: 60000 });
  await sleep(300);
  assert.equal(await card(page), null);
  const s = await state(page);
  assert.equal(s.paused, false);
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("overflow")), "");
  await page.close();
});

test("the manifest's start view is what the card's size counts", () => {
  const { worldId } = JSON.parse(readFileSync(path.join(here, "../public/world/current.json"), "utf8"));
  assert.ok(statSync(path.join(here, "../public/world", worldId, "core.bin")).size > 0);
});
