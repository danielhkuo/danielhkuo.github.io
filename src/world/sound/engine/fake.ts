// A recording stand-in for a BaseAudioContext, for the engine's tests: it makes nodes and parameters that note every
// call, in order, so a test can read the graph that was built and what was scheduled on it. It renders nothing.

export interface Call {
  /** The order the call was made in, across the whole context. */
  seq: number;
  method: string;
  args: number[];
}

export class FakeParam {
  value: number;
  automationRate = "a-rate";
  calls: Call[] = [];
  /** Nodes whose output is connected to this parameter. */
  inputs: FakeNode[] = [];
  readonly owner: FakeNode;
  readonly name: string;
  constructor(owner: FakeNode, name: string, value: number) {
    this.owner = owner;
    this.name = name;
    this.value = value;
  }
  private note(method: string, args: number[]): this {
    this.calls.push({ seq: this.owner.ctx.tick(), method, args });
    return this;
  }
  setValueAtTime(v: number, t: number): this {
    return this.note("setValueAtTime", [v, t]);
  }
  setTargetAtTime(v: number, t: number, tau: number): this {
    return this.note("setTargetAtTime", [v, t, tau]);
  }
  linearRampToValueAtTime(v: number, t: number): this {
    return this.note("linearRampToValueAtTime", [v, t]);
  }
  cancelScheduledValues(t: number): this {
    return this.note("cancelScheduledValues", [t]);
  }
}

export class FakeNode {
  readonly ctx: FakeContext;
  readonly kind: string;
  /** Where its outputs go: nodes (with the input index) and parameters. */
  outs: { to: FakeNode | FakeParam; output: number; input: number }[] = [];
  /** The order of its first connection; −1 before it. */
  connectedAt = -1;
  type = "";
  buffer: unknown = null;
  loop = false;
  curve: Float32Array | null = null;
  oversample = "none";
  started: number[] | null = null;
  stopped: number | null = null;
  reduction = 0;
  [param: string]: unknown;
  constructor(ctx: FakeContext, kind: string, params: Record<string, number> = {}) {
    this.ctx = ctx;
    this.kind = kind;
    for (const name of Object.keys(params)) this[name] = new FakeParam(this, name, params[name]);
    ctx.nodes.push(this);
  }
  connect(to: FakeNode | FakeParam, output = 0, input = 0): void {
    const seq = this.ctx.tick();
    if (this.connectedAt < 0) this.connectedAt = seq;
    if (to instanceof FakeParam) to.inputs.push(this);
    else if (to.connectedAt < 0) to.connectedAt = seq;
    this.outs.push({ to, output, input });
  }
  disconnect(): void {
    this.outs = [];
  }
  start(when = 0, offset = 0): void {
    this.started = [when, offset];
  }
  stop(when = 0): void {
    this.stopped = when;
  }
  params(): FakeParam[] {
    return Object.keys(this).map((k) => this[k]).filter((v): v is FakeParam => v instanceof FakeParam);
  }
}

export class FakeContext {
  sampleRate = 48000;
  currentTime = 0;
  nodes: FakeNode[] = [];
  private seq = 0;
  destination: FakeNode = new FakeNode(this, "destination");
  tick(): number {
    return ++this.seq;
  }
  createGain(): FakeNode {
    return new FakeNode(this, "gain", { gain: 1 });
  }
  createBiquadFilter(): FakeNode {
    return new FakeNode(this, "biquad", { frequency: 350, detune: 0, Q: 1, gain: 0 });
  }
  createBufferSource(): FakeNode {
    return new FakeNode(this, "bufferSource", { playbackRate: 1, detune: 0 });
  }
  createOscillator(): FakeNode {
    return new FakeNode(this, "oscillator", { frequency: 440, detune: 0 });
  }
  createConstantSource(): FakeNode {
    return new FakeNode(this, "constantSource", { offset: 1 });
  }
  createChannelSplitter(): FakeNode {
    return new FakeNode(this, "splitter");
  }
  createChannelMerger(): FakeNode {
    return new FakeNode(this, "merger");
  }
  createDynamicsCompressor(): FakeNode {
    return new FakeNode(this, "compressor", { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 });
  }
  createConvolver(): FakeNode {
    return new FakeNode(this, "convolver");
  }
  createWaveShaper(): FakeNode {
    return new FakeNode(this, "waveShaper");
  }
  createStereoPanner(): FakeNode {
    return new FakeNode(this, "stereoPanner", { pan: 0 });
  }
  createPanner(): FakeNode {
    return new FakeNode(this, "panner");
  }
  /** Every call made on any parameter, in order, with the parameter it was made on. */
  calls(): (Call & { param: FakeParam })[] {
    const all: (Call & { param: FakeParam })[] = [];
    for (const n of this.nodes) for (const p of n.params()) for (const c of p.calls) all.push({ ...c, param: p });
    return all.sort((a, b) => a.seq - b.seq);
  }
}

/** A kit whose every buffer is ready: enough of an AudioBuffer for the graph to be built on. */
export function fakeKit(): { sampleRate: number; step(): boolean; heavy(): boolean; ready(): boolean; done(): boolean; buffer(name: string): AudioBuffer; bytes(name: string): Uint8Array; whenDone(): Promise<void>; dispose(): void } {
  const channels: Record<string, number> = { brown0: 2, buffet: 2, rush: 2, hiss: 2, breeze: 2, pink1: 1, gust: 1, flutter: 2, squall: 3, drift: 2, pip: 1, tail: 1, waveA: 2, velvet: 2, pink0: 2, white0: 2 };
  return {
    sampleRate: 48000,
    step: () => false,
    heavy: () => false,
    ready: () => true,
    done: () => true,
    buffer: (name) => ({ duration: name === "pip" ? 0.12 : 5, numberOfChannels: channels[name] ?? 1, sampleRate: 48000, length: 240000 }) as unknown as AudioBuffer,
    bytes: () => new Uint8Array(65536),
    whenDone: () => Promise.resolve(),
    dispose() {},
  };
}
