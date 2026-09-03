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
};

// Max TPS adalah nilai tertinggi dari titik-titik grafik, jadi angkanya ikut berubah kalau lebar
// bucket diganti — sama seperti Maximum di legend grafik LoadRunner Analysis. Granularity-nya
// ditempel ke header supaya angka itu tidak terbaca sebagai peak absolut yang berdiri sendiri.
function granularitySuffix() {
  return `<span class="muted normal-case">@${state.appliedTpsGranularity}s</span>`;
}

function tpsHeadLabel(key, label) {
  return key === "maxTps" ? `${label} ${granularitySuffix()}` : label;
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

export function renderTpsSummaryRows(rows, mode = "transaction") {
  return rows.map((tx) => `
    <tr class="hover:bg-(--surface)">
      ${tpsCell(escapeHtml(tx.name), "left")}
      ${tpsCell(escapeHtml(tx.groupName ?? "-"), "left", "muted")}
      ${tpsCell(tx.minTps.toFixed(3))}
      ${tpsCell(tx.avgTps.toFixed(3))}
      ${tpsCell(tx.maxTps.toFixed(3))}
      ${tpsCell(fmtNumber(tx.points), "right", "muted")}
    </tr>
  `).join("");
}

export function renderTpsSummaryTable(rows, tbody, showAllBtn, tableKey, mode = "transaction") {
  const re = state.groupFilter ? groupLikeToRegex(state.groupFilter) : null;
  const filtered = sortRows(re ? rows.filter((tx) => re.test(tx.groupName ?? "")) : rows, state.sort[tableKey]);
  tbody.innerHTML = renderTpsSummaryRows(filtered.slice(0, TRANSACTION_SUMMARY_LIMIT), mode);
  showAllBtn.hidden = filtered.length <= TRANSACTION_SUMMARY_LIMIT;
  showAllBtn.textContent = `Show All (${filtered.length})`;
}

export function renderTpsModalContent(els, rows, label, tableKey, mode = "transaction") {
  const re = state.groupFilter ? groupLikeToRegex(state.groupFilter) : null;
  const filtered = sortRows(re ? rows.filter((tx) => re.test(tx.groupName ?? "")) : rows, state.sort[tableKey]);
  els.tpsModalTitle.textContent = `${label} (${filtered.length})`;
  renderTpsSummaryHead(els.tpsModalHead, mode);
  els.tpsModalBody.innerHTML = renderTpsSummaryRows(filtered, mode);
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
