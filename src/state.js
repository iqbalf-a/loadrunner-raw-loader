export const DEFAULT_GRAPH_GRANULARITY_SECONDS = 10;
export const TRANSACTION_SUMMARY_LIMIT = 20;

export const state = {
  data: null,
  transactions: [],
  rpsTransactions: [],
  tpsSummary: [],
  tpsSummaryByGroup: [],
  tpsSummaryPassFailByGroup: [],
  tpsSummaryMode: "transaction",
  chartSelections: {
    responseTime: [],
    responseTimeApi: [],
    siteScopeCpu: [],
    siteScopeMemory: [],
  },
  seriesCountByType: {},
  appliedStart: 0,
  appliedEnd: 0,
  appliedTpsGranularity: DEFAULT_GRAPH_GRANULARITY_SECONDS,
  groupFilter: "",
  sort: {
    tx: { key: "name", dir: "asc" },
    txRps: { key: "name", dir: "asc" },
    tpsSummary: { key: "name", dir: "asc" },
    siteScopeCpu: { key: "host", dir: "asc" },
    siteScopeMemory: { key: "host", dir: "asc" },
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

export function scriptPrefix(name) {
  const segments = String(name ?? "").split("_");
  return segments.find((segment) => /^[A-Za-z]+\d+[A-Za-z]*$/.test(segment)) ?? null;
}

export function resolveGroup(name) {
  const scriptGroups = state.data?.result?.scriptGroups ?? [];
  if (!scriptGroups.length) return null;
  const prefix = scriptPrefix(name);
  if (!prefix) return null;
  return scriptGroups.find((g) => scriptPrefix(g.scriptName) === prefix)?.groupName ?? null;
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
