import { state } from "./state.js";

export function parseHms(value) {
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function parsePositiveSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 1 ? Math.round(seconds) : NaN;
}

export function currentCssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

export function formatHms(seconds) {
  const safe = Math.max(0, Math.round(seconds || 0));
  const h = String(Math.floor(safe / 3600)).padStart(2, "0");
  const m = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const s = String(safe % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function formatClockAt(elapsedSeconds) {
  const startTime = Number(state.data?.result?.scenario?.startTime);
  if (!Number.isFinite(startTime)) return "-";
  const date = new Date((startTime + Number(elapsedSeconds || 0)) * 1000);
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function percentile(values, rank) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((rank / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

export function fmtNumber(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString("id-ID") : "0";
}

export function fmtSeconds(seconds) {
  return Number.isFinite(seconds) ? seconds.toFixed(3) : "-";
}

export function fmtMs(seconds) {
  if (!Number.isFinite(seconds)) return "-";
  return `${(seconds * 1000).toFixed(1)} ms`;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
