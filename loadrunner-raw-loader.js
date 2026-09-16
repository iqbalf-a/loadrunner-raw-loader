import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = {
    resultDir: null,
    out: null,
    mode: "summary",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--json") {
      args.mode = "json";
    } else if (arg === "--summary") {
      args.mode = "summary";
    } else if (!args.resultDir) {
      args.resultDir = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.resultDir) {
    throw new Error("Usage: node loadrunner-raw-loader.js <LoadRunner result dir> [--summary|--json] [--out file.json]");
  }

  return args;
}

function parseIni(text) {
  const result = {};
  let section = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;

    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      result[section] ??= {};
      continue;
    }

    const eq = line.indexOf("=");
    if (eq === -1 || !section) continue;

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    result[section][key] = value;
  }

  return result;
}

function readIni(filePath) {
  if (!existsSync(filePath)) return {};
  return parseIni(readFileSync(filePath, "utf8"));
}

async function findFirstFile(resultDir, pattern) {
  const files = await readdir(resultDir);
  const match = files.find((file) => pattern.test(file));
  return match ? path.join(resultDir, match) : null;
}

function epochToIso(epochSeconds) {
  const epoch = Number(epochSeconds);
  if (!Number.isFinite(epoch)) return null;
  return new Date(epoch * 1000).toISOString();
}

function percentile(values, percentileRank) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileRank / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function weightedPercentile(items, percentileRank) {
  const sorted = items
    .filter((item) => Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight > 0)
    .sort((a, b) => a.value - b.value);

  if (!sorted.length) return null;

  const totalWeight = sorted.reduce((total, item) => total + item.weight, 0);
  const target = Math.ceil((percentileRank / 100) * totalWeight);
  let cumulative = 0;

  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= target) return item.value;
  }

  return sorted[sorted.length - 1].value;
}

function parseScriptGroups(scenarioIni) {
  const scripts = scenarioIni.Scripts ?? {};
  return Object.keys(scripts).map((scriptKey) => {
    const scriptName = scriptKey.replace(/_\d+$/, "");
    return { scriptKey, scriptName, groupName: scriptName.toLowerCase() };
  });
}

function resolveTransactionGroup(txName, scriptGroups) {
  if (!scriptGroups.length) return null;
  // Remove underscore-bounded pure-digit segments (e.g. _01_ or _01 at end)
  const stripped = String(txName ?? "").replace(/_\d+(?=_|$)/g, "");
  return scriptGroups.find((g) => g.scriptName === stripped)?.groupName ?? null;
}

function parseMeasurementValue(value) {
  const comma = value.lastIndexOf(",");
  if (comma === -1) return null;

  const name = value.slice(0, comma);
  const idAndExtras = value.slice(comma + 1);
  const [idText, ...extras] = idAndExtras.split("#");
  const id = Number(idText);

  if (!Number.isFinite(id)) return null;

  return {
    id,
    name,
    extras: extras.map(Number).filter((number) => Number.isFinite(number)),
  };
}

function parseRawDataMap(filePath) {
  const ini = readIni(filePath);
  const parsed = {};

  for (const [section, values] of Object.entries(ini)) {
    parsed[section] = Object.fromEntries(
      Object.entries(values).map(([id, quotedName]) => [id, quotedName.replace(/^"|"$/g, "")]),
    );
  }

  return parsed;
}

function parseSummaryIni(filePath) {
  const ini = readIni(filePath);
  const general = ini.General ?? {};
  const graphs = [];
  const measurementsById = new Map();

  for (const [section, values] of Object.entries(ini)) {
    const graphMatch = section.match(/^graph_(\d+)$/);
    if (!graphMatch) continue;

    const graph = {
      index: Number(graphMatch[1]),
      type: values.GraphType ?? null,
      measurements: [],
    };

    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith("Measurement_")) continue;

      const measurement = parseMeasurementValue(value);
      if (!measurement) continue;

      measurement.graphIndex = graph.index;
      measurement.graphType = graph.type;
      graph.measurements.push(measurement);
      measurementsById.set(measurement.id, measurement);
    }

    graphs.push(graph);
  }

  graphs.sort((a, b) => a.index - b.index);

  return {
    general: {
      version: Number(general.Version),
      graphsNumber: Number(general.GraphsNumber),
      scenarioStartTime: Number(general.ScenarioStartTime),
      scenarioStartIsoUtc: general.ScenarioStartTime ? epochToIso(general.ScenarioStartTime) : null,
      scenarioDurationSeconds: Number(general.ScenarioDuration),
    },
    graphs,
    measurementsById,
  };
}

async function parseGraphData(filePath, measurementsById, scenarioStartTime, includeRows, includeMeasurement, compactRows, includeStats, onBytes) {
  const rows = [];
  const statsByMeasurement = new Map();

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  let lineCount = 0;

  for await (const line of rl) {
    // Posisi baca dilapor berkala, bukan tiap baris: file graph terbesar berisi jutaan baris.
    if ((lineCount += 1) % 20_000 === 0) onBytes?.(stream.bytesRead);
    const trimmed = line.trim();
    if (!trimmed) continue;

    const [measurementIdText, timestampText, valueText, countText, minText, maxText, stddevText] = trimmed.split(/\s+/);
    const measurementId = Number(measurementIdText);
    const timestamp = Number(timestampText);
    const value = Number(valueText);
    const count = Number(countText);
    const min = Number(minText);
    const max = Number(maxText);
    const stddev = Number(stddevText);

    if (![measurementId, timestamp, value, count, min, max, stddev].every(Number.isFinite)) continue;

    const measurement = measurementsById.get(measurementId);
    // Jalur ingest memanggil dengan includeRows=false. Objek row hanya dibentuk kalau benar-benar
    // dipakai — kalau tidak, file 150 MB menghasilkan jutaan objek sampah yang menekan heap.
    if (includeRows && includeMeasurement(measurement)) {
      rows.push(compactRows
        ? {
          measurementId,
          elapsedSeconds: Number.isFinite(scenarioStartTime) ? timestamp - scenarioStartTime : null,
          value,
          count,
          min,
          max,
          stddev,
        }
        : {
          measurementId,
          measurementName: measurement?.name ?? null,
          graphIndex: measurement?.graphIndex ?? null,
          graphType: measurement?.graphType ?? null,
          timestamp,
          isoUtc: epochToIso(timestamp),
          elapsedSeconds: Number.isFinite(scenarioStartTime) ? timestamp - scenarioStartTime : null,
          value,
          count,
          min,
          max,
          stddev,
        });
    }

    if (!includeStats) continue;
    const current = statsByMeasurement.get(measurementId) ?? {
      measurementId,
        measurementName: measurement?.name ?? null,
        graphIndex: measurement?.graphIndex ?? null,
        graphType: measurement?.graphType ?? null,
      samples: 0,
      valueCount: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
      sum: 0,
      weightedSum: 0,
      values: [],
      weightedValues: [],
    };

    current.samples += 1;
    current.valueCount += count;
    current.min = Math.min(current.min, Number.isFinite(min) ? min : value);
    current.max = Math.max(current.max, Number.isFinite(max) ? max : value);
    current.sum += value;
    current.weightedSum += value * count;
    current.values.push(value);
    current.weightedValues.push({ value, weight: count });
    statsByMeasurement.set(measurementId, current);
  }

  onBytes?.(stream.bytesRead);

  const stats = [...statsByMeasurement.values()].map((item) => {
    const { values, weightedValues, ...summary } = item;
    return {
      ...summary,
      avg: item.valueCount ? item.weightedSum / item.valueCount : item.samples ? item.sum / item.samples : null,
      percentile90: item.valueCount ? weightedPercentile(weightedValues, 90) : percentile(values, 90),
    };
  });

  return { rows, stats };
}

function fileSizeOrZero(filePath) {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

async function parseAllGraphData(sumDataDir, graphs, measurementsById, scenarioStartTime, includeRows, includeMeasurement, compactRows, includeStats, onProgress) {
  const parsedGraphs = [];
  // Progres dihitung dari byte, bukan jumlah file: satu graph response time bisa jauh lebih besar
  // daripada semua graph lain digabung.
  const filePaths = graphs.map((graph) => path.join(sumDataDir, `graph_${graph.index}.dat`));
  const sizes = onProgress ? filePaths.map(fileSizeOrZero) : [];
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0) || 1;
  let doneBytes = 0;

  for (const [index, graph] of graphs.entries()) {
    const filePath = filePaths[index];
    if (!existsSync(filePath)) {
      parsedGraphs.push({ ...graph, dataFile: filePath, rows: [], stats: [] });
      continue;
    }

    const parsed = await parseGraphData(filePath, measurementsById, scenarioStartTime, includeRows, includeMeasurement, compactRows, includeStats,
      onProgress && ((bytes) => onProgress((doneBytes + bytes) / totalBytes)));
    doneBytes += sizes[index] ?? 0;
    onProgress?.(doneBytes / totalBytes);
    parsedGraphs.push({
      ...graph,
      dataFile: filePath,
      rowCount: parsed.rows.length,
      stats: parsed.stats,
      rows: includeRows ? parsed.rows : undefined,
    });
  }

  return parsedGraphs;
}

function parseOfflineDefinition(text) {
  const ini = parseIni(text);
  const definition = ini["Graph definition"] ?? {};

  return {
    graphTitle: definition.GraphTitle ?? null,
    dataPointLabel: definition.DataPointLabel_1 ?? null,
    lineTitle: definition.LineTitle_1 ?? null,
    yAxisTitle: definition.YAxisTitle ?? null,
    graphType: definition.GraphType ?? null,
    description: definition.DataPointDescr_1 ?? null,
  };
}

async function parseOfflineDefinitions(resultDir) {
  const files = (await readdir(resultDir)).filter((name) => /^offl_\d+\.def$/i.test(name));
  const definitions = {};

  for (const file of files) {
    const definition = parseOfflineDefinition(readFileSync(path.join(resultDir, file), "utf8"));
    if (definition.dataPointLabel) definitions[definition.dataPointLabel] = { file, ...definition };
  }

  return definitions;
}

async function parseOfflineData(filePath, definitions, includeRows, includeStats = true) {
  if (!existsSync(filePath)) return { rowCount: 0, stats: [], rows: includeRows ? [] : undefined };

  const rows = [];
  const statsByLabel = new Map();
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const match = line.trim().match(/^(\S+)\s+(\d+)\s+([-+]?\d+(?:\.\d+)?)$/);
    if (!match) continue;

    const [, label, timestampText, valueText] = match;
    const timestamp = Number(timestampText);
    const value = Number(valueText);
    const definition = definitions[label];
    const name = definition?.graphTitle ?? null;

    if (includeRows) {
      rows.push({ label, name, timestamp, isoUtc: epochToIso(timestamp), value });
    }

    // Statistik offline menahan setiap nilai di memori untuk perhitungan persentil. Jalur ingest
    // tidak memerlukannya (data SiteScope diambil dari sum_data), jadi bisa dilewati.
    if (!includeStats) continue;

    const current = statsByLabel.get(label) ?? {
      label,
      name,
      samples: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
      sum: 0,
      values: [],
    };

    current.samples += 1;
    current.min = Math.min(current.min, value);
    current.max = Math.max(current.max, value);
    current.sum += value;
    current.values.push(value);
    statsByLabel.set(label, current);
  }

  const stats = [...statsByLabel.values()].map((item) => {
    const { values, ...summary } = item;
    return {
      ...summary,
      avg: item.samples ? item.sum / item.samples : null,
      percentile90: percentile(values, 90),
    };
  });

  return {
    rowCount: includeRows ? rows.length : stats.reduce((total, item) => total + item.samples, 0),
    stats,
    rows: includeRows ? rows : undefined,
  };
}

async function loadLoadRunnerResult(resultDir, options = {}) {
  const resolvedResultDir = path.resolve(resultDir);
  const sumDataDir = path.join(resolvedResultDir, "sum_data");
  const scenarioFile = await findFirstFile(resolvedResultDir, /\.lrr$/i);
  const scenarioIni = scenarioFile ? readIni(scenarioFile) : {};
  const runInfo = readIni(path.join(resolvedResultDir, "RunInfo.ini"));
  const rawDataMap = parseRawDataMap(path.join(resolvedResultDir, "RawData.map"));
  const summary = parseSummaryIni(path.join(sumDataDir, "sum_dat.ini"));
  const offlineDefinitions = await parseOfflineDefinitions(resolvedResultDir);
  const includeRows = options.includeRows === true;
  const includeOfflineRows = options.includeOfflineRows ?? includeRows;
  const includeMeasurement = options.includeMeasurement ?? (() => true);
  const compactRows = options.compactRows === true;
  const includeStats = options.includeStats ?? true;

  const graphs = await parseAllGraphData(
    sumDataDir,
    summary.graphs,
    summary.measurementsById,
    summary.general.scenarioStartTime,
    includeRows,
    includeMeasurement,
    compactRows,
    includeStats,
    options.onGraphProgress,
  );

  // offline.dat bisa ratusan MB dan hanya dipakai ringkasan CLI; ingest dashboard mengambil
  // data SiteScope dari sum_data, jadi bisa dilewati sepenuhnya.
  const offline = options.includeOffline === false
    ? { rowCount: 0, stats: [], rows: includeOfflineRows ? [] : undefined }
    : await parseOfflineData(
      path.join(resolvedResultDir, "offline.dat"),
      offlineDefinitions,
      includeOfflineRows,
      includeStats,
    );

  const scriptGroups = parseScriptGroups(scenarioIni);

  return {
    resultDir: resolvedResultDir,
    scriptGroups,
    scenario: {
      product: scenarioIni.Scenario?.Product ?? null,
      version: scenarioIni.Scenario?.Version ?? null,
      resultName: scenarioIni.Scenario?.ResultName ?? null,
      startTime: Number(scenarioIni.Scenario?.Start_time ?? summary.general.scenarioStartTime),
      startIsoUtc: epochToIso(scenarioIni.Scenario?.Start_time ?? summary.general.scenarioStartTime),
      stopTime: Number(scenarioIni.Scenario?.Stop_time),
      stopIsoUtc: scenarioIni.Scenario?.Stop_time ? epochToIso(scenarioIni.Scenario.Stop_time) : null,
      timezoneSeconds: Number(scenarioIni.Scenario?.Time_Zone),
      durationSeconds: summary.general.scenarioDurationSeconds,
      runDate: runInfo.Report?.RunDate ?? null,
      sessionName: runInfo.Report?.SessionName ?? null,
      companyName: runInfo.Report?.CompanyName ?? null,
      schedule: scenarioIni.Scenario_summary?.["Scenario Duration"] ?? null,
    },
    rawDataMap,
    graphs,
    offline: {
      definitions: offlineDefinitions,
      ...offline,
    },
  };
}

function normalizeTransactionName(name) {
  return String(name ?? "").trim().toLowerCase();
}

function buildTransactionOutcomes(graphs) {
  const successGraph = graphs.find((graph) => graph.type === "es_tr_tprange_pass");
  const failGraph = graphs.find((graph) => /fail/i.test(graph.type ?? ""));
  const outcomes = new Map();

  for (const item of successGraph?.stats ?? []) {
    outcomes.set(normalizeTransactionName(item.measurementName), {
      success: item.samples,
      fail: 0,
    });
  }

  for (const item of failGraph?.stats ?? []) {
    const key = normalizeTransactionName(item.measurementName);
    const current = outcomes.get(key) ?? { success: 0, fail: 0 };
    current.fail = item.samples;
    outcomes.set(key, current);
  }

  return outcomes;
}

function addTransactionOutcomes(transactions, outcomes) {
  return transactions.map((transaction) => {
    const outcome = outcomes.get(normalizeTransactionName(transaction.measurementName)) ?? { success: 0, fail: 0 };
    const responseTimeSamples = transaction.samples;
    return {
      ...transaction,
      responseTimeSamples,
      success: outcome.success,
      fail: outcome.fail,
      samples: outcome.success + outcome.fail,
    };
  });
}
function createConsoleSummary(result) {
  const transactionGraph = result.graphs.find((graph) => graph.type === "es_tr_response_time");
  const runningUsersGraph = result.graphs.find((graph) => graph.type === "es_tr_runtime_vusers");
  const totalRows = result.graphs.reduce((total, graph) => total + graph.rowCount, 0);
  const transactionOutcomes = buildTransactionOutcomes(result.graphs);

  return {
    scenario: result.scenario,
    scriptGroups: result.scriptGroups,
    graphCount: result.graphs.length,
    graphTypes: result.graphs.map((graph) => ({
      index: graph.index,
      type: graph.type,
      measurementCount: graph.measurements.length,
      rowCount: graph.rowCount,
    })),
    totalGraphRows: totalRows,
    runningUsers: runningUsersGraph?.stats ?? [],
    transactionsResponseTime: addTransactionOutcomes(transactionGraph?.stats ?? [], transactionOutcomes),
    offlineSiteScope: {
      definitionCount: Object.keys(result.offline.definitions).length,
      rowCount: result.offline.rowCount,
      firstTenStats: result.offline.stats.slice(0, 10),
    },
    rawDataEventMap: result.rawDataMap,
  };
}

export { loadLoadRunnerResult, createConsoleSummary };

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const args = parseArgs(process.argv.slice(2));
  const result = await loadLoadRunnerResult(args.resultDir, { includeRows: args.mode === "json" });
  const output = args.mode === "json" ? result : createConsoleSummary(result);
  const json = JSON.stringify(output, null, 2);

  if (args.out) {
    writeFileSync(path.resolve(args.out), `${json}\n`, "utf8");
    console.log(`Wrote ${args.mode} to ${path.resolve(args.out)}`);
  } else {
    console.log(json);
  }
}






