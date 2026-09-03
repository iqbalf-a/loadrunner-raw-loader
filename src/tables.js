import { fmtNumber, fmtSeconds, fmtMs, escapeHtml, formatHms } from "./format.js";
import { state, graphByType, inRange, groupLikeToRegex, sortRows, TRANSACTION_SUMMARY_LIMIT } from "./state.js";

export function renderMetrics(target, transactions, start, end) {
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

  target.innerHTML = items.map(([label, value, sub]) => `
    <div class="border border-(--line) bg-(--surface-raised) rounded-[3px] p-[12px_14px]">
      <div class="text-(--chart-text) text-[10px] font-medium uppercase tracking-[0.09em]" style="font-family: var(--font-mono);">${label}</div>
      <div class="mt-1.5 text-(--text) text-[18px] font-medium" style="font-family: var(--font-mono);">${value}</div>
      <div class="mt-1 text-(--chart-text) text-[11px]" style="font-family: var(--font-mono);">${sub}</div>
    </div>
  `).join("");
}

export function renderTable(transactions, tbody, showAllBtn, tableKey) {
  const re = state.groupFilter ? groupLikeToRegex(state.groupFilter) : null;
  const filtered = re ? transactions.filter((tx) => re.test(tx.groupName ?? "")) : transactions;
  const rows = sortRows(filtered, state.sort[tableKey]);
  tbody.innerHTML = renderTransactionRows(rows.slice(0, TRANSACTION_SUMMARY_LIMIT));
  showAllBtn.hidden = rows.length <= TRANSACTION_SUMMARY_LIMIT;
  showAllBtn.textContent = `Show All (${rows.length})`;
}

export function renderTransactionRows(transactions) {
  return transactions.map((tx) => `
    <tr class="hover:bg-(--surface)">
      <td class="px-3.5 py-2.25 border-b border-(--line) text-left whitespace-nowrap">${escapeHtml(tx.name)}</td>
      <td class="px-3.5 py-2.25 border-b border-(--line) text-left whitespace-nowrap muted">${escapeHtml(tx.groupName ?? "-")}</td>
      <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap">${fmtSeconds(tx.min)}</td>
      <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap">${fmtSeconds(tx.avg)}</td>
      <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap">${fmtSeconds(tx.max)}</td>
      <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap">${fmtSeconds(tx.percentile90)}</td>
      <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap">${fmtSeconds(tx.percentile95)}</td>
      <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap">${fmtSeconds(tx.percentile99)}</td>
      <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap">${fmtSeconds(tx.stdDeviation)}</td>
      <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap ok">${fmtNumber(tx.success)}</td>
      <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap fail">${fmtNumber(tx.fail)}</td>
      <td class="px-3.5 py-2.25 border-b border-(--line) text-right whitespace-nowrap">${fmtNumber(tx.samples)}</td>
    </tr>
  `).join("");
}

export function filteredTransactionsFrom(transactions) {
  const re = state.groupFilter ? groupLikeToRegex(state.groupFilter) : null;
  return re ? transactions.filter((tx) => re.test(tx.groupName ?? "")) : transactions;
}

export function renderTransactionModalContent(els, transactions, label, tableKey) {
  const filtered = sortRows(filteredTransactionsFrom(transactions), state.sort[tableKey]);
  els.transactionModalTitle.textContent = `${label} (${filtered.length})`;
  els.transactionModalBody.innerHTML = renderTransactionRows(filtered);
}

export function openTransactionModal(els, transactions, label, tableKey) {
  if (!state.data) return;
  els.transactionModal.dataset.tableKey = tableKey;
  els.transactionModal.dataset.label = label;
  document.getElementById("transactionModalTable").dataset.table = tableKey;
  renderTransactionModalContent(els, transactions, label, tableKey);
  els.transactionModal.hidden = false;
  document.body.classList.add("transaction-modal-open");
  els.closeTransactionModalBtn.focus();
}

export function closeTransactionModal(els) {
  els.transactionModal.hidden = true;
  document.body.classList.remove("transaction-modal-open");
}

const TPS_HEAD_CELL = (sortKey, label, align = "right") => `
  <th class="px-3.5 py-2.5 border-b border-(--line) text-${align} text-(--chart-text) text-[10.5px] tracking-[0.08em] uppercase whitespace-nowrap cursor-pointer select-none" data-sort="${sortKey}">${label} <span class="sort-indicator text-(--signal)"></span></th>
`;

const TPS_MODE_COLUMNS = {
  transaction: [
    ["name", "Transaction", "left"], ["groupName", "Group", "left"],
    ["minTps", "Min TPS"], ["avgTps", "Avg TPS"], ["maxTps", "Max TPS"], ["points", "Points"],
  ],
  api: [
    ["name", "API", "left"], ["groupName", "Group", "left"],
    ["minTps", "Min TPS"], ["avgTps", "Avg TPS"], ["maxTps", "Max TPS"], ["points", "Points"],
  ],
  // TPS Detail: one row per BP group, so the name IS the group — no separate Group column.
  detail: [
    ["name", "BP Group", "left"],
    ["minTps", "Min TPS"], ["avgTps", "Avg TPS"], ["maxTps", "Max TPS"], ["points", "Points"],
  ],
};

// Which field the group-filter wildcard matches against for a given mode: for transaction/api rows
// it's the resolved groupName column, but detail rows ARE already one-row-per-group, so the name
// itself is the group.
function groupFilterField(mode) {
  return mode === "detail" ? "name" : "groupName";
}

// Min/Max TPS are graph readings (lowest/highest plotted bucket), so they move with bucket width
// — same as Min/Max in the LoadRunner Analysis graph legend. Granularity is tagged onto both
// headers so those numbers aren't read as standalone absolutes. Avg TPS is a plain rate (total
// transactions / elapsed window) and is intentionally NOT bucket-dependent, matching LRA's own
// Min/Avg/Max naming — LRA never calls it "Avg graph", only Min and Max carry that framing.
function granularitySuffix() {
  return `<span class="muted normal-case">@${state.appliedTpsGranularity}s</span>`;
}

function tpsHeadLabel(key, label) {
  return key === "maxTps" || key === "minTps" ? `${label} ${granularitySuffix()}` : label;
}

export function renderTpsSummaryHead(target, mode) {
  const columns = TPS_MODE_COLUMNS[mode] ?? TPS_MODE_COLUMNS.transaction;
  target.innerHTML = columns.map(([key, label, align]) => TPS_HEAD_CELL(key, tpsHeadLabel(key, label), align)).join("");
}

// Header tabel TPS di panel utama ditulis statis di index.html, jadi suffix granularity-nya
// disuntikkan ke elemen penampung setiap kali panel dirender ulang.
export function updateTpsGranularityHeaders() {
  document.querySelectorAll("[data-granularity-suffix]").forEach((el) => {
    el.textContent = `@${state.appliedTpsGranularity}s`;
  });
}

function tpsCell(value, align = "right", cls = "") {
  return `<td class="px-3.5 py-2.25 border-b border-(--line) text-${align} whitespace-nowrap ${cls}">${value}</td>`;
}

const TPS_CELL_RENDERERS = {
  name: (tx) => tpsCell(escapeHtml(tx.name), "left"),
  groupName: (tx) => tpsCell(escapeHtml(tx.groupName ?? "-"), "left", "muted"),
  minTps: (tx) => tpsCell(tx.minTps.toFixed(3)),
  avgTps: (tx) => tpsCell(tx.avgTps.toFixed(3)),
  maxTps: (tx) => tpsCell(tx.maxTps.toFixed(3)),
  points: (tx) => tpsCell(fmtNumber(tx.points), "right", "muted"),
};

export function renderTpsSummaryRows(rows, mode = "transaction") {
  const columns = TPS_MODE_COLUMNS[mode] ?? TPS_MODE_COLUMNS.transaction;
  return rows.map((tx) => `
    <tr class="hover:bg-(--surface)">
      ${columns.map(([key]) => TPS_CELL_RENDERERS[key](tx)).join("")}
    </tr>
  `).join("");
}

export function renderTpsSummaryTable(rows, tbody, showAllBtn, tableKey, mode = "transaction") {
  const field = groupFilterField(mode);
  const re = state.groupFilter ? groupLikeToRegex(state.groupFilter) : null;
  const filtered = sortRows(re ? rows.filter((tx) => re.test(tx[field] ?? "")) : rows, state.sort[tableKey]);
  tbody.innerHTML = renderTpsSummaryRows(filtered.slice(0, TRANSACTION_SUMMARY_LIMIT), mode);
  showAllBtn.hidden = filtered.length <= TRANSACTION_SUMMARY_LIMIT;
  showAllBtn.textContent = `Show All (${filtered.length})`;
}

export function renderTpsModalContent(els, rows, label, tableKey, mode = "transaction") {
  const field = groupFilterField(mode);
  const re = state.groupFilter ? groupLikeToRegex(state.groupFilter) : null;
  const filtered = sortRows(re ? rows.filter((tx) => re.test(tx[field] ?? "")) : rows, state.sort[tableKey]);
  els.tpsModalTitle.textContent = `${label} (${filtered.length})`;
  renderTpsSummaryHead(els.tpsModalHead, mode);
  els.tpsModalBody.innerHTML = renderTpsSummaryRows(filtered, mode);
}

export function renderTpsOverall(target, overall) {
  target.innerHTML = `
    <tr>
      ${tpsCell(overall.minTps.toFixed(3))}
      ${tpsCell(overall.avgTps.toFixed(3))}
      ${tpsCell(overall.maxTps.toFixed(3))}
      ${tpsCell(fmtNumber(overall.points), "right", "muted")}
    </tr>
  `;
}

export function openTpsModal(els, rows, label, tableKey, mode = "transaction") {
  if (!state.data) return;
  els.tpsModal.dataset.tableKey = tableKey;
  els.tpsModal.dataset.label = label;
  els.tpsModal.dataset.mode = mode;
  document.getElementById("tpsModalTable").dataset.table = tableKey;
  renderTpsModalContent(els, rows, label, tableKey, mode);
  els.tpsModal.hidden = false;
  document.body.classList.add("transaction-modal-open");
  els.closeTpsModalBtn.focus();
}

export function closeTpsModal(els) {
  els.tpsModal.hidden = true;
  document.body.classList.remove("transaction-modal-open");
}
