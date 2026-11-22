import { createHash } from "node:crypto";

/** SHA-256 hex of a typed array's bytes. */
export function sha256Hex(view: ArrayBufferView): string {
  return createHash("sha256").update(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)).digest("hex");
}
