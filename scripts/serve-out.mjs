// Serves the static export in out/ as GitHub Pages would, for the end-to-end suite (playwright.config.ts starts it).
// A path is tried as a file, then with .html, then as a folder's index.html; anything else gets out/404.html with a
// 404. Types follow the extension, as Pages' do (a .ts file is MPEG transport stream there, not TypeScript).
//
//   node scripts/serve-out.mjs [--port 4417]

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".webmanifest": "application/manifest+json",
  ".ts": "video/mp2t",
  ".bin": "application/octet-stream",
};

const argPort = process.argv.indexOf("--port");
const port = argPort >= 0 ? Number(process.argv[argPort + 1]) : 4417;

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function resolveFile(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(urlPath, "http://x").pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  for (const file of [path.join(root, rel), path.join(root, `${rel}.html`), path.join(root, rel, "index.html")]) {
    const r = path.relative(root, path.normalize(file));
    if (r.startsWith("..") || path.isAbsolute(r)) continue;
    if (isFile(file)) return file;
  }
  return null;
}

const server = createServer((req, res) => {
  const file = resolveFile(req.url ?? "/");
  const status = file ? 200 : 404;
  const served = file ?? path.join(root, "404.html");
  if (!isFile(served)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found (run npm run build first)");
    return;
  }
  res.writeHead(status, { "content-type": TYPES[path.extname(served).toLowerCase()] ?? "application/octet-stream" });
  createReadStream(served).pipe(res);
});
server.listen(port, "127.0.0.1", () => console.log(`serving out/ at http://127.0.0.1:${port}/`));
