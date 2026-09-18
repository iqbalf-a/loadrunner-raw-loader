import { escapeHtml } from "./format.js";
import { state, graphByType, measurementName, inRange, sortRows } from "./state.js";
import { drawMultiLineChart, SERIES_COLORS } from "./charts.js";

const LG_GRAPH_TYPE = "es_tr_lg_monitoring";
// Di atas ~80% CPU/Memory, load generator sendiri mulai jadi bottleneck: response time dan TPS yang
// terukur ikut terdistorsi oleh injector, bukan murni oleh aplikasi yang diuji.
export const LG_WARN_PERCENT = 80;

// Nama measurement: "<host> - CPU Usage", "<host> - Memory Usage", "<host> - Disk Usage".
// Host bisa berupa IP atau "hostname [IP]".
function parseMeasurement(name) {
  const match = String(name ?? "").match(/^(.*) - (CPU|Memory|Disk) Usage$/i);
  return match ? { host: match[1].trim(), metric: match[2].toLowerCase() } : null;
}

function rowsByHost(metric, start, end) {
  const graph = graphByType(LG_GRAPH_TYPE);
  const grouped = new Map();
  for (const row of graph?.rows ?? []) {
    if (!inRange(row, start, end)) continue;
    const parsed = parseMeasurement(measurementName(graph, row));
    if (parsed?.metric !== metric) continue;
    const current = grouped.get(parsed.host) ?? [];
    current.push(row);
    grouped.set(parsed.host, current);
  }
  return grouped;
}

function metricSeries(metric, start, end) {
  return [...rowsByHost(metric, start, end).entries()].map(([host, rows], index) => ({
    name: host,
    color: SERIES_COLORS[index % SERIES_COLORS.length],
    points: rows.map((row) => ({ x: row.elapsedSeconds, y: row.value })).sort((a, b) => a.x - b.x),
  }));
}

// Baris dashboard sudah dirata-rata per bucket granularity, jadi Max diambil dari max asli tiap
// bucket (bukan max dari rata-rata bucket, yang meredam puncak) dan Avg dibobot jumlah sampel.
function metricSummary(rows) {
  const samples = rows.reduce((sum, row) => sum + (row.count || 0), 0);
  return {
    avg: samples ? rows.reduce((sum, row) => sum + row.value * (row.count || 0), 0) / samples : NaN,
    max: rows.length ? Math.max(...rows.map((row) => row.max)) : NaN,
  };
}

function hostSummaries(start, end) {
  const byHost = new Map();
  for (const metric of ["cpu", "memory", "disk"]) {
    for (const [host, rows] of rowsByHost(metric, start, end)) {
      const summary = metricSummary(rows);
      const current = byHost.get(host) ?? { host };
      current[`${metric}Avg`] = summary.avg;
      current[`${metric}Max`] = summary.max;
      byHost.set(host, current);
    }
  }
  return [...byHost.values()].map((row) => {
    const busiest = Math.max(row.cpuMax ?? 0, row.memoryMax ?? 0);
    return { ...row, status: busiest >= LG_WARN_PERCENT ? "Periksa" : "OK" };
  });
}

function percentCell(value, warn = false) {
  const text = Number.isFinite(value) ? value.toFixed(2) : "-";
  const cls = warn && value >= LG_WARN_PERCENT ? "fail" : "";
  return `<td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap ${cls}">${text}</td>`;
}

function renderHealthTable(target, rows) {
  if (!graphByType(LG_GRAPH_TYPE)) {
    target.innerHTML = `<tr><td colspan="8" class="px-3.5 py-3 text-left muted">Result ini tidak punya data Load Generator monitoring (graph ${LG_GRAPH_TYPE}).</td></tr>`;
    return;
  }
  if (!rows.length) {
    target.innerHTML = `<tr><td colspan="8" class="px-3.5 py-3 text-left muted">Tidak ada data Load Generator di rentang waktu ini.</td></tr>`;
    return;
  }
  target.innerHTML = sortRows(rows, state.sort.lgHealth).map((row) => `
    <tr class="hover:bg-(--surface)">
      <td class="px-3.5 py-2.25 border-b border-(--line) text-left whitespace-nowrap">${escapeHtml(row.host)}</td>
      <td class="px-3.5 py-2.25 border-b border-(--line) text-left whitespace-nowrap ${row.status === "OK" ? "ok" : "fail"}">${row.status}</td>
      ${percentCell(row.cpuAvg)}
      ${percentCell(row.cpuMax, true)}
      ${percentCell(row.memoryAvg)}
      ${percentCell(row.memoryMax, true)}
      ${percentCell(row.diskAvg)}
      ${percentCell(row.diskMax)}
    </tr>
  `).join("");
}

export function renderLgHealthSection(els, start, end, applySelection) {
  drawMultiLineChart(els.lgCpuChart, applySelection("lgCpu", metricSeries("cpu", start, end)), start, end);
  drawMultiLineChart(els.lgMemoryChart, applySelection("lgMemory", metricSeries("memory", start, end)), start, end);
  drawMultiLineChart(els.lgDiskChart, applySelection("lgDisk", metricSeries("disk", start, end)), start, end);
  renderHealthTable(els.lgHealthBody, hostSummaries(start, end));
}
