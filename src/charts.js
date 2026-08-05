import { formatHms, currentCssVar } from "./format.js";
import { graphByType, rowsByMeasurement } from "./state.js";

const chartInstances = new WeakMap();
const chartSelectors = new Map();
export const MAX_SELECTED_SERIES = 10;

export function configureChartSelector(key, getNames, getSelected, setSelected) {
  chartSelectors.set(key, { getNames, getSelected, setSelected });
}

function renderChartSelector(panel) {
  const key = panel.dataset.chartSelector;
  const config = chartSelectors.get(key);
  if (!config) return;
  let selector = panel.querySelector(".chart-series-selector");
  if (!selector) {
    selector = document.createElement("div");
    selector.className = "chart-series-selector";
    panel.querySelector(".panel-title")?.after(selector);
  }

  const names = config.getNames();
  let selected = config.getSelected().filter((name) => names.includes(name));
  if (!selected.length && names.length) {
    selected = names.slice(0, MAX_SELECTED_SERIES);
    config.setSelected(selected);
  }
  selector.innerHTML = `
    <div class="chart-series-selector-heading">Select up to ${MAX_SELECTED_SERIES} series <span>${selected.length}/${MAX_SELECTED_SERIES}</span></div>
    <div class="chart-series-selector-list">${names.map((name) => `
      <label><input type="checkbox" value="${escapeHtml(name)}" ${selected.includes(name) ? "checked" : ""}> <span>${escapeHtml(name)}</span></label>
    `).join("")}</div>`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function chartFileName(panel) {
  const title = panel.querySelector(".panel-title")?.innerText ?? "chart";
  return `${title.replace(/EXPAND|CLOSE|PNG/g, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chart"}.png`;
}

export function downloadChartPng(panel) {
  const canvas = panel.querySelector("canvas");
  const chart = canvas ? chartInstances.get(canvas) : null;
  if (!chart) return;

  const link = document.createElement("a");
  link.download = chartFileName(panel);
  link.href = chart.toBase64Image("image/png", 1);
  link.click();
}

export function resizePanelChart(panel) {
  const canvas = panel.querySelector("canvas");
  const chart = canvas ? chartInstances.get(canvas) : null;
  if (chart) chart.resize();
}

export function closeExpandedPanel() {
  const panel = document.querySelector(".chart-panel.expanded");
  if (!panel) return;
  panel.classList.remove("expanded");
  document.body.classList.remove("chart-expanded-open");
  const button = panel.querySelector("[data-chart-action='expand']");
  if (button) button.textContent = "Expand";
  panel.querySelector(".chart-series-selector")?.remove();
  setTimeout(() => resizePanelChart(panel), 50);
}

export function toggleExpandPanel(panel, button) {
  const isExpanded = panel.classList.toggle("expanded");
  document.body.classList.toggle("chart-expanded-open", isExpanded);
  button.textContent = isExpanded ? "Close" : "Expand";
  if (isExpanded) renderChartSelector(panel);
  else panel.querySelector(".chart-series-selector")?.remove();
  setTimeout(() => resizePanelChart(panel), 50);
}

export function setupChartPanelActions() {
  document.querySelectorAll(".chart-panel").forEach((panel) => {
    if (panel.dataset.actionsReady) return;
    const title = panel.querySelector(".panel-title");
    if (!title) return;

    const actions = document.createElement("div");
    actions.className = "panel-actions flex gap-1.5 ml-auto items-center";
    actions.innerHTML = `
      <button class="panel-action-btn h-6 min-w-12 px-2.25 border border-(--line) rounded-[3px] bg-(--surface-raised) text-(--chart-text) text-[10px] font-medium tracking-[0.08em] uppercase cursor-pointer" type="button" data-chart-action="expand" style="font-family: var(--font-mono);">Expand</button>
      <button class="panel-action-btn h-6 min-w-12 px-2.25 border border-(--line) rounded-[3px] bg-(--surface-raised) text-(--chart-text) text-[10px] font-medium tracking-[0.08em] uppercase cursor-pointer" type="button" data-chart-action="download" style="font-family: var(--font-mono);">PNG</button>
    `;
    title.appendChild(actions);
    panel.dataset.actionsReady = "true";
  });
}

export function refreshExpandedChartSelector(key) {
  const panel = document.querySelector(`.chart-panel.expanded[data-chart-selector="${key}"]`);
  if (panel) renderChartSelector(panel);
}

document.addEventListener("change", (event) => {
  const input = event.target.closest(".chart-series-selector input[type='checkbox']");
  if (!input) return;
  const panel = input.closest(".chart-panel");
  const config = chartSelectors.get(panel?.dataset.chartSelector);
  if (!config) return;
  const selected = [...panel.querySelectorAll(".chart-series-selector input:checked")].map((checkbox) => checkbox.value);
  if (selected.length > MAX_SELECTED_SERIES) {
    input.checked = false;
    return;
  }
  config.setSelected(selected);
  renderChartSelector(panel);
});

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

export function baseChartOptions(xMin = null, xMax = null) {
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
          font: { family: "JetBrains Mono, Consolas, SFMono-Regular, monospace", size: 11 },
        },
      },
      tooltip: {
        backgroundColor: "rgba(5, 7, 13, 0.94)",
        borderColor: "rgba(255, 255, 255, 0.14)",
        borderWidth: 1,
        displayColors: true,
        titleFont: { family: "JetBrains Mono, Consolas, SFMono-Regular, monospace", size: 12, weight: "bold" },
        bodyFont: { family: "JetBrains Mono, Consolas, SFMono-Regular, monospace", size: 12 },
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
          font: { family: "JetBrains Mono, Consolas, SFMono-Regular, monospace", size: 11 },
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
          font: { family: "JetBrains Mono, Consolas, SFMono-Regular, monospace", size: 11 },
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

export function drawBarChart(canvas, labels, values, color) {
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
            font: { family: "JetBrains Mono, Consolas, SFMono-Regular, monospace", size: 10 },
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

export function drawMultiLineChart(canvas, seriesList, xMinOverride = null, xMaxOverride = null) {
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

export function transactionSeries(graphType, start, end, mapper) {
  const graph = graphByType(graphType);
  const colors = ["#00bf8f", "#2f7df6", "#ff416d", "#8b5cf6", "#11c5e5", "#a56b00"];
  const grouped = rowsByMeasurement(graph, start, end);
  return [...grouped.entries()].map(([name, rows], index) => ({
    name,
    color: colors[index % colors.length],
    points: mapper([...rows].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds)),
  }));
}

export function tpsPoints(rows, start, end, granularitySeconds) {
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
