import { rm } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { openLoadRunnerCache } from "../loadrunner-duckdb-cache.js";
import { extractResultZip } from "./unzip.js";

const { zipPath, extractDir, key, label, maxExtractBytes, keepExtracted } = workerData;

function post(message) {
  parentPort?.postMessage(message);
}

async function run() {
  post({ type: "status", status: "extracting" });
  const extracted = await extractResultZip(zipPath, extractDir, {
    maxBytes: maxExtractBytes,
    onProgress: ({ done, total, bytes }) => post({ type: "progress", stage: "extracting", done, total, bytes }),
  });

  post({ type: "status", status: "ingesting", files: extracted.fileCount, bytes: extracted.bytes });
  const metadata = await openLoadRunnerCache(extractDir, { key, fingerprint: key, label });

  if (!keepExtracted) {
    // Setelah masuk DuckDB, file mentah tidak dibutuhkan lagi: seluruh query berjalan
    // dari .loadrunner-cache/<key>.duckdb.
    await rm(extractDir, { recursive: true, force: true });
    await rm(zipPath, { force: true });
  }

  post({ type: "done", session: metadata.key, rowCount: metadata.rowCount, result: metadata.result });
}

run().catch((error) => {
  post({ type: "error", error: error instanceof Error ? error.message : String(error) });
});
