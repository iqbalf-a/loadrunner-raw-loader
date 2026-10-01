import { resolveGroupName } from "../group-utils.js";

export const DEFAULT_GRAPH_GRANULARITY_SECONDS = 4;
export const TRANSACTION_SUMMARY_LIMIT = 20;
// Filter Include/Exclude panel TPS, RPS, TPS Overall, dan RPS Overall. Pola dipisah koma, % sebagai
// wildcard, tanpa % berarti awalan. Default exclude mengikuti konvensi script tim: transaksi yang
// tidak dihitung diberi postfix _exc (pada nama RPS_ postfix itu diikuti akhiran _<BP>_<script>_<n>).
const DEFAULT_EXCLUDE = "%_exc, %_exc_%";
// Transactions Summary sejak awal menampilkan transaksi _exc juga (response time-nya tetap
// berguna), jadi default exclude-nya kosong supaya angkanya tidak berubah.
export const DEFAULT_TPS_FILTERS = {
  tx: { include: "BP%", exclude: "" },
  txRps: { include: "RPS_%", exclude: "" },
  // Grafik response time memilih 10 seri dengan total response time terbesar; tanpa exclude _exc
  // yang terpilih hampir semuanya transaksi _exc, jadi default-nya dibuang.
  rt: { include: "BP%", exclude: DEFAULT_EXCLUDE },
  rtApi: { include: "RPS_%", exclude: DEFAULT_EXCLUDE },
  tpsDetail: { include: "BP%", exclude: DEFAULT_EXCLUDE },
  tps: { include: "BP%", exclude: DEFAULT_EXCLUDE },
  rps: { include: "RPS_%", exclude: DEFAULT_EXCLUDE },
  tpsOverall: { include: "BP%", exclude: DEFAULT_EXCLUDE },
  rpsOverall: { include: "RPS_BP%", exclude: DEFAULT_EXCLUDE },
};

// Aturan granularity default LoadRunner Analysis: pangkat 2 terkecil (dalam detik) yang membuat
// grafik muat dalam TARGET_GRAPH_POINTS titik. Dicocokkan terhadap LRA pada run 8148 detik, yang
// di sana default-nya 256s -- persis 8148/256 = 31.8 titik, sementara 128s sudah 63.7 titik.
// Memakai lebar bucket yang sama dengan LRA membuat angka TPS di dashboard ini apple to apple
// dengan LRA. Bucket lebar juga menjauhkan Max TPS dari lantai kuantisasi 1/granularity, yang
// muncul saat bucket terpadat sebuah transaksi cuma berisi satu transaksi.
export const GRANULARITY_STEPS_SECONDS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
export const TARGET_GRAPH_POINTS = 32;

// Run panjang dipatok, tidak ikut tangga pangkat dua: 1 jam ke atas 256s, 2 jam ke atas 512s.
// Aturan LRA di atas tetap dipakai untuk run di bawah 1 jam.
const HOUR_SECONDS = 3600;
export const LONG_RUN_GRANULARITY = [
  { minDurationSeconds: 2 * HOUR_SECONDS, granularity: 512 },
  { minDurationSeconds: HOUR_SECONDS, granularity: 256 },
];

export function autoGranularitySeconds(durationSeconds) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return DEFAULT_GRAPH_GRANULARITY_SECONDS;
  const longRun = LONG_RUN_GRANULARITY.find((rule) => duration >= rule.minDurationSeconds);
  if (longRun) return longRun.granularity;
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
  responseTimeNames: [],
  // Statistik seri yang sedang tampil di grafik response time, untuk tabel di bawah grafiknya.
  rtTableRows: { responseTime: [], responseTimeApi: [] },
  responseTimeApiNames: [],
  tpsOverall: { minTps: 0, avgTps: 0, maxTps: 0, points: 0 },
  tpsOverallSeriesRows: [],
  rpsOverall: { transactions: 0, minTps: 0, avgTps: 0, maxTps: 0, points: 0 },
  rpsOverallSeriesRows: [],
  tpsFilters: structuredClone(DEFAULT_TPS_FILTERS),
  // null = user belum pernah memilih, jadi default 10 seri teratas yang berlaku. [] = "Deselect All"
  // yang disengaja dan tidak boleh ditimpa default. Lihat resolveSelection().
  chartSelections: {
    responseTime: null,
    responseTimeApi: null,
    tpsTransaction: null,
    tpsApi: null,
    tpsDetail: null,
    siteScopeCpu: null,
    siteScopeMemory: null,
    lgCpu: null,
    lgMemory: null,
    lgDisk: null,
  },
  seriesCountByType: {},
  // Total kandidat seri per panel, dibaca dari respons server. Disimpan di state, bukan ditulis
  // langsung ke DOM, karena halaman yang bisa menampilkannya berubah-ubah sesuai rute aktif.
  seriesTotals: { responseTime: 0, responseTimeApi: 0, tpsTransaction: 0, tpsApi: 0, tpsDetail: 0 },
  appliedStart: 0,
  appliedEnd: 0,
  appliedTpsGranularity: DEFAULT_GRAPH_GRANULARITY_SECONDS,
  groupFilter: "",
  siteScopeCpuRows: [],
  siteScopeMemoryRows: [],
  lgHealthRows: [],
  lgMetricRows: { cpu: [], memory: [], disk: [] },
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
    // Key kosong = urutan seri di grafik (terbesar dulu) sampai user mengklik header kolom.
    rtTable: { key: "", dir: "asc" },
    rtApiTable: { key: "", dir: "asc" },
    siteScopeCpu: { key: "host", dir: "asc" },
    siteScopeMemory: { key: "host", dir: "asc" },
    lgHealth: { key: "host", dir: "asc" },
    // Tabel per metrik LG: default terbesar dulu, jadi host yang jadi bottleneck langsung kelihatan.
    lgCpu: { key: "max", dir: "desc" },
    lgMemory: { key: "max", dir: "desc" },
    lgDisk: { key: "max", dir: "desc" },
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

// Seri yang sedang digambar sebuah panel. Default-nya `limit` seri teratas, tapi hanya selama user
// belum pernah memilih sendiri: null = belum ada pilihan, [] = "Deselect All" yang disengaja.
// Tanpa pembedaan itu, grafik akan memaksa 10 seri teratas lagi begitu semua centang dilepas.
export function resolveSelection(key, names, limit) {
  let selected = state.chartSelections[key];
  if (selected == null) {
    selected = names.slice(0, limit);
    state.chartSelections[key] = selected;
  }
  return selected.filter((name) => names.includes(name));
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
