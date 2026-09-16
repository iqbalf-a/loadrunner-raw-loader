// Progres ingest/query yang sedang berjalan, dibaca frontend lewat /api/progress?token=...
// Disimpan di memori proses dev server: umurnya sependek satu request, bukan state yang perlu awet.
const REPORTS = new Map();
const TTL_MS = 5 * 60_000;

const NULL_REPORTER = {
  phase() {},
  set() {},
  done() {},
  fail() {},
};

function prune() {
  const now = Date.now();
  for (const [token, report] of REPORTS) {
    if (now - report.updatedAt > TTL_MS) REPORTS.delete(token);
  }
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

export function startProgress(token) {
  if (!token) return NULL_REPORTER;
  prune();
  const report = { percent: 0, label: "Menyiapkan...", done: false, error: "", updatedAt: Date.now() };
  REPORTS.set(token, report);

  let from = 0;
  let to = 100;
  const update = (percent, label) => {
    report.percent = clampPercent(percent);
    if (label) report.label = label;
    report.updatedAt = Date.now();
  };

  return {
    // Tiap tahap punya jatah rentang persen sendiri, jadi pemanggil cukup lapor 0..1 di dalamnya.
    phase(label, fromPercent, toPercent) {
      from = fromPercent;
      to = toPercent;
      update(fromPercent, label);
    },
    set(fraction) {
      update(from + (to - from) * Math.max(0, Math.min(1, fraction)));
    },
    done() {
      update(100, "Selesai");
      report.done = true;
      // Disimpan sebentar supaya polling terakhir frontend masih dapat status selesai.
      setTimeout(() => REPORTS.delete(token), 5_000).unref?.();
    },
    fail(message) {
      report.error = String(message ?? "");
      report.done = true;
      report.updatedAt = Date.now();
      setTimeout(() => REPORTS.delete(token), 5_000).unref?.();
    },
  };
}

export function readProgress(token) {
  const report = token ? REPORTS.get(token) : null;
  if (!report) return { found: false };
  return { found: true, percent: report.percent, label: report.label, done: report.done, error: report.error };
}
