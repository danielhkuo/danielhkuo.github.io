// The genie on the page. genie.ts says where each band sits; this cuts the window into those bands and moves them.
// A frame is only t, so running t backwards is the window coming back. Nothing fades: a band is either there or gone.

import { GENIE_MS, GENIE_SLOW, genieBands, quadMatrix, type GenieSetup } from "./genie";

const BANDS = 40;

export function runGenie(el: HTMLElement, opts: { reverse: boolean; slow: boolean; onDone(): void }): () => void {
  let settled = false;
  let raf = 0;
  let layer: HTMLDivElement | null = null;

  // `done` is the gesture finishing. Cancel puts the window back and does not call onDone.
  const end = (done: boolean) => {
    if (settled) return;
    settled = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    layer?.remove();
    layer = null;
    // Forward leaves the window hidden: the title takes the front away. Backward puts the window back.
    el.style.visibility = done && !opts.reverse ? "hidden" : "";
    if (done) opts.onDone();
  };

  // A cut. Reduced motion, or a window that has no box yet, is already at the end. The finish is deferred so the
  // caller can store the cancel before React paints the next mode.
  const cut = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rect = el.getBoundingClientRect();
  if (cut || rect.width === 0 || rect.height === 0) {
    queueMicrotask(() => end(true));
    return () => end(false);
  }

  const setup: GenieSetup = {
    win: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
    neckX: window.innerWidth / 2,
    neckHalf: 24,
    floorY: window.innerHeight + 40,
  };

  // One clone per band, built once. Only the quad moves. cloneNode keeps each image's src, so nothing refetches.
  const sample = genieBands(setup, 0, BANDS);
  layer = document.createElement("div");
  layer.style.position = "fixed";
  layer.style.inset = "0";
  layer.style.overflow = "hidden";
  layer.style.pointerEvents = "none";
  layer.style.zIndex = "30";
  const wraps: HTMLDivElement[] = [];
  for (let k = 0; k < BANDS; k++) {
    const from = sample[k].from;
    const height = sample[k].to - from;
    const wrap = document.createElement("div");
    wrap.style.position = "absolute";
    wrap.style.left = "0";
    wrap.style.top = "0";
    wrap.style.width = `${setup.win.w}px`;
    wrap.style.height = `${height}px`;
    wrap.style.overflow = "hidden";
    wrap.style.transformOrigin = "0 0";
    wrap.style.pointerEvents = "none";
    const copy = el.cloneNode(true) as HTMLElement;
    quiet(copy);
    copy.style.position = "absolute";
    copy.style.left = "0";
    copy.style.top = `${-from}px`;
    copy.style.width = `${setup.win.w}px`;
    copy.style.height = `${setup.win.h}px`;
    copy.style.margin = "0";
    copy.style.visibility = "visible";
    copy.style.boxShadow = "none";
    wrap.appendChild(copy);
    layer.appendChild(wrap);
    wraps.push(wrap);
  }

  const paint = (t: number) => {
    const bands = genieBands(setup, t, BANDS);
    for (let k = 0; k < BANDS; k++) {
      const band = bands[k];
      wraps[k].style.transform = quadMatrix(setup.win.w, band.to - band.from, band.quad);
    }
  };

  el.style.visibility = "hidden";
  paint(opts.reverse ? 1 : 0);
  document.body.appendChild(layer);

  const ms = GENIE_MS * (opts.slow ? GENIE_SLOW : 1);
  let start = 0;
  const frame = (now: number) => {
    if (settled) return;
    if (start === 0) start = now;
    let t = (now - start) / ms;
    if (t > 1) t = 1;
    paint(opts.reverse ? 1 - t : t);
    if (t >= 1) end(true);
    else raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => end(false);
}

/** The copy is not a second window: no ids to clash, no focus, and no blink (that blink is an opacity animation). */
function quiet(copy: HTMLElement) {
  const nodes: Element[] = [copy, ...copy.querySelectorAll("*")];
  for (const node of nodes) {
    node.removeAttribute("id");
    if (node instanceof HTMLElement || node instanceof SVGElement) {
      node.style.animation = "none";
      node.style.transition = "none";
    }
  }
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
}
