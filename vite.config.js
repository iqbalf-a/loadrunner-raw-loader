import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { createConsoleSummary } from "./loadrunner-raw-loader.js";
import { openLoadRunnerCache, queryDashboard, queryTransactions, queryTpsSummary, queryResponseTimeSeries, queryTpsSeries, queryTpsDetailSummary, queryTpsDetailSeries, queryTpsOverall } from "./loadrunner-duckdb-cache.js";
import { queryErrors } from "./loadrunner-errors.js";

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

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.setHeader("Cache-Control", "no-store");
  res.end(payload);
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      name: "loadrunner-api",
      configureServer(server) {
        server.middlewares.use("/api/load", async (req, res) => {
          try {
            const url = new URL(req.url ?? "", "http://127.0.0.1");
            const resultPath = url.searchParams.get("path");
            if (!resultPath) {
              sendJson(res, 400, { error: "Parameter path wajib diisi." });
              return;
            }

            const cached = await openLoadRunnerCache(resultPath);
            sendJson(res, 200, {
              session: cached.key,
              result: cached.result,
              cache: { rowCount: cached.rowCount },
            });
          } catch (error) {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
        server.middlewares.use("/api/dashboard", async (req, res) => {
          try {
            const url = new URL(req.url ?? "", "http://127.0.0.1");
            const session = url.searchParams.get("session");
            if (!session) throw new Error("Parameter session wajib diisi.");
            const metadataPath = new URL(`./.loadrunner-cache/${session}.json`, import.meta.url);
            const cached = JSON.parse(await (await import("node:fs/promises")).readFile(metadataPath, "utf8"));
            sendJson(res, 200, await queryDashboard(cached, Number(url.searchParams.get("start")), Number(url.searchParams.get("end")), Number(url.searchParams.get("granularity")), {
              maxSeriesPerGraph: Number(url.searchParams.get("maxSeries")) || undefined,
              focusGraphType: url.searchParams.get("focusGraphType") || undefined,
              focusMeasurementId: Number(url.searchParams.get("focusMeasurementId")),
            }));
          } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
        });
        server.middlewares.use("/api/transactions", async (req, res) => {
          try {
            const url = new URL(req.url ?? "", "http://127.0.0.1");
            const session = url.searchParams.get("session");
            if (!session) throw new Error("Parameter session wajib diisi.");
            const metadataPath = new URL(`./.loadrunner-cache/${session}.json`, import.meta.url);
            const cached = JSON.parse(await (await import("node:fs/promises")).readFile(metadataPath, "utf8"));
            sendJson(res, 200, await queryTransactions(cached, Number(url.searchParams.get("start")), Number(url.searchParams.get("end")), Number(url.searchParams.get("limit")), Number(url.searchParams.get("offset")), url.searchParams.get("namePrefix") || ""));
          } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
        });
        server.middlewares.use("/api/tps-summary", async (req, res) => {
          try {
            const url = new URL(req.url ?? "", "http://127.0.0.1");
            const session = url.searchParams.get("session");
            if (!session) throw new Error("Parameter session wajib diisi.");
            const metadataPath = new URL(`./.loadrunner-cache/${session}.json`, import.meta.url);
            const cached = JSON.parse(await (await import("node:fs/promises")).readFile(metadataPath, "utf8"));
            sendJson(res, 200, await queryTpsSummary(cached, Number(url.searchParams.get("start")), Number(url.searchParams.get("end")), Number(url.searchParams.get("granularity")), Number(url.searchParams.get("limit")), Number(url.searchParams.get("offset")), url.searchParams.get("namePrefix") || ""));
          } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
        });
        server.middlewares.use("/api/tps-detail-summary", async (req, res) => {
          try {
            const url = new URL(req.url ?? "", "http://127.0.0.1");
            const session = url.searchParams.get("session");
            if (!session) throw new Error("Parameter session wajib diisi.");
            const metadataPath = new URL(`./.loadrunner-cache/${session}.json`, import.meta.url);
            const cached = JSON.parse(await (await import("node:fs/promises")).readFile(metadataPath, "utf8"));
            sendJson(res, 200, await queryTpsDetailSummary(cached, Number(url.searchParams.get("start")), Number(url.searchParams.get("end")), Number(url.searchParams.get("granularity")), url.searchParams.get("namePrefix") || "BP"));
          } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
        });
        server.middlewares.use("/api/tps-detail-series", async (req, res) => {
          try {
            const url = new URL(req.url ?? "", "http://127.0.0.1");
            const session = url.searchParams.get("session");
            if (!session) throw new Error("Parameter session wajib diisi.");
            const metadataPath = new URL(`./.loadrunner-cache/${session}.json`, import.meta.url);
            const cached = JSON.parse(await (await import("node:fs/promises")).readFile(metadataPath, "utf8"));
            sendJson(res, 200, await queryTpsDetailSeries(cached, Number(url.searchParams.get("start")), Number(url.searchParams.get("end")), Number(url.searchParams.get("granularity")), {
              maxSeries: Number(url.searchParams.get("maxSeries")) || undefined,
              namePrefix: url.searchParams.get("namePrefix") || "BP",
              extraNames: parseExtraNames(url),
            }));
          } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
        });
        server.middlewares.use("/api/tps-overall", async (req, res) => {
          try {
            const url = new URL(req.url ?? "", "http://127.0.0.1");
            const session = url.searchParams.get("session");
            if (!session) throw new Error("Parameter session wajib diisi.");
            const metadataPath = new URL(`./.loadrunner-cache/${session}.json`, import.meta.url);
            const cached = JSON.parse(await (await import("node:fs/promises")).readFile(metadataPath, "utf8"));
            sendJson(res, 200, await queryTpsOverall(cached, Number(url.searchParams.get("start")), Number(url.searchParams.get("end")), Number(url.searchParams.get("granularity")), url.searchParams.get("namePrefix") || "BP"));
          } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
        });
        server.middlewares.use("/api/response-time-series", async (req, res) => {
          try {
            const url = new URL(req.url ?? "", "http://127.0.0.1");
            const session = url.searchParams.get("session");
            if (!session) throw new Error("Parameter session wajib diisi.");
            const metadataPath = new URL(`./.loadrunner-cache/${session}.json`, import.meta.url);
            const cached = JSON.parse(await (await import("node:fs/promises")).readFile(metadataPath, "utf8"));
            sendJson(res, 200, await queryResponseTimeSeries(cached, Number(url.searchParams.get("start")), Number(url.searchParams.get("end")), Number(url.searchParams.get("granularity")), {
              maxSeries: Number(url.searchParams.get("maxSeries")) || undefined,
              namePrefix: url.searchParams.get("namePrefix") || "",
              extraNames: parseExtraNames(url),
            }));
          } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
        });
        server.middlewares.use("/api/errors", async (req, res) => {
          try {
            const url = new URL(req.url ?? "", "http://127.0.0.1");
            const session = url.searchParams.get("session");
            const cached = session
              ? JSON.parse(await (await import("node:fs/promises")).readFile(new URL(`./.loadrunner-cache/${session}.json`, import.meta.url), "utf8"))
              : null;
            const optionalNumber = (name) => {
              const raw = url.searchParams.get(name);
              return raw === null || raw === "" ? undefined : Number(raw);
            };
            sendJson(res, 200, await queryErrors(cached, {
              start: optionalNumber("start"),
              end: optionalNumber("end"),
              granularity: optionalNumber("granularity"),
              scriptId: optionalNumber("script"),
              errorCode: optionalNumber("code"),
              message: url.searchParams.get("message") || "",
              dbPath: url.searchParams.get("dbPath") || "",
            }));
          } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
        });
        server.middlewares.use("/api/tps-series", async (req, res) => {
          try {
            const url = new URL(req.url ?? "", "http://127.0.0.1");
            const session = url.searchParams.get("session");
            if (!session) throw new Error("Parameter session wajib diisi.");
            const metadataPath = new URL(`./.loadrunner-cache/${session}.json`, import.meta.url);
            const cached = JSON.parse(await (await import("node:fs/promises")).readFile(metadataPath, "utf8"));
            sendJson(res, 200, await queryTpsSeries(cached, Number(url.searchParams.get("start")), Number(url.searchParams.get("end")), Number(url.searchParams.get("granularity")), {
              maxSeries: Number(url.searchParams.get("maxSeries")) || undefined,
              namePrefix: url.searchParams.get("namePrefix") || "",
              extraNames: parseExtraNames(url),
            }));
          } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 8787,
    // Runtime cache, bukan source — watch file .wal yang dikunci DuckDB bikin crash EBUSY di Windows.
    watch: {
      ignored: ["**/.loadrunner-cache/**"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        app: "index.html",
      },
    },
  },
});
