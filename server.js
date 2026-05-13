import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLoadRunnerResult, createConsoleSummary } from "./loadrunner-raw-loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);

function firstExistingPath(paths) {
  return paths.find((filePath) => existsSync(filePath));
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/" || url.pathname === "/dashboard.html") {
      const dashboardPath = firstExistingPath([
        path.join(__dirname, "dist", "index.html"),
        path.join(__dirname, "index.html"),
        path.join(__dirname, "dashboard.html"),
      ]);
      const html = await readFile(dashboardPath, "utf8");
      sendText(res, 200, html, "text/html; charset=utf-8");
      return;
    }

    if (url.pathname === "/vendor/chart.umd.min.js") {
      const chartPath = firstExistingPath([
        path.join(__dirname, "dist", "vendor", "chart.umd.min.js"),
        path.join(__dirname, "public", "vendor", "chart.umd.min.js"),
        path.join(__dirname, "vendor", "chart.umd.min.js"),
      ]);
      const js = await readFile(chartPath, "utf8");
      sendText(res, 200, js, "application/javascript; charset=utf-8");
      return;
    }

    if (url.pathname === "/api/load") {
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
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`LoadRunner dashboard: http://127.0.0.1:${port}`);
});
