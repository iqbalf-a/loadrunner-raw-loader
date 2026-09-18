import { formatHms, escapeHtml } from "./format.js";
import { state } from "./state.js";

// Peta grup dipakai bersama oleh tab dan heading sidebar, jadi urutan section cukup ditulis sekali
// di sini — markup section dan link nav tidak perlu menandai grupnya sendiri-sendiri.
export const SECTION_GROUPS = [
  { id: "overview", label: "Overview", sections: ["section-overview", "section-vusers"] },
  { id: "transactions", label: "Transactions", sections: ["section-tx-summary", "section-tx-rps", "section-rt-chart", "section-rt-api-chart"] },
  { id: "throughput", label: "Throughput", sections: ["section-tps-chart", "section-tps-api-chart", "section-tps-detail-chart", "section-tps-overall-chart"] },
  { id: "infra", label: "Infrastructure", sections: ["section-infra", "section-lg-health"] },
  { id: "errors", label: "Errors", sections: ["section-errors"] },
];

// Nav CPU/Memory menunjuk anak di dalam section-infra, jadi grupnya dipetakan manual.
const NAV_SECTION_ALIAS = { "section-infra-cpu": "section-infra", "section-infra-memory": "section-infra" };
const VIEW_STORAGE_KEY = "loadrunnerViewGroup";

const els = {
  tabs: document.getElementById("viewTabs"),
  chips: document.getElementById("filterChips"),
};

function readStorage(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage bisa diblokir; preferensi tampilan tidak wajib tersimpan.
  }
}

function groupOfSection(sectionId) {
  const resolved = NAV_SECTION_ALIAS[sectionId] ?? sectionId;
  return SECTION_GROUPS.find((group) => group.sections.includes(resolved))?.id ?? null;
}

// ── Tab: menyaring section yang tampil. "All" mempertahankan halaman penuh seperti sebelumnya,
// supaya membandingkan metrik lintas grup (misal TPS turun saat CPU naik) tetap mungkin.
export function applyViewGroup(groupId, onChanged) {
  state.viewGroup = groupId;
  writeStorage(VIEW_STORAGE_KEY, groupId);

  for (const section of document.querySelectorAll(".app-section")) {
    section.hidden = groupId !== "all" && groupOfSection(section.id) !== groupId;
  }
  for (const link of document.querySelectorAll(".sidebar-nav a")) {
    const visible = groupId === "all" || groupOfSection(link.dataset.navTarget) === groupId;
    link.closest("li").hidden = !visible;
  }
  for (const heading of document.querySelectorAll(".sidebar-nav .nav-heading")) {
    heading.hidden = groupId !== "all" && heading.dataset.navGroup !== groupId;
  }
  for (const tab of els.tabs.querySelectorAll("button")) {
    tab.classList.toggle("active", tab.dataset.viewGroup === groupId);
  }
  // Chart yang sempat hidden ukurannya jadi 0, jadi panel yang muncul lagi perlu digambar ulang.
  onChanged?.();
}

export function initViewTabs(onChanged) {
  const groups = [{ id: "all", label: "All" }, ...SECTION_GROUPS];
  els.tabs.innerHTML = groups.map((group) => `
    <button type="button" class="view-tab" data-view-group="${group.id}">${escapeHtml(group.label)}</button>
  `).join("");
  els.tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view-group]");
    if (button) applyViewGroup(button.dataset.viewGroup, onChanged);
  });

  // Heading grup disisipkan ke sidebar dari peta yang sama, bukan ditulis ulang di markup.
  for (const group of SECTION_GROUPS) {
    const firstLink = [...document.querySelectorAll(".sidebar-nav a")]
      .find((link) => groupOfSection(link.dataset.navTarget) === group.id);
    if (!firstLink) continue;
    const heading = document.createElement("li");
    heading.className = "nav-heading";
    heading.dataset.navGroup = group.id;
    heading.textContent = group.label;
    firstLink.closest("li").before(heading);
  }

  applyViewGroup(readStorage(VIEW_STORAGE_KEY, "all"), onChanged);
}

// ── Chip filter aktif: filter yang mengubah seluruh angka harus selalu terlihat, bukan cuma
// tersimpan di kolom input yang bisa ter-scroll keluar layar.
export function renderFilterChips({ onResetTime, onResetGroup, onResetGranularity }) {
  if (!state.data) {
    els.chips.innerHTML = "";
    return;
  }
  const duration = state.data.result.scenario.durationSeconds || 0;
  const start = state.appliedStart;
  const end = state.appliedEnd || duration;
  const isAllRange = start === 0 && Math.round(end) === Math.round(duration);

  const chips = [
    { key: "time", label: `Time ${formatHms(start)} - ${formatHms(end)}`, active: !isAllRange },
    { key: "granularity", label: `Granularity ${state.appliedTpsGranularity}s`, active: false },
  ];
  if (state.groupFilter) chips.push({ key: "group", label: `Group ${state.groupFilter}`, active: true });

  els.chips.innerHTML = chips.map((chip) => `
    <span class="filter-chip${chip.active ? " changed" : ""}">
      ${escapeHtml(chip.label)}
      ${chip.active || chip.key === "granularity" ? `<button type="button" data-chip-reset="${chip.key}" title="Reset">&times;</button>` : ""}
    </span>
  `).join("");

  els.chips.onclick = (event) => {
    const key = event.target.closest("[data-chip-reset]")?.dataset.chipReset;
    if (key === "time") onResetTime();
    else if (key === "group") onResetGroup();
    else if (key === "granularity") onResetGranularity();
  };
}
