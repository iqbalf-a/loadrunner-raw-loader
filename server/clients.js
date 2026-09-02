import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR } from "../loadrunner-duckdb-cache.js";

const COOKIE_NAME = "lr_client";
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 3600;
const ENTRY_TTL_MS = 60 * 24 * 3600 * 1000;
const STORE_PATH = path.join(CACHE_DIR, "clients.json");

const clients = loadStore();
let persistTimer = null;

function loadStore() {
  try {
    if (!existsSync(STORE_PATH)) return new Map();
    const raw = JSON.parse(readFileSync(STORE_PATH, "utf8"));
    const now = Date.now();
    return new Map(Object.entries(raw).filter(([, value]) => now - (value.updatedAt ?? 0) < ENTRY_TTL_MS));
  } catch {
    return new Map();
  }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(STORE_PATH, JSON.stringify(Object.fromEntries(clients)), "utf8");
    } catch {
      // Penyimpanan sesi bersifat best-effort; kegagalan tulis tidak boleh menjatuhkan request.
    }
  }, 1000);
  persistTimer.unref?.();
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    result[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return result;
}

/**
 * Satu browser di satu device = satu client id (cookie persisten). Semua tab pada browser
 * itu berbagi result aktif yang sama; browser atau device lain punya client id sendiri.
 */
export function resolveClientId(req, res) {
  if (req.__lrClientId) return req.__lrClientId;
  const existing = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const clientId = /^[a-f0-9]{32,64}$/.test(existing || "") ? existing : randomBytes(24).toString("hex");
  if (clientId !== existing) {
    const cookie = `${COOKIE_NAME}=${clientId}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax`;
    const previous = res.getHeader("Set-Cookie");
    res.setHeader("Set-Cookie", previous ? [].concat(previous, cookie) : cookie);
  }
  req.__lrClientId = clientId;
  return clientId;
}

export function getClientSession(clientId) {
  return clients.get(clientId) ?? null;
}

export function setClientSession(clientId, session, label) {
  clients.set(clientId, { session, label: label ?? null, updatedAt: Date.now() });
  schedulePersist();
}

export function clearClientSession(clientId) {
  clients.delete(clientId);
  schedulePersist();
}
