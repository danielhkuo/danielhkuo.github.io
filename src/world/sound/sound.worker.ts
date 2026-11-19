// Runs the kit's arithmetic (synth/*) off the main thread and posts the buffers back as transferables.

import { make, type Job, type Raw } from "./synth/make.ts";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(m: unknown, transfer: Transferable[]): void;
};

export interface KitRequest {
  job: Job;
  seed: number;
  sampleRate: number;
}

export interface KitReply {
  job: Job;
  buffers?: Record<string, Raw>;
  error?: string;
}

scope.onmessage = (event: MessageEvent) => {
  const req = event.data as KitRequest;
  try {
    const buffers = make(req.job, req.seed, req.sampleRate);
    const transfer: Transferable[] = [];
    for (const name of Object.keys(buffers)) for (const c of buffers[name].channels) transfer.push(c.buffer as ArrayBuffer);
    scope.postMessage({ job: req.job, buffers } satisfies KitReply, transfer);
  } catch (e) {
    scope.postMessage({ job: req.job, error: e instanceof Error ? e.message : String(e) } satisfies KitReply, []);
  }
};
