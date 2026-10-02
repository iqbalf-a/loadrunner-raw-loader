import { escapeHtml, percentile } from "./format.js";
import { state, graphByType, measurementName, inRange, sortRows, TRANSACTION_SUMMARY_LIMIT } from "./state.js";
import { drawMultiLineChart, seriesPickCell, seriesSearchQuery } from "./charts.js";

export function hostFromSiteScopeName(name) {
  const match = String(name ?? "").match(/\/APIGW\/([^/]+)/);
  return match ? match[1] : String(name ?? "-");
}

export function summarizeValues(values) {
  if (!values.length) {
    return { min: 0, avg: 0, percentile90: 0, max: 0, points: 0 };
  }
  return {
    min: Math.min(...values),
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    percentile90: percentile(values, 90),
    max: Math.max(...values),
    points: values.length,
  };
}

export function siteScopeRows(pattern, start, end) {
  const graph = graphByType("SiteScope");
  return (graph?.rows ?? [])
    .filter((row) => pattern.test(measurementName(graph, row) ?? "") && inRange(row, start, end))
    .sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
}

export function siteScopeSeries(pattern, start, end, colors) {
  const grouped = new Map();
  for (const row of siteScopeRows(pattern, start, end)) {
    const host = hostFromSiteScopeName(measurementName(graphByType("SiteScope"), row));
    const current = grouped.get(host) ?? [];
    current.push({ x: row.elapsedSeconds, y: row.value });
    grouped.set(host, current);
  }

  return [...grouped.entries()].map(([host, points], index) => ({
    name: host,
    color: colors[index % colors.length],
    points,
  }));
}

export function siteScopeHostRows(pattern, start, end) {
  const valuesByHost = new Map();
  for (const row of siteScopeRows(pattern, start, end)) {
    const host = hostFromSiteScopeName(measurementName(graphByType("SiteScope"), row));
    const current = valuesByHost.get(host) ?? [];
    current.push(row.value);
    valuesByHost.set(host, current);
  }
  return [...valuesByHost.entries()].map(([host, values]) => ({ host, ...summarizeValues(values) }));
}

export const CPU_PATTERN = /\/CPU\/utilization$/;
export const MEMORY_PATTERN = /\/(UNIXRES|WINRES)\/Memory Used ?%$/i;

// Baris host ini bukan hasil fetch, tapi turunan dari graph SiteScope -- jadi dihitung ulang setiap
// kali data dashboard berubah, bukan hanya saat panelnya dirender. Yang lain, sheet XLSX untuk
// SiteScope ikut kosong di halaman yang belum pernah dikunjungi.
export function refreshSiteScopeRows(start, end) {
  state.siteScopeCpuRows = siteScopeHostRows(CPU_PATTERN, start, end);
  state.siteScopeMemoryRows = siteScopeHostRows(MEMORY_PATTERN, start, end);
}

// Barisnya diambil dari state yang sudah diisi refreshSiteScopeRows() saat dashboard di-refresh.
// Dihitung ulang di sini hanya akan jadi jalan lain untuk data yang sama, dengan risiko menimpa
// state memakai hasil kedua yang urutannya bisa beda.
export function renderSiteScopeMetricTable(target, hostRows, tableKey, showAllBtn) {
  const key = target.closest("[data-chart-selector]")?.dataset.chartSelector ?? "";
  const query = seriesSearchQuery(key).toLowerCase();
  const sorted = sortRows(hostRows.filter((row) => !query || row.host.toLowerCase().includes(query)), state.sort[tableKey]);
  if (showAllBtn) {
    showAllBtn.hidden = sorted.length === 0;
    showAllBtn.textContent = `Show All (${sorted.length})`;
  }
  target.innerHTML = sorted.slice(0, showAllBtn ? TRANSACTION_SUMMARY_LIMIT : sorted.length).map((row) => `
      <tr class="hover:bg-(--surface)">
        ${seriesPickCell(target, row.host)}
        <td class="px-3.5 py-2.25 border-b border-(--line) text-left whitespace-nowrap">${escapeHtml(row.host)}</td>
        <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap">${row.min.toFixed(3)}</td>
        <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap">${row.avg.toFixed(3)}</td>
        <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap">${row.max.toFixed(3)}</td>
      </tr>
    `).join("");
}

// CPU dan Memory sudah dipisah jadi dua halaman, jadi metrik dirender satu per panggilan: elemen
// halaman yang sedang aktif saja yang ada di DOM.
export function renderSiteScopeMetric(selector, pattern, els, start, end, applySelection) {
  const colors = ["#00bf8f", "#2f7df6", "#ff416d", "#8b5cf6"];
  drawMultiLineChart(els.chart, applySelection(selector, siteScopeSeries(pattern, start, end, colors)), start, end);
  renderSiteScopeMetricTable(els.body, state[`${selector}Rows`] ?? [], selector, els.showAllBtn);
}
