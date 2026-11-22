"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Heading, Text, VStack } from "@astryxdesign/core";

interface BenchResult {
  probe: string;
  workers: number;
  startViewMs: number;
  chunksPerSec: number;
  warmMsPerChunk: number;
  userAgent: string;
  hardwareConcurrency: number;
}

interface WorkerReply {
  kind: string;
  value?: string;
  ms?: number;
  chunks?: number;
}

function ask(worker: Worker, message: unknown): Promise<WorkerReply> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<WorkerReply>) => {
      if (event.data?.kind === "ready") return;
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      resolve(event.data);
    };
    const onError = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      reject(new Error("bench worker failed"));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage(message);
  });
}

export default function WorldBench() {
  const workersRef = useRef<Worker[]>([]);
  const runningRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [json, setJson] = useState("");
  const [status, setStatus] = useState("Starting workers");

  useEffect(() => {
    const hardware = navigator.hardwareConcurrency ?? 2;
    const count = Math.max(1, Math.min(4, hardware - 1));
    const workers: Worker[] = [];
    let pending = count;
    let alive = true;
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL("../../world/bench/bench.worker.ts", import.meta.url), {
        type: "module",
      });
      const onReady = (event: MessageEvent<WorkerReply>) => {
        if (event.data?.kind !== "ready") return;
        worker.removeEventListener("message", onReady);
        pending -= 1;
        if (pending === 0 && alive) {
          setReady(true);
          setStatus("Ready");
        }
      };
      worker.addEventListener("message", onReady);
      workers.push(worker);
    }
    workersRef.current = workers;
    return () => {
      alive = false;
      workersRef.current = [];
      for (const worker of workers) worker.terminate();
    };
  }, []);

  async function run() {
    const workers = workersRef.current;
    if (runningRef.current || workers.length === 0) return;
    runningRef.current = true;
    setRunning(true);
    try {
      setStatus("Probing");
      const probeReply = await ask(workers[0], { kind: "probe" });
      const chunks: [number, number][] = [];
      for (let cy = 0; cy <= 1; cy++) {
        for (let cx = 0; cx <= 2; cx++) chunks.push([cx, cy]);
      }
      const buckets = workers.map(() => [] as [number, number][]);
      chunks.forEach((chunk, index) => buckets[index % workers.length].push(chunk));
      setStatus("Baking start view");
      const started = performance.now();
      await Promise.all(
        buckets.map((bucket, index) =>
          bucket.length === 0 ? Promise.resolve() : ask(workers[index], { kind: "cold", chunks: bucket }),
        ),
      );
      const startViewMs = performance.now() - started;
      setStatus("Sustained bake");
      const warm = await Promise.all(
        workers.map((worker, index) => ask(worker, { kind: "warm", col: index, startRow: 7, ms: 10000 })),
      );
      const totalChunks = warm.reduce((sum, reply) => sum + (reply.chunks ?? 0), 0);
      const maxMs = Math.max(...warm.map((reply) => reply.ms ?? 0));
      const result: BenchResult = {
        probe: probeReply.value ?? "",
        workers: workers.length,
        startViewMs,
        chunksPerSec: totalChunks / (maxMs / 1000),
        warmMsPerChunk: maxMs / totalChunks,
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
      };
      (window as unknown as { __benchResult: BenchResult }).__benchResult = result;
      setJson(JSON.stringify(result, null, 2));
      setStatus("Done");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "bench failed");
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  async function copy() {
    if (!json) return;
    await navigator.clipboard.writeText(json);
    setStatus("Copied");
  }

  return (
    <VStack gap={4} className="mx-auto w-full max-w-3xl px-6 py-10">
      <Heading level={1}>World bench</Heading>
      <Text type="body">{status}</Text>
      <Button label="Run" data-bench-run="1" isDisabled={!ready || running} onClick={() => void run()} />
      <Button label="Copy" isDisabled={json.length === 0} onClick={() => void copy()} />
      {json.length > 0 ? (
        <Text type="code" style={{ whiteSpace: "pre-wrap" }}>
          {json}
        </Text>
      ) : null}
    </VStack>
  );
}
