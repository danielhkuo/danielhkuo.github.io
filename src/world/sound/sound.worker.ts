// Runs the kit's arithmetic (synth/*) off the main thread and posts the buffers back as transferables. A job builds
// the kit; a remake builds one later generation of one looping buffer, the same way, so the page can retire a loop
// before it comes round.

import { make, remake, type Job, type Raw } from "./synth/make.ts";

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

interface RemakeRequest {
  remake: string;
  generation: number;
  seed: number;
  sampleRate: number;
}

function isRemake(data: KitRequest | RemakeRequest): data is RemakeRequest {
  return "remake" in data;
}

scope.onmessage = (event: MessageEvent) => {
  const req = event.data as KitRequest | RemakeRequest;
  if (isRemake(req)) {
    try {
      const raw = remake(req.remake, req.generation, req.seed, req.sampleRate);
      const transfer: Transferable[] = raw.channels.map((c) => c.buffer as ArrayBuffer);
      scope.postMessage({ remake: req.remake, generation: req.generation, raw }, transfer);
    } catch (e) {
      scope.postMessage({ remake: req.remake, generation: req.generation, error: e instanceof Error ? e.message : String(e) }, []);
    }
    return;
  }
  try {
    const buffers = make(req.job, req.seed, req.sampleRate);
    const transfer: Transferable[] = [];
    for (const name of Object.keys(buffers)) {
      for (const c of buffers[name].channels) transfer.push(c.buffer as ArrayBuffer);
      const bytes = buffers[name].bytes;
      if (bytes) transfer.push(bytes.buffer as ArrayBuffer);
    }
    scope.postMessage({ job: req.job, buffers } satisfies KitReply, transfer);
  } catch (e) {
    scope.postMessage({ job: req.job, error: e instanceof Error ? e.message : String(e) } satisfies KitReply, []);
  }
};
