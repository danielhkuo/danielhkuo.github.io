// The touch controls' pinned scenes: the same layouts and states the golden test hashes and the bench draws. Pure.

import { drawControls, type ControlsScene } from "./art.ts";
import { layoutControls, type Hand } from "./layout.ts";

const PHONE = { top: 0, right: 62, bottom: 20, left: 62 };

export interface Pinned {
  name: string;
  fw: number;
  fh: number;
  scene: ControlsScene;
}

/** The scenes: a filled iPhone 17 frame (525×203, s 5), today's letterboxed one (400×225 at 4/3), and the tab-bar one. */
export function pinnedScenes(): Pinned[] {
  const fills: { name: string; w: number; h: number; fw: number; fh: number; frame: { x: number; y: number; w: number; h: number } }[] = [
    { name: "fill", w: 874, h: 338, fw: 525, fh: 203, frame: { x: 0, y: 0, w: 875, h: 338.33 } },
    { name: "letterbox", w: 874, h: 338, fw: 400, fh: 225, frame: { x: 170.33, y: 19, w: 533.33, h: 300 } },
    { name: "tabbar", w: 874, h: 292, fw: 400, fh: 225, frame: { x: 237, y: 33.5, w: 400, h: 225 } },
  ];
  const out: Pinned[] = [];
  for (const f of fills) {
    for (const [state, hand, size, land] of [
      ["idle", "right", 1, false],
      ["held", "right", 1, true],
      ["left", "left", 1, true],
      ["huge", "right", 1.5, true],
    ] as const) {
      const layout = layoutControls({ width: f.w, height: f.h, insets: PHONE, platform: "ios", hand: hand as Hand, size, frame: f.frame, land });
      const held = state === "held" || state === "left";
      const base = { x: layout.rest.x + 4, y: layout.rest.y - 6 };
      out.push({
        name: `${f.name}-${state}`,
        fw: f.fw,
        fh: f.fh,
        scene: {
          layout,
          frame: f.frame,
          stick: held ? { baseX: base.x, baseY: base.y, knobX: base.x + layout.travel * 0.7, knobY: base.y - layout.travel * 0.7 } : null,
          ghost: state === "idle",
          pressed: { boost: held, brake: false, land: state === "left" },
          alpha: state === "idle" ? 0.55 : 1,
        },
      });
    }
  }
  return out;
}

/** A pinned scene drawn over plain paper. */
export function drawPinned(p: Pinned): Uint32Array {
  const out = new Uint32Array(p.fw * p.fh).fill(0xffd2e8f0);
  drawControls(out, p.fw, p.fh, p.scene);
  return out;
}
