import { formatHms, parseHms, parsePositiveSeconds } from "./format.js";
import {
  state,
  autoGranularitySeconds,
  resolveGroup,
  resolveSelection,
  buildTransactions,
} from "./state.js";
import {
  setupChartPanelActions,
  downloadChartPng,
  copyChartImage,
  toggleExpandPanel,
  closeExpandedPanel,
  configureChartSelector,
  onSeriesSearchChange,
  chartSelectors,
} from "./charts.js";
import {
  renderTransactionModalContent,
  renderTpsModalContent,
  closeTransactionModal,
  closeTpsModal,
} from "./tables.js";
import { refreshSiteScopeRows } from "./sitescope.js";
import { refreshLgHealthRows } from "./lgmonitor.js";
import { refreshErrors, resetErrorFilter } from "./errors.js";
import { newProgressToken, startLoadingOverlay, finishLoadingOverlay, setProgress } from "./progress.js";
import { exportTablesToXlsx } from "./export.js";
import {
  PAGES,
  DEFAULT_PAGE,
  SERIES_MAX,
  updateSortIndicators,
  rtRankNames,
} from "./pages.js";

// Seri yang sudah difetch untuk tiap panel grafik. Key-nya sama dengan data-chart-selector di
// template halaman, jadi halaman bisa dibangun ulang dari state tanpa query baru.
const chartAllSeries = {};

// Elemen shell: sidebar, toolbar, modal, loading overlay. Semuanya ada di index.html dari awal,
// jadi aman diambil sekali waktu modul dimuat. Id lain milik halaman tertentu dan baru dicari
// setelah template halaman terpasang.
const els = {
  resultPath: document.getElementById("resultPath"),
  startTime: document.getElementById("startTime"),
  endTime: document.getElementById("endTime"),
  tpsGranularity: document.getElementById("tpsGranularity"),
  themeToggle: document.getElementById("themeToggle"),
  loadBtn: document.getElementById("loadBtn"),
  exportXlsxBtn: document.getElementById("exportXlsxBtn"),
  applyTpsGranularityBtn: document.getElementById("applyTpsGranularityBtn"),
  resetTpsGranularityBtn: document.getElementById("resetTpsGranularityBtn"),
  applyTimeBtn: document.getElementById("applyTimeBtn"),
  resetTimeBtn: document.getElementById("resetTimeBtn"),
  status: document.getElementById("status"),
  groupFilter: document.getElementById("groupFilter"),
  applyGroupFilterBtn: document.getElementById("applyGroupFilterBtn"),
  resetGroupFilterBtn: document.getElementById("resetGroupFilterBtn"),
  transactionModal: document.getElementById("transactionModal"),
  transactionModalTitle: document.getElementById("transactionModalTitle"),
  transactionModalTable: document.getElementById("transactionModalTable"),
  transactionModalBody: document.getElementById("transactionModalBody"),
  closeTransactionModalBtn: document.getElementById("closeTransactionModalBtn"),
  copyTransactionModalBtn: document.getElementById("copyTransactionModalBtn"),
  tpsModal: document.getElementById("tpsModal"),
  tpsModalTitle: document.getElementById("tpsModalTitle"),
  tpsModalHead: document.getElementById("tpsModalHead"),
  tpsModalTable: document.getElementById("tpsModalTable"),
  tpsModalBody: document.getElementById("tpsModalBody"),
  closeTpsModalBtn: document.getElementById("closeTpsModalBtn"),
  copyTpsModalBtn: document.getElementById("copyTpsModalBtn"),
};

const STATUS_BASE = "min-h-[18px] text-(--chart-text) text-[11px] mt-2.5";
const STATUS_ERR = "min-h-[18px] text-(--danger) text-[11px] mt-2.5 font-medium";

function setStatus(text, isError = false) {
  els.status.className = isError ? STATUS_ERR : STATUS_BASE;
  els.status.textContent = text;
}

// ── Router ───────────────────────────────────────────────────────────────────────────────────────
// Outlet hanya pernah memuat satu halaman. Halaman yang lain dibangun ulang dari state saat dibuka,
// tanpa query baru: semua datanya sudah ada di state sejak Load/Apply terakhir.

let currentPage = DEFAULT_PAGE;

function pageKeyFromHash() {
  const key = location.hash.replace(/^#\/?/, "");
  return PAGES[key] ? key : DEFAULT_PAGE;
}

// Dipanggil saat hash berubah: pasang template baru ke outlet, lalu render isinya.
function navigate() {
  const previousPage = currentPage;
  currentPage = pageKeyFromHash();
  const page = PAGES[currentPage];
  // Panel yang di-expand dicocokkan lewat kelas di seluruh dokumen, jadi harus ditutup sebelum
  // markup lamanya dibuang -- kalau tidak, body tetap terkunci mode expanded tanpa panel-nya.
  closeExpandedPanel();
  document.getElementById("page-outlet").innerHTML = page.template();
  document.querySelectorAll(".sidebar-nav a").forEach((link) => {
    link.classList.toggle("active", link.dataset.page === currentPage);
  });
  syncToolbarHeight();
  if (previousPage !== currentPage) window.scrollTo({ top: 0 });
  renderActivePage();
}

// Isi halaman aktif saja yang digambar ulang. Dipakai setiap kali data atau filter berubah;
// template tidak disentuh, jadi listener yang sudah terpasang tidak perlu diletakkan lagi.
function renderActivePage() {
  const result = PAGES[currentPage].init(pageContext());
  // Halaman response time melakukan query sendiri, jadi init-nya async. Kesalahannya harus
  //reported di bar status, bukan jadi promise yang tak tertangani.
  if (result?.catch) result.catch((error) => setStatus(error.message, true));
  if (!state.data) return;
  setStatus(`SESSION ${state.data.result.scenario.resultName || "RESULT"} | ${state.data.result.resultDir}`);
}

function pageContext() {
  return {
    els,
    outlet: document.getElementById("page-outlet"),
    range: () => ({
      start: state.appliedStart,
      end: state.appliedEnd || state.data?.result?.scenario?.durationSeconds || 0,
    }),
    applySelection,
    seriesFromFlatRows,
    applyTpsFilter,
    setStatus,
  };
}

// ── Seri & seleksi grafik ─────────────────────────────────────────────────────────────────────────

function applySelection(key, allSeries) {
  // Merge newly fetched series into chartAllSeries (preserve existing ones)
  const existing = chartAllSeries[key] ?? [];
  const existingMap = new Map(existing.map((s) => [s.name, s]));
  for (const s of allSeries) existingMap.set(s.name, s);
  chartAllSeries[key] = [...existingMap.values()];

  const names = chartAllSeries[key].map((s) => s.name);
  const maxSeries = chartSelectors.get(key)?.maxSeries ?? 10;
  const selected = new Set(resolveSelection(key, names, maxSeries));
  return chartAllSeries[key].filter((s) => selected.has(s.name));
}

function seriesFromFlatRows(rows) {
  const colors = ["#00bf8f", "#2f7df6", "#ff416d", "#8b5cf6", "#11c5e5", "#a56b00"];
  const grouped = new Map();
  for (const row of rows) {
    const current = grouped.get(row.name) ?? [];
    current.push({ x: row.elapsedSeconds, y: row.value });
    grouped.set(row.name, current);
  }
  return [...grouped.entries()].map(([name, points], index) => ({
    name,
    color: colors[index % colors.length],
    points: points.sort((a, b) => a.x - b.x),
  }));
}

// filterKey: panel yang memakai filter Include/Exclude (lihat DEFAULT_TPS_FILTERS); kosong berarti
// pakai namePrefix.
async function ensureSeriesLoaded(key, endpoint, namePrefix, rowsField, missingNames, filterKey = "") {
  if (!state.data) return;
  const { session, result } = state.data;
  const duration = result.scenario.durationSeconds || 0;
  const params = new URLSearchParams({
    session,
    start: String(state.appliedStart),
    end: String(state.appliedEnd || duration),
    granularity: String(state.appliedTpsGranularity),
    maxSeries: String(SERIES_MAX),
    extraNames: JSON.stringify([...(state.chartSelections[key] ?? []), ...missingNames]),
  });

  const response = await fetch(`${endpoint}?${params}${filterKey ? nameFilterParams(filterKey) : ""}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Series query failed");
  state[rowsField] = payload.rows;

  // Merge newly fetched series into chartAllSeries so Top buttons and re-renders have the data
  const newSeries = seriesFromFlatRows(payload.rows);
  const existing = chartAllSeries[key] ?? [];
  const existingMap = new Map(existing.map((s) => [s.name, s]));
  for (const s of newSeries) existingMap.set(s.name, s);
  chartAllSeries[key] = [...existingMap.values()];
}

// Konfigurasi pemilih seri Depends hanya pada key panel, jadi dipasang sekali waktu modul dimuat
// -- bukan tiap kali halaman dirender.
const CHART_SELECTOR_KEYS = [
  "responseTime", "responseTimeApi", "tpsTransaction", "tpsApi", "tpsDetail",
  "siteScopeCpu", "siteScopeMemory", "lgCpu", "lgMemory", "lgDisk",
];
// Panel CPU/Memory/Disk tidak dibatasi supaya semua host bisa ditampilkan.
const UNLIMITED_PANELS = new Set(["siteScopeCpu", "siteScopeMemory", "lgCpu", "lgMemory", "lgDisk"]);

CHART_SELECTOR_KEYS.forEach((key) => {
  const loadedNames = () => chartAllSeries[key]?.map((s) => s.name) ?? [];
  const selected = () => state.chartSelections[key] ?? [];
  // Pilih seri baru hanya perlu menggambar ulang halaman yang sedang terbuka; template halaman lain
  // belum ada, jadi tidak ada yang perlu ikut berubah.
  const setSelected = (names) => { state.chartSelections[key] = names; renderActivePage(); };
  const maxSeries = UNLIMITED_PANELS.has(key) ? Infinity : SERIES_MAX;

  // rankNames: urutan kandidat untuk tombol Top 10/30/50, memakai metrik utama panel itu sendiri
  // (avg response time, avg TPS, avg %) -- bukan urutan volume dari server.
  const rankBy = (rows, metric, nameOf = (r) => r.name) => (names) => {
    const byName = new Map(rows.map((row) => [nameOf(row), row[metric] ?? 0]));
    return [...names].sort((a, b) => (byName.get(b) ?? 0) - (byName.get(a) ?? 0));
  };

  const register = (allNames, ensureLoaded, rankNames) => configureChartSelector(
    key, allNames, loadedNames, selected, setSelected, ensureLoaded, maxSeries, rankNames,
  );

  if (key === "responseTime") {
    register(
      () => state.responseTimeNames,
      (missing) => ensureSeriesLoaded(key, "/api/response-time-series", "BP", "responseTimeRows", missing, "rt"),
      rtRankNames("responseTime"),
    );
  } else if (key === "responseTimeApi") {
    register(
      () => state.responseTimeApiNames,
      (missing) => ensureSeriesLoaded(key, "/api/response-time-series", "RPS_", "responseTimeApiRows", missing, "rtApi"),
      rtRankNames("responseTimeApi"),
    );
  } else if (key === "tpsTransaction") {
    register(
      () => state.tpsSummary.map((t) => t.name),
      (missing) => ensureSeriesLoaded(key, "/api/tps-series", "BP", "tpsSeriesRows", missing, "tps"),
      rankBy(state.tpsSummary, "avgTps"),
    );
  } else if (key === "tpsApi") {
    register(
      () => state.tpsSummaryApi.map((t) => t.name),
      (missing) => ensureSeriesLoaded(key, "/api/tps-series", "RPS_", "tpsApiSeriesRows", missing, "rps"),
      rankBy(state.tpsSummaryApi, "avgTps"),
    );
  } else if (key === "tpsDetail") {
    register(
      () => state.tpsDetail.map((t) => t.name),
      (missing) => ensureSeriesLoaded(key, "/api/tps-detail-series", "BP", "tpsDetailSeriesRows", missing, "tpsDetail"),
      rankBy(state.tpsDetail, "avgTps"),
    );
  } else if (key === "siteScopeCpu" || key === "siteScopeMemory") {
    // Baris host diturunkan dari graph, jadi kandidat panel ini sama dengan yang sudah digambar.
    const rows = key === "siteScopeCpu" ? state.siteScopeCpuRows : state.siteScopeMemoryRows;
    register(loadedNames, null, rankBy(rows, "avg", (r) => r.host));
  } else {
    const metric = key === "lgCpu" ? "cpuAvg" : key === "lgMemory" ? "memoryAvg" : "diskAvg";
    register(loadedNames, null, rankBy(state.lgHealthRows, metric, (r) => r.host));
  }
});

// ── Query & filter ────────────────────────────────────────────────────────────────────────────────

// Query string filter Include/Exclude sebuah panel (lihat DEFAULT_TPS_FILTERS untuk daftarnya).
function nameFilterParams(key) {
  const filter = state.tpsFilters[key];
  return `&include=${encodeURIComponent(filter.include)}&exclude=${encodeURIComponent(filter.exclude)}`;
}

// Filter ini mengubah query summary, series, dan overall sekaligus, jadi dashboard di-refresh
// penuh seperti Apply filter waktu.
async function applyTpsFilter(key, filter) {
  state.tpsFilters[key] = filter;
  if (!state.data) {
    renderActivePage();
    return;
  }
  await withLoadTimer("Applying transaction filter", async (onQueryProgress) => {
    await refreshDashboardData(onQueryProgress);
    renderActivePage();
    setStatus(`Filter ${key} applied: include "${filter.include || "(semua)"}", exclude "${filter.exclude || "(tidak ada)"}"`);
  });
}

function extraNamesParam(key) {
  return JSON.stringify(state.chartSelections[key] ?? []);
}

async function refreshDashboardData(onQueryProgress) {
  const { session, result } = state.data;
  const start = state.appliedStart;
  const end = state.appliedEnd || result.scenario.durationSeconds || 0;
  const params = new URLSearchParams({
    session,
    start: String(start),
    end: String(end),
    granularity: String(state.appliedTpsGranularity),
  });
  let completedQueries = 0;
  const queries = [
    fetch(`/api/dashboard?${params}`),
    fetch(`/api/transactions?${params}&offset=0${nameFilterParams("tx")}`),
    fetch(`/api/transactions?${params}&offset=0${nameFilterParams("txRps")}`),
    fetch(`/api/tps-summary?${params}&offset=0${nameFilterParams("tps")}`),
    fetch(`/api/tps-summary?${params}&offset=0${nameFilterParams("rps")}`),
    fetch(`/api/response-time-series?${params}${nameFilterParams("rt")}&maxSeries=${SERIES_MAX}&extraNames=${encodeURIComponent(extraNamesParam("responseTime"))}`),
    fetch(`/api/response-time-series?${params}${nameFilterParams("rtApi")}&maxSeries=${SERIES_MAX}&extraNames=${encodeURIComponent(extraNamesParam("responseTimeApi"))}`),
    fetch(`/api/tps-series?${params}${nameFilterParams("tps")}&maxSeries=${SERIES_MAX}&extraNames=${encodeURIComponent(extraNamesParam("tpsTransaction"))}`),
    fetch(`/api/tps-series?${params}${nameFilterParams("rps")}&maxSeries=${SERIES_MAX}&extraNames=${encodeURIComponent(extraNamesParam("tpsApi"))}`),
    fetch(`/api/tps-detail-summary?${params}${nameFilterParams("tpsDetail")}`),
    fetch(`/api/tps-detail-series?${params}${nameFilterParams("tpsDetail")}&maxSeries=${SERIES_MAX}&extraNames=${encodeURIComponent(extraNamesParam("tpsDetail"))}`),
    fetch(`/api/tps-overall?${params}${nameFilterParams("tpsOverall")}`),
    fetch(`/api/tps-overall?${params}${nameFilterParams("rpsOverall")}`),
  ];
  const [
    dashboardResponse, transactionsResponse, rpsTransactionsResponse, tpsSummaryResponse, tpsSummaryApiResponse,
    responseTimeResponse, responseTimeApiResponse, tpsSeriesResponse, tpsApiSeriesResponse,
    tpsDetailSummaryResponse, tpsDetailSeriesResponse, tpsOverallResponse, rpsOverallResponse,
  ] = await Promise.all(queries.map((query) => query.then((response) => {
    onQueryProgress?.(completedQueries += 1, queries.length);
    return response;
  })));
  const dashboard = await dashboardResponse.json();
  const transactions = await transactionsResponse.json();
  const rpsTransactions = await rpsTransactionsResponse.json();
  const tpsSummary = await tpsSummaryResponse.json();
  const tpsSummaryApi = await tpsSummaryApiResponse.json();
  const responseTime = await responseTimeResponse.json();
  const responseTimeApi = await responseTimeApiResponse.json();
  const tpsSeries = await tpsSeriesResponse.json();
  const tpsApiSeries = await tpsApiSeriesResponse.json();
  const tpsDetailSummary = await tpsDetailSummaryResponse.json();
  const tpsDetailSeries = await tpsDetailSeriesResponse.json();
  const tpsOverall = await tpsOverallResponse.json();
  const rpsOverall = await rpsOverallResponse.json();
  if (!dashboardResponse.ok) throw new Error(dashboard.error || "Dashboard query failed");
  if (!transactionsResponse.ok) throw new Error(transactions.error || "Transaction query failed");
  if (!rpsTransactionsResponse.ok) throw new Error(rpsTransactions.error || "RPS transaction query failed");
  if (!tpsSummaryResponse.ok) throw new Error(tpsSummary.error || "TPS summary query failed");
  if (!tpsSummaryApiResponse.ok) throw new Error(tpsSummaryApi.error || "TPS summary by API query failed");
  if (!responseTimeResponse.ok) throw new Error(responseTime.error || "Response time by transaction query failed");
  if (!responseTimeApiResponse.ok) throw new Error(responseTimeApi.error || "Response time by API query failed");
  if (!tpsSeriesResponse.ok) throw new Error(tpsSeries.error || "TPS by transaction series query failed");
  if (!tpsApiSeriesResponse.ok) throw new Error(tpsApiSeries.error || "TPS by API series query failed");
  if (!tpsDetailSummaryResponse.ok) throw new Error(tpsDetailSummary.error || "TPS detail summary query failed");
  if (!tpsDetailSeriesResponse.ok) throw new Error(tpsDetailSeries.error || "TPS detail series query failed");
  if (!tpsOverallResponse.ok) throw new Error(tpsOverall.error || "TPS overall query failed");
  if (!rpsOverallResponse.ok) throw new Error(rpsOverall.error || "RPS overall query failed");

  const graphs = new Map(result.graphs.map((graph) => [graph.type, graph]));
  for (const graph of result.graphs) graph.rows = [];
  for (const row of dashboard.rows) {
    const graph = graphs.get(row.graph_type);
    if (!graph) continue;
    graph.rows.push({
      measurementId: row.measurement_id,
      elapsedSeconds: row.elapsed_seconds,
      value: row.value,
      count: row.sample_count,
      min: row.min_value,
      max: row.max_value,
      stddev: row.stddev,
    });
  }
  state.transactions = transactions.rows.map((tx) => ({ ...tx, groupName: resolveGroup(tx.name) }));
  state.rpsTransactions = rpsTransactions.rows.map((tx) => ({ ...tx, groupName: resolveGroup(tx.name) }));
  state.tpsSummary = tpsSummary.rows.map((tx) => ({ ...tx, groupName: resolveGroup(tx.name) }));
  state.tpsSummaryApi = tpsSummaryApi.rows.map((tx) => ({ ...tx, groupName: resolveGroup(tx.name) }));
  state.responseTimeRows = responseTime.rows;
  state.responseTimeApiRows = responseTimeApi.rows;
  state.responseTimeNames = responseTime.names ?? [];
  state.responseTimeApiNames = responseTimeApi.names ?? [];
  state.tpsSeriesRows = tpsSeries.rows;
  state.tpsApiSeriesRows = tpsApiSeries.rows;
  state.tpsDetail = tpsDetailSummary.rows;
  state.tpsDetailTransactions = tpsDetailSummary.transactions ?? 0;
  state.tpsDetailSeriesRows = tpsDetailSeries.rows;
  state.tpsOverall = tpsOverall;
  state.tpsOverallSeriesRows = tpsOverall.series;
  state.rpsOverall = rpsOverall;
  state.rpsOverallSeriesRows = rpsOverall.series;
  state.seriesCountByType = dashboard.seriesCountByType ?? {};
  // Jumlah kandidat seri per panel dibaca di halaman mana pun yang menampilkannya, jadi disimpan di
  // state, bukan ditulis langsung ke DOM seperti sebelumnya.
  state.seriesTotals = {
    responseTime: responseTime.total ?? 0,
    responseTimeApi: responseTimeApi.total ?? 0,
    tpsTransaction: tpsSeries.total ?? 0,
    tpsApi: tpsApiSeries.total ?? 0,
    tpsDetail: tpsDetailSeries.total ?? 0,
  };
  // Baris SiteScope dan load generator bukan hasil fetch, tapi turunan dari graph. Kalau hanya
  // dihitung saat panelnya dirender, sheet XLSX-nya kosong di halaman yang belum pernah dibuka.
  refreshSiteScopeRows(start, end);
  refreshLgHealthRows(start, end);
  await refreshErrors();
}

// Apply/Reset menjalankan ulang seluruh query dashboard, sama beratnya dengan Load Result, jadi
// overlay-nya ikut muncul. Bedanya tidak ada tahap ingest di server: data sudah ada di cache, yang
// berjalan cuma query, jadi 0-90% dibagi rata per query dan sisanya untuk render.
async function withLoadTimer(loadingLabel, task) {
  setStatus("");
  const startedAt = Date.now();
  const timerInterval = setInterval(() => {
    setStatus(`${loadingLabel}... ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  }, 100);
  startLoadingOverlay(loadingLabel, newProgressToken());
  try {
    await task((done, total) => setProgress((90 * done) / total, `Query dashboard ${done}/${total}...`));
    setProgress(100, "Selesai");
    setStatus(`${els.status.textContent.replace(/ \| Updated in .*$/, "")} | Updated in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    clearInterval(timerInterval);
    finishLoadingOverlay();
  }
}

async function applyTimeFilter() {
  if (!state.data) return;
  const duration = state.data.result.scenario.durationSeconds || 0;
  const start = parseHms(els.startTime.value);
  const end = els.endTime.value.trim() ? parseHms(els.endTime.value) : duration;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    setStatus("Range waktu tidak valid.", true);
    return;
  }
  state.appliedStart = start;
  state.appliedEnd = end;
  await withLoadTimer("Applying filter", async (onQueryProgress) => {
    await refreshDashboardData(onQueryProgress);
    renderActivePage();
    setStatus(`Filter applied: ${formatHms(start)} - ${formatHms(end)}`);
  });
}

async function resetTimeFilter() {
  if (!state.data) return;
  const duration = state.data.result.scenario.durationSeconds || 0;
  els.startTime.value = "00:00:00";
  els.endTime.value = formatHms(duration);
  state.appliedStart = 0;
  state.appliedEnd = duration;
  await withLoadTimer("Resetting filter", async (onQueryProgress) => {
    await refreshDashboardData(onQueryProgress);
    renderActivePage();
    setStatus(`Filter reset: ${formatHms(0)} - ${formatHms(duration)}`);
  });
}

async function applyTpsGranularity() {
  if (!state.data) return;
  const tpsGranularity = parsePositiveSeconds(els.tpsGranularity.value);
  if (!Number.isFinite(tpsGranularity)) {
    setStatus("Granularity grafik harus angka minimal 1 detik.", true);
    return;
  }
  state.appliedTpsGranularity = tpsGranularity;
  await withLoadTimer("Applying granularity", async (onQueryProgress) => {
    await refreshDashboardData(onQueryProgress);
    renderActivePage();
    setStatus(`Granularity grafik applied: ${tpsGranularity}s bucket`);
  });
}

async function resetTpsGranularity() {
  if (!state.data) return;
  // Default-nya mengikuti durasi run yang sedang dibuka, bukan konstanta tetap.
  const granularity = autoGranularitySeconds(state.data.result.scenario.durationSeconds);
  els.tpsGranularity.value = String(granularity);
  state.appliedTpsGranularity = granularity;
  await withLoadTimer("Resetting granularity", async (onQueryProgress) => {
    await refreshDashboardData(onQueryProgress);
    renderActivePage();
    setStatus(`Granularity grafik reset to auto: ${granularity}s bucket`);
  });
}

// Filter group tidak memanggil server sama sekali, semuanya render ulang di browser. Render itu
// memblokir thread, jadi overlay-nya harus sempat tergambar dulu (dua frame) sebelum kerjanya
// mulai — kalau tidak, browser baru melukis setelah tabelnya selesai dan overlay tidak pernah
// kelihatan.
async function withRenderOverlay(label, render) {
  startLoadingOverlay(label, newProgressToken());
  setProgress(20, "Menyusun tabel...");
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    render();
    setProgress(100, "Selesai");
  } finally {
    finishLoadingOverlay();
  }
}

async function applyGroupFilter() {
  if (!state.data) return;
  state.groupFilter = els.groupFilter.value.trim();
  await withRenderOverlay("Applying group filter", renderActivePage);
}

async function resetGroupFilter() {
  els.groupFilter.value = "";
  state.groupFilter = "";
  if (!state.data) return;
  await withRenderOverlay("Resetting group filter", renderActivePage);
}

async function loadResult() {
  const resultPath = els.resultPath.value.trim();
  if (!resultPath) {
    setStatus("Isi path hasil LoadRunner dulu, lalu klik Load Result.", true);
    return;
  }
  els.loadBtn.disabled = true;
  setStatus("");

  const startedAt = Date.now();
  const timerInterval = setInterval(() => {
    setStatus(`Loading... ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  }, 100);
  // Ingest jalan di server, query dashboard di browser: 0-90% dari server, sisanya dari sini.
  const progressToken = newProgressToken();
  startLoadingOverlay("Load Result", progressToken, 0.9);

  try {
    const response = await fetch(`/api/load?path=${encodeURIComponent(resultPath)}&progress=${encodeURIComponent(progressToken)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Load failed");
    localStorage.setItem("loadrunnerLastPath", resultPath);
    state.data = payload;
    const duration = payload.result.scenario.durationSeconds || 300;
    els.startTime.value = "00:00:00";
    els.endTime.value = formatHms(duration);
    state.appliedStart = 0;
    state.appliedEnd = duration;
    state.appliedTpsGranularity = autoGranularitySeconds(duration);
    els.tpsGranularity.value = String(state.appliedTpsGranularity);
    resetErrorFilter();
    setProgress(90, "Query dashboard...");
    await refreshDashboardData((done, total) => setProgress(90 + (10 * done) / total, `Query dashboard ${done}/${total}...`));
    renderActivePage();
    setStatus(`${els.status.textContent} | Loaded in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
    els.exportXlsxBtn.disabled = false;
    els.exportXlsxBtn.title = "Semua tabel panel ke satu file .xlsx, satu sheet per panel";
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    clearInterval(timerInterval);
    finishLoadingOverlay();
    els.loadBtn.disabled = false;
  }
}

// ── Modal ─────────────────────────────────────────────────────────────────────────────────────────

function tableToTsv(table) {
  const headerCells = [...table.querySelectorAll("thead th")].map((th) => {
    const clone = th.cloneNode(true);
    clone.querySelector(".sort-indicator")?.remove();
    return clone.textContent.trim();
  });
  const bodyRows = [...table.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()).join("\t"));
  return [headerCells.join("\t"), ...bodyRows].join("\n");
}

async function copyTableRows(table, button) {
  const text = tableToTsv(table);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  const original = button.textContent;
  button.textContent = "Copied!";
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 1200);
}

// Modal hidup di luar outlet, jadi tidak ikut hilang saat pindah halaman -- isinya di-render ulang
// dari state setiap sort.
function getTableRows(tableKey) {
  switch (tableKey) {
    case "tx": return buildTransactions();
    case "txRps": return state.rpsTransactions;
    case "rtTable": return state.rtTableRows.responseTime;
    case "rtApiTable": return state.rtTableRows.responseTimeApi;
    case "tpsSummary": return state.tpsSummary;
    case "tpsSummaryApi": return state.tpsSummaryApi;
    case "tpsDetail": return state.tpsDetail;
    case "siteScopeCpu": return state.siteScopeCpuRows;
    case "siteScopeMemory": return state.siteScopeMemoryRows;
    default: return [];
  }
}

function refreshOpenModals() {
  if (!els.transactionModal.hidden) {
    const tableKey = els.transactionModal.dataset.tableKey;
    renderTransactionModalContent(els, getTableRows(tableKey), els.transactionModal.dataset.label, tableKey);
  }
  if (!els.tpsModal.hidden) {
    const tableKey = els.tpsModal.dataset.tableKey;
    const mode = els.tpsModal.dataset.mode || "transaction";
    renderTpsModalContent(els, getTableRows(tableKey), els.tpsModal.dataset.label, tableKey, mode);
  }
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  els.themeToggle.textContent = theme === "dark" ? "Light" : "Dark";
  localStorage.setItem("loadrunnerTheme", theme);
  renderActivePage();
}

function syncToolbarHeight() {
  const toolbar = document.getElementById("toolbar");
  if (!toolbar) return;
  document.documentElement.style.setProperty("--toolbar-height", `${toolbar.offsetHeight + 16}px`);
}

// ── Wiring shell ──────────────────────────────────────────────────────────────────────────────────

els.loadBtn.addEventListener("click", loadResult);
els.resultPath.addEventListener("keydown", (e) => { if (e.key === "Enter") loadResult(); });
els.exportXlsxBtn.addEventListener("click", () => {
  if (!state.data) return;
  const sheetCount = exportTablesToXlsx();
  if (!sheetCount) return;
  setStatus(`Exported ${sheetCount} tabel ke XLSX`);
});
els.themeToggle.addEventListener("click", () => applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark"));
els.applyTpsGranularityBtn.addEventListener("click", applyTpsGranularity);
els.resetTpsGranularityBtn.addEventListener("click", resetTpsGranularity);
els.applyTimeBtn.addEventListener("click", applyTimeFilter);
els.resetTimeBtn.addEventListener("click", resetTimeFilter);
els.applyGroupFilterBtn.addEventListener("click", applyGroupFilter);
els.resetGroupFilterBtn.addEventListener("click", resetGroupFilter);
els.groupFilter.addEventListener("keydown", (e) => { if (e.key === "Enter") applyGroupFilter(); });

els.closeTransactionModalBtn.addEventListener("click", () => closeTransactionModal(els));
els.copyTransactionModalBtn.addEventListener("click", () => copyTableRows(els.transactionModalTable, els.copyTransactionModalBtn));
els.transactionModal.addEventListener("click", (event) => {
  if (event.target === els.transactionModal) closeTransactionModal(els);
});
els.closeTpsModalBtn.addEventListener("click", () => closeTpsModal(els));
els.copyTpsModalBtn.addEventListener("click", () => copyTableRows(els.tpsModalTable, els.copyTpsModalBtn));
els.tpsModal.addEventListener("click", (event) => {
  if (event.target === els.tpsModal) closeTpsModal(els);
});

// Sort dan aksi grafik ditangkap di level document: yang berubah adalah elemennya tiap kali halaman
// dirender, bukan pendengarnya, jadi tidak perlu dipasang ulang tiap navigasi.
document.addEventListener("click", (event) => {
  const th = event.target.closest("th[data-sort]");
  if (!th) return;
  const tableKey = th.closest("[data-table]")?.dataset.table;
  const current = tableKey ? state.sort[tableKey] : null;
  if (!current) return;
  const sortKey = th.dataset.sort;
  const dir = current.key === sortKey && current.dir === "asc" ? "desc" : "asc";
  state.sort[tableKey] = { key: sortKey, dir };
  renderActivePage();
  updateSortIndicators(document);
  refreshOpenModals();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chart-action]");
  if (!button) return;
  const panel = button.closest(".chart-panel");
  if (!panel) return;

  if (button.dataset.chartAction === "download") downloadChartPng(panel);
  else if (button.dataset.chartAction === "copy") copyChartImage(panel, button);
  else if (button.dataset.chartAction === "expand") toggleExpandPanel(panel, button);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!els.transactionModal.hidden) closeTransactionModal(els);
  else if (!els.tpsModal.hidden) closeTpsModal(els);
  else closeExpandedPanel();
});

window.addEventListener("resize", renderActivePage);
window.addEventListener("hashchange", navigate);

// Search di toolbar panel hanya mengubah baris tabel mana yang tampil, jadi cukup render ulang
// halaman yang sedang terbuka. Dipanggil sekali di sini, bukan tiap kali init halaman berjalan.
onSeriesSearchChange(() => renderActivePage());

setupChartPanelActions();
// Halaman harus terpasang sebelum tema applies: applyTheme() menggambar ulang halaman aktif untuk
// menggambar ulang canvas dengan warna tema baru, jadi outlet-nya sudah harus berisi template.
navigate();
applyTheme(localStorage.getItem("loadrunnerTheme") === "dark" ? "dark" : "light");
els.resultPath.value = localStorage.getItem("loadrunnerLastPath") || "";
syncToolbarHeight();
new ResizeObserver(syncToolbarHeight).observe(document.getElementById("toolbar"));