import { defineConfig } from "vite";
import { loadLoadRunnerResult, createConsoleSummary } from "./loadrunner-raw-loader.js";

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

            const result = await loadLoadRunnerResult(resultPath, { includeRows: true });
            sendJson(res, 200, {
              summary: createConsoleSummary(result),
              result,
            });
          } catch (error) {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: {
        app: "index.html",
      },
    },
  },
});
