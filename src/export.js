import { formatHms, formatClockAt } from "./format.js";
import { state, sortRows } from "./state.js";
import { filterByGroup, overviewMetrics } from "./tables.js";
import { buildXlsx } from "./xlsx.js";

// Satu sheet per panel tabel, nama sheet = judul panel tanpa akhiran "(Table)"/"(Chart + Table)"
// supaya muat di batas 31 karakter Excel. Isinya semua baris seperti di modal Show All: filter
// group dan urutan kolom yang sedang aktif ikut terbawa, tidak dipotong ke 20 baris.
const col = (header, key, format = "text") => ({ header, key, format });

function granularityTag() {
  return `@${state.appliedTpsGranularity}s`;
}

const TX_COLUMNS = [
  col("Transaction", "name"), col("Group", (tx) => tx.groupName ?? "-"),
  col("Min (s)", "min", "dec3"), col("Avg (s)", "avg", "dec3"), col("Max (s)", "max", "dec3"),
  col("Std Deviation (s)", "stdDeviation", "dec3"),
  col("P90 (s)", "percentile90", "dec3"), col("P95 (s)", "percentile95", "dec3"), col("P99 (s)", "percentile99", "dec3"),
  col("Success", "success", "int"), col("Fail", "fail", "int"), col("Total", "samples", "int"),
];

// Kolom tabel RPS Overall: angkanya dari rumus yang sama dengan TPS Overall, hanya labelnya RPS.
function rpsOverallColumns() {
  return [
    col(`Min RPS ${granularityTag()}`, "minTps", "dec3"),
    col("Avg RPS", "avgTps", "dec3"),
    col(`Max RPS ${granularityTag()}`, "maxTps", "dec3"),
    col("Points", "points", "int"),
  ];
}

function tpsColumns(nameHeader, withGroup) {
  return [
    col(nameHeader, "name"),
    ...(withGroup ? [col("Group", (tx) => tx.groupName ?? "-")] : []),
    col(`Min TPS ${granularityTag()}`, "minTps", "dec3"),
    col("Avg TPS", "avgTps", "dec3"),
    col(`Max TPS ${granularityTag()}`, "maxTps", "dec3"),
    col("Points", "points", "int"),
  ];
}

const SITESCOPE_COLUMNS = [
  col("Host", "host"), col("Min (%)", "min", "dec3"), col("Avg (%)", "avg", "dec3"), col("Max (%)", "max", "dec3"),
];

const LG_COLUMNS = [
  col("Load Generator", "host"), col("Status", "status"),
  col("CPU Avg (%)", "cpuAvg", "dec2"), col("CPU Max (%)", "cpuMax", "dec2"),
  col("Memory Avg (%)", "memoryAvg", "dec2"), col("Memory Max (%)", "memoryMax", "dec2"),
  col("Disk Avg (%)", "diskAvg", "dec2"), col("Disk Max (%)", "diskMax", "dec2"),
];

// Di tabel, Iteration dan Time cuma menampilkan kemunculan pertama dan sisanya di tooltip. Di
// Excel tidak ada tooltip, jadi rentangnya dijadikan kolom sendiri.
const ERROR_COLUMNS = [
  col("Script", "scriptName"), col("Code", "errorCode", "int"),
  col("API Code", "apiCode", "int"), col("API", "apiPath"), col("API URL", "apiUrl"),
  col("Message", (row) => String(row.message ?? "").trim()),
  col("Count", "count", "int"), col("VUsers", "vusers", "int"),
  col("First Iteration", "firstIteration", "int"), col("Last Iteration", "lastIteration", "int"),
  col("Iterations", "iterations", "int"),
  col("Injector", (row) => (row.injectors ?? "").replaceAll(",", ", ")),
  col("First Time", "firstTime"), col("Last Time", "lastTime"),
];

const TPS_FILTER_LABELS = {
  tx: "Transactions Summary (BP)", txRps: "Transactions Summary (RPS_)",
  rt: "Response Time By Transaction", rtApi: "Response Time By API", tps: "TPS", rps: "RPS",
  tpsDetail: "TPS Detail", tpsOverall: "TPS Overall", rpsOverall: "RPS Overall",
};

function tpsFilterText(key) {
  const filter = state.tpsFilters[key];
  if (!filter) return "";
  return `Include: ${filter.include || "(semua)"}; Exclude: ${filter.exclude || "(tidak ada)"}`;
}

function rangeText(from, to, format) {
  return `${format(from)} - ${format(to)}`;
}

function errorFilterText() {
  const filter = state.errorFilter;
  const script = state.errors?.scripts?.find((s) => String(s.id) === filter.scriptId)?.name ?? filter.scriptId;
  const parts = [
    script && `Script: ${script}`,
    filter.code && `Code: ${filter.code}`,
    filter.message && `Message: ${filter.message}`,
    (filter.start !== null || filter.end !== null) && `Time: ${filter.start !== null ? formatHms(filter.start) : "awal"} - ${filter.end !== null ? formatHms(filter.end) : "akhir"}`,
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : "(tidak ada)";
}

// Sheet pertama: isi panel Overview plus filter yang aktif saat export, supaya file yang dibuka
// belakangan masih bisa ditelusuri dibuat dari rentang dan granularity berapa.
function overviewSheet() {
  const { scenario, resultDir } = state.data.result;
  const duration = scenario.durationSeconds || 0;
  const start = state.appliedStart;
  const end = state.appliedEnd || duration;
  const metrics = overviewMetrics(state.transactions, start, end);
  const int = (value) => ({ value, format: "int" });
  const dec = (value) => ({ value, format: "dec3" });
  const rows = [
    ["Project", scenario.companyName || "-"],
    ["Scenario", scenario.sessionName || "-"],
    ["Run Date", scenario.runDate || "-"],
    ["Result Folder", resultDir || "-"],
    ["All Range (elapsed)", rangeText(0, duration, formatHms)],
    ["All Range (clock)", rangeText(0, duration, formatClockAt)],
    ["Filtered Range (elapsed)", rangeText(start, end, formatHms)],
    ["Filtered Range (clock)", rangeText(start, end, formatClockAt)],
    ["Granularity (s)", int(state.appliedTpsGranularity)],
    ["Filter Group Name", state.groupFilter || "(tidak ada)"],
    ...Object.entries(TPS_FILTER_LABELS).map(([key, label]) => [`${label} Filter`, tpsFilterText(key)]),
    ["Transactions (BP)", int(state.transactions.length)],
    ["Success", int(metrics.success)],
    ["Fail", int(metrics.fail)],
    ["Fail (%)", dec(metrics.total ? (metrics.fail / metrics.total) * 100 : 0)],
    ["Total", int(metrics.total)],
    ["Avg RT (ms)", dec(metrics.avg * 1000)],
    ["Peak VUsers", int(metrics.peakVusers)],
    ...(state.errors?.available ? [["Error Filter", errorFilterText()]] : []),
    ["Exported At", new Date().toLocaleString("id-ID")],
  ];
  return { name: "Overview", columns: [col("Item", 0), col("Value", 1)], rows };
}

function sheet(name, columns, rows) {
  return {
    name,
    columns,
    rows: rows.map((row) => columns.map(({ key }) => (typeof key === "function" ? key(row) : row[key]) ?? null)),
  };
}

function tableSheet(name, columns, rows, tableKey, mode) {
  return sheet(name, columns, sortRows(filterByGroup(rows ?? [], mode), state.sort[tableKey]));
}

export function collectTableSheets() {
  const sheets = [];
  if (state.data) {
    sheets.push(
      overviewSheet(),
      tableSheet("Transactions Summary (BP)", TX_COLUMNS, state.transactions, "tx", "transaction"),
      tableSheet("Transactions Summary (RPS_)", TX_COLUMNS, state.rpsTransactions, "txRps", "transaction"),
      tableSheet("TPS", tpsColumns("Transaction", true), state.tpsSummary, "tpsSummary", "transaction"),
      tableSheet("RPS", tpsColumns("API", true), state.tpsSummaryApi, "tpsSummaryApi", "api"),
      tableSheet("TPS Detail", tpsColumns("BP Group", false), state.tpsDetail, "tpsDetail", "detail"),
      sheet("TPS Overall", tpsColumns("", false).slice(1), [state.tpsOverall]),
      sheet("RPS Overall", rpsOverallColumns(), [state.rpsOverall]),
      tableSheet("SiteScope CPU Overall", SITESCOPE_COLUMNS, state.siteScopeCpuRows, "siteScopeCpu", "sitescope"),
      tableSheet("SiteScope Memory Overall", SITESCOPE_COLUMNS, state.siteScopeMemoryRows, "siteScopeMemory", "sitescope"),
      sheet("Load Generator Summary", LG_COLUMNS, sortRows(state.lgHealthRows ?? [], state.sort.lgHealth)),
    );
  }
  // Errors bisa dimuat dari SqliteDb.db tanpa result, jadi sheet-nya berdiri sendiri.
  if (state.errors?.available) {
    sheets.push(sheet("Errors", ERROR_COLUMNS, sortRows(state.errors.rows ?? [], state.sort.errors)));
  }
  return sheets;
}

// Tabel yang ikut di gambar PNG sebuah grafik: hanya baris yang seri-nya dicentang di grafik itu.
// names[i] adalah nama seri baris ke-i, dipakai untuk mencocokkan warna garis di gambar.
const CHART_TABLES = {
  responseTime: () => ({ columns: TX_COLUMNS, rows: state.rtTableRows.responseTime, nameKey: "name", sortKey: "rtTable" }),
  responseTimeApi: () => ({ columns: TX_COLUMNS, rows: state.rtTableRows.responseTimeApi, nameKey: "name", sortKey: "rtApiTable" }),
  tpsTransaction: () => ({ columns: tpsColumns("Transaction", true), rows: state.tpsSummary, nameKey: "name", sortKey: "tpsSummary" }),
  tpsApi: () => ({ columns: tpsColumns("API", true), rows: state.tpsSummaryApi, nameKey: "name", sortKey: "tpsSummaryApi" }),
  tpsDetail: () => ({ columns: tpsColumns("BP Group", false), rows: state.tpsDetail, nameKey: "name", sortKey: "tpsDetail" }),
  tpsOverall: () => ({ columns: tpsColumns("", false).slice(1), rows: [state.tpsOverall] }),
  rpsOverall: () => ({ columns: rpsOverallColumns(), rows: [state.rpsOverall] }),
  siteScopeCpu: () => ({ columns: SITESCOPE_COLUMNS, rows: state.siteScopeCpuRows, nameKey: "host", sortKey: "siteScopeCpu" }),
  siteScopeMemory: () => ({ columns: SITESCOPE_COLUMNS, rows: state.siteScopeMemoryRows, nameKey: "host", sortKey: "siteScopeMemory" }),
  lgCpu: () => ({ columns: LG_COLUMNS, rows: state.lgHealthRows, nameKey: "host", sortKey: "lgHealth" }),
  lgMemory: () => ({ columns: LG_COLUMNS, rows: state.lgHealthRows, nameKey: "host", sortKey: "lgHealth" }),
  lgDisk: () => ({ columns: LG_COLUMNS, rows: state.lgHealthRows, nameKey: "host", sortKey: "lgHealth" }),
};

export function chartPanelTable(key) {
  const spec = CHART_TABLES[key]?.();
  if (!spec) return null;
  let rows = spec.rows ?? [];
  if (spec.nameKey) {
    const selected = new Set(state.chartSelections[key] ?? []);
    rows = sortRows(rows.filter((row) => selected.has(row[spec.nameKey])), state.sort[spec.sortKey]);
  }
  if (!rows.length) return null;
  return { ...sheet("", spec.columns, rows), names: rows.map((row) => (spec.nameKey ? row[spec.nameKey] : null)) };
}

// "<nomor run>_<nama scenario>.xlsx": folder RawResults_463 + scenario "Load Test MCM_3" menjadi
// "463_Load Test MCM_3.xlsx". Nomor run diambil dari angka di akhir nama folder result.
function exportFileName() {
  const result = state.data?.result;
  const folder = String(result?.resultDir ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  const runNumber = folder.match(/(\d+)$/)?.[1] ?? folder;
  const scenarioName = result?.scenario?.sessionName ?? "";
  const base = [runNumber, scenarioName].filter(Boolean).join("_") || "loadrunner-errors";
  return `${base}.xlsx`.replace(/[\\/:*?"<>|]+/g, "_");
}

// Mengembalikan jumlah sheet yang ditulis; 0 berarti belum ada tabel untuk diekspor, null berarti
// dibatalkan di dialog konfirmasi.
export function exportTablesToXlsx() {
  const sheets = collectTableSheets();
  if (!sheets.length) return 0;
  // Tombolnya di top bar, dekat Load Result, jadi mudah terklik tanpa sengaja.
  const summary = sheets.map((s) => `- ${s.name} (${s.rows.length} baris)`).join("\n");
  if (!window.confirm(`Download ${exportFileName()}?\n\n${sheets.length} sheet:\n${summary}`)) return null;
  const url = URL.createObjectURL(buildXlsx(sheets));
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return sheets.length;
}
