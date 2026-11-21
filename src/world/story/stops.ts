// The five stops, in the order a tie between equally near ones is broken.

export type StopKey = "pine" | "desk" | "bell" | "mill" | "basket";

export const STOPS: readonly { key: StopKey; interest: string; name: string; icon: StopKey }[] = [
  { key: "pine", interest: "bonsai", name: "the small pine", icon: "pine" },
  { key: "desk", interest: "reading", name: "the desk", icon: "desk" },
  { key: "bell", interest: "faith", name: "the bell", icon: "bell" },
  { key: "mill", interest: "homelab", name: "the mill-shed", icon: "mill" },
  { key: "basket", interest: "basketball", name: "the basket", icon: "basket" },
];

/** True when `v` is one of the five stop keys. */
export function isStopKey(v: unknown): v is StopKey {
  return typeof v === "string" && STOPS.some((stop) => stop.key === v);
}

/**
 * The colour of each stop's piece, the thing the quest collects: a glass of its own colour set in the monument, and
 * the colour its slot in the count fills with. Packed RGBA, as the frame is (red in the low byte).
 */
export const PIECE_RGB: Readonly<Record<StopKey, number>> = {
  pine: 0xff4aa85a,
  desk: 0xffd0703c,
  bell: 0xff3cb4e8,
  mill: 0xffa0a62e,
  basket: 0xff2c6ae2,
};
