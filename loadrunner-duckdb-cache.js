import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createReadStream } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";
import { loadLoadRunnerResult } from "./loadrunner-raw-loader.js";

const CACHE_DIR = path.resolve(process.env.LR_CACHE_DIR || ".loadrunner-cache");

export { CACHE_DIR };
const DUCKDB_MEMORY_LIMIT = process.env.LR_DUCKDB_MEMORY_LIMIT || "1GB";
const DUCKDB_THREADS = Number(process.env.LR_DUCKDB_THREADS) || 0;
const MAX_POINTS_PER_SERIES = 600;
const DEFAULT_MAX_SERIES_PER_GRAPH = 12;
const SITESCOPE_METRIC_PATTERN = /\/CPU\/utilization$|\/(UNIXRES|WINRES)\/Memory Used ?%$/i;

function cacheKey(resultDir) {
  return createHash("sha256").update(path.resolve(resultDir)).digest("hex").slice(0, 24);
}

function dashboardGraph(graph) {
  return ["es_tr_runtime_vusers", "es_tr_tprange_pass", "es_tr_response_time", "Web_Connections_Per_Second"].includes(graph.type)
    || /fail/i.test(graph.type ?? "")
    || graph.type === "SiteScope";
}

async function fingerprint(resultDir) {
  const files = [path.join(resultDir, "RunInfo.ini"), path.join(resultDir, "RawData.map")];
  const sumDataDir = path.join(resultDir, "sum_data");
  if (existsSync(sumDataDir)) {
    for (const name of await readdir(sumDataDir)) files.push(path.join(sumDataDir, name));
  }
  const parts = await Promise.all(files.map(async (file) => {
    try {
      const info = await stat(file);
      return `${file}:${info.size}:${info.mtimeMs}`;
    } catch {
      return `${file}:missing`;
    }
  }));
  return createHash("sha256").update(parts.sort().join("\n")).digest("hex");
}

// DuckDB default-nya memakai sampai 80% RAM mesin. Di server kecil itu menyisakan terlalu
// sedikit memori untuk heap V8, sehingga proses ingest mati dengan "Committing semi space
// failed". Batasnya dibuat eksplisit dan bisa diatur lewat env.
async function openConnection(databasePath) {
  const instance = await DuckDBInstance.fromCache(databasePath);
  const connection = await instance.connect();
  await connection.run(`SET memory_limit='${DUCKDB_MEMORY_LIMIT}'`);
  if (DUCKDB_THREADS) await connection.run(`SET threads=${DUCKDB_THREADS}`);
  await connection.run(`SET temp_directory='${CACHE_DIR.replaceAll("\\", "/")}/tmp'`);
  return connection;
}

async function queryRows(connection, sql, values = {}) {
  const reader = await connection.runAndReadAll(sql, values);
  return reader.getRowObjectsJS();
}

async function appendGraphRows(connection, graph, scenarioStartTime) {
  if (!existsSync(graph.dataFile)) return 0;
  const measurementNameById = new Map(graph.measurements.map((m) => [m.id, m.name]));
  const isSiteScope = graph.type === "SiteScope";
  const appender = await connection.createAppender("rows");
  let rowCount = 0;
  const input = readline.createInterface({ input: createReadStream(graph.dataFile, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of input) {
    const [measurementId, timestamp, value, count, min, max, stddev] = line.trim().split(/\s+/).map(Number);
    if (![measurementId, timestamp, value, count, min, max, stddev].every(Number.isFinite)) continue;
    if (isSiteScope && !SITESCOPE_METRIC_PATTERN.test(measurementNameById.get(measurementId) ?? "")) continue;
    // SiteScope reports negative sentinel codes (e.g. -101) when a monitor fails to collect a
    // value at that timestamp — these are collection errors, not real CPU/Memory percentages.
    if (isSiteScope && value < 0) continue;
    appender.appendVarchar(graph.type ?? "");
    appender.appendInteger(measurementId);
    appender.appendDouble(timestamp - scenarioStartTime);
    appender.appendDouble(value);
    appender.appendDouble(count);
    appender.appendDouble(min);
    appender.appendDouble(max);
    appender.appendDouble(stddev);
    appender.endRow();
    rowCount += 1;
  }
  appender.closeSync();
  return rowCount;
}

function publicResult(result) {
  return {
    resultDir: result.resultDir,
    scenario: result.scenario,
    scriptGroups: result.scriptGroups,
    graphs: result.graphs.filter(dashboardGraph).map((graph) => ({
      index: graph.index,
      type: graph.type,
      measurements: graph.measurements.map(({ id, name, graphIndex, graphType }) => ({ id, name, graphIndex, graphType })),
      rowCount: graph.rowCount,
    })),
  };
}

export function cachePaths(key) {
  return {
    databasePath: path.join(CACHE_DIR, `${key}.duckdb`),
    metadataPath: path.join(CACHE_DIR, `${key}.json`),
  };
}

export async function readCacheMetadata(key) {
  const { databasePath, metadataPath } = cachePaths(key);
  if (!existsSync(databasePath) || !existsSync(metadataPath)) return null;
  try {
    return JSON.parse(await readFile(metadataPath, "utf8"));
  } catch {
    return null;
  }
}

// overrides = { key, fingerprint, label }. Dipakai jalur upload: identitas cache berasal
// dari isi ZIP (sha256), bukan dari path folder, supaya folder ekstraksi boleh dihapus
// setelah ingest dan re-upload ZIP identik langsung memakai ulang .duckdb yang ada.
export async function openLoadRunnerCache(resultDir, overrides = {}) {
  const resolvedResultDir = path.resolve(resultDir);
  const byContent = typeof overrides.key === "string" && overrides.key.length > 0;
  const key = byContent ? overrides.key : cacheKey(resolvedResultDir);
  const label = overrides.label ?? null;
  const { databasePath, metadataPath } = cachePaths(key);
  const currentFingerprint = byContent ? overrides.fingerprint ?? key : await fingerprint(resolvedResultDir);
  await mkdir(CACHE_DIR, { recursive: true });

  if (existsSync(databasePath) && existsSync(metadataPath)) {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    const sameSource = byContent || metadata.result.resultDir === resolvedResultDir;
    if (metadata.fingerprint === currentFingerprint && sameSource) return metadata;
  }

  // Reuse the established metadata parser, but avoid retaining every graph point in JS.
  const parsed = await loadLoadRunnerResult(resolvedResultDir, { includeRows: false, includeStats: false, includeOffline: false });
  const result = { ...publicResult(parsed), label };
  const connection = await openConnection(databasePath);
  try {
    await connection.run("DROP TABLE IF EXISTS rows");
    await connection.run(`CREATE TABLE rows (
      graph_type VARCHAR, measurement_id INTEGER, elapsed_seconds DOUBLE,
      value DOUBLE, sample_count DOUBLE, min_value DOUBLE, max_value DOUBLE, stddev DOUBLE
    )`);
    let rowCount = 0;
    for (const graph of parsed.graphs.filter(dashboardGraph)) {
      rowCount += await appendGraphRows(connection, graph, parsed.scenario.startTime);
    }
    await connection.run("CREATE INDEX rows_lookup ON rows(graph_type, measurement_id, elapsed_seconds)");
    const metadata = { key, fingerprint: currentFingerprint, result, rowCount };
    await writeFile(metadataPath, JSON.stringify(metadata), "utf8");
    return metadata;
  } finally {
    connection.closeSync();
  }
}

export async function queryDashboard(session, requestedStart, requestedEnd, requestedGranularity, options = {}) {
  const { result } = session;
  const duration = Number(result.scenario.durationSeconds) || 0;
  const start = Math.max(0, Number.isFinite(requestedStart) ? requestedStart : 0);
  const end = Math.max(start, Math.min(duration || Number.MAX_SAFE_INTEGER, Number.isFinite(requestedEnd) ? requestedEnd : duration));
  const granularity = Math.max(1, Math.ceil(Math.max(Number(requestedGranularity) || 1, (end - start) / MAX_POINTS_PER_SERIES)));
  const maxSeriesPerGraph = Math.max(1, Number(options.maxSeriesPerGraph) || DEFAULT_MAX_SERIES_PER_GRAPH);
  const focusGraphType = options.focusGraphType ?? "";
  const focusMeasurementId = Number.isFinite(options.focusMeasurementId) ? options.focusMeasurementId : -1;
  const databasePath = path.join(CACHE_DIR, `${session.key}.duckdb`);
  const connection = await openConnection(databasePath);
  try {
    const seriesCounts = await queryRows(connection, `
      SELECT graph_type, count(*) AS total
      FROM (SELECT DISTINCT graph_type, measurement_id FROM rows WHERE elapsed_seconds BETWEEN $start AND $end)
      GROUP BY graph_type`, { start, end });
    const rows = await queryRows(connection, `
      WITH totals AS (
        SELECT graph_type, measurement_id, sum(sample_count) AS total_count, sum(value) AS total_value
        FROM rows
        WHERE elapsed_seconds BETWEEN $start AND $end
        GROUP BY graph_type, measurement_id
      ), ranked AS (
        SELECT *, row_number() OVER (PARTITION BY graph_type ORDER BY total_value DESC, total_count DESC) AS rnk
        FROM totals
      ), selected AS (
        -- SiteScope is already curated to a small set of CPU/Memory hosts at ingestion time
        -- (see SITESCOPE_METRIC_PATTERN), so it doesn't have the cardinality-explosion problem
        -- transaction graphs do — never cap it, always show every host per the applied filter.
        SELECT graph_type, measurement_id FROM ranked
        WHERE graph_type = 'SiteScope'
           OR rnk <= $maxSeriesPerGraph
           OR (graph_type = $focusGraphType AND measurement_id = $focusMeasurementId)
      )
      SELECT r.graph_type, r.measurement_id,
        floor((r.elapsed_seconds - $start) / $granularity) * $granularity + $start AS elapsed_seconds,
        avg(r.value) AS value, sum(r.sample_count) AS sample_count,
        min(r.min_value) AS min_value, max(r.max_value) AS max_value, avg(r.stddev) AS stddev
      FROM rows r
      JOIN selected s ON s.graph_type = r.graph_type AND s.measurement_id = r.measurement_id
      WHERE r.elapsed_seconds BETWEEN $start AND $end
      GROUP BY ALL ORDER BY r.graph_type, r.measurement_id, elapsed_seconds`,
      { start, end, granularity, maxSeriesPerGraph, focusGraphType, focusMeasurementId });
    const seriesCountByType = Object.fromEntries(seriesCounts.map((row) => [row.graph_type, Number(row.total)]));
    return { start, end, granularity, maxSeriesPerGraph, seriesCountByType, rows };
  } finally {
    connection.closeSync();
  }
}

export async function queryTransactions(session, requestedStart, requestedEnd, limit = 0, offset = 0, namePrefix = "") {
  const { result } = session;
  const duration = Number(result.scenario.durationSeconds) || 0;
  const start = Math.max(0, Number.isFinite(requestedStart) ? requestedStart : 0);
  const end = Math.max(start, Math.min(duration || Number.MAX_SAFE_INTEGER, Number.isFinite(requestedEnd) ? requestedEnd : duration));
  const names = new Map(result.graphs.flatMap((graph) => graph.measurements.map((m) => [`${graph.type}:${m.id}`, m.name])));
  const databasePath = path.join(CACHE_DIR, `${session.key}.duckdb`);
  const connection = await openConnection(databasePath);
  try {
    const aggregates = await queryRows(connection, `
      SELECT graph_type, measurement_id, min(value) AS min, avg(value) AS avg,
        quantile_cont(value, 0.9) AS percentile90, quantile_cont(value, 0.95) AS percentile95,
        quantile_cont(value, 0.99) AS percentile99, max(value) AS max, stddev_pop(value) AS std_deviation,
        sum(value) AS total
      FROM rows WHERE elapsed_seconds BETWEEN $start AND $end
      AND (graph_type = 'es_tr_response_time' OR graph_type = 'es_tr_tprange_pass' OR graph_type ILIKE '%fail%')
      GROUP BY graph_type, measurement_id`, { start, end });
    const byName = new Map();
    for (const item of aggregates) {
      const name = names.get(`${item.graph_type}:${item.measurement_id}`) ?? String(item.measurement_id);
      const current = byName.get(name) ?? { name, success: 0, fail: 0, samples: 0, min: 0, avg: 0, percentile90: 0, percentile95: 0, percentile99: 0, max: 0, stdDeviation: 0 };
      if (item.graph_type === "es_tr_response_time") Object.assign(current, { min: item.min, avg: item.avg, percentile90: item.percentile90, percentile95: item.percentile95, percentile99: item.percentile99, max: item.max, stdDeviation: item.std_deviation ?? 0 });
      else if (/fail/i.test(item.graph_type)) current.fail += Number(item.total);
      else current.success += Number(item.total);
      current.samples = current.success + current.fail;
      byName.set(name, current);
    }
    const filtered = namePrefix ? [...byName.values()].filter((tx) => tx.name.toLowerCase().startsWith(namePrefix.toLowerCase())) : [...byName.values()];
    const all = filtered.sort((a, b) => a.name.localeCompare(b.name));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const safeLimit = Number(limit) > 0 ? Number(limit) : all.length;
    return { start, end, total: all.length, rows: all.slice(safeOffset, safeOffset + safeLimit) };
  } finally {
    connection.closeSync();
  }
}

export async function queryTpsSummary(session, requestedStart, requestedEnd, requestedGranularity, limit = 0, offset = 0, namePrefix = "") {
  const { result } = session;
  const duration = Number(result.scenario.durationSeconds) || 0;
  const start = Math.max(0, Number.isFinite(requestedStart) ? requestedStart : 0);
  const end = Math.max(start, Math.min(duration || Number.MAX_SAFE_INTEGER, Number.isFinite(requestedEnd) ? requestedEnd : duration));
  const granularity = Math.max(1, Number(requestedGranularity) || 10);
  const graph = result.graphs.find((g) => g.type === "es_tr_tprange_pass");
  const candidates = (graph?.measurements ?? [])
    // "_exc"-suffixed measurements are LoadRunner's auto-generated exception/error sub-transactions
    // for the SAME business step, not distinct transactions — summing them into TPS double-counts.
    .filter((m) => !/exc/i.test(m.name))
    .filter((m) => !namePrefix || m.name.toLowerCase().startsWith(namePrefix.toLowerCase()));
  const names = new Map(candidates.map((m) => [m.id, m.name]));
  if (!candidates.length) return { start, end, granularity, total: 0, rows: [] };

  const databasePath = path.join(CACHE_DIR, `${session.key}.duckdb`);
  const connection = await openConnection(databasePath);
  try {
    const idListSql = candidates.map((m) => m.id).join(",");
    // Every transaction's Avg/Min TPS must be measured against the SAME shared time base
    // (total_buckets = how many 5s-ish intervals had ANY activity across this whole filtered
    // group), not each transaction's own active-bucket count — otherwise infrequent transactions
    // get an inflated per-transaction average (dividing by only their own sparse activity), and
    // summing the Avg column across hundreds of transactions massively overshoots the real
    // combined throughput. This mirrors how LoadRunner Analysis reports per-transaction TPS.
    const aggregates = await queryRows(connection, `
      WITH bucketed AS (
        SELECT measurement_id,
          floor((elapsed_seconds - $start) / $granularity) AS bucket_index,
          sum(value) AS bucket_total
        FROM rows
        WHERE graph_type = 'es_tr_tprange_pass' AND elapsed_seconds BETWEEN $start AND $end
          AND measurement_id IN (${idListSql})
        GROUP BY measurement_id, bucket_index
      ), total_buckets AS (
        SELECT count(DISTINCT bucket_index) AS n FROM bucketed
      )
      SELECT measurement_id,
        min(bucket_total / $granularity) AS min_tps_active,
        sum(bucket_total) AS total,
        max(bucket_total / $granularity) AS max_tps,
        count(*) AS points,
        (SELECT n FROM total_buckets) AS total_buckets
      FROM bucketed
      GROUP BY measurement_id`, { start, end, granularity });
    const rows = aggregates.map((item) => {
      const totalBuckets = Math.max(1, Number(item.total_buckets));
      const points = Number(item.points);
      return {
        name: names.get(item.measurement_id) ?? String(item.measurement_id),
        minTps: points < totalBuckets ? 0 : item.min_tps_active,
        avgTps: Number(item.total) / (totalBuckets * granularity),
        maxTps: item.max_tps,
        points,
      };
    });
    const all = rows.sort((a, b) => a.name.localeCompare(b.name));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const safeLimit = Number(limit) > 0 ? Number(limit) : all.length;
    return { start, end, granularity, total: all.length, rows: all.slice(safeOffset, safeOffset + safeLimit) };
  } finally {
    connection.closeSync();
  }
}

// Standalone top-N-by-volume response-time series query, scoped by name prefix. Used for the
// "Response Time By API" chart (namePrefix "RPS_") so it doesn't compete with regular transaction
// names for the shared /api/dashboard cap — RPS_ measurements tend to have much smaller individual
// response-time totals and would almost never win that ranking otherwise.
export async function queryResponseTimeSeries(session, requestedStart, requestedEnd, requestedGranularity, options = {}) {
  const { result } = session;
  const duration = Number(result.scenario.durationSeconds) || 0;
  const start = Math.max(0, Number.isFinite(requestedStart) ? requestedStart : 0);
  const end = Math.max(start, Math.min(duration || Number.MAX_SAFE_INTEGER, Number.isFinite(requestedEnd) ? requestedEnd : duration));
  const granularity = Math.max(1, Math.ceil(Math.max(Number(requestedGranularity) || 1, (end - start) / MAX_POINTS_PER_SERIES)));
  const maxSeries = Math.max(1, Number(options.maxSeries) || DEFAULT_MAX_SERIES_PER_GRAPH);
  const namePrefix = options.namePrefix ?? "";
  // Names the caller wants included regardless of volume ranking (e.g. picked via search in the
  // chart's series selector, so it may fall outside the top-maxSeries-by-volume pool).
  const extraNames = new Set(options.extraNames ?? []);
  const graph = result.graphs.find((g) => g.type === "es_tr_response_time");
  const candidates = (graph?.measurements ?? []).filter((m) => !namePrefix || m.name.startsWith(namePrefix));
  const names = new Map(candidates.map((m) => [m.id, m.name]));
  if (!candidates.length) return { start, end, granularity, total: 0, rows: [] };

  const databasePath = path.join(CACHE_DIR, `${session.key}.duckdb`);
  const connection = await openConnection(databasePath);
  try {
    const idListSql = candidates.map((m) => m.id).join(",");
    const ranked = await queryRows(connection, `
      SELECT measurement_id, sum(value) AS total_value
      FROM rows
      WHERE graph_type = 'es_tr_response_time' AND elapsed_seconds BETWEEN $start AND $end
        AND measurement_id IN (${idListSql})
      GROUP BY measurement_id
      ORDER BY total_value DESC
      LIMIT ${maxSeries}`, { start, end });
    const rankedIds = new Set(ranked.map((r) => r.measurement_id));
    const extraIds = candidates.filter((m) => extraNames.has(m.name) && !rankedIds.has(m.id)).map((m) => m.id);
    const selectedIds = [...ranked.map((r) => r.measurement_id), ...extraIds];
    if (!selectedIds.length) return { start, end, granularity, total: candidates.length, rows: [] };

    const selectedIdsSql = selectedIds.join(",");
    const rows = await queryRows(connection, `
      SELECT measurement_id,
        floor((elapsed_seconds - $start) / $granularity) * $granularity + $start AS elapsed_seconds,
        avg(value) AS value
      FROM rows
      WHERE graph_type = 'es_tr_response_time' AND elapsed_seconds BETWEEN $start AND $end
        AND measurement_id IN (${selectedIdsSql})
      GROUP BY measurement_id, elapsed_seconds
      ORDER BY measurement_id, elapsed_seconds`, { start, end, granularity });

    return {
      start, end, granularity, total: candidates.length,
      rows: rows.map((row) => ({
        measurementId: row.measurement_id,
        name: names.get(row.measurement_id) ?? String(row.measurement_id),
        elapsedSeconds: row.elapsed_seconds,
        value: row.value,
      })),
    };
  } finally {
    connection.closeSync();
  }
}

export async function queryTpsSeries(session, requestedStart, requestedEnd, requestedGranularity, options = {}) {
  const { result } = session;
  const duration = Number(result.scenario.durationSeconds) || 0;
  const start = Math.max(0, Number.isFinite(requestedStart) ? requestedStart : 0);
  const end = Math.max(start, Math.min(duration || Number.MAX_SAFE_INTEGER, Number.isFinite(requestedEnd) ? requestedEnd : duration));
  const granularity = Math.max(1, Number(requestedGranularity) || 10);
  const maxSeries = Math.max(1, Number(options.maxSeries) || DEFAULT_MAX_SERIES_PER_GRAPH);
  const namePrefix = options.namePrefix ?? "";
  // Names the caller wants included regardless of volume ranking (e.g. picked via search in the
  // chart's series selector, so it may fall outside the top-maxSeries-by-volume pool).
  const extraNames = new Set(options.extraNames ?? []);
  const graph = result.graphs.find((g) => g.type === "es_tr_tprange_pass");
  const candidates = (graph?.measurements ?? [])
    // "_exc"-suffixed measurements are LoadRunner's auto-generated exception/error sub-transactions
    // for the SAME business step, not distinct transactions — summing them into TPS double-counts.
    .filter((m) => !/exc/i.test(m.name))
    .filter((m) => !namePrefix || m.name.toLowerCase().startsWith(namePrefix.toLowerCase()));
  const names = new Map(candidates.map((m) => [m.id, m.name]));
  if (!candidates.length) return { start, end, granularity, total: 0, rows: [] };

  const databasePath = path.join(CACHE_DIR, `${session.key}.duckdb`);
  const connection = await openConnection(databasePath);
  try {
    const idListSql = candidates.map((m) => m.id).join(",");
    const ranked = await queryRows(connection, `
      SELECT measurement_id, sum(value) AS total_value
      FROM rows
      WHERE graph_type = 'es_tr_tprange_pass' AND elapsed_seconds BETWEEN $start AND $end
        AND measurement_id IN (${idListSql})
      GROUP BY measurement_id
      ORDER BY total_value DESC
      LIMIT ${maxSeries}`, { start, end });
    const rankedIds = new Set(ranked.map((r) => r.measurement_id));
    const extraIds = candidates.filter((m) => extraNames.has(m.name) && !rankedIds.has(m.id)).map((m) => m.id);
    const selectedIds = [...ranked.map((r) => r.measurement_id), ...extraIds];
    if (!selectedIds.length) return { start, end, granularity, total: candidates.length, rows: [] };

    const selectedIdsSql = selectedIds.join(",");
    const rows = await queryRows(connection, `
      SELECT measurement_id,
        floor((elapsed_seconds - $start) / $granularity) * $granularity + $start AS bucket_start,
        sum(value) AS bucket_total
      FROM rows
      WHERE graph_type = 'es_tr_tprange_pass' AND elapsed_seconds BETWEEN $start AND $end
        AND measurement_id IN (${selectedIdsSql})
      GROUP BY measurement_id, bucket_start
      ORDER BY measurement_id, bucket_start`, { start, end, granularity });

    return {
      start, end, granularity, total: candidates.length,
      rows: rows.map((row) => ({
        measurementId: row.measurement_id,
        name: names.get(row.measurement_id) ?? String(row.measurement_id),
        elapsedSeconds: row.bucket_start,
        value: row.bucket_total / granularity,
      })),
    };
  } finally {
    connection.closeSync();
  }
}
