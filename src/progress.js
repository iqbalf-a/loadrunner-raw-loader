// Overlay loading dengan progress bar. Persen server dibaca lewat polling /api/progress; sisa
// rentangnya dipakai pemanggil untuk tahap yang berjalan di browser (misal query dashboard).
const els = {
  overlay: document.getElementById("loadingOverlay"),
  title: document.getElementById("loadingTitle"),
  phase: document.getElementById("loadingPhase"),
  fill: document.getElementById("loadingBarFill"),
  percent: document.getElementById("loadingPercent"),
  elapsed: document.getElementById("loadingElapsed"),
};

const POLL_MS = 250;
let token = null;
let serverShare = 1;
let startedAt = 0;
let pollTimer = null;
let elapsedTimer = null;

export function newProgressToken() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function setProgress(percent, label) {
  if (els.overlay.hidden) return;
  const safe = Math.max(0, Math.min(100, percent));
  els.fill.style.width = `${safe}%`;
  els.percent.textContent = `${Math.round(safe)}%`;
  if (label) els.phase.textContent = label;
}

async function pollServerProgress() {
  try {
    const response = await fetch(`/api/progress?token=${encodeURIComponent(token)}`);
    if (!response.ok) return;
    const report = await response.json();
    // Belum terdaftar (request belum sampai backend) atau sudah dihapus: biarkan bar apa adanya.
    if (report.found && !report.done) setProgress(report.percent * serverShare, report.label);
  } catch {
    // Polling progres tidak boleh menggagalkan proses utama.
  }
}

export function startLoadingOverlay(title, progressToken, share = 1) {
  token = progressToken;
  serverShare = share;
  startedAt = Date.now();
  els.title.textContent = title;
  els.overlay.hidden = false;
  document.body.classList.add("transaction-modal-open");
  setProgress(0, "Menyiapkan...");
  els.elapsed.textContent = "0.0s";
  elapsedTimer = setInterval(() => {
    els.elapsed.textContent = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  }, 100);
  pollTimer = setInterval(pollServerProgress, POLL_MS);
}

export function finishLoadingOverlay() {
  clearInterval(pollTimer);
  clearInterval(elapsedTimer);
  pollTimer = null;
  elapsedTimer = null;
  token = null;
  els.overlay.hidden = true;
  document.body.classList.remove("transaction-modal-open");
}
