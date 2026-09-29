import { currentCssVar } from "./format.js";
import { chartPanelTable } from "./export.js";

// Gambar PNG untuk Copy/Download grafik: judul panel di atas, grafik digambar ulang
// dengan lebar tetap (lebih lebar dari panel di layar), lalu tabel baris yang dicentang di bawah.
// Grafik dibuat ulang, bukan disalin dari canvas di layar, supaya ukurannya tidak bergantung
// pada lebar jendela browser.
const WIDTH = 1400;
const CHART_HEIGHT = 520;
const PADDING = 28;
const SCALE = 2;
const ROW_HEIGHT = 26;
const CELL_PADDING = 12;
const SWATCH_WIDTH = 30;

function panelTitle(panel) {
  const title = panel.querySelector(".panel-title");
  if (!title) return "Chart";
  const first = title.querySelector(":scope > span") ?? title;
  const clone = first.cloneNode(true);
  clone.querySelectorAll("button, .panel-actions").forEach((node) => node.remove());
  // Akhiran "(Chart + Table)" cuma penanda jenis panel di dashboard, tidak berguna di gambar.
  return clone.textContent.replace(/\s+/g, " ").replace(/\s*\((Chart \+ Table|Chart|Table)\)\s*$/, "").trim() || "Chart";
}

function formatCell(value, format) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value !== "number") return String(value);
  if (!Number.isFinite(value)) return "-";
  if (format === "dec3") return value.toFixed(3);
  if (format === "dec2") return value.toFixed(2);
  if (format === "int") return String(Math.round(value));
  return String(value);
}

// Grafik digambar ulang di canvas tersembunyi. Canvas harus menempel di dokumen supaya font
// web ikut terpakai; posisinya di luar layar.
async function renderChartCopy(chart) {
  const holder = document.createElement("div");
  holder.style.cssText = `position:fixed;left:-99999px;top:0;width:${WIDTH - PADDING * 2}px;height:${CHART_HEIGHT}px;`;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH - PADDING * 2;
  canvas.height = CHART_HEIGHT;
  holder.appendChild(canvas);
  document.body.appendChild(holder);
  const ctx = canvas.getContext("2d");
  const datasets = chart.data.datasets.map((dataset) => {
    if (chart.config.type !== "line" || typeof dataset.borderColor !== "string") return { ...dataset, data: [...dataset.data] };
    const gradient = ctx.createLinearGradient(0, 0, 0, CHART_HEIGHT);
    gradient.addColorStop(0, `${dataset.borderColor}38`);
    gradient.addColorStop(1, `${dataset.borderColor}08`);
    return { ...dataset, data: [...dataset.data], backgroundColor: gradient };
  });
  const copy = new Chart(canvas, {
    type: chart.config.type,
    data: { ...chart.data, datasets },
    options: { ...chart.config.options, responsive: false, maintainAspectRatio: false, animation: false, devicePixelRatio: SCALE },
  });
  return {
    canvas,
    dispose() {
      copy.destroy();
      holder.remove();
    },
  };
}

function measureTable(ctx, table) {
  const headerFont = `bold 12px ${currentCssVar("--font-mono")}`;
  const bodyFont = `12px ${currentCssVar("--font-mono")}`;
  const cells = table.rows.map((row) => row.map((value, i) => formatCell(value, table.columns[i].format)));
  const widths = table.columns.map((column, i) => {
    ctx.font = headerFont;
    let width = ctx.measureText(column.header).width;
    ctx.font = bodyFont;
    for (const row of cells) width = Math.max(width, ctx.measureText(row[i]).width);
    return Math.ceil(width) + CELL_PADDING * 2;
  });
  const hasSwatch = table.names.some(Boolean);
  const width = widths.reduce((sum, w) => sum + w, 0) + (hasSwatch ? SWATCH_WIDTH : 0);
  return { cells, widths, width, hasSwatch, headerFont, bodyFont, height: ROW_HEIGHT * (cells.length + 1) };
}

function drawTable(ctx, table, layout, x, y, colors) {
  const { cells, widths, hasSwatch, headerFont, bodyFont } = layout;
  const text = currentCssVar("--text") || "#1c1e1f";
  const muted = currentCssVar("--chart-text") || "#65708f";
  const line = currentCssVar("--line") || "#d6d3c8";
  const isNumeric = (i) => table.columns[i].format !== "text";
  ctx.textBaseline = "middle";

  const drawRow = (values, rowY, font, color, name) => {
    let cellX = x;
    if (hasSwatch) {
      const swatch = name ? colors.get(name) : null;
      if (swatch) {
        ctx.fillStyle = swatch;
        ctx.fillRect(cellX + 6, rowY + ROW_HEIGHT / 2 - 2, SWATCH_WIDTH - 12, 4);
      }
      cellX += SWATCH_WIDTH;
    }
    ctx.font = font;
    ctx.fillStyle = color;
    values.forEach((value, i) => {
      ctx.textAlign = isNumeric(i) ? "right" : "left";
      ctx.fillText(value, isNumeric(i) ? cellX + widths[i] - CELL_PADDING : cellX + CELL_PADDING, rowY + ROW_HEIGHT / 2);
      cellX += widths[i];
    });
    ctx.fillStyle = line;
    ctx.fillRect(x, rowY + ROW_HEIGHT - 1, layout.width, 1);
  };

  drawRow(table.columns.map((column) => column.header), y, headerFont, muted, null);
  cells.forEach((values, r) => drawRow(values, y + ROW_HEIGHT * (r + 1), bodyFont, text, table.names[r]));
  ctx.textAlign = "left";
}

export async function composeChartImage(panel, chart) {
  await document.fonts?.ready;
  const key = panel.dataset.chartSelector || panel.dataset.chartTable;
  const table = key ? chartPanelTable(key) : null;
  const chartCopy = await renderChartCopy(chart);
  try {
    const measure = document.createElement("canvas").getContext("2d");
    const layout = table ? measureTable(measure, table) : null;
    const width = Math.max(WIDTH, layout ? layout.width + PADDING * 2 : 0);
    const headerHeight = 40;
    const height = PADDING + headerHeight + CHART_HEIGHT + (layout ? 20 + layout.height : 0) + PADDING;

    const output = document.createElement("canvas");
    output.width = width * SCALE;
    output.height = height * SCALE;
    const ctx = output.getContext("2d");
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = currentCssVar("--surface-raised") || "#ffffff";
    ctx.fillRect(0, 0, width, height);

    ctx.textBaseline = "top";
    ctx.fillStyle = currentCssVar("--text") || "#1c1e1f";
    ctx.font = `bold 20px ${currentCssVar("--font-display")}`;
    ctx.fillText(panelTitle(panel), PADDING, PADDING);

    const chartY = PADDING + headerHeight;
    ctx.drawImage(chartCopy.canvas, PADDING, chartY, WIDTH - PADDING * 2, CHART_HEIGHT);

    if (layout) {
      const colors = new Map(chart.data.datasets.map((dataset) => [dataset.label, dataset.borderColor]));
      drawTable(ctx, table, layout, PADDING, chartY + CHART_HEIGHT + 20, colors);
    }
    return await new Promise((resolve, reject) => {
      output.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Gagal membuat gambar"))), "image/png");
    });
  } finally {
    chartCopy.dispose();
  }
}
