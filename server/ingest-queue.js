import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const WORKER_PATH = fileURLToPath(new URL("./ingest-worker.js", import.meta.url));
const MAX_CONCURRENT = Math.max(1, Number(process.env.LR_INGEST_CONCURRENCY) || 1);
const JOB_TTL_MS = 30 * 60 * 1000;

const jobs = new Map();
const jobByKey = new Map();
const pending = [];
let running = 0;

function publicJob(job) {
  return {
    job: job.id,
    key: job.key,
    label: job.label,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    session: job.session,
    error: job.error,
  };
}

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if ((job.status === "done" || job.status === "error") && now - job.finishedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

function settle(job, patch) {
  Object.assign(job, patch, { finishedAt: Date.now() });
  jobByKey.delete(job.key);
  running -= 1;
  pump();
}

function pump() {
  while (running < MAX_CONCURRENT && pending.length) {
    const job = pending.shift();
    if (job.status !== "queued") continue;
    running += 1;
    job.status = "running";
    job.stage = "extracting";

    const worker = new Worker(WORKER_PATH, {
      workerData: {
        zipPath: job.zipPath,
        extractDir: job.extractDir,
        key: job.key,
        label: job.label,
        maxExtractBytes: job.maxExtractBytes,
        keepExtracted: job.keepExtracted,
      },
    });

    worker.on("message", (message) => {
      if (message.type === "status") job.stage = message.status;
      else if (message.type === "progress") job.progress = { done: message.done, total: message.total, bytes: message.bytes };
      else if (message.type === "done") settle(job, { status: "done", stage: "done", session: message.session, rowCount: message.rowCount });
      else if (message.type === "error") settle(job, { status: "error", stage: "error", error: message.error });
    });
    worker.on("error", (error) => {
      if (job.status === "running") settle(job, { status: "error", stage: "error", error: error.message });
    });
    worker.on("exit", (code) => {
      if (job.status === "running") settle(job, { status: "error", stage: "error", error: `Ingest worker berhenti (exit ${code}).` });
    });
  }
}

/**
 * Antrekan ingest satu ZIP. Kunci dedupe adalah sha256 isi ZIP: kalau result yang sama
 * sedang diproses, pemanggil kedua ikut job yang sama — mencegah dua proses menulis
 * file .duckdb yang sama secara bersamaan.
 */
export function enqueueIngest({ key, zipPath, extractDir, label, maxExtractBytes, keepExtracted }) {
  pruneJobs();
  const existing = jobByKey.get(key);
  if (existing) return publicJob(existing);

  const job = {
    id: randomUUID(),
    key,
    label,
    zipPath,
    extractDir,
    maxExtractBytes,
    keepExtracted,
    status: "queued",
    stage: "queued",
    progress: null,
    session: null,
    error: null,
    createdAt: Date.now(),
    finishedAt: 0,
  };
  jobs.set(job.id, job);
  jobByKey.set(key, job);
  pending.push(job);
  pump();
  return publicJob(job);
}

export function getIngestJob(id) {
  const job = jobs.get(id);
  return job ? publicJob(job) : null;
}
