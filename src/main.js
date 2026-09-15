import { formatHms, formatClockAt, parseHms, parsePositiveSeconds, escapeHtml } from "./format.js";
import {
  state,
  autoGranularitySeconds,
  resolveGroup,
  buildTransactions,
} from "./state.js";
import { drawMultiLineChart, transactionSeries, setupChartPanelActions, downloadChartPng, toggleExpandPanel, closeExpandedPanel, configureChartSelector, refreshExpandedChartSelector, MAX_SELECTED_SERIES } from "./charts.js";
import { renderMetrics, renderTable, renderTpsSummaryTable, renderTpsOverall, updateTpsGranularityHeaders, openTransactionModal, closeTransactionModal, openTpsModal, closeTpsModal, renderTransactionModalContent, renderTpsModalContent } from "./tables.js";
import { renderSiteScopeSection } from "./sitescope.js";
import { renderLgHealthSection } from "./lgmonitor.js";
import { refreshErrors, renderErrors, resetErrorFilter } from "./errors.js";

const SERIES_MAX = 30;

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
  scenarioInfo: document.getElementById("scenarioInfo"),
  rangeInfo: document.getElementById("rangeInfo"),
  metrics: document.getElementById("metrics"),
  txBody: document.getElementById("txBody"),
  txRpsBody: document.getElementById("txRpsBody"),
  showAllRpsTransactionsBtn: document.getElementById("showAllRpsTransactionsBtn"),
  tpsBody: document.getElementById("tpsBody"),
  showAllTpsTransactionsBtn: document.getElementById("showAllTpsTransactionsBtn"),
  tpsApiBody: document.getElementById("tpsApiBody"),
  showAllTpsApiBtn: document.getElementById("showAllTpsApiBtn"),
  tpsDetailBody: document.getElementById("tpsDetailBody"),
  showAllTpsDetailBtn: document.getElementById("showAllTpsDetailBtn"),
  tpsOverallBody: document.getElementById("tpsOverallBody"),
  tpsModal: document.getElementById("tpsModal"),
  tpsModalTitle: document.getElementById("tpsModalTitle"),
  tpsModalHead: document.getElementById("tpsModalHead"),
  tpsModalBody: document.getElementById("tpsModalBody"),
  closeTpsModalBtn: document.getElementById("closeTpsModalBtn"),
  rangeLabel: document.getElementById("rangeLabel"),
  tpsGranularityLabel: document.getElementById("tpsGranularityLabel"),
  seriesCountRt: document.getElementById("seriesCountRt"),
  seriesCountRtApi: document.getElementById("seriesCountRtApi"),
  seriesCountTps: document.getElementById("seriesCountTps"),
  seriesCountTpsApi: document.getElementById("seriesCountTpsApi"),
  seriesCountTpsDetail: document.getElementById("seriesCountTpsDetail"),
  transactionRtChart: document.getElementById("transactionRtChart"),
  transactionRtApiChart: document.getElementById("transactionRtApiChart"),
  vusersChart: document.getElementById("vusersChart"),
  tpsChart: document.getElementById("tpsChart"),
  tpsApiChart: document.getElementById("tpsApiChart"),
  tpsDetailChart: document.getElementById("tpsDetailChart"),
  tpsOverallChart: document.getElementById("tpsOverallChart"),
  siteScopeCpuChart: document.getElementById("siteScopeCpuChart"),
  siteScopeMemoryChart: document.getElementById("siteScopeMemoryChart"),
  siteScopeCpuBody: document.getElementById("siteScopeCpuBody"),
  siteScopeMemoryBody: document.getElementById("siteScopeMemoryBody"),
  lgCpuChart: document.getElementById("lgCpuChart"),
  lgMemoryChart: document.getElementById("lgMemoryChart"),
  lgDiskChart: document.getElementById("lgDiskChart"),
  lgHealthBody: document.getElementById("lgHealthBody"),
  groupFilter: document.getElementById("groupFilter"),
  applyGroupFilterBtn: document.getElementById("applyGroupFilterBtn"),
  resetGroupFilterBtn: document.getElementById("resetGroupFilterBtn"),
  showAllTransactionsBtn: document.getElementById("showAllTransactionsBtn"),
  transactionModal: document.getElementById("transactionModal"),
  transactionModalTitle: document.getElementById("transactionModalTitle"),
  transactionModalTable: document.getElementById("transactionModalTable"),
  transactionModalBody: document.getElementById("transactionModalBody"),
  closeTransactionModalBtn: document.getElementById("closeTransactionModalBtn"),
  copyTransactionModalBtn: document.getElementById("copyTransactionModalBtn"),
  tpsModalTable: document.getElementById("tpsModalTable"),
  copyTpsModalBtn: document.getElementById("copyTpsModalBtn"),
};

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

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  els.themeToggle.textContent = theme === "dark" ? "Light" : "Dark";
  localStorage.setItem("loadrunnerTheme", theme);
  if (state.data) renderAll();
  else renderErrors();
}

function toggleTheme() {
  applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
}

function renderTpsCharts(start, end) {
  els.tpsGranularityLabel.textContent = `${state.appliedTpsGranularity}s bucket`;
  drawMultiLineChart(els.tpsChart, applySelection("tpsTransaction", seriesFromFlatRows(state.tpsSeriesRows ?? [])), start, end);
  drawMultiLineChart(els.tpsApiChart, applySelection("tpsApi", seriesFromFlatRows(state.tpsApiSeriesRows ?? [])), start, end);
  drawMultiLineChart(els.tpsDetailChart, applySelection("tpsDetail", seriesFromFlatRows(state.tpsDetailSeriesRows ?? [])), start, end);
  drawMultiLineChart(els.tpsOverallChart, [{
    name: "Overall TPS",
    color: "#00bf8f",
    points: (state.tpsOverallSeriesRows ?? []).map((row) => ({ x: row.elapsedSeconds, y: row.value })),
  }], start, end);
}

function renderTpsSummaryPanels() {
  updateTpsGranularityHeaders();
  renderTpsSummaryTable(state.tpsSummary, els.tpsBody, els.showAllTpsTransactionsBtn, "tpsSummary", "transaction");
  renderTpsSummaryTable(state.tpsSummaryApi, els.tpsApiBody, els.showAllTpsApiBtn, "tpsSummaryApi", "api");
  renderTpsSummaryTable(state.tpsDetail, els.tpsDetailBody, els.showAllTpsDetailBtn, "tpsDetail", "detail");
  renderTpsOverall(els.tpsOverallBody, state.tpsOverall);
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
    applySelection("responseTime", seriesFromFlatRows(state.responseTimeRows ?? [])),
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
  renderTpsCharts(start, end);
  renderSiteScopeSection(els, start, end, applySelection);
  renderLgHealthSection(els, start, end, applySelection);
  ["responseTime", "responseTimeApi", "tpsTransaction", "tpsApi", "tpsDetail", "siteScopeCpu", "siteScopeMemory", "lgCpu", "lgMemory", "lgDisk"].forEach(refreshExpandedChartSelector);
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
  const { companyName, sessionName, runDate } = state.data.result.scenario;
  els.scenarioInfo.innerHTML = `
    <div class="range-chip border border-(--line) border-l-2 bg-(--surface-raised) rounded-[3px] p-[12px_14px]">
      <div class="text-[11px] text-(--chart-text) font-medium tracking-[0.08em] uppercase" style="font-family: var(--font-mono);">Project</div>
      <div class="mt-1.5 text-[15px] text-(--text) font-medium tracking-[0.02em]" style="font-family: var(--font-mono);">${escapeHtml(companyName || "-")}</div>
      ${runDate ? `<div class="mt-1 text-(--chart-text) text-[11px]" style="font-family: var(--font-mono);">${escapeHtml(runDate)}</div>` : ""}
    </div>
    <div class="range-chip border border-(--line) border-l-2 bg-(--surface-raised) rounded-[3px] p-[12px_14px]">
      <div class="text-[11px] text-(--chart-text) font-medium tracking-[0.08em] uppercase" style="font-family: var(--font-mono);">Scenario</div>
      <div class="mt-1.5 text-[15px] text-(--text) font-medium tracking-[0.02em]" style="font-family: var(--font-mono);">${escapeHtml(sessionName || "-")}</div>
    </div>
  `;
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
  renderErrors();
  els.status.textContent = `SESSION ${state.data.result.scenario.resultName || "RESULT"} | ${state.data.result.resultDir}`;
}

async function withLoadTimer(loadingLabel, task) {
  els.status.className = STATUS_BASE;
  const startedAt = Date.now();
  const timerInterval = setInterval(() => {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    els.status.textContent = `${loadingLabel}... ${elapsed}s`;
  }, 100);
  try {
    await task();
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
    els.status.textContent += ` | Updated in ${elapsed}s`;
  } catch (error) {
    els.status.textContent = error.message;
    els.status.className = STATUS_ERR;
  } finally {
    clearInterval(timerInterval);
  }
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
  await withLoadTimer("Applying filter", async () => {
    await refreshDashboardData();
    renderAll();
    els.status.textContent = `Filter applied: ${formatHms(start)} - ${formatHms(end)}`;
  });
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
  await withLoadTimer("Applying granularity", async () => {
    await refreshDashboardData();
    renderAll();
    els.status.textContent = `Granularity grafik applied: ${tpsGranularity}s bucket`;
  });
}

async function resetTpsGranularity() {
  if (!state.data) return;
  // Default-nya mengikuti durasi run yang sedang dibuka, bukan konstanta tetap.
  const granularity = autoGranularitySeconds(state.data.result.scenario.durationSeconds);
  els.tpsGranularity.value = String(granularity);
  state.appliedTpsGranularity = granularity;
  await withLoadTimer("Resetting granularity", async () => {
    await refreshDashboardData();
    renderAll();
    els.status.textContent = `Granularity grafik reset to auto: ${granularity}s bucket`;
  });
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
    state.appliedTpsGranularity = autoGranularitySeconds(duration);
    els.tpsGranularity.value = String(state.appliedTpsGranularity);
    resetErrorFilter();
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

function extraNamesParam(key) {
  return JSON.stringify(state.chartSelections[key] ?? []);
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
    dashboardResponse, transactionsResponse, rpsTransactionsResponse, tpsSummaryResponse, tpsSummaryApiResponse,
    responseTimeResponse, responseTimeApiResponse, tpsSeriesResponse, tpsApiSeriesResponse,
    tpsDetailSummaryResponse, tpsDetailSeriesResponse, tpsOverallResponse,
  ] = await Promise.all([
    fetch(`/api/dashboard?${params}`),
    fetch(`/api/transactions?${params}&offset=0&namePrefix=BP`),
    fetch(`/api/transactions?${params}&offset=0&namePrefix=RPS_`),
    fetch(`/api/tps-summary?${params}&offset=0&namePrefix=BP`),
    fetch(`/api/tps-summary?${params}&offset=0&namePrefix=RPS_`),
    fetch(`/api/response-time-series?${params}&namePrefix=BP&maxSeries=${SERIES_MAX}&extraNames=${encodeURIComponent(extraNamesParam("responseTime"))}`),
    fetch(`/api/response-time-series?${params}&namePrefix=RPS_&maxSeries=${SERIES_MAX}&extraNames=${encodeURIComponent(extraNamesParam("responseTimeApi"))}`),
    fetch(`/api/tps-series?${params}&namePrefix=BP&maxSeries=${SERIES_MAX}&extraNames=${encodeURIComponent(extraNamesParam("tpsTransaction"))}`),
    fetch(`/api/tps-series?${params}&namePrefix=RPS_&maxSeries=${SERIES_MAX}&extraNames=${encodeURIComponent(extraNamesParam("tpsApi"))}`),
    fetch(`/api/tps-detail-summary?${params}&namePrefix=BP`),
    fetch(`/api/tps-detail-series?${params}&namePrefix=BP&maxSeries=${SERIES_MAX}&extraNames=${encodeURIComponent(extraNamesParam("tpsDetail"))}`),
    fetch(`/api/tps-overall?${params}&namePrefix=BP`),
  ]);
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
  state.tpsSummaryApi = tpsSummaryApi.rows.map((tx) => ({ ...tx, groupName: resolveGroup(tx.name) }));
  state.responseTimeRows = responseTime.rows;
  state.responseTimeApiRows = responseTimeApi.rows;
  state.tpsSeriesRows = tpsSeries.rows;
  state.tpsApiSeriesRows = tpsApiSeries.rows;
  state.tpsDetail = tpsDetailSummary.rows;
  state.tpsDetailSeriesRows = tpsDetailSeries.rows;
  state.tpsOverall = tpsOverall;
  state.tpsOverallSeriesRows = tpsOverall.series;
  state.seriesCountByType = dashboard.seriesCountByType ?? {};
  const capHint = (total) => (total > SERIES_MAX ? `(top ${Math.min(total, SERIES_MAX)} of ${total} by volume)` : "");
  els.seriesCountRt.textContent = capHint(responseTime.total ?? 0);
  els.seriesCountRtApi.textContent = capHint(responseTimeApi.total ?? 0);
  els.seriesCountTps.textContent = capHint(tpsSeries.total ?? 0);
  els.seriesCountTpsApi.textContent = capHint(tpsApiSeries.total ?? 0);
  els.seriesCountTpsDetail.textContent = capHint(tpsDetailSeries.total ?? 0);
  await refreshErrors();
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
  await withLoadTimer("Resetting filter", async () => {
    await refreshDashboardData();
    renderAll();
    els.status.textContent = `Filter reset: ${formatHms(0)} - ${formatHms(duration)}`;
  });
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
    case "tpsSummary": return state.tpsSummary;
    case "tpsSummaryApi": return state.tpsSummaryApi;
    case "tpsDetail": return state.tpsDetail;
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
    else if (tableKey === "errors") renderErrors();
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
els.showAllTransactionsBtn.addEventListener("click", () => openTransactionModal(els, buildTransactions(), "All Transactions (BP)", "tx"));
els.showAllRpsTransactionsBtn.addEventListener("click", () => openTransactionModal(els, state.rpsTransactions, "All Transactions (RPS_)", "txRps"));
els.closeTransactionModalBtn.addEventListener("click", () => closeTransactionModal(els));
els.copyTransactionModalBtn.addEventListener("click", () => copyTableRows(els.transactionModalTable, els.copyTransactionModalBtn));
els.transactionModal.addEventListener("click", (event) => {
  if (event.target === els.transactionModal) closeTransactionModal(els);
});
els.showAllTpsTransactionsBtn.addEventListener("click", () => openTpsModal(els, state.tpsSummary, "TPS (Chart + Table)", "tpsSummary", "transaction"));
els.showAllTpsApiBtn.addEventListener("click", () => openTpsModal(els, state.tpsSummaryApi, "RPS (Chart + Table)", "tpsSummaryApi", "api"));
els.showAllTpsDetailBtn.addEventListener("click", () => openTpsModal(els, state.tpsDetail, "TPS Detail (Chart + Table)", "tpsDetail", "detail"));
els.closeTpsModalBtn.addEventListener("click", () => closeTpsModal(els));
els.copyTpsModalBtn.addEventListener("click", () => copyTableRows(els.tpsModalTable, els.copyTpsModalBtn));
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
async function ensureSeriesLoaded(key, endpoint, namePrefix, rowsField, missingNames) {
  if (!state.data) return;
  const { session, result } = state.data;
  const duration = result.scenario.durationSeconds || 0;
  const params = new URLSearchParams({
    session,
    start: String(state.appliedStart),
    end: String(state.appliedEnd || duration),
    granularity: String(state.appliedTpsGranularity),
    namePrefix,
    maxSeries: String(SERIES_MAX),
    extraNames: JSON.stringify([...(state.chartSelections[key] ?? []), ...missingNames]),
  });
  const response = await fetch(`${endpoint}?${params}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Series query failed");
  state[rowsField] = payload.rows;
}

["responseTime", "responseTimeApi", "tpsTransaction", "tpsApi", "tpsDetail", "siteScopeCpu", "siteScopeMemory", "lgCpu", "lgMemory", "lgDisk"].forEach((key) => {
  const loadedNames = () => chartAllSeries[key]?.map((s) => s.name) ?? [];
  const setSelected = (selected) => { state.chartSelections[key] = selected; redrawCharts(); };
  if (key === "responseTime") {
    configureChartSelector(key, () => state.transactions.map((t) => t.name), loadedNames, () => state.chartSelections[key] ?? [], setSelected,
      (missing) => ensureSeriesLoaded(key, "/api/response-time-series", "BP", "responseTimeRows", missing));
  } else if (key === "responseTimeApi") {
    configureChartSelector(key, () => state.rpsTransactions.map((t) => t.name), loadedNames, () => state.chartSelections[key] ?? [], setSelected,
      (missing) => ensureSeriesLoaded(key, "/api/response-time-series", "RPS_", "responseTimeApiRows", missing));
  } else if (key === "tpsTransaction") {
    configureChartSelector(key, () => state.tpsSummary.map((t) => t.name), loadedNames, () => state.chartSelections[key] ?? [], setSelected,
      (missing) => ensureSeriesLoaded(key, "/api/tps-series", "BP", "tpsSeriesRows", missing));
  } else if (key === "tpsApi") {
    configureChartSelector(key, () => state.tpsSummaryApi.map((t) => t.name), loadedNames, () => state.chartSelections[key] ?? [], setSelected,
      (missing) => ensureSeriesLoaded(key, "/api/tps-series", "RPS_", "tpsApiSeriesRows", missing));
  } else if (key === "tpsDetail") {
    configureChartSelector(key, () => state.tpsDetail.map((t) => t.name), loadedNames, () => state.chartSelections[key] ?? [], setSelected,
      (missing) => ensureSeriesLoaded(key, "/api/tps-detail-series", "BP", "tpsDetailSeriesRows", missing));
  } else {
    configureChartSelector(key, loadedNames, loadedNames, () => state.chartSelections[key] ?? [], setSelected);
  }
});

setupChartPanelActions();
applyTheme(localStorage.getItem("loadrunnerTheme") === "dark" ? "dark" : "light");
els.resultPath.value = localStorage.getItem("loadrunnerLastPath") || "";
syncToolbarHeight();
new ResizeObserver(syncToolbarHeight).observe(document.getElementById("toolbar"));
initSortableTables();
updateSortIndicators();
initScrollspy();
