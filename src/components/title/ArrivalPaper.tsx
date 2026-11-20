"use client";

// The world's arrival behind the title. Paper lies over the world's frame pixel for pixel, at the same size and place
// as the world's canvas, so each paper pixel covers exactly one pixel of the world. When the title says "play", the
// paper clears from the dragon outward in the order arrival.ts gives, each pixel in a single step: slow, but nothing
// ever fades. "cut" clears it at once (the opening was skipped, or motion is reduced).

import { useEffect, useRef, type CSSProperties } from "react";
import { useFrameFit } from "../../app/world/useFrameScale";
import { HOLD_AT, type HoldAt } from "../../world/runtime/hold";
import { ARRIVAL_MS, arrivalOrder, paperOver } from "./arrival";
import styles from "./title.module.css";

export type ArrivalStart = "wait" | "play" | "cut";

/** The page's paper as RGB, whatever CSS colour the body has: read back through the canvas itself. */
function paperOf(ctx: CanvasRenderingContext2D): [number, number, number] {
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor || "#fffcf0";
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

export default function ArrivalPaper({ start, at = HOLD_AT, onArrived }: {
  start: ArrivalStart;
  /** Where the held dragon's head is, as shares of the frame: the world comes in from there. */
  at?: HoldAt;
  onArrived(): void;
}) {
  const fit = useFrameFit();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arrived = useRef(onArrived);
  // Read when the arrival starts: a later measurement of the title must not start it over.
  const from = useRef(at);
  useEffect(() => {
    arrived.current = onArrived;
    from.current = at;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = fit.w;
    canvas.height = fit.h;
    const paper = paperOf(ctx);
    // The world comes in from the dragon, held where the title put it.
    const order = arrivalOrder(fit.w, fit.h, Math.round(from.current.x * fit.w), Math.round(from.current.y * fit.h));
    const image = ctx.createImageData(fit.w, fit.h);
    const draw = (p: number) => {
      paperOver(order, p, image.data, paper);
      ctx.putImageData(image, 0, 0);
    };
    if (start === "wait") {
      draw(-1);
      return;
    }
    if (start === "cut") {
      draw(2);
      arrived.current();
      return;
    }
    let raf = 0;
    let t0 = -1;
    const tick = (t: number) => {
      if (t0 < 0) t0 = t;
      const share = (t - t0) / ARRIVAL_MS;
      // The reach grows as the root of time, so the world's area comes in at an even rate: not a trickle at first.
      draw(Math.sqrt(Math.min(1, share)));
      if (share >= 1) {
        arrived.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    draw(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, fit.w, fit.h]);

  // The world's canvas is placed the same way: from the window's top-left corner, a whole number of device pixels each.
  const size = { width: fit.w * fit.css, height: fit.h * fit.css } as CSSProperties;
  return <canvas ref={canvasRef} className={styles.arrival} style={size} />;
}
