// The control signals, played once and shared: the gust, each ear's flutter and the two slow drifts. (The whistles'
// squalls are played by the whistles' own voice, which exists only at speed.) Each is a small buffer played at a tenth of its rate, and a buffer played off its rate is resampled
// sample by sample (about 0.03 % of a core a channel), so every voice that wants one taps the same source here.

import { rngFor } from "../../core/rng.ts";
import { CONTROL_PLAYBACK } from "../synth/controls.ts";
import { loop, type Ctx } from "./graph.ts";
import type { Kit } from "./kit.ts";

export interface Hub {
  /** One channel, 0 … 1. */
  gust: ChannelSplitterNode;
  /** Two channels, 0 … 1: 8–14 Hz. */
  flutter: ChannelSplitterNode;
  /** Two channels, −1 … 1: 0.07 and 0.11 Hz. */
  drift: ChannelSplitterNode;
  sources: AudioBufferSourceNode[];
}

export function buildHub(ctx: Ctx, kit: Kit, seed: number, at: number): Hub {
  const rng = rngFor(seed, "sound/wind/offsets");
  const sources: AudioBufferSourceNode[] = [];
  const control = (name: string): ChannelSplitterNode => {
    const buffer = kit.buffer(name);
    const s = loop(ctx, buffer, CONTROL_PLAYBACK);
    s.start(at, rng.float() * buffer.duration);
    sources.push(s);
    const split = ctx.createChannelSplitter(Math.max(2, buffer.numberOfChannels));
    s.connect(split);
    return split;
  };
  return { gust: control("gust"), flutter: control("flutter"), drift: control("drift"), sources };
}
