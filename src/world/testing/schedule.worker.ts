// Runs the erosion schedule in a worker_threads worker and posts the hash of G.
import { parentPort, workerData } from "node:worker_threads";
import { runSchedule } from "../gen/erode.ts";
import { paramsFor } from "../gen/params.ts";
import { planWorld } from "../gen/plan.ts";
import { sha256Hex } from "./sha.ts";

const { n, seed } = workerData as { n: number; seed: number };
const p = paramsFor(n);
parentPort!.postMessage(sha256Hex(runSchedule(planWorld(p, seed), p, seed).g));
