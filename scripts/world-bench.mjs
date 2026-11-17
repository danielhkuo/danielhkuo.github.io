import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { probe } from "../src/world/core/probe.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".bin": "application/octet-stream",
};

function parseArgs(argv) {
  let rate = 4;
  let serve = false;
  let hidden = false;
  let port = 4317;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--rate") rate = Number(argv[++i]);
    else if (arg === "--port") port = Number(argv[++i]);
    else if (arg === "--serve") serve = true;
    else if (arg === "--hidden") hidden = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return { rate, serve, hidden, port };
}

function resolveFile(urlPath) {
  const pathname = decodeURIComponent((urlPath ?? "/").split("?")[0]);
  const rel = pathname.replace(/^\/+/, "");
  const candidates = [path.join(root, rel), path.join(root, `${rel}.html`), path.join(root, rel, "index.html")];
  for (const file of candidates) {
    const relative = path.relative(root, path.normalize(file));
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      // Missing candidate; try the next spelling.
    }
  }
  return null;
}

function listen(port) {
  const server = createServer((req, res) => {
    const file = resolveFile(req.url);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function throttleWorker(worker, rate) {
  worker.client.send("Emulation.setCPUThrottlingRate", { rate }).catch(() => {});
}

const options = parseArgs(process.argv.slice(2));
const server = await listen(options.port);
const origin = `http://127.0.0.1:${options.port}/`;

if (options.serve) {
  console.log(origin);
} else {
  const browser = await puppeteer.launch({ headless: true });
  let failed = false;
  try {
    const page = await browser.newPage();
    page.on("workercreated", (worker) => throttleWorker(worker, options.rate));
    await page.goto(`${origin}world-bench`, { waitUntil: "load" });
    await page.emulateCPUThrottling(options.rate);
    for (const worker of page.workers()) throttleWorker(worker, options.rate);
    await page.waitForFunction(
      () => {
        const button = document.querySelector("[data-bench-run]");
        return button instanceof HTMLButtonElement && !button.disabled;
      },
      { timeout: 120000 },
    );
    await page.click("[data-bench-run]");
    if (options.hidden) {
      const extra = await browser.newPage();
      await extra.goto("about:blank");
      await extra.bringToFront();
    }
    await page.waitForFunction(() => window.__benchResult, { timeout: 120000 });
    const result = await page.evaluate(() => window.__benchResult);
    if (result.probe !== probe(42)) {
      console.error(`probe mismatch: got ${result.probe}, expected ${probe(42)}`);
      failed = true;
    } else {
      console.log(JSON.stringify({ ...result, rate: options.rate }, null, 2));
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failed) process.exit(1);
}
