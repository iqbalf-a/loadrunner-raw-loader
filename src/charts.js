import { formatHms, currentCssVar } from "./format.js";
import { state, graphByType, resolveSelection, rowsByMeasurement } from "./state.js";
import { composeChartImage } from "./chart-snapshot.js";

const chartInstances = new WeakMap();
export const chartSelectors = new Map();
const searchQueries = new Map();
const seriesSearch = new Map();
const searchListeners = new Set();
const SEARCH_RESULTS_LIMIT = 150;
// Batas baris tabel ketika kotak search panel response time diisi: statistik per nama diambil dari
// server, jadi jangan sampai satu ketikan memunculkan ratusan baris sekaligus.
export const SEARCH_ROWS_LIMIT = 100;

// Isian kotak search di toolbar tabel. Chart-nya sendiri tidak berubah karena search ini; yang
// berubah cuma baris mana yang tampil di tabel, jadi renderer tabel yang membaca nilainya.
export function seriesSearchQuery(key) {
  return (seriesSearch.get(key) ?? "").trim();
}

export function onSeriesSearchChange(listener) {
  searchListeners.add(listener);
}

// getAllNames: full searchable universe (may include series with no data loaded yet).
// getLoadedNames: series currently fetched and ready to plot (the default top-N pool).
// ensureLoaded(names): optional async hook to fetch data for names picked via search that
// aren't in the loaded pool yet — lets users pin a specific transaction outside the top-N.
// maxSeries: maximum selectable series (default 10, Infinity = no limit)
// rankNames(names): optional function to sort candidates by panel metric (avg RT, avg TPS, avg %)
//   for Top 10/30/50 buttons. Default: sort by avg descending.
export function configureChartSelector(key, getAllNames, getLoadedNames, getSelected, setSelected, ensureLoaded, maxSeries = 10, rankNames = null) {
  chartSelectors.set(key, { getAllNames, getLoadedNames, getSelected, setSelected, ensureLoaded, maxSeries, rankNames });
}

function selectorListHtml(names, selected) {
  if (!names.length) return `<div class="chart-series-selector-empty muted">No matches</div>`;
  return names.map((name) => `
    <label><input type="checkbox" value="${escapeHtml(name)}" ${selected.includes(name) ? "checked" : ""}> <span>${escapeHtml(name)}</span></label>
  `).join("");
}

function renderSelectorList(panel) {
  const key = panel.dataset.chartSelector;
  const config = chartSelectors.get(key);
  const selector = panel.querySelector(".chart-series-selector");
  if (!config || !selector) return;

  const allNames = config.getAllNames();
  const loadedNames = new Set(config.getLoadedNames());
  const maxSeries = config.maxSeries ?? 10;
  const selected = resolveSelection(key, allNames, maxSeries);

  const query = (searchQueries.get(key) ?? "").trim().toLowerCase();
  const visibleNames = query
    ? allNames.filter((name) => name.toLowerCase().includes(query)).slice(0, SEARCH_RESULTS_LIMIT)
    : allNames.filter((name) => loadedNames.has(name) || selected.includes(name));

  const countText = maxSeries === Infinity ? `${selected.length}/${allNames.length}` : `${selected.length}/${maxSeries}`;
  selector.querySelector(".chart-series-selector-count").textContent = countText;
  selector.querySelector(".chart-series-selector-list").innerHTML = selectorListHtml(visibleNames, selected);
}

function renderChartSelector(panel) {
  const key = panel.dataset.chartSelector;
  const config = chartSelectors.get(key);
  if (!config) return;
  // Panel yang tabelnya sudah jadi pemilih seri (kolom checkbox) tidak butuh daftar centang
  // di atas grafik -- panel tanpa tabel, seperti chart Load Generator, tetap memakainya.
  if (panel.querySelector("table[data-table]")) return;
  let selector = panel.querySelector(".chart-series-selector");
  const maxSeries = config.maxSeries ?? 10;
  if (!selector) {
    selector = document.createElement("div");
    selector.className = "chart-series-selector";
    const heading = maxSeries === Infinity
      ? `Select series (${config.getAllNames().length} available)`
      : `Select up to ${maxSeries} series`;
    const topButtons = maxSeries !== Infinity
      ? `<div class="chart-series-top-btns">
          <button type="button" class="chart-series-top-btn" data-top="10" title="Pilih 10 seri teratas">Top 10</button>
          <button type="button" class="chart-series-top-btn" data-top="30" title="Pilih 30 seri teratas">Top 30</button>
          <button type="button" class="chart-series-top-btn" data-top="50" title="Pilih 50 seri teratas">Top 50</button>
        </div>`
      : "";
    selector.innerHTML = `
      <div class="chart-series-selector-heading">
        <span>${heading}</span>
        <button type="button" class="chart-series-clear-btn" title="Kosongkan semua pilihan">Deselect All</button>
        ${maxSeries === Infinity ? `<button type="button" class="chart-series-select-all-btn" title="Pilih semua seri">Select All</button>` : ""}
        <span class="chart-series-selector-count"></span>
      </div>
      ${topButtons}
      <input type="search" class="chart-series-search" placeholder="Cari transaksi...">
      <div class="chart-series-selector-list"></div>
    `;
    panel.querySelector(".panel-title")?.after(selector);
    selector.querySelector(".chart-series-search").addEventListener("input", (event) => {
      searchQueries.set(key, event.target.value);
      renderSelectorList(panel);
    });
    selector.querySelector(".chart-series-clear-btn").addEventListener("click", (event) => {
      event.stopPropagation();
      config.setSelected([]);
      renderSelectorList(panel);
    });
    if (maxSeries === Infinity) {
      selector.querySelector(".chart-series-select-all-btn").addEventListener("click", (event) => {
        event.stopPropagation();
        config.setSelected(config.getAllNames());
        renderSelectorList(panel);
      });
    }
    // Top N handlers for BOTH limited AND unlimited panels (expanded panel)
    selector.querySelectorAll(".chart-series-top-btn").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const top = Number(btn.dataset.top);
        const ranked = config.rankNames ? config.rankNames(config.getAllNames()) : config.getAllNames();
        const topNames = ranked.slice(0, top);
        // Fetch missing series data before selecting (same as manual checkbox behavior)
        const loaded = new Set(config.getLoadedNames());
        const missing = topNames.filter((name) => !loaded.has(name));
        if (missing.length && config.ensureLoaded) {
          try {
            await config.ensureLoaded(missing);
          } catch (e) {
            // Ignore fetch errors; selection will still apply to what we have
          }
        }
        config.setSelected(topNames);
        renderSelectorList(panel);
      });
    });
  }
  selector.querySelector(".chart-series-search").value = searchQueries.get(key) ?? "";
  renderSelectorList(panel);
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// Ikon inline (bukan icon font/CDN) supaya dashboard tetap jalan tanpa internet.
const DOWNLOAD_ICON = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></svg>`;
const COPY_ICON = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>`;

export function chartFileName(panel) {
  const title = panel.querySelector(".panel-title")?.innerText ?? "chart";
  // Label tombol ikut terbaca dari judul panel, termasuk label sementara tombol Copy.
  return `${title.replace(/EXPAND|CLOSE|PNG|COPIED!|GAGAL/g, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chart"}.png`;
}

// Dikonfirmasi dulu: tombolnya bersebelahan dengan Expand dan Copy, jadi salah klik gampang
// terjadi dan hasilnya berkas nyasar di folder Downloads tanpa disadari.
export async function downloadChartPng(panel) {
  const canvas = panel.querySelector("canvas");
  const chart = canvas ? chartInstances.get(canvas) : null;
  if (!chart) return;

  const fileName = chartFileName(panel);
  if (!window.confirm(`Download grafik ini sebagai PNG?\n\n${fileName}`)) return;

  const url = URL.createObjectURL(await composeChartImage(panel, chart));
  const link = document.createElement("a");
  link.download = fileName;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function flashButtonLabel(button, text) {
  const original = button.innerHTML;
  button.innerHTML = text;
  button.disabled = true;
  setTimeout(() => {
    button.innerHTML = original;
    button.disabled = false;
  }, 1400);
}

// Menyalin gambar grafik ke clipboard supaya bisa langsung ditempel ke chat atau dokumen laporan,
// tanpa lewat berkas. Clipboard gambar butuh izin browser, jadi kegagalannya dilaporkan di tombol.
export async function copyChartImage(panel, button) {
  const canvas = panel.querySelector("canvas");
  const chart = canvas ? chartInstances.get(canvas) : null;
  if (!chart) return;

  try {
    // Blob-nya diserahkan sebagai Promise: menyusun gambar butuh waktu, dan clipboard.write harus
    // dipanggil selagi klik user masih dianggap aktif oleh browser.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": composeChartImage(panel, chart) })]);
    flashButtonLabel(button, "Copied!");
  } catch {
    flashButtonLabel(button, "Gagal");
  }
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

    const buttonClass = "panel-action-btn h-6 min-w-12 px-2.25 border border-(--line) rounded-[3px] bg-(--surface-raised) text-(--chart-text) text-[10px] font-medium tracking-[0.08em] uppercase cursor-pointer";
    const actions = document.createElement("div");
    actions.className = "panel-actions flex gap-1.5 ml-auto items-center";
    actions.innerHTML = `
      <button class="${buttonClass}" type="button" data-chart-action="expand" style="font-family: var(--font-mono);">Expand</button>
      <button class="${buttonClass}" type="button" data-chart-action="download" title="Download grafik sebagai PNG" style="font-family: var(--font-mono);">${DOWNLOAD_ICON}PNG</button>
      <button class="${buttonClass}" type="button" data-chart-action="copy" title="Salin grafik sebagai gambar" style="font-family: var(--font-mono);">${COPY_ICON}PNG</button>
    `;
    title.appendChild(actions);
    panel.dataset.actionsReady = "true";
  });
  setupSeriesToolbars();
}

// Panel yang sedang di-expand memakai daftar centang di atas grafik supaya picker-nya kelihatan
// lagi setiap kali panel dibuka ulang.
export function refreshExpandedChartSelector(key) {
  const panel = document.querySelector(`.chart-panel.expanded[data-chart-selector="${key}"]`);
  if (panel) renderChartSelector(panel);
}

// Toolbar di sebelah kiri tabel panel: tombol Deselect All, hitungan seri yang sedang digambar,
// dan kotak search. Dipasang sekali per panel yang punya tabel di bawah grafiknya.
function setupSeriesToolbars() {
  document.querySelectorAll(".chart-panel[data-chart-selector]").forEach((panel) => {
    if (panel.dataset.seriesToolbarReady) return;
    const table = panel.querySelector("table[data-table]");
    const wrap = table?.parentElement;
    if (!table || !wrap) return;

    const config = chartSelectors.get(panel.dataset.chartSelector);
    const maxSeries = config?.maxSeries ?? 10;

    const toolbar = document.createElement("div");
    toolbar.className = "series-toolbar";
    const topBtns = `<div class="series-toolbar-top-btns">
        <button type="button" class="series-toolbar-btn" data-top="10" title="Pilih 10 seri teratas">Top 10</button>
        <button type="button" class="series-toolbar-btn" data-top="30" title="Pilih 30 seri teratas">Top 30</button>
        <button type="button" class="series-toolbar-btn" data-top="50" title="Pilih 50 seri teratas">Top 50</button>
      </div>`;
    const selectAllBtn = maxSeries === Infinity
      ? `<button type="button" class="series-toolbar-btn" data-series-action="select-all" title="Pilih semua seri">Select All</button>`
      : "";
    toolbar.innerHTML = `
      <button type="button" class="series-toolbar-btn" data-series-action="clear" title="Kosongkan semua centang, grafik jadi kosong">Deselect All</button>
      ${topBtns}
      ${selectAllBtn}
      <span class="series-toolbar-count muted"></span>
      <input type="search" class="series-toolbar-search" placeholder="Cari transaksi...">
    `;
    wrap.before(toolbar);

    const key = panel.dataset.chartSelector;
    const search = toolbar.querySelector(".series-toolbar-search");
    // Search di panel response time menelusuri nama kandidat yang datanya dari server, jadi query
    // ulang digagalkan sebentar supaya mengetik tidak memicu satu request per ketikan.
    let debounce = 0;
    search.addEventListener("input", (event) => {
      seriesSearch.set(key, event.target.value);
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        for (const listener of searchListeners) listener();
      }, 250);
    });
    toolbar.querySelector("[data-series-action='clear']").addEventListener("click", () => {
      chartSelectors.get(key)?.setSelected([]);
      refreshSeriesToolbars();
    });
    // Select All handler (only for unlimited panels where the button exists)
    if (maxSeries === Infinity) {
      toolbar.querySelector("[data-series-action='select-all']").addEventListener("click", () => {
        const cfg = chartSelectors.get(key);
        if (cfg) {
          cfg.setSelected(cfg.getAllNames());
          refreshSeriesToolbars();
        }
      });
    }
    // Top N handlers for BOTH limited AND unlimited panels
    toolbar.querySelectorAll("[data-top]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const cfg = chartSelectors.get(key);
        if (!cfg) return;
        const top = Number(btn.dataset.top);
        const ranked = cfg.rankNames ? cfg.rankNames(cfg.getAllNames()) : cfg.getAllNames();
        const topNames = ranked.slice(0, top);
        // Fetch missing series data before selecting (same as manual checkbox behavior)
        const loaded = new Set(cfg.getLoadedNames());
        const missing = topNames.filter((name) => !loaded.has(name));
        if (missing.length && cfg.ensureLoaded) {
          try {
            await cfg.ensureLoaded(missing);
          } catch (e) {
            // Ignore fetch errors; selection will still apply to what we have
          }
        }
        cfg.setSelected(topNames);
        refreshSeriesToolbars();
      });
    });

    const headRow = table.querySelector("thead tr");
    if (headRow) {
      const head = document.createElement("th");
      head.className = "series-pick-head";
      head.title = "Pilih atau kosongkan semua baris di tabel ini";
      const toggleAll = document.createElement("input");
      toggleAll.type = "checkbox";
      toggleAll.dataset.seriesAction = "toggle-all";
      head.appendChild(toggleAll);
      headRow.insertBefore(head, headRow.firstChild);
    }
    panel.dataset.seriesToolbarReady = "true";
  });
  refreshSeriesToolbars();
}

// Hitungan "n/10", centang header, dan centang tiap baris semuanya diturunkan dari state, jadi
// cukup dipanggil ulang setiap render -- tidak perlu melacak checkbox mana yang diklik user.
export function refreshSeriesToolbars() {
  document.querySelectorAll(".series-toolbar").forEach((toolbar) => {
    const panel = toolbar.closest("[data-chart-selector]");
    const key = panel?.dataset.chartSelector;
    if (!key) return;
    const config = chartSelectors.get(key);
    const maxSeries = config?.maxSeries ?? 10;
    const selected = new Set(state.chartSelections[key] ?? []);
    toolbar.querySelector(".series-toolbar-search").value = seriesSearch.get(key) ?? "";
    const countText = maxSeries === Infinity ? `${selected.size}/${config.getAllNames().length}` : `${selected.size}/${maxSeries}`;
    toolbar.querySelector(".series-toolbar-count").textContent = `${countText} seri`;
    const rows = [...panel.querySelectorAll("table[data-table] tbody [data-series-pick]")];
    let picked = 0;
    for (const input of rows) {
      input.checked = selected.has(input.value);
      if (input.checked) picked += 1;
    }
    const toggleAll = panel.querySelector("[data-series-action='toggle-all']");
    if (toggleAll) {
      toggleAll.checked = rows.length > 0 && picked === rows.length;
      toggleAll.indeterminate = picked > 0 && picked < rows.length;
    }
  });
}

// Batas maxSeries ada di UI karena satu grafik dengan banyak garis hanya jadi noise.
// Centang yang ditolak kembali seperti semula, dan hitungan di toolbar sempat menuliskan
// alasannya supaya user tahu itu bukan checkbox-nya yang rusak.
function flashSeriesLimit(toolbar) {
  const count = toolbar?.querySelector(".series-toolbar-count");
  if (!count) return;
  const original = count.textContent;
  const panel = toolbar.closest("[data-chart-selector]");
  const key = panel?.dataset.chartSelector;
  const config = key ? chartSelectors.get(key) : null;
  const maxSeries = config?.maxSeries ?? 10;
  count.textContent = maxSeries === Infinity ? "no limit" : `maksimal ${maxSeries} seri`;
  count.classList.add("series-toolbar-count-warn");
  setTimeout(() => {
    count.textContent = original;
    count.classList.remove("series-toolbar-count-warn");
  }, 1400);
}

// Sel kolom pertama tabel: centang di sini yang menentukan seri mana yang digambar grafik panelnya.
export function seriesPickCell(tbody, name) {
  const key = tbody.closest("[data-chart-selector]")?.dataset.chartSelector;
  const checked = key ? (state.chartSelections[key] ?? []).includes(name) : false;
  return `<td class="series-pick-cell"><input type="checkbox" data-series-pick value="${escapeHtml(name)}"${checked ? " checked" : ""} title="Tampilkan seri ini di grafik"></td>`;
}

document.addEventListener("change", async (event) => {
  const toggleAll = event.target.closest("[data-series-action='toggle-all']");
  if (toggleAll) {
    const panel = toggleAll.closest("[data-chart-selector]");
    const key = panel?.dataset.chartSelector;
    const config = chartSelectors.get(key);
    if (!config) return;
    const maxSeries = config.maxSeries ?? 10;
    const names = [...panel.querySelectorAll("table[data-table] tbody [data-series-pick]")].map((input) => input.value);
    let rejected = false;
    if (!toggleAll.checked) {
      config.setSelected([]);
    } else if (maxSeries === Infinity || names.length <= maxSeries) {
      toggleAll.disabled = true;
      try {
        await config.ensureLoaded?.(names);
        config.setSelected(names);
      } finally {
        toggleAll.disabled = false;
      }
    } else {
      toggleAll.checked = false;
      rejected = true;
    }
    // Pesan batas dipasang setelah refreshSeriesToolbars(), karena fungsi itu menulis ulang hitungan.
    refreshSeriesToolbars();
    if (rejected) flashSeriesLimit(toggleAll.closest(".series-toolbar"));
    return;
  }

  const input = event.target.closest("tbody [data-series-pick]");
  if (!input) return;
  const panel = input.closest("[data-chart-selector]");
  const key = panel?.dataset.chartSelector;
  const config = chartSelectors.get(key);
  if (!config) return;
  const maxSeries = config.maxSeries ?? 10;
  const current = config.getSelected();
  const selected = input.checked
    ? [...new Set([...current, input.value])]
    : current.filter((name) => name !== input.value);
  const rejected = maxSeries !== Infinity && selected.length > maxSeries;
  if (rejected) input.checked = false;
  else {
    const loaded = new Set(config.getLoadedNames());
    const missing = selected.filter((name) => !loaded.has(name));
    if (missing.length && config.ensureLoaded) {
      input.disabled = true;
      try {
        await config.ensureLoaded(missing);
      } finally {
        input.disabled = false;
      }
    }
    config.setSelected(selected);
  }
  // Pesan batas dipasang setelah refreshSeriesToolbars(), karena fungsi itu menulis ulang hitungan.
  refreshSeriesToolbars();
  if (rejected) flashSeriesLimit(panel.querySelector(".series-toolbar"));
});

document.addEventListener("change", async (event) => {
  const input = event.target.closest(".chart-series-selector input[type='checkbox']");
  if (!input) return;
  const panel = input.closest(".chart-panel");
  const config = chartSelectors.get(panel?.dataset.chartSelector);
  if (!config) return;
  const maxSeries = config.maxSeries ?? 10;
  const selected = [...panel.querySelectorAll(".chart-series-selector input:checked")].map((checkbox) => checkbox.value);
  if (maxSeries !== Infinity && selected.length > maxSeries) {
    input.checked = false;
    return;
  }
  const loadedNames = new Set(config.getLoadedNames());
  const missing = selected.filter((name) => !loadedNames.has(name));
  if (missing.length && config.ensureLoaded) {
    input.disabled = true;
    try {
      await config.ensureLoaded(missing);
    } finally {
      input.disabled = false;
    }
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
