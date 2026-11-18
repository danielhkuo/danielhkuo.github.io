// What a bake worker holds: the decoded world, the look and the tile cache.
// bake.worker.ts wraps this in a message loop; tests call it directly.

/** Decodes `bin` and returns a function that bakes chunk (cx, cy) as bakeChunk does. */
export async function createBakeHost(bin: Uint8Array, mask: Uint8Array): Promise<(cx: number, cy: number) => Uint32Array> {
  void bin;
  void mask;
  throw new Error("not implemented");
}
