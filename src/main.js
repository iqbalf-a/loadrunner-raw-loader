import { formatHms, formatClockAt, parseHms, parsePositiveSeconds } from "./format.js";
import {
  state,
  DEFAULT_GRAPH_GRANULARITY_SECONDS,
  resolveGroup,
  buildTransactions,
} from "./state.js";
import { drawMultiLineChart, transactionSeries, tpsPoints, setupChartPanelActions, downloadChartPng, toggleExpandPanel, closeExpandedPanel, configureChartSelector, refreshExpandedChartSelector, MAX_SELECTED_SERIES } from "./charts.js";
import { renderMetrics, renderTable, renderTpsSummaryTable, renderTpsSummaryHead, openTransactionModal, closeTransactionModal, openTpsModal, closeTpsModal, renderTransactionModalContent, renderTpsModalContent } from "./tables.js";
import { renderSiteScopeSection } from "./sitescope.js";

const TPS_SUMMARY_LABELS = {
  transaction: "TPS Summary By Transaction",
  group: "TPS Summary By Group",
  passFailGroup: "TPS Summary By Pass/Failed Group",
};

const chartAllSeries = {};

const els = {
  resultPath: document.getElementById("resultPath"),
  startTime: document.getElementById("startTime"),
  endTime: document.getElementById("endTime"),
  tpsGranularity: document.getElementById("tpsGranularity"),
  themeToggle: document.getElementById("themeToggle"),
  loadBtn: document.getElementById("loadBtn"),
  applyTpsGranularityBtn: document.getElementById("applyTpsGranularityBtn"),
  resetTpsGranularityBtn: document.getElementById("resetTpsGranularityBtn"),
  applyTimeBtn: document.getElementById("applyTimeBtn"),
  resetTimeBtn: document.getElementById("resetTimeBtn"),
  status: document.getElementById("status"),
  rangeInfo: document.getElementById("rangeInfo"),
  metrics: document.getElementById("metrics"),
  txBody: document.getElementById("txBody"),
  txRpsBody: document.getElementById("txRpsBody"),
  showAllRpsTransactionsBtn: document.getElementById("showAllRpsTransactionsBtn"),
  tpsBody: document.getElementById("tpsBody"),
  tpsSummaryHead: document.getElementById("tpsSummaryHead"),
  tpsSummaryMode: document.getElementById("tpsSummaryMode"),
  showAllTpsTransactionsBtn: document.getElementById("showAllTpsTransactionsBtn"),
  tpsModal: document.getElementById("tpsModal"),
  tpsModalTitle: document.getElementById("tpsModalTitle"),
  tpsModalHead: document.getElementById("tpsModalHead"),
  tpsModalBody: document.getElementById("tpsModalBody"),
  closeTpsModalBtn: document.getElementById("closeTpsModalBtn"),
  rangeLabel: document.getElementById("rangeLabel"),
  tpsGranularityLabel: document.getElementById("tpsGranularityLabel"),
  seriesCountRt: document.getElementById("seriesCountRt"),
  seriesCountTps: document.getElementById("seriesCountTps"),
  transactionRtChart: document.getElementById("transactionRtChart"),
  transactionRtApiChart: document.getElementById("transactionRtApiChart"),
  vusersChart: document.getElementById("vusersChart"),
  tpsChart: document.getElementById("tpsChart"),
  siteScopeCpuChart: document.getElementById("siteScopeCpuChart"),
  siteScopeMemoryChart: document.getElementById("siteScopeMemoryChart"),
  siteScopeCpuBody: document.getElementById("siteScopeCpuBody"),
  siteScopeMemoryBody: document.getElementById("siteScopeMemoryBody"),
  groupFilter: document.getElementById("groupFilter"),
  applyGroupFilterBtn: document.getElementById("applyGroupFilterBtn"),
  resetGroupFilterBtn: document.getElementById("resetGroupFilterBtn"),
  showAllTransactionsBtn: document.getElementById("showAllTransactionsBtn"),
  transactionModal: document.getElementById("transactionModal"),
  transactionModalTitle: document.getElementById("transactionModalTitle"),
  transactionModalBody: document.getElementById("transactionModalBody"),
  closeTransactionModalBtn: document.getElementById("closeTransactionModalBtn"),
};

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  els.themeToggle.textContent = theme === "dark" ? "Light" : "Dark";
  localStorage.setItem("loadrunnerTheme", theme);
  if (state.data) renderAll();
}

function toggleTheme() {
  applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
}

function renderTpsChart(start, end) {
  const tpsSeries = transactionSeries(
    "es_tr_tprange_pass",
    start,
    end,
    (rows) => tpsPoints(rows, start, end, state.appliedTpsGranularity),
  ).map((s) => ({ ...s, groupName: resolveGroup(s.name) }));
  els.tpsGranularityLabel.textContent = `${state.appliedTpsGranularity}s bucket`;
  drawMultiLineChart(els.tpsChart, tpsSeries, start, end);
}

function getTpsSummaryModeRows() {
  if (state.tpsSummaryMode === "group") return state.tpsSummaryByGroup;
  if (state.tpsSummaryMode === "passFailGroup") return state.tpsSummaryPassFailByGroup;
  return state.tpsSummary;
}

function renderTpsSummaryPanels() {
  renderTpsSummaryHead(els.tpsSummaryHead, state.tpsSummaryMode);
  renderTpsSummaryTable(getTpsSummaryModeRows(), els.tpsBody, els.showAllTpsTransactionsBtn, "tpsSummary", state.tpsSummaryMode);
}

function applySelection(key, allSeries) {
  chartAllSeries[key] = allSeries;
  const names = allSeries.map((s) => s.name);
  let selected = (state.chartSelections[key] ?? []).filter((name) => names.includes(name));
  if (!selected.length && names.length) {
    selected = names.slice(0, MAX_SELECTED_SERIES);
    state.chartSelections[key] = selected;
  }
  return allSeries.filter((s) => selected.includes(s.name));
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

function renderCharts(transactions, start, end) {
  drawMultiLineChart(
    els.transactionRtChart,
    applySelection("responseTime", transactionSeries("es_tr_response_time", start, end, (rows) => rows.map((row) => ({ x: row.elapsedSeconds, y: row.value })))),
    start,
    end,
  );
  drawMultiLineChart(
    els.transactionRtApiChart,
    applySelection("responseTimeApi", seriesFromFlatRows(state.responseTimeApiRows ?? [])),
    start,
    end,
  );
  drawMultiLineChart(
    els.vusersChart,
    transactionSeries("es_tr_runtime_vusers", start, end, (rows) => rows.map((row) => ({ x: row.elapsedSeconds, y: row.value }))),
    start,
    end,
  );
  renderTpsChart(start, end);
  renderSiteScopeSection(els, start, end, applySelection);
  ["responseTime", "responseTimeApi", "siteScopeCpu", "siteScopeMemory"].forEach(refreshExpandedChartSelector);
}

const STATUS_BASE = "min-h-[18px] text-(--chart-text) text-[11px] mb-3.5";
const STATUS_ERR  = "min-h-[18px] text-(--danger) text-[11px] mb-3.5 font-medium";

function renderAll() {
  if (!state.data) return;
  const duration = state.data.result.scenario.durationSeconds || 0;
  const start = state.appliedStart;
  const end = state.appliedEnd || duration;

  els.status.className = STATUS_BASE;
  const isAllRange = start === 0 && Math.round(end) === Math.round(duration);
  els.rangeLabel.textContent = `Filtered: ${formatHms(start)} - ${formatHms(end)}`;
  els.rangeInfo.innerHTML = `
    <div class="range-chip border border-(--line) border-l-2 bg-(--surface-raised) rounded-[3px] p-[12px_14px]">
      <div class="text-[11px] text-(--chart-text) font-medium tracking-[0.08em] uppercase" style="font-family: var(--font-mono);">All Range</div>
      <div class="mt-1.5 text-[15px] text-(--text) font-medium tracking-[0.02em]" style="font-family: var(--font-mono);">${formatHms(0)} - ${formatHms(duration)}</div>
      <div class="mt-1 text-(--chart-text) text-[11px]" style="font-family: var(--font-mono);">${formatClockAt(0)} - ${formatClockAt(duration)}</div>
    </div>
    <div class="range-chip ${isAllRange ? "" : "changed"} border border-(--line) border-l-2 bg-(--surface-raised) rounded-[3px] p-[12px_14px]">
      <div class="text-[11px] text-(--chart-text) font-medium tracking-[0.08em] uppercase" style="font-family: var(--font-mono);">${isAllRange ? "Filtered Range: All selected" : "Filtered Range"}</div>
      <div class="mt-1.5 text-[15px] text-(--text) font-medium tracking-[0.02em]" style="font-family: var(--font-mono);">${formatHms(start)} - ${formatHms(end)}</div>
      <div class="mt-1 text-(--chart-text) text-[11px]" style="font-family: var(--font-mono);">${formatClockAt(start)} - ${formatClockAt(end)}</div>
    </div>
  `;
  const transactions = buildTransactions();
  renderMetrics(els.metrics, transactions, start, end);
  renderTable(transactions, els.txBody, els.showAllTransactionsBtn, "tx");
  renderTable(state.rpsTransactions, els.txRpsBody, els.showAllRpsTransactionsBtn, "txRps");
  renderTpsSummaryPanels();
  renderCharts(transactions, start, end);
  els.status.textContent = `SESSION ${state.data.result.scenario.resultName || "RESULT"} | ${state.data.result.resultDir}`;
}

async function applyTimeFilter() {
  if (!state.data) return;
  const duration = state.data.result.scenario.durationSeconds || 0;
  const start = parseHms(els.startTime.value);
  const end = els.endTime.value.trim() ? parseHms(els.endTime.value) : duration;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    els.status.textContent = "Range waktu tidak valid.";
    els.status.className = STATUS_ERR;
    return;
  }
  state.appliedStart = start;
  state.appliedEnd = end;
  try {
    await refreshDashboardData();
    renderAll();
  } catch (error) {
    els.status.textContent = error.message;
    els.status.className = STATUS_ERR;
  }
}

async function applyTpsGranularity() {
  if (!state.data) return;
  const tpsGranularity = parsePositiveSeconds(els.tpsGranularity.value);
  if (!Number.isFinite(tpsGranularity)) {
    els.status.textContent = "Granularity grafik harus angka minimal 1 detik.";
    els.status.className = STATUS_ERR;
    return;
  }
  state.appliedTpsGranularity = tpsGranularity;
  els.status.className = STATUS_BASE;
  try {
    await refreshDashboardData();
    renderAll();
    els.status.textContent = `Granularity grafik applied: ${tpsGranularity}s bucket`;
  } catch (error) {
    els.status.textContent = error.message;
    els.status.className = STATUS_ERR;
  }
}

async function resetTpsGranularity() {
  if (!state.data) return;
  els.tpsGranularity.value = String(DEFAULT_GRAPH_GRANULARITY_SECONDS);
  state.appliedTpsGranularity = DEFAULT_GRAPH_GRANULARITY_SECONDS;
  els.status.className = STATUS_BASE;
  try {
    await refreshDashboardData();
    renderAll();
    els.status.textContent = `Granularity grafik reset to default: ${DEFAULT_GRAPH_GRANULARITY_SECONDS}s bucket`;
  } catch (error) {
    els.status.textContent = error.message;
    els.status.className = STATUS_ERR;
  }
}

async function loadResult() {
  const resultPath = els.resultPath.value.trim();
  if (!resultPath) {
    els.status.textContent = "Isi path hasil LoadRunner dulu, lalu klik Load Result.";
    els.status.className = STATUS_ERR;
    return;
  }
  els.loadBtn.disabled = true;
  els.status.className = STATUS_BASE;

  const startedAt = Date.now();
  let timerInterval = setInterval(() => {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    els.status.textContent = `Loading... ${elapsed}s`;
  }, 100);

  try {
    const response = await fetch(`/api/load?path=${encodeURIComponent(resultPath)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Load failed");
    localStorage.setItem("loadrunnerLastPath", resultPath);
    state.data = payload;
    const duration = payload.result.scenario.durationSeconds || 300;
    els.startTime.value = "00:00:00";
    els.endTime.value = formatHms(duration);
    state.appliedStart = 0;
    state.appliedEnd = duration;
    state.appliedTpsGranularity = parsePositiveSeconds(els.tpsGranularity.value) || DEFAULT_GRAPH_GRANULARITY_SECONDS;
    await refreshDashboardData();
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
    renderAll();
    els.status.textContent += ` | Loaded in ${elapsed}s`;
  } catch (error) {
    els.status.textContent = error.message;
    els.status.className = STATUS_ERR;
  } finally {
    clearInterval(timerInterval);
    els.loadBtn.disabled = false;
  }
}

async function refreshDashboardData() {
  const { session, result } = state.data;
  const start = state.appliedStart;
  const end = state.appliedEnd || result.scenario.durationSeconds || 0;
  const params = new URLSearchParams({
    session,
    start: String(start),
    end: String(end),
    granularity: String(state.appliedTpsGranularity),
  });
  const [
    dashboardResponse, transactionsResponse, rpsTransactionsResponse, tpsSummaryResponse,
    responseTimeApiResponse, tpsSummaryByGroupResponse, tpsSummaryPassFailByGroupResponse,
  ] = await Promise.all([
    fetch(`/api/dashboard?${params}`),
    fetch(`/api/transactions?${params}&limit=500&offset=0`),
    fetch(`/api/transactions?${params}&limit=500&offset=0&namePrefix=RPS_`),
    fetch(`/api/tps-summary?${params}&limit=500&offset=0`),
    fetch(`/api/response-time-series?${params}&namePrefix=RPS_&maxSeries=30`),
    fetch(`/api/tps-summary-by-group?${params}`),
    fetch(`/api/tps-summary-pass-fail-by-group?${params}`),
  ]);
  const dashboard = await dashboardResponse.json();
  const transactions = await transactionsResponse.json();
  const rpsTransactions = await rpsTransactionsResponse.json();
  const tpsSummary = await tpsSummaryResponse.json();
  const responseTimeApi = await responseTimeApiResponse.json();
  const tpsSummaryByGroup = await tpsSummaryByGroupResponse.json();
  const tpsSummaryPassFailByGroup = await tpsSummaryPassFailByGroupResponse.json();
  if (!dashboardResponse.ok) throw new Error(dashboard.error || "Dashboard query failed");
  if (!transactionsResponse.ok) throw new Error(transactions.error || "Transaction query failed");
  if (!rpsTransactionsResponse.ok) throw new Error(rpsTransactions.error || "RPS transaction query failed");
  if (!tpsSummaryResponse.ok) throw new Error(tpsSummary.error || "TPS summary query failed");
  if (!responseTimeApiResponse.ok) throw new Error(responseTimeApi.error || "Response time by API query failed");
  if (!tpsSummaryByGroupResponse.ok) throw new Error(tpsSummaryByGroup.error || "TPS summary by group query failed");
  if (!tpsSummaryPassFailByGroupResponse.ok) throw new Error(tpsSummaryPassFailByGroup.error || "TPS summary pass/fail by group query failed");

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
  state.transactions = transactions.rows.map((transaction) => ({
    ...transaction,
    groupName: resolveGroup(transaction.name),
  }));
  state.rpsTransactions = rpsTransactions.rows.map((transaction) => ({
    ...transaction,
    groupName: resolveGroup(transaction.name),
  }));
  state.tpsSummary = tpsSummary.rows.map((tx) => ({ ...tx, groupName: resolveGroup(tx.name) }));
  state.responseTimeApiRows = responseTimeApi.rows;
  state.tpsSummaryByGroup = tpsSummaryByGroup.rows;
  state.tpsSummaryPassFailByGroup = tpsSummaryPassFailByGroup.rows;
  state.seriesCountByType = dashboard.seriesCountByType ?? {};
  const seriesHint = (graphType) => {
    const total = state.seriesCountByType[graphType] ?? 0;
    const shown = Math.min(total, dashboard.maxSeriesPerGraph ?? total);
    return total > shown ? `(top ${shown} of ${total} by volume)` : "";
  };
  els.seriesCountRt.textContent = seriesHint("es_tr_response_time");
  els.seriesCountTps.textContent = seriesHint("es_tr_tprange_pass");
}

function applyGroupFilter() {
  if (!state.data) return;
  state.groupFilter = els.groupFilter.value.trim();
  const transactions = buildTransactions();
  renderTable(transactions, els.txBody, els.showAllTransactionsBtn, "tx");
  renderTable(state.rpsTransactions, els.txRpsBody, els.showAllRpsTransactionsBtn, "txRps");
  renderTpsSummaryPanels();
}

function resetGroupFilter() {
  els.groupFilter.value = "";
  state.groupFilter = "";
  if (!state.data) return;
  const transactions = buildTransactions();
  renderTable(transactions, els.txBody, els.showAllTransactionsBtn, "tx");
  renderTable(state.rpsTransactions, els.txRpsBody, els.showAllRpsTransactionsBtn, "txRps");
  renderTpsSummaryPanels();
}

async function resetTimeFilter() {
  if (!state.data) return;
  const duration = state.data.result.scenario.durationSeconds || 0;
  els.startTime.value = "00:00:00";
  els.endTime.value = formatHms(duration);
  state.appliedStart = 0;
  state.appliedEnd = duration;
  try {
    await refreshDashboardData();
    renderAll();
  } catch (error) {
    els.status.textContent = error.message;
    els.status.className = STATUS_ERR;
  }
}

function syncToolbarHeight() {
  const toolbar = document.getElementById("toolbar");
  if (!toolbar) return;
  document.documentElement.style.setProperty("--toolbar-height", `${toolbar.offsetHeight + 16}px`);
}

function initScrollspy() {
  const navLinks = document.querySelectorAll(".sidebar-nav a");
  const sections = [...navLinks].map((a) => document.getElementById(a.dataset.navTarget)).filter(Boolean);
  const linkByTarget = new Map([...navLinks].map((a) => [a.dataset.navTarget, a]));

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      navLinks.forEach((a) => a.classList.remove("active"));
      linkByTarget.get(entry.target.id)?.classList.add("active");
    }
  }, { rootMargin: "-10% 0px -75% 0px", threshold: 0 });

  sections.forEach((section) => observer.observe(section));

  navLinks.forEach((a) => {
    a.addEventListener("click", (event) => {
      event.preventDefault();
      document.getElementById(a.dataset.navTarget)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function updateSortIndicators() {
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    const tableKey = th.closest("[data-table]")?.dataset.table;
    const sort = tableKey ? state.sort[tableKey] : null;
    const indicator = th.querySelector(".sort-indicator");
    if (!indicator) return;
    indicator.textContent = sort && sort.key === th.dataset.sort ? (sort.dir === "asc" ? "▲" : "▼") : "";
  });
}

function getTableRows(tableKey) {
  switch (tableKey) {
    case "tx": return buildTransactions();
    case "txRps": return state.rpsTransactions;
    case "tpsSummary": return getTpsSummaryModeRows();
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

function redrawCharts() {
  if (!state.data) return;
  const duration = state.data.result.scenario.durationSeconds || 0;
  renderCharts(buildTransactions(), state.appliedStart, state.appliedEnd || duration);
}

function onTpsSummaryModeChange() {
  state.tpsSummaryMode = els.tpsSummaryMode.value;
  state.sort.tpsSummary = { key: state.tpsSummaryMode === "transaction" ? "name" : "groupName", dir: "asc" };
  renderTpsSummaryPanels();
  updateSortIndicators();
}

function initSortableTables() {
  document.addEventListener("click", (event) => {
    const th = event.target.closest("th[data-sort]");
    if (!th) return;
    const tableKey = th.closest("[data-table]")?.dataset.table;
    const current = tableKey ? state.sort[tableKey] : null;
    if (!current) return;
    const sortKey = th.dataset.sort;
    const dir = current.key === sortKey && current.dir === "asc" ? "desc" : "asc";
    state.sort[tableKey] = { key: sortKey, dir };
    updateSortIndicators();
    if (state.data) renderAll();
    refreshOpenModals();
  });
}

els.loadBtn.addEventListener("click", loadResult);
els.resultPath.addEventListener("keydown", (e) => { if (e.key === "Enter") loadResult(); });
els.themeToggle.addEventListener("click", toggleTheme);
els.applyTpsGranularityBtn.addEventListener("click", applyTpsGranularity);
els.resetTpsGranularityBtn.addEventListener("click", resetTpsGranularity);
els.applyTimeBtn.addEventListener("click", applyTimeFilter);
els.resetTimeBtn.addEventListener("click", resetTimeFilter);
els.applyGroupFilterBtn.addEventListener("click", applyGroupFilter);
els.resetGroupFilterBtn.addEventListener("click", resetGroupFilter);
els.showAllTransactionsBtn.addEventListener("click", () => openTransactionModal(els, buildTransactions(), "All Transactions", "tx"));
els.showAllRpsTransactionsBtn.addEventListener("click", () => openTransactionModal(els, state.rpsTransactions, "All Transactions (RPS_)", "txRps"));
els.closeTransactionModalBtn.addEventListener("click", () => closeTransactionModal(els));
els.transactionModal.addEventListener("click", (event) => {
  if (event.target === els.transactionModal) closeTransactionModal(els);
});
els.showAllTpsTransactionsBtn.addEventListener("click", () => openTpsModal(els, getTpsSummaryModeRows(), TPS_SUMMARY_LABELS[state.tpsSummaryMode], "tpsSummary", state.tpsSummaryMode));
els.tpsSummaryMode.addEventListener("change", onTpsSummaryModeChange);
els.closeTpsModalBtn.addEventListener("click", () => closeTpsModal(els));
els.tpsModal.addEventListener("click", (event) => {
  if (event.target === els.tpsModal) closeTpsModal(els);
});
els.groupFilter.addEventListener("keydown", (e) => { if (e.key === "Enter") applyGroupFilter(); });
window.addEventListener("resize", () => renderAll());
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chart-action]");
  if (!button) return;
  const panel = button.closest(".chart-panel");
  if (!panel) return;

  if (button.dataset.chartAction === "download") {
    downloadChartPng(panel);
  } else if (button.dataset.chartAction === "expand") {
    toggleExpandPanel(panel, button);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!els.transactionModal.hidden) closeTransactionModal(els);
  else if (!els.tpsModal.hidden) closeTpsModal(els);
  else closeExpandedPanel();
});
["responseTime", "responseTimeApi", "siteScopeCpu", "siteScopeMemory"].forEach((key) => {
  configureChartSelector(
    key,
    () => chartAllSeries[key]?.map((s) => s.name) ?? [],
    () => state.chartSelections[key] ?? [],
    (selected) => { state.chartSelections[key] = selected; redrawCharts(); },
  );
});

setupChartPanelActions();
applyTheme(localStorage.getItem("loadrunnerTheme") === "dark" ? "dark" : "light");
els.resultPath.value = localStorage.getItem("loadrunnerLastPath") || "";
syncToolbarHeight();
new ResizeObserver(syncToolbarHeight).observe(document.getElementById("toolbar"));
initSortableTables();
updateSortIndicators();
initScrollspy();
