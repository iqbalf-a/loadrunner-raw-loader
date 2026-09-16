import { resolveGroupName } from "../group-utils.js";

export const DEFAULT_GRAPH_GRANULARITY_SECONDS = 4;
export const TRANSACTION_SUMMARY_LIMIT = 20;

// Aturan granularity default LoadRunner Analysis: pangkat 2 terkecil (dalam detik) yang membuat
// grafik muat dalam TARGET_GRAPH_POINTS titik. Dicocokkan terhadap LRA pada run 8148 detik, yang
// di sana default-nya 256s -- persis 8148/256 = 31.8 titik, sementara 128s sudah 63.7 titik.
// Memakai lebar bucket yang sama dengan LRA membuat angka TPS di dashboard ini apple to apple
// dengan LRA. Bucket lebar juga menjauhkan Max TPS dari lantai kuantisasi 1/granularity, yang
// muncul saat bucket terpadat sebuah transaksi cuma berisi satu transaksi.
export const GRANULARITY_STEPS_SECONDS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
export const TARGET_GRAPH_POINTS = 32;

export function autoGranularitySeconds(durationSeconds) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return DEFAULT_GRAPH_GRANULARITY_SECONDS;
  return GRANULARITY_STEPS_SECONDS.find((step) => duration / step <= TARGET_GRAPH_POINTS)
    ?? GRANULARITY_STEPS_SECONDS[GRANULARITY_STEPS_SECONDS.length - 1];
}

export const state = {
  data: null,
  transactions: [],
  rpsTransactions: [],
  tpsSummary: [],
  tpsSummaryApi: [],
  tpsDetail: [],
  tpsDetailSeriesRows: [],
  tpsOverall: { minTps: 0, avgTps: 0, maxTps: 0, points: 0 },
  tpsOverallSeriesRows: [],
  chartSelections: {
    responseTime: [],
    responseTimeApi: [],
    tpsTransaction: [],
    tpsApi: [],
    tpsDetail: [],
    siteScopeCpu: [],
    siteScopeMemory: [],
    lgCpu: [],
    lgMemory: [],
    lgDisk: [],
  },
  seriesCountByType: {},
  appliedStart: 0,
  appliedEnd: 0,
  appliedTpsGranularity: DEFAULT_GRAPH_GRANULARITY_SECONDS,
  groupFilter: "",
  siteScopeCpuRows: [],
  siteScopeMemoryRows: [],
  errors: null,
  errorDbPath: "",
  errorFilter: { scriptId: "", code: "", message: "", start: null, end: null },
  sort: {
    errors: { key: "count", dir: "desc" },
    tx: { key: "name", dir: "asc" },
    txRps: { key: "name", dir: "asc" },
    tpsSummary: { key: "name", dir: "asc" },
    tpsSummaryApi: { key: "name", dir: "asc" },
    tpsDetail: { key: "name", dir: "asc" },
    siteScopeCpu: { key: "host", dir: "asc" },
    siteScopeMemory: { key: "host", dir: "asc" },
    lgHealth: { key: "host", dir: "asc" },
  },
};

export function sortRows(rows, sort) {
  if (!sort?.key) return rows;
  const sign = sort.dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    if (typeof av === "string" || typeof bv === "string") {
      return sign * String(av ?? "").localeCompare(String(bv ?? ""));
    }
    return sign * ((av ?? 0) - (bv ?? 0));
  });
}

const measurementNameCaches = new WeakMap();

export { scriptPrefix } from "../group-utils.js";

export function resolveGroup(name) {
  return resolveGroupName(name, state.data?.result?.scriptGroups ?? []);
}

export function groupLikeToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escaped.replace(/%/g, ".*") + "$", "i");
}

export function graphByType(type) {
  return state.data?.result?.graphs?.find((graph) => graph.type === type);
}

export function inRange(row, start, end) {
  return row.elapsedSeconds >= start && row.elapsedSeconds <= end;
}

export function measurementName(graph, row) {
  if (row.measurementName) return row.measurementName;
  let names = measurementNameCaches.get(graph);
  if (!names) {
    names = new Map(graph?.measurements?.map((measurement) => [measurement.id, measurement.name]));
    measurementNameCaches.set(graph, names);
  }
  return names.get(row.measurementId) ?? null;
}

export function rowsByMeasurement(graph, start, end) {
  const grouped = new Map();
  for (const row of graph?.rows ?? []) {
    if (!inRange(row, start, end)) continue;
    const name = measurementName(graph, row);
    const current = grouped.get(name) ?? [];
    current.push(row);
    grouped.set(name, current);
  }
  return grouped;
}

export function buildTransactions() {
  return state.transactions;
}
