import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

// Hanya file yang benar-benar dibaca loadLoadRunnerResult() yang diekstrak.
// Sisanya (log mdrv, folder host, script, output.mdb) dilewati.
const WHITELIST = [
  { test: /^[^/]+\.lrr$/i, canonical: (name) => name },
  { test: /^RunInfo\.ini$/i, canonical: () => "RunInfo.ini" },
  { test: /^RawData\.map$/i, canonical: () => "RawData.map" },
  { test: /^offline\.dat$/i, canonical: () => "offline.dat" },
  { test: /^offl_\d+\.def$/i, canonical: (name) => name.toLowerCase() },
  { test: /^sum_data\/sum_dat\.ini$/i, canonical: () => "sum_data/sum_dat.ini" },
  { test: /^sum_data\/graph_\d+\.dat$/i, canonical: (name) => `sum_data/${path.posix.basename(name).toLowerCase()}` },
];

function normalizeEntryName(raw) {
  const name = String(raw).replaceAll("\\", "/").replace(/^\.\//, "");
  if (!name || name.endsWith("/")) return null;
  if (name.startsWith("/") || /^[a-z]:/i.test(name)) return null;
  if (name.split("/").some((segment) => segment === "..")) return null;
  return name;
}

function matchWhitelist(relative) {
  for (const rule of WHITELIST) {
    if (rule.test.test(relative)) return rule.canonical(relative);
  }
  return null;
}

// Root result di dalam ZIP bisa di mana saja: "RawResults_12/...", "a/b/RawResults_12/...",
// atau langsung di root ZIP. Dideteksi dari lokasi file .lrr (fallback RunInfo.ini) terdangkal.
function detectRoot(names) {
  const candidates = names.filter((name) => /\.lrr$/i.test(name) || /(^|\/)RunInfo\.ini$/i.test(name));
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const depth = a.split("/").length - b.split("/").length;
    if (depth !== 0) return depth;
    const lrr = Number(/\.lrr$/i.test(b)) - Number(/\.lrr$/i.test(a));
    return lrr !== 0 ? lrr : a.localeCompare(b);
  });
  const dir = path.posix.dirname(candidates[0]);
  return dir === "." ? "" : `${dir}/`;
}

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (error, zipfile) => {
      if (error) reject(error);
      else resolve(zipfile);
    });
  });
}

function readAllEntries(zipfile) {
  return new Promise((resolve, reject) => {
    const entries = [];
    zipfile.on("entry", (entry) => {
      entries.push(entry);
      zipfile.readEntry();
    });
    zipfile.on("end", () => resolve(entries));
    zipfile.on("error", reject);
    zipfile.readEntry();
  });
}

function openEntryStream(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error) reject(error);
      else resolve(stream);
    });
  });
}

/**
 * Ekstrak file raw result dari ZIP ke targetDir (struktur diratakan ke root result).
 * @returns {Promise<{fileCount: number, bytes: number, root: string}>}
 */
export async function extractResultZip(zipPath, targetDir, options = {}) {
  const maxBytes = Number(options.maxBytes) || Number.MAX_SAFE_INTEGER;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const zipfile = await openZip(zipPath);

  try {
    const entries = await readAllEntries(zipfile);
    const normalized = entries
      .map((entry) => ({ entry, name: normalizeEntryName(entry.fileName) }))
      .filter((item) => item.name !== null);

    const root = detectRoot(normalized.map((item) => item.name));
    if (root === null) {
      throw new Error("ZIP tidak berisi raw result LoadRunner (file .lrr atau RunInfo.ini tidak ditemukan).");
    }

    const selected = [];
    for (const item of normalized) {
      if (!item.name.startsWith(root)) continue;
      const relative = item.name.slice(root.length);
      const canonical = matchWhitelist(relative);
      if (canonical) selected.push({ entry: item.entry, canonical });
    }
    if (!selected.length) {
      throw new Error("ZIP tidak memuat file result yang dibutuhkan (sum_data, RunInfo.ini, dll).");
    }

    await mkdir(path.join(targetDir, "sum_data"), { recursive: true });

    let bytes = 0;
    let done = 0;
    for (const { entry, canonical } of selected) {
      bytes += Number(entry.uncompressedSize) || 0;
      if (bytes > maxBytes) {
        throw new Error(`Isi ZIP melebihi batas ekstraksi (${maxBytes} byte).`);
      }
      const destination = path.join(targetDir, canonical.replaceAll("/", path.sep));
      const stream = await openEntryStream(zipfile, entry);
      await pipeline(stream, createWriteStream(destination));
      done += 1;
      if (onProgress) onProgress({ done, total: selected.length, bytes });
    }

    return { fileCount: selected.length, bytes, root };
  } finally {
    zipfile.close();
  }
}
