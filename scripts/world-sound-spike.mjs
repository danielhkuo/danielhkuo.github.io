// The platform spike for the world's sound (design §6.9, §10 phase 0): what headless Chrome and headless Firefox do
// with the Web Audio features the engine leans on. Prints one JSON object per browser; the findings are written up in
// the design's §6.9.
//
//   node scripts/world-sound-spike.mjs [--browser chrome|firefox|both]

import puppeteer from "puppeteer";

const FIREFOX = process.env.FIREFOX_BIN ?? "/Applications/Firefox.app/Contents/MacOS/firefox";
const which = process.argv.includes("--browser") ? process.argv[process.argv.indexOf("--browser") + 1] : "both";

/** Runs in the page. */
async function spike() {
  const out = { userAgent: navigator.userAgent };
  const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  const rms = (x, a = 0, b = x.length) => {
    let s = 0;
    for (let i = a; i < b; i++) s += x[i] * x[i];
    return Math.sqrt(s / (b - a));
  };
  const RATE = 48000;

  // What exists.
  out.has = {
    offlineSuspend: typeof OfflineAudioContext.prototype.suspend === "function",
    cancelAndHoldAtTime: typeof AudioParam.prototype.cancelAndHoldAtTime === "function",
    getOutputTimestamp: typeof AudioContext.prototype.getOutputTimestamp === "function",
    outputLatency: "outputLatency" in AudioContext.prototype,
    audioBufferConstructor: (() => {
      try {
        return new AudioBuffer({ length: 8, sampleRate: 48000, numberOfChannels: 2 }).length === 8;
      } catch {
        return false;
      }
    })(),
    audioSession: "audioSession" in navigator,
  };

  // k-rate on a biquad's detune.
  {
    const c = new OfflineAudioContext(1, 128, RATE);
    const f = c.createBiquadFilter();
    try {
      f.detune.automationRate = "k-rate";
      out.kRate = f.detune.automationRate;
    } catch (e) {
      out.kRate = `throws: ${e.message}`;
    }
  }

  // A 3000 Hz buffer, six channels, played at a tenth of its speed: is it accepted, and is the result a smooth line?
  try {
    const n = 300;
    const buf = new AudioBuffer({ length: n, sampleRate: 3000, numberOfChannels: 6 });
    for (let ch = 0; ch < 6; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = ch === 5 ? i / n : 0;
    }
    const c = new OfflineAudioContext(2, RATE, RATE);
    const s = c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = 0.1;
    const split = c.createChannelSplitter(6);
    s.connect(split);
    split.connect(c.destination, 5);
    s.start(0);
    const r = (await c.startRendering()).getChannelData(0);
    // One second of output covers the whole 0.1 s buffer slowed tenfold: a ramp from 0 to 1.
    let worst = 0, step = 0;
    for (let i = 1000; i < RATE - 1000; i++) {
      worst = Math.max(worst, Math.abs(r[i] - i / RATE));
      step = Math.max(step, Math.abs(r[i] - r[i - 1]));
    }
    out.controlBuffer = { accepted: true, worstErrorFromLine: +worst.toFixed(5), biggestStep: +step.toFixed(6), idealStep: +(1 / RATE).toFixed(6) };
  } catch (e) {
    out.controlBuffer = { accepted: false, error: e.message };
  }

  // Pan: a gain pair against a StereoPannerNode, on a mono sine.
  {
    const pans = [-0.85, -0.5, -0.3, 0, 0.3, 0.5, 0.85];
    const rows = [];
    for (const p of pans) {
      const c = new OfflineAudioContext(4, RATE / 2, RATE);
      const o = c.createOscillator();
      o.frequency.value = 440;
      const merge = c.createChannelMerger(4);
      const a = ((p + 1) * Math.PI) / 4;
      const gl = c.createGain(), gr = c.createGain();
      gl.gain.value = Math.cos(a);
      gr.gain.value = Math.sin(a);
      o.connect(gl);
      o.connect(gr);
      gl.connect(merge, 0, 0);
      gr.connect(merge, 0, 1);
      const sp = c.createStereoPanner();
      sp.pan.value = p;
      const split = c.createChannelSplitter(2);
      o.connect(sp);
      sp.connect(split);
      split.connect(merge, 0, 2);
      split.connect(merge, 1, 3);
      merge.connect(c.destination);
      o.start();
      const r = await c.startRendering();
      const lv = [0, 1, 2, 3].map((ch) => rms(r.getChannelData(ch), 4800));
      rows.push({ pan: p, pairDb: [+db(lv[0] * Math.SQRT2).toFixed(2), +db(lv[1] * Math.SQRT2).toFixed(2)], pannerDb: [+db(lv[2] * Math.SQRT2).toFixed(2), +db(lv[3] * Math.SQRT2).toFixed(2)] });
    }
    out.pan = rows;
    out.panWorstDifferenceDb = +Math.max(...rows.flatMap((r) => [0, 1].map((k) => (Number.isFinite(r.pairDb[k]) && Number.isFinite(r.pannerDb[k]) ? Math.abs(r.pairDb[k] - r.pannerDb[k]) : 0)))).toFixed(3);
  }

  // The master chain's limiter: its make-up gain on a −20 dBFS tone, its delay on an impulse, and what `reduction` reads.
  {
    const mk = (c) => {
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -3;
      comp.knee.value = 0;
      comp.ratio.value = 20;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      return comp;
    };
    const c = new OfflineAudioContext(1, RATE, RATE);
    const o = c.createOscillator();
    o.frequency.value = 1000;
    const g = c.createGain();
    g.gain.value = 0.1;
    const comp = mk(c);
    o.connect(g);
    g.connect(comp);
    comp.connect(c.destination);
    o.start();
    const reductions = [];
    if (out.has.offlineSuspend) {
      for (const t of [0.1, 0.3, 0.6, 0.9]) void c.suspend(t).then(() => {
        reductions.push(+comp.reduction.toFixed(3));
        void c.resume();
      });
    }
    const before = comp.reduction;
    const r = (await c.startRendering()).getChannelData(0);
    out.limiter = { makeupDb: +(db(rms(r, RATE / 2) * Math.SQRT2) + 20).toFixed(3), reductionBeforeRender: before, reductionDuringRender: reductions, reductionAfterRender: +comp.reduction.toFixed(3) };
    const c2 = new OfflineAudioContext(1, 4800, RATE);
    const b = new AudioBuffer({ length: 4800, sampleRate: RATE, numberOfChannels: 1 });
    b.getChannelData(0)[480] = 0.1;
    const s = c2.createBufferSource();
    s.buffer = b;
    const comp2 = mk(c2);
    s.connect(comp2);
    comp2.connect(c2.destination);
    s.start();
    const r2 = (await c2.startRendering()).getChannelData(0);
    let at = 0;
    for (let i = 0; i < r2.length; i++) if (Math.abs(r2[i]) > Math.abs(r2[at])) at = i;
    out.limiter.delayMs = +(((at - 480) / RATE) * 1000).toFixed(3);
  }

  // A ramp scheduled after a setTargetAtTime has settled, with and without an anchor: does it start from the settled value?
  if (out.has.offlineSuspend) {
    const run = async (anchor, hold) => {
      const c = new OfflineAudioContext(1, RATE * 2, RATE);
      const k = c.createConstantSource();
      const g = c.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(1, 0, 0.02);
      k.connect(g);
      g.connect(c.destination);
      k.start();
      void c.suspend(1).then(() => {
        if (hold && g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(1);
        else g.gain.cancelScheduledValues(1);
        if (anchor) g.gain.setValueAtTime(1, 1);
        g.gain.linearRampToValueAtTime(0, 1.2);
        void c.resume();
      });
      const r = (await c.startRendering()).getChannelData(0);
      return { justBefore: +r[RATE - 200].toFixed(4), at50ms: +r[RATE + 2400].toFixed(4), at100ms: +r[RATE + 4800].toFixed(4) };
    };
    out.rampAfterSettledTarget = { cancelThenRamp: await run(false, false), holdThenRamp: await run(false, true), cancelSetThenRamp: await run(true, false) };
  }

  // A burst of offline renders at once (the kit's prerenders).
  {
    const t0 = performance.now();
    const jobs = [];
    for (let i = 0; i < 24; i++) {
      const c = new OfflineAudioContext(1, RATE * 2, 32000);
      const o = c.createOscillator();
      o.frequency.value = 200 + 10 * i;
      o.connect(c.destination);
      o.start();
      jobs.push(c.startRendering().then((b) => b.length, (e) => `error: ${e.message}`));
    }
    const done = await Promise.all(jobs);
    out.offlineBurst = { renders: done.length, ok: done.filter((d) => typeof d === "number").length, ms: Math.round(performance.now() - t0) };
  }

  // A live context: its state without a gesture, and the output timestamp just after a resume.
  try {
    const c = new AudioContext({ latencyHint: "playback" });
    const live = { stateAtStart: c.state, sampleRate: c.sampleRate, baseLatency: c.baseLatency, outputLatency: c.outputLatency };
    const stamp = () => {
      const s = typeof c.getOutputTimestamp === "function" ? c.getOutputTimestamp() : null;
      return { state: c.state, currentTime: +c.currentTime.toFixed(4), contextTime: s ? +(+s.contextTime).toFixed(4) : null, performanceTime: s ? +(+s.performanceTime).toFixed(1) : null, now: +performance.now().toFixed(1) };
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const resumed = await Promise.race([c.resume().then(() => "resolved", (e) => `rejected: ${e.message}`), wait(1500).then(() => "pending after 1.5 s")]);
    live.resume = resumed;
    live.rightAfterResume = stamp();
    await wait(50);
    live.after50ms = stamp();
    await wait(450);
    live.after500ms = stamp();
    live.outputLatencyRunning = c.outputLatency;
    if (c.state === "running") {
      await c.suspend();
      await wait(300);
      live.suspended = stamp();
      void c.resume();
      live.resumeCalled = stamp();
      await wait(20);
      live.resumed20ms = stamp();
      await wait(200);
      live.resumed220ms = stamp();
    }
    await c.close();
    out.live = live;
  } catch (e) {
    out.live = { error: e.message };
  }
  return out;
}

async function run(name) {
  const browser =
    name === "firefox"
      ? await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true, extraPrefsFirefox: { "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0 } })
      : await puppeteer.launch({ headless: "shell", args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    const page = await browser.newPage();
    await page.goto("about:blank");
    const result = await page.evaluate(spike);
    return { browser: name, version: await browser.version(), ...result };
  } finally {
    await browser.close();
  }
}

for (const name of which === "both" ? ["chrome", "firefox"] : [which]) {
  try {
    console.log(JSON.stringify(await run(name), null, 2));
  } catch (e) {
    console.log(JSON.stringify({ browser: name, error: e instanceof Error ? e.message : String(e) }, null, 2));
  }
}
