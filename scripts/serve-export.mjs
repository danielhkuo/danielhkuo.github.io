// The static export, served the way GitHub Pages serves it: out/ over HTTP
// on a free local port, a path answered by the file itself, then path.html,
// then path/index.html, and anything else by 404.html. Shared by the checks
// that open the built site in a browser (run-axe.mjs, minimal-e2e.mjs).

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const OUT = path.resolve("out");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
};

/** The file GitHub Pages serves for a path: the file itself, else path.html, else path/index.html. */
async function fileFor(urlPath) {
  const pathname = decodeURIComponent(new URL(urlPath, "http://x").pathname);
  const base = path.join(OUT, pathname);
  if (base !== OUT && !base.startsWith(OUT + path.sep)) return null;
  for (const candidate of [base, `${base}.html`, path.join(base, "index.html")]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Not this one; try the next.
    }
  }
  return null;
}

/** Whether there is an export to serve. */
export async function hasExport() {
  try {
    return (await stat(path.join(OUT, "index.html"))).isFile();
  } catch {
    return false;
  }
}

/** A static server for out/ on a free local port. `origin(server)` is where it listens. */
export async function serveExport() {
  const server = createServer(async (req, res) => {
    const file = await fileFor(req.url ?? "/");
    if (!file) {
      res.writeHead(404, { "Content-Type": TYPES[".html"] });
      res.end(await readFile(path.join(OUT, "404.html")).catch(() => "Not found"));
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

export function origin(server) {
  return `http://127.0.0.1:${server.address().port}`;
}
