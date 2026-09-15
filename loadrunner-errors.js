import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { autoGranularitySeconds } from "./src/state.js";

const CACHE_DIR = path.resolve(".loadrunner-cache");
const DB_FILE_NAME = "SqliteDb.db";
const ROWS_LIMIT = 1000;
const openDatabases = new Map();

const SCRIPT_NAME = "COALESCE(NULLIF(s.Script_Name, ''), '(controller)')";
const FROM_MAIN = `FROM Main m
  LEFT JOIN ErrorMessages e ON e.Message_ID = m.Message_ID
  LEFT JOIN Scripts s ON s.Script_ID = m.Script_ID
  LEFT JOIN Injectors i ON i.Injector_ID = m.Injector_ID`;

// LoadRunner menaruh SqliteDb.db di dalam folder RawResults, tapi result yang dikumpulkan manual
// bisa menaruhnya di sebelah folder RawResults, kadang dibungkus folder bernama SqliteDb.db juga.
function candidatePaths(resultDir) {
  const parent = path.dirname(resultDir);
  return [
    path.join(resultDir, DB_FILE_NAME),
    path.join(parent, DB_FILE_NAME, DB_FILE_NAME),
    path.join(parent, DB_FILE_NAME),
  ];
}

// Path dari input panel boleh berupa file database atau folder yang berisi SqliteDb.db.
function explicitPaths(dbPath) {
  const resolved = path.resolve(dbPath);
  return [resolved, path.join(resolved, DB_FILE_NAME), path.join(resolved, DB_FILE_NAME, DB_FILE_NAME)];
}

async function statFile(file) {
  try {
    const info = await stat(file);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

async function findErrorDatabase(candidates) {
  for (const file of candidates) {
    const info = await statFile(file);
    if (info) return { file, info };
  }
  return null;
}

async function loadDatabaseSync() {
  try {
    return (await import("node:sqlite")).DatabaseSync;
  } catch {
    throw new Error(`Membaca SqliteDb.db butuh Node.js 22.5 atau lebih baru (sekarang ${process.version}).`);
  }
}

// Yang dibuka salinannya di cache, bukan file aslinya: SQLite membuat file -shm/-wal di sebelah
// database walau dibuka read-only, dan folder result tidak boleh ikut berubah.
async function openErrorDatabase(candidates) {
  const found = await findErrorDatabase(candidates);
  if (!found) return null;

  const walInfo = await statFile(`${found.file}-wal`);
  const version = [found.info.size, found.info.mtimeMs, walInfo?.size ?? "-", walInfo?.mtimeMs ?? "-"].join(":");
  const sourceKey = createHash("sha256").update(found.file).digest("hex").slice(0, 16);
  const versionKey = createHash("sha256").update(version).digest("hex").slice(0, 8);
  // Versi ikut di nama file: di Windows salinan lama tidak bisa ditimpa selama masih dibuka proses
  // lain (misalnya dev server sebelum restart), jadi versi baru selalu disalin ke file baru.
  const copyPath = path.join(CACHE_DIR, `${sourceKey}-${versionKey}-errors.db`);

  const cached = openDatabases.get(sourceKey);
  if (cached?.copyPath === copyPath) return { db: cached.db, source: found.file };
  cached?.db.close();
  openDatabases.delete(sourceKey);

  const DatabaseSync = await loadDatabaseSync();
  await mkdir(CACHE_DIR, { recursive: true });
  await removeStaleCopies(sourceKey, copyPath);
  if (!await statFile(copyPath)) {
    await copyFile(found.file, copyPath);
    if (walInfo?.size) await copyFile(`${found.file}-wal`, `${copyPath}-wal`);
  }

  const db = new DatabaseSync(copyPath);
  openDatabases.set(sourceKey, { db, copyPath });
  return { db, source: found.file };
}

// Dipakai kalau path ternyata bukan database LoadRunner, supaya salinannya tidak menumpuk di cache.
async function discardCopy(sourceFile) {
  const sourceKey = createHash("sha256").update(sourceFile).digest("hex").slice(0, 16);
  openDatabases.get(sourceKey)?.db.close();
  openDatabases.delete(sourceKey);
  await removeStaleCopies(sourceKey, "");
}

// Best effort: salinan yang masih dikunci proses lain dilewati dan dibersihkan di pemanggilan berikutnya.
async function removeStaleCopies(sourceKey, keepPath) {
  const keepName = keepPath ? path.basename(keepPath) : null;
  for (const name of await readdir(CACHE_DIR)) {
    if (!name.startsWith(`${sourceKey}-`) || (keepName && name.startsWith(keepName))) continue;
    await rm(path.join(CACHE_DIR, name), { force: true }).catch(() => {});
  }
}

// Kolom Time berisi jam dinding lokal Controller tanpa zona waktu. Diasumsikan sama dengan zona
// waktu mesin yang menjalankan dashboard, sama seperti formatClockAt di frontend.
function elapsedBase(db, scenarioStartTime) {
  if (Number.isFinite(scenarioStartTime)) {
    return scenarioStartTime - new Date(scenarioStartTime * 1000).getTimezoneOffset() * 60;
  }
  return get(db, "SELECT MIN(CAST(strftime('%s', Time) AS INTEGER)) AS base FROM Main")?.base ?? 0;
}

const ELAPSED = "(CAST(strftime('%s', m.Time) AS INTEGER) - :base)";

// node:sqlite menolak named parameter yang tidak muncul di SQL, jadi tiap query hanya diberi
// parameter yang benar-benar dipakainya.
function usedParams(sql, values) {
  return Object.fromEntries(Object.entries(values).filter(([name]) => new RegExp(`${name}\\b`).test(sql)));
}

function all(db, sql, values = {}) {
  return db.prepare(sql).all(usedParams(sql, values));
}

function get(db, sql, values = {}) {
  return db.prepare(sql).get(usedParams(sql, values));
}

// session boleh null: panel Errors bisa dipakai hanya dengan path SqliteDb.db, tanpa load result.
// Tanpa result, elapsed dihitung dari error pertama dan granularity dipilih dari rentang errornya.
export async function queryErrors(session, options = {}) {
  const result = session?.result;
  const candidates = options.dbPath ? explicitPaths(options.dbPath) : result ? candidatePaths(result.resultDir) : [];
  if (!candidates.length) throw new Error("Isi path SqliteDb.db, atau load result dulu untuk mencarinya otomatis.");
  const opened = await openErrorDatabase(candidates);
  if (!opened) return { available: false, searched: candidates };
  const { db, source } = opened;
  let hasMainTable = false;
  try {
    hasMainTable = Boolean(get(db, "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'Main'"));
  } catch {
    // File yang bukan SQLite sama sekali gagal di sini ("file is not a database").
  }
  if (!hasMainTable) {
    await discardCopy(source);
    throw new Error(`${source} bukan SqliteDb.db LoadRunner (tabel Main tidak ada).`);
  }

  const values = { ":base": elapsedBase(db, Number(result?.scenario?.startTime)) };
  const where = [];
  if (Number.isFinite(options.start)) {
    where.push(`${ELAPSED} >= :start`);
    values[":start"] = options.start;
  }
  if (Number.isFinite(options.end)) {
    where.push(`${ELAPSED} <= :end`);
    values[":end"] = options.end;
  }
  if (Number.isFinite(options.scriptId)) {
    where.push("m.Script_ID = :script");
    values[":script"] = options.scriptId;
  }
  if (Number.isFinite(options.errorCode)) {
    where.push("m.Error_Code = :code");
    values[":code"] = options.errorCode;
  }
  if (options.message) {
    // Sama dengan filter group: % dari user dipakai apa adanya, selain itu dicari sebagai "mengandung".
    where.push("e.Message_String LIKE :message");
    values[":message"] = options.message.includes("%") ? options.message : `%${options.message}%`;
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totals = get(db, `SELECT COUNT(*) AS errors, COUNT(DISTINCT m.Message_ID) AS messages,
      COUNT(DISTINCT m.Vuser_ID) AS vusers, COUNT(DISTINCT m.Script_ID) AS scripts,
      MIN(${ELAPSED}) AS firstSeconds, MAX(${ELAPSED}) AS lastSeconds
    ${FROM_MAIN} ${whereSql}`, values);
  const granularity = Math.max(1, Math.round(Number(options.granularity) || autoGranularitySeconds(totals.lastSeconds)));

  const groupBy = "GROUP BY m.Script_ID, m.Error_Code, m.Message_ID";
  const rows = all(db, `SELECT ${SCRIPT_NAME} AS scriptName, m.Error_Code AS errorCode,
      COALESCE(e.Message_String, '') AS message, COUNT(*) AS count, COUNT(DISTINCT m.Vuser_ID) AS vusers,
      group_concat(DISTINCT i.Injector_Name) AS injectors,
      MIN(${ELAPSED}) AS firstSeconds, MAX(${ELAPSED}) AS lastSeconds
    ${FROM_MAIN} ${whereSql} ${groupBy}
    ORDER BY count DESC LIMIT ${ROWS_LIMIT}`, values);
  const rowsTotal = get(db, `SELECT COUNT(*) AS n FROM (SELECT 1 ${FROM_MAIN} ${whereSql} ${groupBy})`, values).n;

  const series = all(db, `SELECT CAST(${ELAPSED} / :granularity AS INTEGER) * :granularity AS elapsedSeconds,
      ${SCRIPT_NAME} AS name, COUNT(*) AS value
    ${FROM_MAIN} ${whereSql}
    GROUP BY elapsedSeconds, m.Script_ID ORDER BY elapsedSeconds`, { ...values, ":granularity": granularity });

  // Pilihan dropdown sengaja tidak ikut difilter supaya daftar script/error tetap lengkap.
  const scripts = all(db, `SELECT m.Script_ID AS id, ${SCRIPT_NAME} AS name, COUNT(*) AS count
    FROM Main m LEFT JOIN Scripts s ON s.Script_ID = m.Script_ID
    GROUP BY m.Script_ID ORDER BY name`);
  const codes = all(db, `SELECT code, total AS count, message FROM (
      SELECT m.Error_Code AS code, e.Message_String AS message,
        SUM(COUNT(*)) OVER (PARTITION BY m.Error_Code) AS total,
        ROW_NUMBER() OVER (PARTITION BY m.Error_Code ORDER BY COUNT(*) DESC) AS rank
      FROM Main m LEFT JOIN ErrorMessages e ON e.Message_ID = m.Message_ID
      GROUP BY m.Error_Code, m.Message_ID
    ) WHERE rank = 1 ORDER BY count DESC`);

  return {
    available: true,
    dbPath: source,
    granularity,
    totals,
    rows,
    rowsTotal,
    rowsLimit: ROWS_LIMIT,
    series,
    scripts,
    codes,
  };
}
