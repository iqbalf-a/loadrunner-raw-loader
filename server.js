import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "./server/api.js";

const DIST_DIR = fileURLToPath(new URL("./dist/", import.meta.url));
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 8787;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

const handleApi = createApiRouter();

function resolveStatic(pathname) {
  const decoded = decodeURIComponent(pathname.split("?")[0]);
  const candidate = path.join(DIST_DIR, decoded.replaceAll("/", path.sep));
  const relative = path.relative(DIST_DIR, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return path.join(DIST_DIR, "index.html");
}

const server = http.createServer(async (req, res) => {
  try {
    if (await handleApi(req, res)) return;

    const file = resolveStatic(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
    if (!file || !existsSync(file)) {
      res.statusCode = 404;
      res.end("Not found. Jalankan `npm run build` dulu supaya folder dist tersedia.");
      return;
    }
    res.setHeader("Content-Type", CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
    res.setHeader("Cache-Control", file.endsWith("index.html") ? "no-store" : "public, max-age=3600");
    createReadStream(file).pipe(res);
  } catch (error) {
    res.statusCode = 500;
    res.end(error instanceof Error ? error.message : String(error));
  }
});

// Upload ZIP besar bisa memakan waktu lama; matikan timeout bawaan Node.
server.requestTimeout = 0;
server.headersTimeout = 0;

server.listen(PORT, HOST, () => {
  console.log(`LoadRunner dashboard listening on http://${HOST}:${PORT}`);
  console.log(`Static dir: ${DIST_DIR}`);
});
