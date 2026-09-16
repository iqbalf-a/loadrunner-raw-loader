import { formatHms, formatClockAt, parseHms, escapeHtml, fmtNumber } from "./format.js";
import { state, sortRows } from "./state.js";
import { drawMultiLineChart } from "./charts.js";
import { newProgressToken, startLoadingOverlay, finishLoadingOverlay, setProgress } from "./progress.js";

const COLORS = ["#ff416d", "#2f7df6", "#00bf8f", "#8b5cf6", "#11c5e5", "#a56b00"];
// Di atas batas ini bucket kosong tidak diisi nol, supaya chart tidak menggambar puluhan ribu titik.
const MAX_FILLED_BUCKETS = 2000;
const EMPTY_FILTER = { scriptId: "", code: "", message: "", start: null, end: null };
const DB_PATH_STORAGE_KEY = "loadrunnerLastErrorDbPath";

const els = {
  dbPath: document.getElementById("errorDbPath"),
  loadBtn: document.getElementById("loadErrorDbBtn"),
  granularityLabel: document.getElementById("errorGranularityLabel"),
  script: document.getElementById("errorScriptFilter"),
  code: document.getElementById("errorCodeFilter"),
  message: document.getElementById("errorMessageFilter"),
  start: document.getElementById("errorStartTime"),
  end: document.getElementById("errorEndTime"),
  applyBtn: document.getElementById("applyErrorFilterBtn"),
  resetBtn: document.getElementById("resetErrorFilterBtn"),
  info: document.getElementById("errorInfo"),
  rowsLabel: document.getElementById("errorRowsLabel"),
  chart: document.getElementById("errorsChart"),
  body: document.getElementById("errorsBody"),
};

function setInfo(text, isError = false) {
  els.info.textContent = text;
  els.info.classList.toggle("fail", isError);
}

export function resetErrorFilter() {
  state.errorFilter = { ...EMPTY_FILTER };
  for (const input of [els.script, els.code, els.message, els.start, els.end]) input.value = "";
}

export async function refreshErrors(progressToken = "") {
  if (!state.data && !state.errorDbPath) return;
  const filter = state.errorFilter;
  const params = new URLSearchParams();
  // Tanpa result, backend yang memilih granularity dari rentang waktu errornya sendiri.
  if (state.data) {
    params.set("session", state.data.session);
    params.set("granularity", String(state.appliedTpsGranularity));
  }
  if (state.errorDbPath) params.set("dbPath", state.errorDbPath);
  if (progressToken) params.set("progress", progressToken);
  if (filter.scriptId) params.set("script", filter.scriptId);
  if (filter.code) params.set("code", filter.code);
  if (filter.message) params.set("message", filter.message);
  if (filter.start !== null) params.set("start", String(filter.start));
  if (filter.end !== null) params.set("end", String(filter.end));
  try {
    const response = await fetch(`/api/errors?${params}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Error query failed");
    state.errors = payload;
  } catch (error) {
    state.errors = { error: error.message };
  }
}

function renderOptions(select, items, toOption, selected) {
  select.innerHTML = `<option value="">All</option>${items.map((item) => {
    const [value, label] = toOption(item);
    return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  }).join("")}`;
  select.value = selected;
  if (select.selectedIndex < 0) select.value = "";
}

function shorten(text, length) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

function errorSeries(rows, from, to, granularity) {
  const countsByName = new Map();
  for (const row of rows) {
    if (!countsByName.has(row.name)) countsByName.set(row.name, new Map());
    countsByName.get(row.name).set(row.elapsedSeconds, row.value);
  }
  const firstBucket = Math.floor(from / granularity) * granularity;
  const steps = Math.floor((to - firstBucket) / granularity) + 1;
  return [...countsByName.entries()].map(([name, counts], index) => ({
    name,
    color: COLORS[index % COLORS.length],
    // Bucket tanpa error diisi nol; tanpa itu garis chart menyambung lurus melewati jeda tanpa error.
    points: steps <= MAX_FILLED_BUCKETS
      ? Array.from({ length: steps }, (_, i) => {
        const x = firstBucket + i * granularity;
        return { x, y: counts.get(x) ?? 0 };
      })
      : [...counts].map(([x, y]) => ({ x, y })).sort((a, b) => a.x - b.x),
  }));
}

function cell(content, cls = "text-right whitespace-nowrap", title = "") {
  return `<td class="px-3.5 py-2.25 border-b border-(--line) ${cls}"${title ? ` title="${escapeHtml(title)}"` : ""}>${content}</td>`;
}

function renderRows(rows) {
  if (!rows.length) {
    return `<tr><td colspan="10" class="px-3.5 py-3 text-left muted">Tidak ada error untuk filter ini.</td></tr>`;
  }
  return rows.map((row) => `
    <tr class="hover:bg-(--surface) align-top">
      ${cell(escapeHtml(row.scriptName), "text-left whitespace-nowrap")}
      ${cell(row.errorCode, "text-right whitespace-nowrap fail")}
      ${cell(row.apiCode ?? "-", `text-right whitespace-nowrap ${row.apiCode ? "fail" : "muted"}`)}
      ${cell(escapeHtml(row.apiPath ?? "-"), `text-left min-w-64 break-all ${row.apiPath ? "" : "muted"}`, row.apiUrl ?? "")}
      ${cell(escapeHtml(row.message.trim()), "text-left min-w-90 break-words whitespace-pre-line")}
      ${cell(fmtNumber(row.count))}
      ${cell(fmtNumber(row.vusers), "text-right whitespace-nowrap muted")}
      ${cell(escapeHtml((row.injectors ?? "-").replaceAll(",", ", ")), "text-left muted")}
      ${cell(formatHms(row.firstSeconds), "text-right whitespace-nowrap", formatClockAt(row.firstSeconds))}
      ${cell(formatHms(row.lastSeconds), "text-right whitespace-nowrap", formatClockAt(row.lastSeconds))}
    </tr>
  `).join("");
}

export function renderErrors() {
  const data = state.errors;
  if (!data) return;
  const filter = state.errorFilter;

  if (data.error || !data.available) {
    setInfo(data.error ?? `SqliteDb.db tidak ditemukan. Dicari di: ${data.searched.join(" ; ")}`, true);
    renderOptions(els.script, [], () => [], "");
    renderOptions(els.code, [], () => [], "");
    els.rowsLabel.textContent = "";
    els.granularityLabel.textContent = "";
    els.body.innerHTML = renderRows([]);
    drawMultiLineChart(els.chart, []);
    return;
  }

  renderOptions(els.script, data.scripts, (s) => [String(s.id), `${s.name} (${s.count})`], filter.scriptId);
  renderOptions(els.code, data.codes, (c) => [String(c.code), `${c.code} · ${shorten(c.message, 70)} (${c.count})`], filter.code);

  const { totals } = data;
  setInfo(totals.errors
    ? `${fmtNumber(totals.errors)} errors · ${totals.messages} pesan unik · ${totals.scripts} script · ${totals.vusers} vuser · ${formatHms(totals.firstSeconds)} - ${formatHms(totals.lastSeconds)} | ${data.dbPath}`
    : `Tidak ada error untuk filter ini. | ${data.dbPath}`);
  els.rowsLabel.textContent = data.rowsTotal > data.rows.length
    ? `(top ${data.rows.length} of ${data.rowsTotal} by count)`
    : `(${data.rowsTotal} rows)`;
  els.granularityLabel.textContent = `@${data.granularity}s`;
  els.body.innerHTML = renderRows(sortRows(data.rows, state.sort.errors));

  const duration = state.data?.result?.scenario?.durationSeconds || 0;
  const from = filter.start ?? 0;
  const to = filter.end ?? Math.max(duration, totals.lastSeconds ?? 0);
  drawMultiLineChart(els.chart, errorSeries(data.series, from, to, data.granularity), from, to);
}

async function applyErrorFilter() {
  if (!state.data && !state.errorDbPath) {
    setInfo("Isi path SqliteDb.db lalu klik Load Errors, atau load result untuk mencarinya otomatis.", true);
    return;
  }
  const start = els.start.value.trim() ? parseHms(els.start.value) : null;
  const end = els.end.value.trim() ? parseHms(els.end.value) : null;
  if (Number.isNaN(start) || Number.isNaN(end) || (start !== null && end !== null && end < start)) {
    setInfo("Range waktu tidak valid. Pakai HH:MM:SS, atau kosongkan untuk semua.", true);
    return;
  }
  state.errorFilter = {
    scriptId: els.script.value,
    code: els.code.value,
    message: els.message.value.trim(),
    start,
    end,
  };
  els.applyBtn.disabled = true;
  setInfo("Loading errors...");
  try {
    await refreshErrors();
    renderErrors();
  } finally {
    els.applyBtn.disabled = false;
  }
}

// Database lain punya Script_ID sendiri, jadi filter di-reset setiap kali path diganti.
async function loadErrorDatabase() {
  state.errorDbPath = els.dbPath.value.trim().replace(/^"(.*)"$/, "$1");
  els.dbPath.value = state.errorDbPath;
  resetErrorFilter();
  if (!state.data && !state.errorDbPath) {
    setInfo("Isi path SqliteDb.db lalu klik Load Errors, atau load result untuk mencarinya otomatis.", true);
    return;
  }
  els.loadBtn.disabled = true;
  const progressToken = newProgressToken();
  startLoadingOverlay("Load Errors", progressToken);
  setInfo("Loading errors...");
  try {
    await refreshErrors(progressToken);
    // Query errors sering selesai sebelum polling progres sempat jalan, jadi bar ditutup di 100%
    // supaya tidak terlihat berhenti di tengah.
    setProgress(100, "Selesai");
    renderErrors();
  } finally {
    finishLoadingOverlay();
    els.loadBtn.disabled = false;
  }
  try {
    if (!state.errorDbPath) localStorage.removeItem(DB_PATH_STORAGE_KEY);
    else if (state.errors?.available) localStorage.setItem(DB_PATH_STORAGE_KEY, state.errorDbPath);
  } catch {
    // localStorage bisa diblokir; path cuma kenyamanan, tidak wajib tersimpan.
  }
}

try {
  state.errorDbPath = localStorage.getItem(DB_PATH_STORAGE_KEY) || "";
} catch {
  state.errorDbPath = "";
}
els.dbPath.value = state.errorDbPath;

els.loadBtn.addEventListener("click", loadErrorDatabase);
els.dbPath.addEventListener("keydown", (event) => { if (event.key === "Enter") loadErrorDatabase(); });
els.applyBtn.addEventListener("click", applyErrorFilter);
els.script.addEventListener("change", applyErrorFilter);
els.code.addEventListener("change", applyErrorFilter);
for (const input of [els.message, els.start, els.end]) {
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") applyErrorFilter(); });
}
els.resetBtn.addEventListener("click", () => {
  resetErrorFilter();
  applyErrorFilter();
});
