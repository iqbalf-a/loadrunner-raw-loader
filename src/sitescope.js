import { percentile } from "./format.js";
import { state, graphByType, measurementName, inRange, sortRows, TRANSACTION_SUMMARY_LIMIT } from "./state.js";
import { drawMultiLineChart } from "./charts.js";

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

export function renderSiteScopeMetricTable(target, pattern, start, end, tableKey, showAllBtn, stateKey) {
  const valuesByHost = new Map();

  for (const row of siteScopeRows(pattern, start, end)) {
    const host = hostFromSiteScopeName(measurementName(graphByType("SiteScope"), row));
    const current = valuesByHost.get(host) ?? [];
    current.push(row.value);
    valuesByHost.set(host, current);
  }

  const hostRows = [...valuesByHost.entries()].map(([host, values]) => ({ host, ...summarizeValues(values) }));
  // Disimpan supaya modal "Show All" memakai baris yang sama dengan tabel panel.
  if (stateKey) state[stateKey] = hostRows;
  const sorted = sortRows(hostRows, state.sort[tableKey]);
  if (showAllBtn) {
    showAllBtn.hidden = sorted.length === 0;
    showAllBtn.textContent = `Show All (${sorted.length})`;
  }
  target.innerHTML = sorted.slice(0, showAllBtn ? TRANSACTION_SUMMARY_LIMIT : sorted.length).map((row) => `
      <tr class="hover:bg-(--surface)">
        <td class="px-3.5 py-2.25 border-b border-(--line) text-left whitespace-nowrap">${row.host}</td>
        <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap">${row.min.toFixed(3)}</td>
        <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap">${row.avg.toFixed(3)}</td>
        <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap">${row.max.toFixed(3)}</td>
      </tr>
    `).join("");
}

export function renderSiteScopeSection(els, start, end, applySelection) {
  const colors = ["#00bf8f", "#2f7df6", "#ff416d", "#8b5cf6"];
  const cpuSeries = siteScopeSeries(/\/CPU\/utilization$/, start, end, colors);
  const memorySeries = siteScopeSeries(/\/(UNIXRES|WINRES)\/Memory Used ?%$/i, start, end, colors);
  drawMultiLineChart(els.siteScopeCpuChart, applySelection("siteScopeCpu", cpuSeries), start, end);
  drawMultiLineChart(els.siteScopeMemoryChart, applySelection("siteScopeMemory", memorySeries), start, end);
  renderSiteScopeMetricTable(els.siteScopeCpuBody, /\/CPU\/utilization$/, start, end, "siteScopeCpu", els.showAllSiteScopeCpuBtn, "siteScopeCpuRows");
  renderSiteScopeMetricTable(els.siteScopeMemoryBody, /\/(UNIXRES|WINRES)\/Memory Used ?%$/i, start, end, "siteScopeMemory", els.showAllSiteScopeMemoryBtn, "siteScopeMemoryRows");
}
