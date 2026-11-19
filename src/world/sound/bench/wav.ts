// A WAV file, 32-bit float, from channels of samples: what the bench hands the render script.

export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const n = channels.length, frames = channels[0]?.length ?? 0;
  const bytes = frames * n * 4;
  const out = new Uint8Array(44 + bytes);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i);
  };
  tag(0, "RIFF");
  v.setUint32(4, 36 + bytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  // Format 3: IEEE float.
  v.setUint16(20, 3, true);
  v.setUint16(22, n, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * n * 4, true);
  v.setUint16(32, n * 4, true);
  v.setUint16(34, 32, true);
  tag(36, "data");
  v.setUint32(40, bytes, true);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < n; c++) {
      v.setFloat32(at, channels[c][i], true);
      at += 4;
    }
  }
  return out;
}

/** Base64 of bytes, in pieces small enough for String.fromCharCode. */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}
