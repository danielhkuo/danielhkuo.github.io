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
