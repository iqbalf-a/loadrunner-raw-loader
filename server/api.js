import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  openLoadRunnerCache,
  readCacheMetadata,
  queryDashboard,
  queryTransactions,
  queryTpsSummary,
  queryResponseTimeSeries,
  queryTpsSeries,
  queryTpsDetailSummary,
  queryTpsDetailSeries,
  queryTpsOverall,
} from "../loadrunner-duckdb-cache.js";
import { clearClientSession, getClientSession, resolveClientId, setClientSession } from "./clients.js";
import { enqueueIngest, getIngestJob } from "./ingest-queue.js";

const UPLOAD_DIR = path.resolve(process.env.LR_UPLOAD_DIR || ".loadrunner-uploads");
const RESULTS_ROOT = process.env.LR_RESULTS_ROOT ? path.resolve(process.env.LR_RESULTS_ROOT) : null;
const MAX_UPLOAD_BYTES = Number(process.env.LR_MAX_UPLOAD_BYTES) || 4 * 1024 ** 3;
const MAX_EXTRACT_BYTES = Number(process.env.LR_MAX_EXTRACT_BYTES) || 16 * 1024 ** 3;
const KEEP_EXTRACTED = process.env.LR_KEEP_EXTRACTED === "1";

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.setHeader("Cache-Control", "no-store");
  res.end(payload);
}

function parseExtraNames(url) {
  const raw = url.searchParams.get("extraNames");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((name) => typeof name === "string") : [];
  } catch {
    return [];
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveRequestedPath(rawPath, pathModeAllowed) {
  if (!pathModeAllowed) {
    throw new HttpError(403, "Mode path dimatikan di server ini. Upload file ZIP raw result.");
  }
  const resolved = path.resolve(rawPath);
  if (RESULTS_ROOT && !isInside(RESULTS_ROOT, resolved)) {
    throw new HttpError(400, `Path harus berada di dalam ${RESULTS_ROOT}.`);
  }
  return resolved;
}

// Session hanya boleh dipakai oleh browser yang memuatnya. Result browser lain tidak
// bisa dibaca hanya dengan menebak/menyalin session key.
function requireOwnedSession(url, clientId) {
  const session = url.searchParams.get("session");
  if (!session) throw new HttpError(400, "Parameter session wajib diisi.");
  const active = getClientSession(clientId);
  if (!active || active.session !== session) {
    throw new HttpError(403, "Session tidak aktif untuk browser ini. Muat ulang halaman.");
  }
  return session;
}

async function loadSessionMetadata(session) {
  const metadata = await readCacheMetadata(session);
  if (!metadata) throw new HttpError(404, "Cache result tidak ditemukan, muat ulang result.");
  return metadata;
}

function readBodyToFile(req, filePath, maxBytes) {
  const hash = createHash("sha256");
  let bytes = 0;
  req.on("data", (chunk) => {
    bytes += chunk.length;
    hash.update(chunk);
    if (bytes > maxBytes) req.destroy(new HttpError(413, `Ukuran upload melebihi batas ${maxBytes} byte.`));
  });
  return pipeline(req, createWriteStream(filePath)).then(() => ({ sha256: hash.digest("hex"), bytes }));
}

async function handleUpload(req, res, url, clientId) {
  const label = (url.searchParams.get("name") || "raw-result.zip").replace(/[\r\n]/g, "").slice(0, 200);
  await mkdir(UPLOAD_DIR, { recursive: true });
  const temporaryPath = path.join(UPLOAD_DIR, `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}.zip`);

  let uploaded;
  try {
    uploaded = await readBodyToFile(req, temporaryPath, MAX_UPLOAD_BYTES);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error instanceof HttpError ? error : new HttpError(400, `Upload gagal: ${error.message}`);
  }
  if (!uploaded.bytes) {
    await rm(temporaryPath, { force: true });
    throw new HttpError(400, "File upload kosong.");
  }

  const key = uploaded.sha256.slice(0, 24);
  const cached = await readCacheMetadata(key);
  if (cached) {
    await rm(temporaryPath, { force: true });
    setClientSession(clientId, key, cached.result.label || label);
    sendJson(res, 200, { status: "done", session: key, cached: true });
    return;
  }

  const zipPath = path.join(UPLOAD_DIR, `${key}.zip`);
  await rename(temporaryPath, zipPath);
  const job = enqueueIngest({
    key,
    zipPath,
    extractDir: path.join(UPLOAD_DIR, key),
    label,
    maxExtractBytes: MAX_EXTRACT_BYTES,
    keepExtracted: KEEP_EXTRACTED,
  });
  sendJson(res, 202, { ...job, cached: false });
}

async function handleSession(res, clientId) {
  const active = getClientSession(clientId);
  if (!active) {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }
  const metadata = await readCacheMetadata(active.session);
  if (!metadata) {
    clearClientSession(clientId);
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }
  sendJson(res, 200, {
    session: metadata.key,
    result: metadata.result,
    cache: { rowCount: metadata.rowCount },
  });
}

export function createApiRouter(options = {}) {
  const pathModeAllowed = options.pathMode ?? (RESULTS_ROOT !== null);

  return async function handleApi(req, res) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/")) return false;

    const clientId = resolveClientId(req, res);

    try {
      switch (url.pathname) {
        case "/api/config":
          sendJson(res, 200, { pathMode: pathModeAllowed, resultsRoot: RESULTS_ROOT, maxUploadBytes: MAX_UPLOAD_BYTES });
          return true;

        case "/api/session":
          if (req.method === "DELETE") {
            clearClientSession(clientId);
            sendJson(res, 200, { ok: true });
            return true;
          }
          await handleSession(res, clientId);
          return true;

        case "/api/upload":
          if (req.method !== "POST") throw new HttpError(405, "Gunakan POST untuk upload.");
          await handleUpload(req, res, url, clientId);
          return true;

        case "/api/upload-status": {
          const job = getIngestJob(url.searchParams.get("job") || "");
          if (!job) throw new HttpError(404, "Job ingest tidak ditemukan atau sudah kedaluwarsa.");
          if (job.status === "done" && job.session) setClientSession(clientId, job.session, job.label);
          sendJson(res, 200, job);
          return true;
        }

        case "/api/load": {
          const requested = url.searchParams.get("path");
          if (!requested) throw new HttpError(400, "Parameter path wajib diisi.");
          const cached = await openLoadRunnerCache(resolveRequestedPath(requested, pathModeAllowed));
          setClientSession(clientId, cached.key, cached.result.resultDir);
          sendJson(res, 200, {
            session: cached.key,
            result: cached.result,
            cache: { rowCount: cached.rowCount },
          });
          return true;
        }

        case "/api/dashboard": {
          const metadata = await loadSessionMetadata(requireOwnedSession(url, clientId));
          sendJson(res, 200, await queryDashboard(
            metadata,
            Number(url.searchParams.get("start")),
            Number(url.searchParams.get("end")),
            Number(url.searchParams.get("granularity")),
            {
              maxSeriesPerGraph: Number(url.searchParams.get("maxSeries")) || undefined,
              focusGraphType: url.searchParams.get("focusGraphType") || undefined,
              focusMeasurementId: Number(url.searchParams.get("focusMeasurementId")),
            },
          ));
          return true;
        }

        case "/api/transactions": {
          const metadata = await loadSessionMetadata(requireOwnedSession(url, clientId));
          sendJson(res, 200, await queryTransactions(
            metadata,
            Number(url.searchParams.get("start")),
            Number(url.searchParams.get("end")),
            Number(url.searchParams.get("limit")),
            Number(url.searchParams.get("offset")),
            url.searchParams.get("namePrefix") || "",
          ));
          return true;
        }

        case "/api/tps-summary": {
          const metadata = await loadSessionMetadata(requireOwnedSession(url, clientId));
          sendJson(res, 200, await queryTpsSummary(
            metadata,
            Number(url.searchParams.get("start")),
            Number(url.searchParams.get("end")),
            Number(url.searchParams.get("granularity")),
            Number(url.searchParams.get("limit")),
            Number(url.searchParams.get("offset")),
            url.searchParams.get("namePrefix") || "",
          ));
          return true;
        }

        case "/api/response-time-series": {
          const metadata = await loadSessionMetadata(requireOwnedSession(url, clientId));
          sendJson(res, 200, await queryResponseTimeSeries(
            metadata,
            Number(url.searchParams.get("start")),
            Number(url.searchParams.get("end")),
            Number(url.searchParams.get("granularity")),
            {
              maxSeries: Number(url.searchParams.get("maxSeries")) || undefined,
              namePrefix: url.searchParams.get("namePrefix") || "",
              extraNames: parseExtraNames(url),
            },
          ));
          return true;
        }

        case "/api/tps-series": {
          const metadata = await loadSessionMetadata(requireOwnedSession(url, clientId));
          sendJson(res, 200, await queryTpsSeries(
            metadata,
            Number(url.searchParams.get("start")),
            Number(url.searchParams.get("end")),
            Number(url.searchParams.get("granularity")),
            {
              maxSeries: Number(url.searchParams.get("maxSeries")) || undefined,
              namePrefix: url.searchParams.get("namePrefix") || "",
              extraNames: parseExtraNames(url),
            },
          ));
          return true;
        }

        case "/api/tps-detail-summary": {
          const metadata = await loadSessionMetadata(requireOwnedSession(url, clientId));
          sendJson(res, 200, await queryTpsDetailSummary(
            metadata,
            Number(url.searchParams.get("start")),
            Number(url.searchParams.get("end")),
            Number(url.searchParams.get("granularity")),
            url.searchParams.get("namePrefix") || "BP",
          ));
          return true;
        }

        case "/api/tps-detail-series": {
          const metadata = await loadSessionMetadata(requireOwnedSession(url, clientId));
          sendJson(res, 200, await queryTpsDetailSeries(
            metadata,
            Number(url.searchParams.get("start")),
            Number(url.searchParams.get("end")),
            Number(url.searchParams.get("granularity")),
            {
              maxSeries: Number(url.searchParams.get("maxSeries")) || undefined,
              namePrefix: url.searchParams.get("namePrefix") || "BP",
              extraNames: parseExtraNames(url),
            },
          ));
          return true;
        }

        case "/api/tps-overall": {
          const metadata = await loadSessionMetadata(requireOwnedSession(url, clientId));
          sendJson(res, 200, await queryTpsOverall(
            metadata,
            Number(url.searchParams.get("start")),
            Number(url.searchParams.get("end")),
            Number(url.searchParams.get("granularity")),
            url.searchParams.get("namePrefix") || "BP",
          ));
          return true;
        }

        default:
          throw new HttpError(404, `Endpoint ${url.pathname} tidak dikenal.`);
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  };
}
