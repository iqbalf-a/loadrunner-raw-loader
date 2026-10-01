import { state, sortRows, resolveGroup, buildTransactions, DEFAULT_TPS_FILTERS } from "./state.js";
import { escapeHtml, formatHms, formatClockAt } from "./format.js";
import {
  drawMultiLineChart,
  transactionSeries,
  setupChartPanelActions,
  refreshSeriesToolbars,
  refreshExpandedChartSelector,
  seriesSearchQuery,
} from "./charts.js";
import {
  renderMetrics,
  renderTable,
  renderTransactionRows,
  renderTpsSummaryTable,
  renderTpsOverall,
  updateTpsGranularityHeaders,
  openTransactionModal,
  openTpsModal,
  filterByGroup,
} from "./tables.js";
import { renderSiteScopeMetric, CPU_PATTERN, MEMORY_PATTERN } from "./sitescope.js";
import { renderLgHealthTable, renderLgHealthChart } from "./lgmonitor.js";
import { renderErrors, initErrorPanel } from "./errors.js";

// Jumlah seri maksimum yang diambil dari server per panel. Dipakai juga untuk membungkus baris
// "top N of M by volume" di judul panel.
export const SERIES_MAX = 50;

const rangeText = (start, end) => `${formatHms(start)} - ${formatHms(end)}`;

// init() dipanggil ulang pada DOM yang sama setiap kali data atau filter berubah, bukan hanya saat
// halaman diganti. Jadi listener dipasang per node, sekali seumur umur node itu: node baru dari
// template baru selalu datang tanpa penanda, node lama tidak pernah.listener-nya dikumpulkan dua kali.
function bindOnce(node, handler) {
  if (!node || node.dataset.wired) return;
  node.dataset.wired = "true";
  node.addEventListener("click", handler);
}

// Template halaman memakai id yang sama persis dengan section yang dulu ada di index.html, jadi
// renderer di tables.js/sitescope.js/lgmonitor.js/errors.js tidak perlu tahu soal halaman.

// ── Potongan markup yang diulang antar halaman ──────────────────────────────────────────────────
// Tiap halaman adalah template HTML yang sama persis dengan section yang dulu ada di index.html:
// kelas, id, data-chart-selector, data-tps-filter, dan data-table harus tetap sama supaya renderer
// di tables.js/sitescope.js/lgmonitor.js tidak perlu tahu soal halaman.

const thSorted = (key, label, align = "right") => `<th class="px-3.5 py-2.5 border-b border-(--line) text-${align} text-(--chart-text) text-[10.5px] tracking-[0.08em] uppercase whitespace-nowrap cursor-pointer select-none" data-sort="${key}">${label} <span class="sort-indicator text-(--signal)"></span></th>`;

// Min/Max TPS ikut lebar bucket, jadi headernya membawa tag granularity. Avg TPS tidak.
const thGrained = (key, label) => `<th class="px-3.5 py-2.5 border-b border-(--line) text-right text-(--chart-text) text-[10.5px] tracking-[0.08em] uppercase whitespace-nowrap cursor-pointer select-none" data-sort="${key}">${label} <span data-granularity-suffix class="muted normal-case"></span> <span class="sort-indicator text-(--signal)"></span></th>`;

const thPlain = (label, { align = "right", grain = false } = {}) => `<th class="px-3.5 py-2.5 border-b border-(--line) text-${align} text-(--chart-text) text-[10.5px] tracking-[0.08em] uppercase whitespace-nowrap">${label}${grain ? ' <span data-granularity-suffix class="muted normal-case"></span>' : ""}</th>`;

const tpsHead = (columns) => `<tr>${columns
  .map(([key, label, align = "right"]) => (key === "minTps" || key === "maxTps" ? thGrained(key, label) : thSorted(key, label, align)))
  .join("")}</tr>`;

const TX_COLUMNS = [
  ["name", "Transaction", "left"], ["groupName", "Group", "left"],
  ["min", "Min (s)"], ["avg", "Avg (s)"], ["max", "Max (s)"],
  ["stdDeviation", "Std Deviation (s)"], ["percentile90", "P90 (s)"],
  ["percentile95", "P95 (s)"], ["percentile99", "P99 (s)"],
  ["success", "Success"], ["fail", "Fail"], ["samples", "Total"],
];

const TX_HEAD = `<tr>${TX_COLUMNS.map(([key, label, align]) => thSorted(key, label, align)).join("")}</tr>`;

const TX_TPS_COLUMNS = [["name", "Transaction", "left"], ["groupName", "Group", "left"], ["minTps", "Min TPS"], ["avgTps", "Avg TPS"], ["maxTps", "Max TPS"], ["points", "Points"]];
const API_TPS_COLUMNS = [["name", "API", "left"], ["groupName", "Group", "left"], ["minTps", "Min TPS"], ["avgTps", "Avg TPS"], ["maxTps", "Max TPS"], ["points", "Points"]];
// TPS Detail: satu baris per BP group, jadi kolom namanya sudah embody group-nya.
const DETAIL_TPS_COLUMNS = [["name", "BP Group", "left"], ["minTps", "Min TPS"], ["avgTps", "Avg TPS"], ["maxTps", "Max TPS"], ["points", "Points"]];

const HOST_COLUMNS = [["host", "Host", "left"], ["min", "Min (%)"], ["avg", "Avg (%)"], ["max", "Max (%)"]];
const HOST_HEAD = `<tr>${HOST_COLUMNS.map(([key, label, align]) => thSorted(key, label, align)).join("")}</tr>`;

const LG_COLUMNS = [
  ["host", "Load Generator", "left"], ["status", "Status", "left"],
  ["cpuAvg", "CPU Avg (%)"], ["cpuMax", "CPU Max (%)"],
  ["memoryAvg", "Memory Avg (%)"], ["memoryMax", "Memory Max (%)"],
  ["diskAvg", "Disk Avg (%)"], ["diskMax", "Disk Max (%)"],
];
const LG_HEAD = `<tr>${LG_COLUMNS.map(([key, label, align]) => thSorted(key, label, align)).join("")}</tr>`;

const ERROR_COLUMNS = [
  ["scriptName", "Script", "left"], ["errorCode", "Code", "right"],
  ["apiCode", "API Code", "right"], ["apiPath", "API", "left"],
  ["message", "Message", "left"], ["count", "Count", "right"],
  ["vusers", "VUsers", "right"], ["firstIteration", "Iteration", "right"],
  ["injectors", "Injector", "left"], ["firstTime", "Time", "right"],
];

const section = (title, body) => `<section class="app-section mb-8.5"><h2 class="text-[13px] font-bold tracking-[0.02em] mb-2.5 pb-2 border-b border-(--line)">${title}</h2>${body}</section>`;

const titleRow = (inner, { bordered = false } = {}) => `<div class="panel-title flex items-center min-h-9 px-4 py-2 border-${bordered ? "y" : "b"} border-(--line) text-[11px] font-medium text-(--chart-text) tracking-[0.09em] uppercase gap-2.5" style="font-family: var(--font-mono);">${inner}</div>`;

const showAllBtn = (id) => `<button id="${id}" type="button" hidden class="panel-action-btn ml-auto h-6 px-2.25 border border-(--line) rounded-[3px] bg-(--surface-raised) text-(--chart-text) text-[10px] font-medium tracking-[0.08em] uppercase cursor-pointer" style="font-family: var(--font-mono);">Show All</button>`;

const chartWrap = (canvasId, height = "h-[320px]") => `<div class="chart-wrap ${height} px-4.5 pt-2.5 pb-3.5"><canvas id="${canvasId}" class="block w-full h-full"></canvas></div>`;

const dataTable = (attrs, head, bodyId) => `<div class="overflow-x-auto"><table ${attrs} class="w-full border-collapse text-[12.5px]" style="font-family: var(--font-mono);"><thead>${head}</thead><tbody id="${bodyId}"></tbody></table></div>`;

const plainTable = (head, bodyId, wrapper = "overflow-x-auto") => `<div class="${wrapper}"><table class="w-full border-collapse text-[12.5px]" style="font-family: var(--font-mono);"><thead>${head}</thead><tbody id="${bodyId}"></tbody></table></div>`;

const panel = (attrs, inner) => `<div ${attrs} class="panel chart-panel wide overflow-hidden border border-(--line) bg-(--surface-raised) rounded-[3px]">${inner}</div>`;

const filterPanel = (key, inner) => `<div data-tps-filter="${key}" class="panel wide overflow-hidden border border-(--line) bg-(--surface-raised) rounded-[3px]">${inner}</div>`;

// ── Chrome per halaman ──────────────────────────────────────────────────────────────────────────

export function updateSortIndicators(root = document) {
  root.querySelectorAll("th[data-sort]").forEach((th) => {
    const tableKey = th.closest("[data-table]")?.dataset.table;
    const sort = tableKey ? state.sort[tableKey] : null;
    const indicator = th.querySelector(".sort-indicator");
    if (!indicator) return;
    indicator.textContent = sort && sort.key === th.dataset.sort ? (sort.dir === "asc" ? "▲" : "▼") : "";
  });
}

// Jumlah transaksi yang lolos filter tiap panel, ditampilkan di bar filter-nya.
const TPS_FILTER_COUNTS = {
  rt: () => state.responseTimeNames.length,
  rtApi: () => state.responseTimeApiNames.length,
  tx: () => state.transactions.length,
  txRps: () => state.rpsTransactions.length,
  // TPS Detail satu baris per group, jadi yang dihitung transaksi anggota group-nya.
  tpsDetail: () => state.tpsDetailTransactions ?? 0,
  tps: () => state.tpsSummary.length,
  rps: () => state.tpsSummaryApi.length,
  tpsOverall: () => state.tpsOverall.transactions ?? 0,
  rpsOverall: () => state.rpsOverall.transactions ?? 0,
};

const FILTER_INPUT_CLASS = "w-full h-7.5 px-2.25 border border-(--line) rounded-[3px] bg-(--surface-raised) text-(--text) font-[inherit] text-[13px]";
const FILTER_LABEL_CLASS = "block text-[10px] text-(--chart-text) mb-0.75 font-medium tracking-[0.08em] uppercase";

// Bar filter disisipkan di bawah judul setiap panel bertanda data-tps-filter, supaya markup-nya
// tidak diulang di setiap halaman.
export function mountTpsFilterBars(root, applyTpsFilter) {
  root.querySelectorAll("[data-tps-filter]").forEach((host) => {
    if (host.querySelector(".tps-filter-bar")) return;
    const key = host.dataset.tpsFilter;
    const bar = document.createElement("div");
    bar.className = "tps-filter-bar flex flex-wrap items-end gap-2.5 px-4 py-2.5 border-b border-(--line)";
    bar.innerHTML = `
      <div class="min-w-55">
        <label class="${FILTER_LABEL_CLASS}" style="font-family: var(--font-mono);">Include</label>
        <input data-filter-field="include" type="text" spellcheck="false" class="${FILTER_INPUT_CLASS}" style="font-family: var(--font-mono);">
      </div>
      <div class="flex-1 min-w-65">
        <label class="${FILTER_LABEL_CLASS}" style="font-family: var(--font-mono);">Exclude</label>
        <input data-filter-field="exclude" type="text" spellcheck="false" class="${FILTER_INPUT_CLASS}" style="font-family: var(--font-mono);">
      </div>
      <button data-filter-action="apply" type="button" class="h-7.5 min-w-20.5 px-3 border border-(--signal) rounded-[3px] bg-(--signal) text-[#1c1200] font-[inherit] text-[12px] font-bold cursor-pointer">Apply</button>
      <button data-filter-action="reset" type="button" class="h-7.5 min-w-20.5 px-3 border border-(--line) rounded-[3px] bg-(--surface-raised) text-(--text) font-[inherit] text-[12px] font-medium cursor-pointer">Reset</button>
      <span data-filter-count class="h-7.5 leading-7.5 text-[11px] text-(--chart-text)" style="font-family: var(--font-mono);"></span>
      <div class="basis-full text-[11px] text-(--chart-text)" style="font-family: var(--font-mono);">Beberapa pola dipisah koma. % = wildcard, tanpa % = awalan, _ dibaca apa adanya. Ikut kalau cocok salah satu Include dan tidak cocok satu pun Exclude.</div>
    `;
    host.querySelector(".panel-title").after(bar);
    const input = (field) => bar.querySelector(`[data-filter-field="${field}"]`);
    const apply = () => applyTpsFilter(key, { include: input("include").value.trim(), exclude: input("exclude").value.trim() });
    bar.querySelector('[data-filter-action="apply"]').addEventListener("click", apply);
    bar.querySelector('[data-filter-action="reset"]').addEventListener("click", () => applyTpsFilter(key, { ...DEFAULT_TPS_FILTERS[key] }));
    bar.querySelectorAll("input").forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(); }));
  });
  syncTpsFilterBars(root);
}

export function syncTpsFilterBars(root = document) {
  root.querySelectorAll("[data-tps-filter]").forEach((host) => {
    const bar = host.querySelector(".tps-filter-bar");
    if (!bar) return;
    const key = host.dataset.tpsFilter;
    const filter = state.tpsFilters[key];
    bar.querySelector('[data-filter-field="include"]').value = filter.include;
    bar.querySelector('[data-filter-field="exclude"]').value = filter.exclude;
    bar.querySelector("[data-filter-count]").textContent = state.data ? `${TPS_FILTER_COUNTS[key]()} transaksi cocok` : "";
  });
}

// Dipanggil setelah isi halaman dirender: tombol Expand/PNG, toolbar centang seri, bar filter
// Include/Exclude, tag granularity, dan indikator sort semuanya menempel di markup yang baru dibuat
// template. Urutannya penting: refreshSeriesToolbars() mencentang checkbox di tbody, jadi isi
// tabelnya harus sudah terisi.
function finishPage(ctx) {
  const { outlet } = ctx;
  setupChartPanelActions();
  mountTpsFilterBars(outlet, ctx.applyTpsFilter);
  updateTpsGranularityHeaders();
  updateSortIndicators(outlet);
  refreshSeriesToolbars();
  // Panel yang sedang di-expand harus memunculkan kembali daftar serinya.
  for (const key of new Set([...outlet.querySelectorAll("[data-chart-selector]")].map((p) => p.dataset.chartSelector))) {
    refreshExpandedChartSelector(key);
  }
}

// "top 50 of 812 by volume" -- hanya perlu ditampilkan kalau server benar-benar memotong daftar seri.
function seriesCountHint(key) {
  const total = state.seriesTotals[key] ?? 0;
  return total > SERIES_MAX ? `(top ${Math.min(total, SERIES_MAX)} of ${total} by volume)` : "";
}

// ── Halaman ─────────────────────────────────────────────────────────────────────────────────────
// init(ctx) boleh dipanggil berulang, jadi isinya harus idempoten dan tidak boleh bergantung pada
// elemen halaman lain. ctx: { outlet, els, range, applySelection, seriesFromFlatRows, applyTpsFilter, setStatus }

// Overview tetap landing page: grid info + kartu metrik. Grafik VUsers punya panel sendiri karena
// grafik, bukan ringkasan info.
const overview = {
  key: "overview",
  title: "Overview",
  template: () => section("Overview", `
    <div id="scenarioInfo" class="grid gap-3 mb-3" style="grid-template-columns: repeat(2, minmax(260px, 1fr));"></div>
    <div id="rangeInfo" class="grid gap-3 mb-3" style="grid-template-columns: repeat(2, minmax(260px, 1fr));"></div>
    <div id="metrics" class="grid gap-3" style="grid-template-columns: repeat(5, minmax(140px, 1fr));"></div>
  `),
  init(ctx) {
    const { outlet, range } = ctx;
    const { start, end } = range();
    const scenario = state.data?.result?.scenario;
    const duration = scenario?.durationSeconds || 0;
    const isAllRange = start === 0 && Math.round(end) === Math.round(duration);

    const chip = (label, value, sub, changed = false) => `
      <div class="range-chip${changed ? " changed" : ""} border border-(--line) border-l-2 bg-(--surface-raised) rounded-[3px] p-[12px_14px]">
        <div class="text-[11px] text-(--chart-text) font-medium tracking-[0.08em] uppercase" style="font-family: var(--font-mono);">${label}</div>
        <div class="mt-1.5 text-[15px] text-(--text) font-medium tracking-[0.02em]" style="font-family: var(--font-mono);">${value}</div>
        ${sub ? `<div class="mt-1 text-(--chart-text) text-[11px]" style="font-family: var(--font-mono);">${sub}</div>` : ""}
      </div>`;

    outlet.querySelector("#scenarioInfo").innerHTML = scenario
      ? chip("Project", escapeHtml(scenario.companyName || "-"), scenario.runDate ? escapeHtml(scenario.runDate) : "")
        + chip("Scenario", escapeHtml(scenario.sessionName || "-"), "")
      : "";
    outlet.querySelector("#rangeInfo").innerHTML = scenario
      ? chip("All Range", rangeText(0, duration), `${formatClockAt(0)} - ${formatClockAt(duration)}`)
        + chip(isAllRange ? "Filtered Range: All selected" : "Filtered Range", rangeText(start, end), `${formatClockAt(start)} - ${formatClockAt(end)}`, !isAllRange)
      : "";

    renderMetrics(outlet.querySelector("#metrics"), buildTransactions(), start, end);
    finishPage(ctx);
  },
};

const vusers = {
  key: "vusers",
  title: "VUsers Overall",
  template: () => section("VUsers Overall (Chart)", panel("", `
    ${titleRow("VUsers Overall (Chart)")}
    ${chartWrap("vusersChart")}
  `)),
  init(ctx) {
    const { outlet, range } = ctx;
    const { start, end } = range();
    drawMultiLineChart(
      outlet.querySelector("#vusersChart"),
      transactionSeries("es_tr_runtime_vusers", start, end, (rows) => rows.map((row) => ({ x: row.elapsedSeconds, y: row.value }))),
      start,
      end,
    );
    finishPage(ctx);
  },
};

// Tabel BP dan RPS_ dipisah jadi dua halaman karena keduanya punya baris, filter, dan tombol Show
// All sendiri meski markup-nya sama.
const transactionsPage = ({ key, menu, label, tableKey, filterKey, bodyId, btnId, rows, modalTitle, showRange }) => ({
  key,
  title: menu,
  template: () => section(label, filterPanel(filterKey, `
    ${titleRow(`<span>${label}</span>${showRange ? `<span id="rangeLabel" class="muted"></span>` : ""}${showAllBtn(btnId)}`)}
    ${dataTable(`data-table="${tableKey}"`, TX_HEAD, bodyId)}
  `)),
  init(ctx) {
    const { outlet, range, els: shell } = ctx;
    const { start, end } = range();
    const rangeLabel = outlet.querySelector("#rangeLabel");
    if (rangeLabel) rangeLabel.textContent = `Filtered: ${rangeText(start, end)}`;
    const all = rows();
    const btn = outlet.querySelector(`#${btnId}`);
    renderTable(all, outlet.querySelector(`#${bodyId}`), btn, tableKey);
    bindOnce(btn, () => openTransactionModal(shell, all, modalTitle, tableKey));
    finishPage(ctx);
  },
});

const transactions = transactionsPage({
  key: "transactions",
  menu: "Transactions Summary (BP)",
  label: "Transactions Summary (BP) (Table)",
  tableKey: "tx",
  filterKey: "tx",
  bodyId: "txBody",
  btnId: "showAllTransactionsBtn",
  rows: () => buildTransactions(),
  modalTitle: "All Transactions (BP)",
  showRange: true,
});

const transactionsRps = transactionsPage({
  key: "transactions-rps",
  menu: "Transactions Summary (RPS_)",
  label: "Transactions Summary (RPS_) (Table)",
  tableKey: "txRps",
  filterKey: "txRps",
  bodyId: "txRpsBody",
  btnId: "showAllRpsTransactionsBtn",
  rows: () => state.rpsTransactions,
  modalTitle: "All Transactions (RPS_)",
  showRange: false,
});

// Peringkat avg response time per nama, dipakai tombol Top 10/30/50 di panel response time.
export function rtRankNames(key) {
  return (names) => {
    const rows = state.rtTableRows[key] ?? [];
    const byName = new Map(rows.map((row) => [row.name, row.avg ?? 0]));
    return [...names].sort((a, b) => (byName.get(b) ?? 0) - (byName.get(a) ?? 0));
  };
}

// Tabel di bawah grafik response time: daftar kandidat seri panel itu, satu baris per transaksi,
// dengan centang di kolom pertama yang menentukan seri mana yang digambar. Kandidatnya SELURUH nama
// yang lolos filter panel, bukan cuma top-N yang sudah digambar, supaya transaksi seperti BP195 yang
// total response time-nya kecil tetap bisa difilter group dan dicentang. Grafik tetap hanya
// menggambar SERIES_MAX seri, jadi tabel boleh lebih panjang dari grafik.
const RT_TABLES = [
  { key: "responseTime", filterKey: "rt", body: "rtBody", btn: "showAllRtBtn", count: "seriesCountRt", tableKey: "rtTable", label: "Response Time By Transaction", chart: "transactionRtChart", names: () => state.responseTimeNames, series: () => state.responseTimeRows },
  { key: "responseTimeApi", filterKey: "rtApi", body: "rtApiBody", btn: "showAllRtApiBtn", count: "seriesCountRtApi", tableKey: "rtApiTable", label: "Response Time By API", chart: "transactionRtApiChart", names: () => state.responseTimeApiNames, series: () => state.responseTimeApiRows },
];

const rtTableRequests = new Map();
// Peringkat total response time per panel, diisi dari respons server di updateRtTables.
const rtVolumeRank = { responseTime: new Map(), responseTimeApi: new Map() };

function renderRtTable(ctx, spec) {
  const { outlet, els: shell } = ctx;
  // Urutan baris = peringkat total response time terbesar dulu, bukan urutan centang. Peringkat
  // ini ikut dari server, karena tabel sekarang memuat semua kandidat seri panel -- bukan cuma
  // top-N yang sudah digambar -- jadi `chartAllSeries` tidak bisa lagi jadi acuan urutan.
  const order = new Map([...rtVolumeRank[spec.key].keys()].map((name, index) => [name, index]));
  const allRows = filterByGroup(state.rtTableRows[spec.key], "transaction")
    .sort((a, b) => (order.get(a.name) ?? Infinity) - (order.get(b.name) ?? Infinity));
  const query = seriesSearchQuery(spec.key);
  // Default: tampilkan semua baris. Kalau ada query search: tampilkan semua yang cocok.
  const tbody = outlet.querySelector(`#${spec.body}`);
  tbody.innerHTML = allRows.length
    ? renderTransactionRows(sortRows(allRows, state.sort[spec.tableKey]), tbody)
    : `<tr><td colspan="13" class="px-3.5 py-3 text-left muted">${query ? `Tidak ada transaksi yang cocok dengan "${query}".` : "Belum ada data response time di rentang ini."}</td></tr>`;

  const btn = outlet.querySelector(`#${spec.btn}`);
  btn.hidden = allRows.length === 0;
  btn.textContent = `Show All (${allRows.length})`;
  bindOnce(btn, () => openTransactionModal(shell, filterByGroup(state.rtTableRows[spec.key], "transaction"), spec.label, spec.tableKey));

  const count = outlet.querySelector(`#${spec.count}`);
  if (count) count.textContent = seriesCountHint(spec.key);
}

// Statistik diambil dari server hanya kalau daftar nama kandidat atau rentang waktunya berubah;
// render ulang biasa (resize, ganti tema, sort) cukup memakai baris yang sudah ada.
// Gunakan POST + body JSON (include/exclude) agar tidak kelewat batas URL seperti GET ?names=...
// Key RT_TABLES ("responseTime", "responseTimeApi") != key DEFAULT_TPS_FILTERS ("rt", "rtApi").
// Hanya spec halaman aktif yang diambil: by transaction dan by API sudah jadi halaman terpisah,
// jadi tidak perlu query keduanya setiap kali salah satunya dirender.
async function updateRtTable(ctx, spec, render) {
  if (!state.data) return;
  const duration = state.data.result.scenario.durationSeconds || 0;
  const filter = state.tpsFilters[spec.filterKey];
  const body = {
    session: state.data.session,
    start: state.appliedStart,
    end: state.appliedEnd || duration,
    offset: 0,
    limit: 0,
    order: "volume",
    namePrefix: "",
    nameFilter: filter ? { include: filter.include, exclude: filter.exclude } : null,
  };
  const requestKey = JSON.stringify(body);
  if (rtTableRequests.get(spec.key) === requestKey) {
    render();
    return;
  }
  rtTableRequests.set(spec.key, requestKey);
  try {
    const response = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Response time table query failed");
    // Respons yang datang terlambat untuk pilihan lama dibuang.
    if (rtTableRequests.get(spec.key) !== requestKey) return;
    rtVolumeRank[spec.key] = new Map(payload.rows.map((tx, index) => [tx.name, index]));
    state.rtTableRows[spec.key] = payload.rows.map((tx) => ({ ...tx, groupName: resolveGroup(tx.name) }));
  } catch (error) {
    rtTableRequests.delete(spec.key);
    rtVolumeRank[spec.key] = new Map();
    state.rtTableRows[spec.key] = [];
    ctx.setStatus(error.message, true);
  }
  render();
}

// Response time by transaction dan by API dipisah jadi dua halaman: keduanya memakai panel dan
// tabel yang sama persis, yang berbeda hanya nama serinya dan titik endpointnya.
const rtPage = ({ key, menu, spec }) => ({
  key,
  title: menu,
  template: () => section(spec.label, panel(`data-chart-selector="${spec.key}" data-tps-filter="${spec.filterKey}"`, `
    ${titleRow(`<span>${spec.label}</span><span id="${spec.count}" class="muted"></span>${showAllBtn(spec.btn)}`)}
    ${chartWrap(spec.chart)}
    ${dataTable(`data-table="${spec.tableKey}"`, TX_HEAD, spec.body)}
  `)),
  async init(ctx) {
    const { outlet, range, applySelection, seriesFromFlatRows } = ctx;
    const { start, end } = range();
    drawMultiLineChart(outlet.querySelector(`#${spec.chart}`), applySelection(spec.key, seriesFromFlatRows(spec.series() ?? [])), start, end);
    await updateRtTable(ctx, spec, () => renderRtTable(ctx, spec));
    finishPage(ctx);
  },
});

const responseTimeTx = rtPage({ key: "response-time", menu: "Response Time By Transaction", spec: RT_TABLES[0] });
const responseTimeApi = rtPage({ key: "response-time-api", menu: "Response Time By API", spec: RT_TABLES[1] });

// Panel TPS per transaksi, satu baris per transaksi, dan TPS Detail satu baris per BP group -- jadi
// filter group name-nya sudah melekat di kolom name-nya.
const TPS_PANELS = [
  { key: "tpsTransaction", rows: () => state.tpsSummary, series: () => state.tpsSeriesRows, body: "tpsBody", btn: "showAllTpsTransactionsBtn", tableKey: "tpsSummary", mode: "transaction", label: "TPS (Chart + Table)", count: "seriesCountTps" },
  { key: "tpsDetail", rows: () => state.tpsDetail, series: () => state.tpsDetailSeriesRows, body: "tpsDetailBody", btn: "showAllTpsDetailBtn", tableKey: "tpsDetail", mode: "detail", label: "TPS Detail (Chart + Table)", count: "seriesCountTpsDetail" },
];

// Panel TPS per API (prefix RPS_) milik halaman RPS, bukan halaman TPS: metriknya diukur per API,
// bukan per transaksi.
const RPS_PANELS = [
  { key: "tpsApi", rows: () => state.tpsSummaryApi, series: () => state.tpsApiSeriesRows, body: "tpsApiBody", btn: "showAllTpsApiBtn", tableKey: "tpsSummaryApi", mode: "api", label: "RPS (Chart + Table)", count: "seriesCountTpsApi" },
];

// Grafik dulu untuk semua panel, baru tabelnya: centang di kolom tabel ikut pilihan seri, jadi
// tabel harus digambar setelah applySelection() menentukan default seri teratasnya.
function renderTpsPanels(ctx, specs, canvasIds) {
  const { outlet, applySelection, seriesFromFlatRows, els: shell, range } = ctx;
  const { start, end } = range();
  specs.forEach((spec, index) => {
    drawMultiLineChart(outlet.querySelector(`#${canvasIds[index]}`), applySelection(spec.key, seriesFromFlatRows(spec.series() ?? [])), start, end);
  });
  for (const spec of specs) {
    const tbody = outlet.querySelector(`#${spec.body}`);
    const btn = outlet.querySelector(`#${spec.btn}`);
    const rows = spec.rows();
    renderTpsSummaryTable(rows, tbody, btn, spec.tableKey, spec.mode);
    bindOnce(btn, () => openTpsModal(shell, rows, spec.label, spec.tableKey, spec.mode));
    const count = outlet.querySelector(`#${spec.count}`);
    if (count) count.textContent = seriesCountHint(spec.key);
  }
}

const overallPanel = (label, grain, canvasId, bodyId, filterKey) => `
  <div data-chart-table="${filterKey}" data-tps-filter="${filterKey}" class="panel chart-panel wide overflow-hidden border border-(--line) bg-(--surface-raised) rounded-[3px]">
    ${titleRow(`<span>${label}</span>`)}
    ${chartWrap(canvasId)}
    ${plainTable(`<tr>${thPlain(`Min ${grain}`, { grain: true })}${thPlain(`Avg ${grain}`)}${thPlain(`Max ${grain}`, { grain: true })}${thPlain("Points")}</tr>`, bodyId)}
  </div>`;

const tps = {
  key: "tps",
  title: "TPS",
  template: () => section("TPS (Chart + Table)", panel('data-chart-selector="tpsTransaction" data-tps-filter="tps"', `
    ${titleRow(`<span>TPS (Chart + Table)</span><span id="tpsGranularityLabel" class="muted"></span><span id="seriesCountTps" class="muted"></span>${showAllBtn("showAllTpsTransactionsBtn")}`)}
    ${chartWrap("tpsChart")}
    ${dataTable(`data-table="tpsSummary"`, tpsHead(TX_TPS_COLUMNS), "tpsBody")}
  `)),
  init(ctx) {
    const { outlet } = ctx;
    outlet.querySelector("#tpsGranularityLabel").textContent = `${state.appliedTpsGranularity}s bucket`;
    renderTpsPanels(ctx, [TPS_PANELS[0]], ["tpsChart"]);
    finishPage(ctx);
  },
};

// Satu halaman satu panel: TPS Detail (per BP group) dipisah dari TPS (per transaksi) karena
// kolom name-nya berisi group name, bukan nama transaksi.
const tpsDetail = {
  key: "tps-detail",
  title: "TPS Detail",
  template: () => section("TPS Detail (Chart + Table)", panel('data-chart-selector="tpsDetail" data-tps-filter="tpsDetail"', `
    ${titleRow(`<span>TPS Detail (Chart + Table)</span><span id="seriesCountTpsDetail" class="muted"></span>${showAllBtn("showAllTpsDetailBtn")}`)}
    ${chartWrap("tpsDetailChart")}
    ${dataTable(`data-table="tpsDetail"`, tpsHead(DETAIL_TPS_COLUMNS), "tpsDetailBody")}
  `)),
  init(ctx) {
    renderTpsPanels(ctx, [TPS_PANELS[1]], ["tpsDetailChart"]);
    finishPage(ctx);
  },
};

const tpsOverall = {
  key: "tps-overall",
  title: "TPS Overall",
  template: () => section("TPS Overall (Chart + Table)", overallPanel("TPS Overall (Chart + Table)", "TPS", "tpsOverallChart", "tpsOverallBody", "tpsOverall")),
  init(ctx) {
    const { outlet, range } = ctx;
    const { start, end } = range();
    drawMultiLineChart(outlet.querySelector("#tpsOverallChart"), [{
      name: "Overall TPS",
      color: "#00bf8f",
      points: (state.tpsOverallSeriesRows ?? []).map((row) => ({ x: row.elapsedSeconds, y: row.value })),
    }], start, end);
    renderTpsOverall(outlet.querySelector("#tpsOverallBody"), state.tpsOverall);
    finishPage(ctx);
  },
};

const rps = {
  key: "rps",
  title: "RPS",
  template: () => section("RPS (Chart + Table)", panel('data-chart-selector="tpsApi" data-tps-filter="rps"', `
    ${titleRow(`<span>RPS (Chart + Table)</span><span id="seriesCountTpsApi" class="muted"></span>${showAllBtn("showAllTpsApiBtn")}`)}
    ${chartWrap("tpsApiChart")}
    ${dataTable(`data-table="tpsSummaryApi"`, tpsHead(API_TPS_COLUMNS), "tpsApiBody")}
  `)),
  init(ctx) {
    renderTpsPanels(ctx, RPS_PANELS, ["tpsApiChart"]);
    finishPage(ctx);
  },
};

const rpsOverall = {
  key: "rps-overall",
  title: "RPS Overall",
  template: () => section("RPS Overall (Chart + Table)", overallPanel("RPS Overall (Chart + Table)", "RPS", "rpsOverallChart", "rpsOverallBody", "rpsOverall")),
  init(ctx) {
    const { outlet, range } = ctx;
    const { start, end } = range();
    drawMultiLineChart(outlet.querySelector("#rpsOverallChart"), [{
      name: "Overall RPS",
      color: "#2f7df6",
      points: (state.rpsOverallSeriesRows ?? []).map((row) => ({ x: row.elapsedSeconds, y: row.value })),
    }], start, end);
    renderTpsOverall(outlet.querySelector("#rpsOverallBody"), state.rpsOverall);
    finishPage(ctx);
  },
};

const SITE_SCOPE_BUTTON = (id, label) => `<button id="${id}" type="button" hidden class="panel-action-btn h-6 px-2.25 border border-(--line) rounded-[3px] bg-(--surface-raised) text-(--chart-text) text-[10px] font-medium tracking-[0.08em] uppercase cursor-pointer" style="font-family: var(--font-mono);">Show All</button>`;

// CPU dan Memory dipisah jadi dua halaman, jadi keduanya dibuat dari factory yang sama: selector
// seri, pattern, dan kunci state untuk tiap metrik hanya berbeda di parameter ini.
const siteScopePage = ({ key, menu, title, selector, pattern, chartId, bodyId, btnId, modalTitle, stateKey }) => ({
  key,
  title: menu,
  template: () => section(title, `<div class="panel overflow-hidden border border-(--line) bg-(--surface-raised) rounded-[3px]">
    <div class="chart-panel" data-chart-selector="${selector}">
      ${titleRow(`<span>${title}</span>${SITE_SCOPE_BUTTON(btnId)}`)}
      ${chartWrap(chartId, "h-[235px]")}
      ${dataTable(`data-table="${selector}"`, HOST_HEAD, bodyId)}
    </div>
  </div>`),
  init(ctx) {
    const { outlet, range, applySelection, els: shell } = ctx;
    const { start, end } = range();
    const showAllBtn = outlet.querySelector(`#${btnId}`);
    renderSiteScopeMetric(selector, pattern, {
      chart: outlet.querySelector(`#${chartId}`),
      body: outlet.querySelector(`#${bodyId}`),
      showAllBtn,
    }, start, end, applySelection);
    bindOnce(showAllBtn, () => openTpsModal(shell, state[stateKey], modalTitle, selector, "sitescope"));
    finishPage(ctx);
  },
});

const siteScopeCpu = siteScopePage({
  key: "infrastructure-cpu",
  menu: "SiteScope CPU",
  title: "SiteScope CPU Overall (Chart + Table)",
  selector: "siteScopeCpu",
  pattern: CPU_PATTERN,
  chartId: "siteScopeCpuChart",
  bodyId: "siteScopeCpuBody",
  btnId: "showAllSiteScopeCpuBtn",
  modalTitle: "SiteScope CPU Overall",
  stateKey: "siteScopeCpuRows",
});

const siteScopeMemory = siteScopePage({
  key: "infrastructure-memory",
  menu: "SiteScope Memory",
  title: "SiteScope Memory Overall (Chart + Table)",
  selector: "siteScopeMemory",
  pattern: MEMORY_PATTERN,
  chartId: "siteScopeMemoryChart",
  bodyId: "siteScopeMemoryBody",
  btnId: "showAllSiteScopeMemoryBtn",
  modalTitle: "SiteScope Memory Overall",
  stateKey: "siteScopeMemoryRows",
});

const lgHealth = {
  key: "lg-health",
  title: "Load Generator Summary",
  template: () => section("Load Generator Summary (Table)", `<div class="panel overflow-hidden border border-(--line) bg-(--surface-raised) rounded-[3px]">
    ${titleRow(`<span>Load Generator Summary (Table)</span><span class="muted normal-case">Status "Periksa" jika Max CPU atau Memory &ge; 80%</span>`)}
    ${dataTable(`data-table="lgHealth"`, LG_HEAD, "lgHealthBody")}
  </div>`),
  init(ctx) {
    const { outlet, range } = ctx;
    const { start, end } = range();
    renderLgHealthTable({ lgHealthBody: outlet.querySelector("#lgHealthBody") }, start, end);
    finishPage(ctx);
  },
};

// Tiga metrik load generator dipisah per halaman: masing-masing satu canvas, satu seri yang dipilih,
// satu toolbar centang, dan tabel Avg/Max milik metrik itu saja. Tabelnya diturunkan dari baris
// ringkasan yang sama, jadi tidak ada request tambahan.
const lgChartPage = ({ key, menu, label, metric, metricLabel, canvasId }) => ({
  key,
  title: menu,
  template: () => section(label, `<div class="panel overflow-hidden border border-(--line) bg-(--surface-raised) rounded-[3px]">
    <div class="chart-panel" data-chart-selector="${key}">
      ${titleRow(label)}
      ${chartWrap(canvasId, "h-[235px]")}
    </div>
    ${dataTable(`data-table="${key}"`, `<tr>${thSorted("host", "Load Generator", "left")}${thSorted("avg", `${metricLabel} Avg (%)`)}${thSorted("max", `${metricLabel} Max (%)`)}</tr>`, `${key}Body`)}
  </div>`),
  init(ctx) {
    const { outlet, range, applySelection } = ctx;
    const { start, end } = range();
    renderLgHealthChart(key, metric, {
      chart: outlet.querySelector(`#${canvasId}`),
      table: outlet.querySelector(`#${key}Body`),
    }, start, end, applySelection);
    finishPage(ctx);
  },
});

const lgCpu = lgChartPage({ key: "lg-cpu", menu: "Load Generator CPU", label: "Load Generator CPU Usage % (Chart)", metric: "cpu", metricLabel: "CPU", canvasId: "lgCpuChart" });
const lgMemory = lgChartPage({ key: "lg-memory", menu: "Load Generator Memory", label: "Load Generator Memory Usage % (Chart)", metric: "memory", metricLabel: "Memory", canvasId: "lgMemoryChart" });
const lgDisk = lgChartPage({ key: "lg-disk", menu: "Load Generator Disk", label: "Load Generator Disk Usage % (Chart)", metric: "disk", metricLabel: "Disk", canvasId: "lgDiskChart" });

const errors = {
  key: "errors",
  title: "Errors",
  template: () => section("Errors (Chart + Table)", `<div class="panel chart-panel wide overflow-hidden border border-(--line) bg-(--surface-raised) rounded-[3px]">
    ${titleRow(`<span>Errors (Chart + Table)</span><span class="muted normal-case">errors per bucket <span id="errorGranularityLabel"></span></span><span id="errorRowsLabel" class="muted normal-case"></span>`)}
    <div class="flex flex-wrap items-end gap-2.5 px-4 pt-2.5">
      <div class="flex-1 min-w-80">
        <label for="errorDbPath" class="block text-[10px] text-(--chart-text) mb-0.75 font-medium tracking-[0.08em] uppercase" style="font-family: var(--font-mono);">SqliteDb.db path (file atau folder)</label>
        <input id="errorDbPath" placeholder="C:\\path\\to\\SqliteDb.db  (kosong = cari dari folder result)" spellcheck="false" class="w-full h-7.5 px-2.25 border border-(--line) rounded-[3px] bg-(--surface-raised) text-(--text) font-[inherit] text-[13px]" style="font-family: var(--font-mono);">
      </div>
      <button id="loadErrorDbBtn" type="button" class="h-7.5 min-w-20.5 px-3 border border-(--signal) rounded-[3px] bg-(--signal) text-[#1c1200] font-[inherit] text-[12px] font-bold cursor-pointer">Load Errors</button>
    </div>
    <div class="flex flex-wrap items-end gap-2.5 px-4 py-2.5 border-b border-(--line)">
      <div class="min-w-55">
        <label for="errorScriptFilter" class="block text-[10px] text-(--chart-text) mb-0.75 font-medium tracking-[0.08em] uppercase" style="font-family: var(--font-mono);">Script</label>
        <select id="errorScriptFilter" class="w-full h-7.5 px-1.5 border border-(--line) rounded-[3px] bg-(--surface-raised) text-(--text) font-[inherit] text-[12px]" style="font-family: var(--font-mono);"><option value="">All</option></select>
      </div>
      <div class="min-w-55" style="max-width: 420px;">
        <label for="errorCodeFilter" class="block text-[10px] text-(--chart-text) mb-0.75 font-medium tracking-[0.08em] uppercase" style="font-family: var(--font-mono);">Error Code</label>
        <select id="errorCodeFilter" class="w-full h-7.5 px-1.5 border border-(--line) rounded-[3px] bg-(--surface-raised) text-(--text) font-[inherit] text-[12px]" style="font-family: var(--font-mono);"><option value="">All</option></select>
      </div>
      <div class="flex-1 min-w-55">
        <label for="errorMessageFilter" class="block text-[10px] text-(--chart-text) mb-0.75 font-medium tracking-[0.08em] uppercase" style="font-family: var(--font-mono);">Cari Pesan</label>
        <input id="errorMessageFilter" type="text" placeholder="HTTP Status-Code=500" spellcheck="false" class="w-full h-7.5 px-2.25 border border-(--line) rounded-[3px] bg-(--surface-raised) text-(--text) font-[inherit] text-[13px]" style="font-family: var(--font-mono);">
      </div>
      <div style="width: 96px;">
        <label for="errorStartTime" class="block text-[10px] text-(--chart-text) mb-0.75 font-medium tracking-[0.08em] uppercase" style="font-family: var(--font-mono);">Start</label>
        <input id="errorStartTime" placeholder="All" inputmode="numeric" class="w-full h-7.5 px-2.25 border border-(--line) rounded-[3px] bg-(--surface-raised) text-(--text) font-[inherit] text-[13px]" style="font-family: var(--font-mono);">
      </div>
      <div style="width: 96px;">
        <label for="errorEndTime" class="block text-[10px] text-(--chart-text) mb-0.75 font-medium tracking-[0.08em] uppercase" style="font-family: var(--font-mono);">End</label>
        <input id="errorEndTime" placeholder="All" inputmode="numeric" class="w-full h-7.5 px-2.25 border border-(--line) rounded-[3px] bg-(--surface-raised) text-(--text) font-[inherit] text-[13px]" style="font-family: var(--font-mono);">
      </div>
      <button id="applyErrorFilterBtn" type="button" class="h-7.5 min-w-20.5 px-3 border border-(--signal) rounded-[3px] bg-(--signal) text-[#1c1200] font-[inherit] text-[12px] font-bold cursor-pointer">Apply</button>
      <button id="resetErrorFilterBtn" type="button" class="h-7.5 min-w-20.5 px-3 border border-(--line) rounded-[3px] bg-(--surface-raised) text-(--text) font-[inherit] text-[12px] font-medium cursor-pointer">Reset</button>
    </div>
    <div id="errorInfo" class="px-4 pt-2 text-[11px] text-(--chart-text) break-all" style="font-family: var(--font-mono);">Isi path SqliteDb.db lalu klik Load Errors, atau load result untuk mencarinya otomatis.</div>
    ${chartWrap("errorsChart")}
    <div class="overflow-auto max-h-[560px]">
      <table data-table="errors" class="w-full border-collapse text-[12.5px]" style="font-family: var(--font-mono);">
        <thead><tr>${ERROR_COLUMNS.map(([key, label, align]) => thSorted(key, label, align)).join("")}</tr></thead>
        <tbody id="errorsBody"></tbody>
      </table>
    </div>
  </div>`),
  init(ctx) {
    initErrorPanel();
    renderErrors();
    finishPage(ctx);
  },
};

export const PAGES = {
  overview,
  vusers,
  transactions,
  "transactions-rps": transactionsRps,
  "response-time": responseTimeTx,
  "response-time-api": responseTimeApi,
  tps,
  "tps-detail": tpsDetail,
  "tps-overall": tpsOverall,
  rps,
  "rps-overall": rpsOverall,
  "infrastructure-cpu": siteScopeCpu,
  "infrastructure-memory": siteScopeMemory,
  "lg-health": lgHealth,
  "lg-cpu": lgCpu,
  "lg-memory": lgMemory,
  "lg-disk": lgDisk,
  errors,
};

export const DEFAULT_PAGE = "overview";
