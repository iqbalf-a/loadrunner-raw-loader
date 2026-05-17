const DEFAULT_GRAPH_GRANULARITY_SECONDS = 10;

const state = {
  data: null,
  appliedStart: 0,
  appliedEnd: 0,
  appliedTpsGranularity: DEFAULT_GRAPH_GRANULARITY_SECONDS,
  groupFilter: "",
};
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
  tpsBody: document.getElementById("tpsBody"),
  rangeLabel: document.getElementById("rangeLabel"),
  tpsGranularityLabel: document.getElementById("tpsGranularityLabel"),
  seriesSelect: document.getElementById("seriesSelect"),
  transactionRtChart: document.getElementById("transactionRtChart"),
  vusersChart: document.getElementById("vusersChart"),
  tpsChart: document.getElementById("tpsChart"),
  siteScopeCpuChart: document.getElementById("siteScopeCpuChart"),
  siteScopeMemoryChart: document.getElementById("siteScopeMemoryChart"),
  siteScopeCpuBody: document.getElementById("siteScopeCpuBody"),
  siteScopeMemoryBody: document.getElementById("siteScopeMemoryBody"),
  seriesChart: document.getElementById("seriesChart"),
  groupFilter: document.getElementById("groupFilter"),
  applyGroupFilterBtn: document.getElementById("applyGroupFilterBtn"),
  resetGroupFilterBtn: document.getElementById("resetGroupFilterBtn"),
};
const chartHitboxes = new WeakMap();
const chartInstances = new WeakMap();
const chartTooltip = document.createElement("div");
chartTooltip.className = "chart-tooltip";
document.body.appendChild(chartTooltip);

function parseHms(value) {
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function parsePositiveSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 1 ? Math.round(seconds) : NaN;
}

function resolveGroup(name) {
  const scriptGroups = state.data?.summary?.scriptGroups ?? [];
  if (!scriptGroups.length) return null;
  const stripped = String(name ?? "").replace(/_\d+(?=_|$)/g, "");
  return scriptGroups.find((g) => g.scriptName === stripped)?.groupName ?? null;
}

function groupLikeToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escaped.replace(/%/g, ".*") + "$", "i");
}

function currentCssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  els.themeToggle.textContent = theme === "dark" ? "Light" : "Dark";
  localStorage.setItem("loadrunnerTheme", theme);
  if (state.data) renderAll();
}

function toggleTheme() {
  applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
}

function formatHms(seconds) {
  const safe = Math.max(0, Math.round(seconds || 0));
  const h = String(Math.floor(safe / 3600)).padStart(2, "0");
  const m = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const s = String(safe % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatClockAt(elapsedSeconds) {
  const startTime = Number(state.data?.result?.scenario?.startTime);
  if (!Number.isFinite(startTime)) return "-";
  const date = new Date((startTime + Number(elapsedSeconds || 0)) * 1000);
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatRangeWithClock(start, end) {
  return `${formatHms(start)} (${formatClockAt(start)}) - ${formatHms(end)} (${formatClockAt(end)})`;
}

function percentile(values, rank) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((rank / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function fmtNumber(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString("id-ID") : "0";
}

function fmtSeconds(seconds) {
  return Number.isFinite(seconds) ? seconds.toFixed(3) : "-";
}

function fmtMs(seconds) {
  if (!Number.isFinite(seconds)) return "-";
  return `${(seconds * 1000).toFixed(1)} ms`;
}

function graphByType(type) {
  return state.data?.result?.graphs?.find((graph) => graph.type === type);
}

function inRange(row, start, end) {
  return row.elapsedSeconds >= start && row.elapsedSeconds <= end;
}

function rowsByMeasurement(graph, start, end) {
  const grouped = new Map();
  for (const row of graph?.rows ?? []) {
    if (!inRange(row, start, end)) continue;
    const current = grouped.get(row.measurementName) ?? [];
    current.push(row);
    grouped.set(row.measurementName, current);
  }
  return grouped;
}

function buildTransactions(start, end) {
  const responseRows = rowsByMeasurement(graphByType("es_tr_response_time"), start, end);
  const successRows = rowsByMeasurement(graphByType("es_tr_tprange_pass"), start, end);
  const failGraph = state.data.result.graphs.find((graph) => /fail/i.test(graph.type || ""));
  const failRows = rowsByMeasurement(failGraph, start, end);
  const names = new Set([...responseRows.keys(), ...successRows.keys(), ...failRows.keys()]);

  return [...names].sort().map((name) => {
    const rt = responseRows.get(name) ?? [];
    const values = rt.map((row) => row.value).filter(Number.isFinite);
    const success = (successRows.get(name) ?? []).reduce((sum, row) => sum + row.value, 0);
    const fail = (failRows.get(name) ?? []).reduce((sum, row) => sum + row.value, 0);
    const total = Math.round(success + fail);
    const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

    return {
      name,
      groupName: resolveGroup(name),
      success: Math.round(success),
      fail: Math.round(fail),
      samples: total,
      min: values.length ? Math.min(...values) : 0,
      avg,
      percentile90: percentile(values, 90),
      max: values.length ? Math.max(...values) : 0,
      stdDeviation: standardDeviation(values),
      responseTimeSamples: values.length,
    };
  });
}

function renderMetrics(transactions, start, end) {
  const success = transactions.reduce((sum, tx) => sum + tx.success, 0);
  const fail = transactions.reduce((sum, tx) => sum + tx.fail, 0);
  const total = success + fail;
  const avg = transactions.length ? transactions.reduce((sum, tx) => sum + tx.avg, 0) / transactions.length : 0;
  const peakVusers = Math.max(0, ...(graphByType("es_tr_runtime_vusers")?.rows ?? [])
    .filter((row) => inRange(row, start, end))
    .map((row) => row.value));

  const items = [
    ["Success", fmtNumber(success), `${transactions.length} TRANSACTIONS`],
    ["Fail", fmtNumber(fail), total ? `${((fail / total) * 100).toFixed(2)}%` : "0%"],
    ["Total", fmtNumber(total), "SUCCESS + FAIL"],
    ["Avg RT", fmtMs(avg), "mean by transaction"],
    ["Peak VUsers", fmtNumber(peakVusers), `${formatHms(start)} - ${formatHms(end)}`],
  ];

  els.metrics.innerHTML = items.map(([label, value, sub]) => `
    <div class="metric bg-[rgba(255,255,255,0.88)] dark:bg-[rgba(14,20,33,0.88)] border border-black/9 dark:border-white/12 rounded-[10px] shadow-(--shadow) backdrop-blur-[18px] p-[14px_16px]">
      <div class="label text-(--chart-text) font-mono text-[11px] font-black uppercase tracking-[0.09em]" style="font-family: Consolas, 'SFMono-Regular', monospace;">${label}</div>
      <div class="value mt-2 text-[#111827] dark:text-[#f4f7ff] font-mono text-[21px] font-black leading-[1.1] tracking-[-0.01em]" style="font-family: Consolas, 'SFMono-Regular', monospace;">${value}</div>
      <div class="sub mt-1.5 text-(--chart-text) font-mono text-[11px]" style="font-family: Consolas, 'SFMono-Regular', monospace;">${sub}</div>
    </div>
  `).join("");
}

function renderTable(transactions) {
  const re = state.groupFilter ? groupLikeToRegex(state.groupFilter) : null;
  const rows = re ? transactions.filter((tx) => re.test(tx.groupName ?? "")) : transactions;
  els.txBody.innerHTML = rows.map((tx) => `
    <tr class="hover:bg-[rgba(47,125,246,0.05)]">
      <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-left whitespace-nowrap">${tx.name}</td>
      <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-left whitespace-nowrap muted">${tx.groupName ?? "-"}</td>
      <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap">${fmtSeconds(tx.min)}</td>
      <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap">${fmtSeconds(tx.avg)}</td>
      <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap">${fmtSeconds(tx.max)}</td>
      <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap">${fmtSeconds(tx.percentile90)}</td>
      <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap">${fmtSeconds(tx.stdDeviation)}</td>
      <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap ok">${fmtNumber(tx.success)}</td>
      <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap fail">${fmtNumber(tx.fail)}</td>
      <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap">${fmtNumber(tx.samples)}</td>
      <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap muted">${fmtNumber(tx.responseTimeSamples)}</td>
    </tr>
  `).join("");
}

function renderTpsTable(tpsSeries) {
  const re = state.groupFilter ? groupLikeToRegex(state.groupFilter) : null;
  const rows = re ? tpsSeries.filter((s) => re.test(s.groupName ?? "")) : tpsSeries;
  els.tpsBody.innerHTML = rows.map((series) => {
    const values = series.points.map((point) => point.y).filter(Number.isFinite);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return `
      <tr class="hover:bg-[rgba(47,125,246,0.05)]">
        <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-left whitespace-nowrap">${series.name}</td>
        <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-left whitespace-nowrap muted">${series.groupName ?? "-"}</td>
        <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap">${min.toFixed(3)}</td>
        <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap">${avg.toFixed(3)}</td>
        <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap">${max.toFixed(3)}</td>
        <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap muted">${fmtNumber(values.length)}</td>
      </tr>
    `;
  }).join("");
}

function hostFromSiteScopeName(name) {
  const match = String(name ?? "").match(/\/APIGW\/([^/]+)/);
  return match ? match[1] : String(name ?? "-");
}

function summarizeValues(values) {
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

function siteScopeRows(pattern, start, end) {
  const graph = graphByType("SiteScope");
  return (graph?.rows ?? [])
    .filter((row) => pattern.test(row.measurementName ?? "") && inRange(row, start, end))
    .sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
}

function siteScopeSeries(pattern, start, end, colors) {
  const grouped = new Map();
  for (const row of siteScopeRows(pattern, start, end)) {
    const host = hostFromSiteScopeName(row.measurementName);
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

function renderSiteScopeMetricTable(target, pattern, start, end) {
  const valuesByHost = new Map();

  for (const row of siteScopeRows(pattern, start, end)) {
    const host = hostFromSiteScopeName(row.measurementName);
    const current = valuesByHost.get(host) ?? [];
    current.push(row.value);
    valuesByHost.set(host, current);
  }

  const hosts = [...valuesByHost.keys()].sort();
  target.innerHTML = hosts.map((host) => {
    const summary = summarizeValues(valuesByHost.get(host) ?? []);
    return `
      <tr class="hover:bg-[rgba(47,125,246,0.05)]">
        <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-left whitespace-nowrap">${host}</td>
        <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap">${summary.min.toFixed(3)}</td>
        <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap">${summary.avg.toFixed(3)}</td>
        <td class="px-4.5 py-3 border-b border-black/9 dark:border-white/12 text-right whitespace-nowrap">${summary.max.toFixed(3)}</td>
      </tr>
    `;
  }).join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function tooltipHtml(lines) {
  const [title, ...details] = lines.map(escapeHtml);
  return `<strong>${title}</strong>${details.join("<br>")}`;
}

function setChartHitboxes(canvas, hitboxes) {
  chartHitboxes.set(canvas, hitboxes);
  if (canvas.dataset.tooltipReady) return;
  canvas.dataset.tooltipReady = "true";

  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const candidates = chartHitboxes.get(canvas) ?? [];
    let closest = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const item of candidates) {
      if (item.bounds && x >= item.bounds.left && x <= item.bounds.right && y >= item.bounds.top && y <= item.bounds.bottom) {
        closest = item;
        closestDistance = 0;
        break;
      }

      const distance = Math.hypot(x - item.x, y - item.y);
      if (distance < closestDistance) {
        closest = item;
        closestDistance = distance;
      }
    }

    if (!closest || closestDistance > 14) {
      chartTooltip.style.display = "none";
      return;
    }

    chartTooltip.innerHTML = tooltipHtml(closest.lines);
    chartTooltip.style.left = `${event.clientX + 12}px`;
    chartTooltip.style.top = `${event.clientY + 12}px`;
    chartTooltip.style.display = "block";
  });

  canvas.addEventListener("mouseleave", () => {
    chartTooltip.style.display = "none";
  });
}

function chartFileName(panel) {
  const title = panel.querySelector(".panel-title")?.innerText ?? "chart";
  return `${title.replace(/EXPAND|CLOSE|PNG/g, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chart"}.png`;
}

function downloadChartPng(panel) {
  const canvas = panel.querySelector("canvas");
  const chart = canvas ? chartInstances.get(canvas) : null;
  if (!chart) return;

  const link = document.createElement("a");
  link.download = chartFileName(panel);
  link.href = chart.toBase64Image("image/png", 1);
  link.click();
}

function resizePanelChart(panel) {
  const canvas = panel.querySelector("canvas");
  const chart = canvas ? chartInstances.get(canvas) : null;
  if (chart) chart.resize();
}

function closeExpandedPanel() {
  const panel = document.querySelector(".chart-panel.expanded");
  if (!panel) return;
  panel.classList.remove("expanded");
  document.body.classList.remove("chart-expanded-open");
  const button = panel.querySelector("[data-chart-action='expand']");
  if (button) button.textContent = "Expand";
  setTimeout(() => resizePanelChart(panel), 50);
}

function toggleExpandPanel(panel, button) {
  const isExpanded = panel.classList.toggle("expanded");
  document.body.classList.toggle("chart-expanded-open", isExpanded);
  button.textContent = isExpanded ? "Close" : "Expand";
  setTimeout(() => resizePanelChart(panel), 50);
}

function setupChartPanelActions() {
  document.querySelectorAll(".chart-panel").forEach((panel) => {
    if (panel.dataset.actionsReady) return;
    const title = panel.querySelector(".panel-title");
    if (!title) return;

    const actions = document.createElement("div");
    actions.className = "panel-actions flex gap-1.5 ml-auto items-center";
    actions.innerHTML = `
      <button class="panel-action-btn h-6 min-w-12 px-2.25 border border-black/9 dark:border-white/12 rounded-[7px] bg-[rgba(255,255,255,0.84)] dark:bg-[rgba(10,15,25,0.78)] text-(--chart-text) font-mono text-[10px] font-black tracking-[0.08em] uppercase cursor-pointer" type="button" data-chart-action="expand" style="font-family: Consolas, 'SFMono-Regular', monospace; box-shadow: none;">Expand</button>
      <button class="panel-action-btn h-6 min-w-12 px-2.25 border border-black/9 dark:border-white/12 rounded-[7px] bg-[rgba(255,255,255,0.84)] dark:bg-[rgba(10,15,25,0.78)] text-(--chart-text) font-mono text-[10px] font-black tracking-[0.08em] uppercase cursor-pointer" type="button" data-chart-action="download" style="font-family: Consolas, 'SFMono-Regular', monospace; box-shadow: none;">PNG</button>
    `;
    title.appendChild(actions);
    panel.dataset.actionsReady = "true";
  });
}

function hexToRgb(hex) {
  const clean = String(hex).replace("#", "");
  const value = Number.parseInt(clean.length === 3 ? clean.split("").map((char) => char + char).join("") : clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function destroyChart(canvas) {
  const current = chartInstances.get(canvas);
  if (current) current.destroy();
}

function baseChartOptions(xMin = null, xMax = null) {
  const xBounds = {};
  if (Number.isFinite(xMin)) xBounds.min = xMin;
  if (Number.isFinite(xMax)) xBounds.max = xMax;

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "nearest", intersect: false },
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          usePointStyle: true,
          pointStyle: "line",
          boxWidth: 28,
          boxHeight: 4,
          color: currentCssVar("--chart-text") || "#65708f",
          font: { family: "Consolas, SFMono-Regular, monospace", size: 11 },
        },
      },
      tooltip: {
        backgroundColor: "rgba(5, 7, 13, 0.94)",
        borderColor: "rgba(255, 255, 255, 0.14)",
        borderWidth: 1,
        displayColors: true,
        titleFont: { family: "Consolas, SFMono-Regular, monospace", size: 12, weight: "bold" },
        bodyFont: { family: "Consolas, SFMono-Regular, monospace", size: 12 },
        callbacks: {
          title(items) {
            const x = items[0]?.raw?.x ?? items[0]?.label;
            return Number.isFinite(x) ? formatHms(x) : String(x ?? "");
          },
          label(item) {
            const label = item.dataset.label ? `${item.dataset.label}: ` : "";
            return `${label}${Number(item.parsed.y ?? 0).toFixed(3)}`;
          },
        },
      },
    },
    scales: {
      x: {
        type: "linear",
        ...xBounds,
        bounds: "ticks",
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: currentCssVar("--chart-text") || "#65708f",
          font: { family: "Consolas, SFMono-Regular, monospace", size: 11 },
          callback: (value) => formatHms(value),
          maxTicksLimit: 7,
        },
      },
      y: {
        beginAtZero: true,
        grid: { color: currentCssVar("--grid-line") || "rgba(114, 126, 160, 0.14)" },
        border: { display: false },
        ticks: {
          color: currentCssVar("--chart-text") || "#65708f",
          font: { family: "Consolas, SFMono-Regular, monospace", size: 11 },
        },
      },
    },
  };
}

function createGradient(canvas, color) {
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 240);
  gradient.addColorStop(0, rgba(color, 0.22));
  gradient.addColorStop(1, rgba(color, 0.03));
  return gradient;
}

function drawBarChart(canvas, labels, values, color) {
  destroyChart(canvas);
  const chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Value",
        data: values,
        backgroundColor: createGradient(canvas, color),
        borderColor: color,
        borderWidth: 1.5,
        borderRadius: 5,
        maxBarThickness: 42,
      }],
    },
    options: {
      ...baseChartOptions(),
      plugins: {
        ...baseChartOptions().plugins,
        legend: { display: false },
        tooltip: {
          ...baseChartOptions().plugins.tooltip,
          callbacks: {
            title(items) {
              return String(items[0]?.label ?? "");
            },
            label(item) {
              return `Value: ${Number(item.parsed.y ?? 0).toFixed(3)}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "category",
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: currentCssVar("--chart-text") || "#65708f",
            font: { family: "Consolas, SFMono-Regular, monospace", size: 10 },
            maxRotation: 35,
            minRotation: 0,
          },
        },
        y: baseChartOptions().scales.y,
      },
    },
  });
  chartInstances.set(canvas, chart);
}

function drawLineChart(canvas, series, color, xMin = null, xMax = null) {
  drawMultiLineChart(canvas, [{
    name: "Time Series",
    color,
    points: series,
  }], xMin, xMax);
}

function drawMultiLineChart(canvas, seriesList, xMinOverride = null, xMaxOverride = null) {
  destroyChart(canvas);
  const allPoints = seriesList
    .flatMap((series) => series.points)
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const xMin = Number.isFinite(xMinOverride) ? xMinOverride : allPoints.length ? Math.min(...allPoints.map((point) => point.x)) : 0;
  const xMax = Number.isFinite(xMaxOverride) ? xMaxOverride : allPoints.length ? Math.max(...allPoints.map((point) => point.x)) : 1;
  const datasets = seriesList.map((series) => ({
    label: series.name,
    data: series.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    borderColor: series.color,
    backgroundColor: createGradient(canvas, series.color),
    borderWidth: 2.25,
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHitRadius: 12,
    tension: 0.28,
    fill: true,
  }));

  const chart = new Chart(canvas, {
    type: "line",
    data: { datasets },
    options: baseChartOptions(xMin, xMax),
  });
  chartInstances.set(canvas, chart);
}

function transactionSeries(graphType, start, end, mapper) {
  const graph = graphByType(graphType);
  const colors = ["#00bf8f", "#2f7df6", "#ff416d", "#8b5cf6", "#11c5e5", "#a56b00"];
  return (graph?.measurements ?? []).map((measurement, index) => {
    const rows = (graph.rows ?? [])
      .filter((row) => row.measurementName === measurement.name && inRange(row, start, end))
      .sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
    return {
      name: measurement.name,
      color: colors[index % colors.length],
      points: mapper(rows),
    };
  });
}

function tpsPoints(rows, start, end, granularitySeconds) {
  const buckets = new Map();

  for (const row of rows) {
    const bucketIndex = Math.floor((row.elapsedSeconds - start) / granularitySeconds);
    const bucketStart = start + bucketIndex * granularitySeconds;
    const current = buckets.get(bucketStart) ?? 0;
    buckets.set(bucketStart, current + row.value);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bucketStart, total]) => {
      const bucketEnd = Math.min(bucketStart + granularitySeconds, end);
      const bucketDuration = Math.max(1, bucketEnd - bucketStart);
      return {
        x: bucketStart + bucketDuration / 2,
        y: total / bucketDuration,
      };
    });
}

function renderCharts(transactions, start, end) {
  drawMultiLineChart(
    els.transactionRtChart,
    transactionSeries("es_tr_response_time", start, end, (rows) => rows.map((row) => ({ x: row.elapsedSeconds, y: row.value }))),
    start,
    end,
  );
  drawMultiLineChart(
    els.vusersChart,
    transactionSeries("es_tr_runtime_vusers", start, end, (rows) => rows.map((row) => ({ x: row.elapsedSeconds, y: row.value }))),
    start,
    end,
  );
  renderTpsSection(start, end);
  renderSiteScopeSection(start, end);

  const selected = els.seriesSelect.value || "es_tr_runtime_vusers::Running";
  const [graphType, measurementName] = selected.split("::");
  const graph = graphByType(graphType);
  const rows = (graph?.rows ?? [])
    .filter((row) => row.measurementName === measurementName && inRange(row, start, end))
    .map((row) => ({ x: row.elapsedSeconds, y: row.value }));
  drawLineChart(els.seriesChart, rows, graphType === "es_tr_response_time" ? "#ff416d" : "#2f7df6", start, end);
}

function populateSeriesOptions() {
  const graphTypes = new Set(["es_tr_runtime_vusers", "es_tr_response_time", "es_tr_tprange_pass", "Web_Connections_Per_Second"]);
  const options = [];
  for (const graph of state.data.result.graphs) {
    if (!graphTypes.has(graph.type) && graph.type !== "SiteScope") continue;
    for (const measurement of graph.measurements) {
      if (graph.type === "SiteScope" && !/\/CPU\/utilization$|\/(UNIXRES|WINRES)\/Memory Used %$/i.test(measurement.name)) continue;
      options.push({ value: `${graph.type}::${measurement.name}`, label: `${graph.type} - ${measurement.name}` });
    }
  }
  els.seriesSelect.innerHTML = options.map((option) => `<option value="${option.value}">${option.label}</option>`).join("");
}

function renderTpsSection(start, end) {
  const tpsSeries = transactionSeries(
    "es_tr_tprange_pass",
    start,
    end,
    (rows) => tpsPoints(rows, start, end, state.appliedTpsGranularity),
  ).map((s) => ({ ...s, groupName: resolveGroup(s.name) }));
  els.tpsGranularityLabel.textContent = `${state.appliedTpsGranularity}s bucket`;
  drawMultiLineChart(els.tpsChart, tpsSeries, start, end);
  renderTpsTable(tpsSeries);
}

function renderSiteScopeSection(start, end) {
  const colors = ["#00bf8f", "#2f7df6", "#ff416d", "#8b5cf6"];
  drawMultiLineChart(els.siteScopeCpuChart, siteScopeSeries(/\/CPU\/utilization$/, start, end, colors), start, end);
  drawMultiLineChart(els.siteScopeMemoryChart, siteScopeSeries(/\/(UNIXRES|WINRES)\/Memory Used %$/i, start, end, colors), start, end);
  renderSiteScopeMetricTable(els.siteScopeCpuBody, /\/CPU\/utilization$/, start, end);
  renderSiteScopeMetricTable(els.siteScopeMemoryBody, /\/(UNIXRES|WINRES)\/Memory Used %$/i, start, end);
}

const STATUS_BASE = "min-h-[18px] text-(--chart-text) font-mono text-[11px] mb-2 max-w-360";
const STATUS_ERR  = "min-h-[18px] font-mono text-[11px] mb-2 max-w-360 text-[#ff416d] font-black";

function renderAll() {
  if (!state.data) return;
  const duration = state.data.result.scenario.durationSeconds || 0;
  const start = state.appliedStart;
  const end = state.appliedEnd || duration;

  els.status.className = STATUS_BASE;
  const isAllRange = start === 0 && Math.round(end) === Math.round(duration);
  els.rangeLabel.textContent = `Filtered: ${formatHms(start)} - ${formatHms(end)}`;
  els.rangeInfo.innerHTML = `
    <div class="range-chip border border-l-4 border-l-[#2f7df6] border-black/9 dark:border-white/12 rounded-[10px] bg-[rgba(255,255,255,0.88)] dark:bg-[rgba(14,20,33,0.88)] p-[12px_14px] shadow-(--shadow) backdrop-blur-[18px]">
      <div class="title font-mono text-[11px] text-(--chart-text) font-black tracking-[0.08em] uppercase" style="font-family: Consolas, 'SFMono-Regular', monospace;">All Range</div>
      <div class="time mt-2 font-mono text-[15px] text-[#111827] dark:text-[#f4f7ff] font-black tracking-[0.02em]" style="font-family: Consolas, 'SFMono-Regular', monospace;">${formatHms(0)} - ${formatHms(duration)}</div>
      <div class="clock mt-1.25 text-(--chart-text) font-mono text-[11px]" style="font-family: Consolas, 'SFMono-Regular', monospace;">${formatClockAt(0)} - ${formatClockAt(duration)}</div>
    </div>
    <div class="range-chip filtered ${isAllRange ? "" : "changed"} border border-l-4 ${isAllRange ? "border-l-[#00bf8f]" : "border-l-[#a56b00]"} border-black/9 dark:border-white/12 rounded-[10px] bg-[rgba(255,255,255,0.88)] dark:bg-[rgba(14,20,33,0.88)] p-[12px_14px] shadow-(--shadow) backdrop-blur-[18px]">
      <div class="title font-mono text-[11px] text-(--chart-text) font-black tracking-[0.08em] uppercase" style="font-family: Consolas, 'SFMono-Regular', monospace;">${isAllRange ? "Filtered Range: All selected" : "Filtered Range"}</div>
      <div class="time mt-2 font-mono text-[15px] text-[#111827] dark:text-[#f4f7ff] font-black tracking-[0.02em]" style="font-family: Consolas, 'SFMono-Regular', monospace;">${formatHms(start)} - ${formatHms(end)}</div>
      <div class="clock mt-1.25 text-(--chart-text) font-mono text-[11px]" style="font-family: Consolas, 'SFMono-Regular', monospace;">${formatClockAt(start)} - ${formatClockAt(end)}</div>
    </div>
  `;
  const transactions = buildTransactions(start, end);
  renderMetrics(transactions, start, end);
  renderTable(transactions);
  renderCharts(transactions, start, end);
  els.status.textContent = `SESSION ${state.data.result.scenario.resultName || "RESULT"} | ${state.data.result.resultDir}`;
}

function applyTimeFilter() {
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
  renderAll();
}

function applyTpsGranularity() {
  if (!state.data) return;
  const tpsGranularity = parsePositiveSeconds(els.tpsGranularity.value);
  if (!Number.isFinite(tpsGranularity)) {
    els.status.textContent = "Granularity grafik harus angka minimal 1 detik.";
    els.status.className = STATUS_ERR;
    return;
  }
  state.appliedTpsGranularity = tpsGranularity;
  els.status.className = STATUS_BASE;
  renderTpsSection(state.appliedStart, state.appliedEnd || state.data.result.scenario.durationSeconds || 0);
  els.status.textContent = `Granularity grafik applied: ${tpsGranularity}s bucket`;
}

function resetTpsGranularity() {
  if (!state.data) return;
  els.tpsGranularity.value = String(DEFAULT_GRAPH_GRANULARITY_SECONDS);
  state.appliedTpsGranularity = DEFAULT_GRAPH_GRANULARITY_SECONDS;
  els.status.className = STATUS_BASE;
  renderTpsSection(state.appliedStart, state.appliedEnd || state.data.result.scenario.durationSeconds || 0);
  els.status.textContent = `Granularity grafik reset to default: ${DEFAULT_GRAPH_GRANULARITY_SECONDS}s bucket`;
}

async function loadResult() {
  const resultPath = els.resultPath.value.trim();
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
    state.data = payload;
    const duration = payload.result.scenario.durationSeconds || 300;
    els.startTime.value = "00:00:00";
    els.endTime.value = formatHms(duration);
    state.appliedStart = 0;
    state.appliedEnd = duration;
    state.appliedTpsGranularity = parsePositiveSeconds(els.tpsGranularity.value) || DEFAULT_GRAPH_GRANULARITY_SECONDS;
    populateSeriesOptions();
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

function applyGroupFilter() {
  if (!state.data) return;
  state.groupFilter = els.groupFilter.value.trim();
  const start = state.appliedStart;
  const end = state.appliedEnd || state.data.result.scenario.durationSeconds || 0;
  const transactions = buildTransactions(start, end);
  renderTable(transactions);
  renderTpsSection(start, end);
}

function resetGroupFilter() {
  els.groupFilter.value = "";
  state.groupFilter = "";
  if (!state.data) return;
  const start = state.appliedStart;
  const end = state.appliedEnd || state.data.result.scenario.durationSeconds || 0;
  const transactions = buildTransactions(start, end);
  renderTable(transactions);
  renderTpsSection(start, end);
}

function resetTimeFilter() {
  if (!state.data) return;
  const duration = state.data.result.scenario.durationSeconds || 0;
  els.startTime.value = "00:00:00";
  els.endTime.value = formatHms(duration);
  state.appliedStart = 0;
  state.appliedEnd = duration;
  renderAll();
}

els.loadBtn.addEventListener("click", loadResult);
els.themeToggle.addEventListener("click", toggleTheme);
els.applyTpsGranularityBtn.addEventListener("click", applyTpsGranularity);
els.resetTpsGranularityBtn.addEventListener("click", resetTpsGranularity);
els.applyTimeBtn.addEventListener("click", applyTimeFilter);
els.resetTimeBtn.addEventListener("click", resetTimeFilter);
els.applyGroupFilterBtn.addEventListener("click", applyGroupFilter);
els.resetGroupFilterBtn.addEventListener("click", resetGroupFilter);
els.groupFilter.addEventListener("keydown", (e) => { if (e.key === "Enter") applyGroupFilter(); });
els.seriesSelect.addEventListener("change", renderAll);
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
  if (event.key === "Escape") closeExpandedPanel();
});
setupChartPanelActions();
applyTheme(localStorage.getItem("loadrunnerTheme") === "dark" ? "dark" : "light");
loadResult();
