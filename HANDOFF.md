# Handoff — LoadRunner Raw Loader Dashboard

Konteks kerja untuk melanjutkan proyek ini di sesi/model lain. Tempel bagian **"Prompt lanjutan"** di paling bawah sebagai pesan pertama ke model baru.

## Apa proyek ini

Dashboard internal (Vite + vanilla JS + DuckDB) untuk membaca hasil raw LoadRunner (`sum_data/*.dat`) dan menampilkan metrik performance test: response time, TPS, VUsers, dan infra (SiteScope CPU/Memory). Dipakai oleh performance engineer di Bank Mandiri (KOPRA project).

Data uji nyata ada di lokal: `C:\Users\adidata.ardiansyah\Downloads\RawResults_16`, `RawResults_21` (juga `.zip` dan `RawResults_14`). Selalu validasi perubahan pakai salah satu folder ini, jangan cuma percaya build sukses.

## Arsitektur saat ini

**Backend (dev-only, di `vite.config.js` sebagai middleware):**
- `loadrunner-raw-loader.js` — parser mentah asli (jangan diubah kecuali memang perlu, dipakai juga oleh `npm run summary`).
- `loadrunner-duckdb-cache.js` — ingest hasil parse ke DuckDB file (`.loadrunner-cache/<hash>.duckdb` + `.json` metadata), lalu expose 3 query:
  - `queryDashboard` — data chart (time-bucketed), cap top-N series by volume untuk transaksi (default 12) supaya tidak meledak di dataset dengan ribuan transaksi, TAPI `SiteScope` **sengaja tidak di-cap** (lihat komentar di kode) karena sudah dikuratori kecil sejak ingest.
  - `queryTransactions` — agregat P90/P95/P99/success/fail per transaksi, support `namePrefix` (dipakai untuk split "RPS_" / by-API) dan pagination.
  - `queryTpsSummary` — agregat Min/Avg/Max TPS per transaksi dari bucket waktu, sama pola dengan `queryTransactions`.
- Endpoint: `/api/load`, `/api/dashboard`, `/api/transactions`, `/api/tps-summary`.

**Frontend (`src/`), modular ES modules (dipecah dari `main.js` 1033 baris):**
- `state.js` — state object, `sortRows()`, `resolveGroup`/`scriptPrefix` (matching transaksi ke script group via prefix kode BP, BUKAN nama penuh — lihat catatan bug di bawah), leaf module (tanpa dependency internal).
- `format.js` — helper format angka/waktu, leaf module.
- `charts.js` — integrasi Chart.js (chart.js dimuat via `<script>` global non-module di `index.html`, BUKAN via import — jangan diubah jadi bundler import).
- `tables.js` — render tabel + modal "Show All" untuk transaksi & TPS summary.
- `sitescope.js` — render chart & tabel CPU/Memory SiteScope.
- `main.js` — orchestrator tipis: DOM refs (`els`), event wiring, `renderAll()`, scrollspy, sort-click handler.

**Styling:** Tailwind v4 (`@tailwindcss/vite`, dari `node_modules`, bukan CDN — sudah 100% offline) dipakai sebagai utility class LANGSUNG di HTML/JS template string (bukan custom CSS classes). `src/styles.css` cuma berisi: font self-hosted (`public/fonts/*.woff2`, download sekali dari Google Fonts lalu di-vendor lokal — TIDAK boleh diganti balik ke CDN), design token (`--ink`, `--paper`, `--line`, `--signal`, `--ok`, `--danger`, `--surface`, dll di `:root`/`[data-theme="dark"]`), dan beberapa rule yang genuinely tidak bisa jadi utility (pseudo-element, JS-toggled state, modal/expand overlay).

**Desain:** tema "instrument panel teknis" — flat, hairline border, radius kecil (3px), SATU warna aksen (amber `--signal`), graph-paper background texture, font Space Grotesk (display) + JetBrains Mono (data/angka). Bukan lagi glassmorphism/gradient blob seperti sebelumnya.

## Urutan pekerjaan yang sudah selesai (kronologis, sesi ini)

1. DuckDB ingestion + `/api/dashboard`/`/api/transactions` (sudah ada sebelum sesi ini, divalidasi ulang).
2. **Fix bug lock DuckDB**: `openLoadRunnerCache` sempat pakai `DuckDBInstance.create()` (handle mentah, tidak terdaftar di cache singleton) sementara query lain pakai `DuckDBInstance.fromCache()` → bentrok "file already open". Fix: semua pakai `fromCache()`.
3. **Fix bug Group kosong**: `resolveGroup` awalnya strip angka tengah dari nama transaksi lalu cocokkan ke nama script utuh — salah asumsi pola. Fix: cocokkan lewat prefix kode BP (segmen yang match `/^[A-Za-z]+\d+[A-Za-z]*$/`), robust untuk kode berhuruf di belakang (`BP007A`) dan transaksi berprefix `RPS_` (kode BP ada di segmen kedua, bukan pertama).
4. Tambah P95/P99 di Transactions Summary, hapus kolom "RT Points" (tidak dipakai).
5. Panel baru "Transactions Summary (RPS_)" — filter prefix nama `RPS_`, backend dapat parameter `namePrefix`.
6. `TRANSACTION_SUMMARY_LIMIT` 50→20.
7. Hapus default path hardcoded (`D:\transfer-kantor\RawResults_12`) yang bikin ENOENT tiap buka — ganti jadi placeholder kosong + `localStorage` simpan path terakhir yang BERHASIL, tanpa auto-load.
8. **Rombak total desain** (redesign besar, atas permintaan eksplisit user): dari glassmorphism ke instrument-panel, self-host font, sidebar+scrollspy, split file JS jadi modul (lihat Arsitektur di atas).
9. Hapus panel "Time Series" (dropdown pilih series manual) — tidak dipakai lagi.
10. Panel Infrastructure (CPU+Memory) digabung jadi 1 panel visual (atas-bawah, bukan kanan-kiri), TAPI nav sidebar tetap 2 link terpisah ("CPU Utilization"/"Memory Utilization") yang scroll ke 2 anchor `<div>` di dalam panel yang sama.
11. Split "TPS Summary By Transaction" jadi 2 section: "By Transaction" dan "By API" (filter `RPS_`), backend baru `queryTpsSummary`.
12. **Fix bug data SiteScope CPU/Memory sangat sedikit + ada Min -101**:
    - Top-N cap (awalnya didesain buat transaksi yang cardinality meledak) ternyata ikut membatasi SiteScope ke 12 gabungan CPU+Memory padahal ada 74 host CPU + 74 host Memory. Fix: SiteScope dikecualikan total dari cap.
    - Nilai -101 adalah sentinel error SiteScope ("gagal collect"), bukan data asli — di-skip saat ingest (`value < 0` untuk graph_type SiteScope).
    - **Regex Memory ketinggalan 53 dari 74 host** karena raw data punya 2 varian nama: `"Memory Used %"` (pakai spasi) dan `"Memory Used%"` (tanpa spasi) — regex lama cuma cocok yang pakai spasi. Fix: spasi jadi opsional (`Memory Used ?%$`).
13. **Fix bug toolbar menutupi konten saat klik nav**: toolbar `position: sticky` tingginya ~196px (3 baris kontrol) tapi `scroll-margin-top` di-hardcode 64px. Fix: ukur tinggi toolbar dinamis via `ResizeObserver` → set CSS var `--toolbar-height`, dipakai semua section via selector `[id^="section-"]`.
14. **Sortable columns** di SEMUA 6 tabel detail (Transactions Summary, Transactions Summary RPS_, TPS Summary By Transaction, TPS Summary By API, SiteScope CPU, SiteScope Memory) — klik header kolom toggle asc/desc, berlaku untuk SEMUA kolom (nama, group, angka). Implementasi: `state.sort` per tabel di `state.js`, `sortRows()` helper, `data-table`/`data-sort` attribute di `<th>`, indicator ▲/▼, event delegation di `main.js`.
15. **Sortable columns juga di modal "Show All"** (transactionModal & tpsModal) — modal share `state.sort` yang sama dengan tabel panel utama (satu sumber kebenaran per tableKey), tapi setiap tableKey (tx/txRps/tpsSummary/tpsSummaryApi) independen satu sama lain. Klik header di dalam modal TIDAK menutup modal, cuma re-render body-nya (`renderTransactionModalContent`/`renderTpsModalContent`), sementara tabel panel utama di belakang ikut ter-update juga (via `renderAll()`) karena state sort-nya sama.
16. **Hapus panel "TPS Summary By API" sepenuhnya** (nav link + section + tabel + modal reference) — user koreksi konsep: TPS (Transactions Per Second) itu metrik level BUSINESS TRANSACTION, bukan level API/request. Measurement berprefix `RPS_` adalah breakdown per-API dari transaksi yang sama, bukan transaksi independen, jadi "TPS by API" itu category error, bukan sekadar salah label. User pilih hapus total (bukan rename ke "RPS" atau sekadar fix nilai). Semua referensi JS dibersihkan: `els.tpsRpsBody`/`showAllTpsRpsTransactionsBtn`, `state.rpsTpsSummary`, `state.sort.tpsSummaryApi`, case `"tpsSummaryApi"` di `getTableRows()`, fetch `/api/tps-summary?...&namePrefix=RPS_` di `refreshDashboardData()` (endpoint `/api/tps-summary` sendiri TETAP ada, masih dipakai tanpa `namePrefix` untuk "TPS Summary By Transaction").
17. **Fix bug TPS ter-inflasi parah** (user cek ulang: nilai avgTps ~1092/maxTps ~1244 tidak masuk akal) — root cause: `groupNameByMeasurement()` di `loadrunner-duckdb-cache.js` ikut memasukkan measurement berprefix `RPS_` ke peta group→nama, sehingga `queryTpsSummaryByGroup`/`queryTpsSummaryPassFailByGroup` MENJUMLAHKAN count transaksi asli bersama count sub-request `RPS_` yang jauh lebih granular dalam bucket waktu yang sama per group — dua hal ini bukan aktivitas paralel independen, jadi menjumlahkannya melipatgandakan angka secara salah. Fix: `groupNameByMeasurement()` exclude measurement `RPS_`-prefixed dari peta sepenuhnya; kedua fungsi query di-`continue` (skip) untuk measurement yang tidak ada di peta group, bukan fallback ke bucket `"-"`. Tervalidasi ulang di RawResults_21: maxTps per-group sekarang realistis (~91-98 range), bukan lagi ribuan. Ini bug murni di query-time agregasi, TIDAK perlu hapus `.loadrunner-cache/` / re-ingest.

## Cara validasi (PENTING — jangan cuma percaya `npm run build`)

Tidak ada Playwright terinstal permanen (sengaja tidak di-`--save`, supaya tidak masuk `package.json`/lockfile). Pola yang dipakai sepanjang sesi ini:

```bash
# 1. install sementara (dari root proyek, BUKAN dari scratchpad — ESM import perlu node_modules lokal)
npm install --no-save playwright@1.62.0

# 2. jalankan dev server (biasanya port 8787 kepakai proses lain punya user, auto pindah ke 8788)
npm run dev &

# 3. tulis script .mjs pendek pakai `import { chromium } from "playwright"`, load path result asli
#    (C:/Users/adidata.ardiansyah/Downloads/RawResults_16 atau _21), klik/isi form,
#    assert lewat page.evaluate / locator, screenshot ke AppData/Local/Temp kalau perlu verifikasi visual.

# 4. WAJIB bersihkan setelah selesai:
rm -rf node_modules/playwright node_modules/playwright-core node_modules/.bin/playwright
# dan matikan dev server yang dijalankan sendiri (jangan matikan proses user di port lain tanpa izin)
```

Kalau ubah kode backend (`loadrunner-duckdb-cache.js`), **hapus `.loadrunner-cache/`** dulu supaya re-ingest (fingerprint cache tidak tahu logic ingest berubah, cuma tahu file source berubah).

## Task "7 poin" — SELESAI (dikerjakan lintas sesi: scaffolding dari sesi lain + JS wiring di sesi ini)

User minta 7 hal ini (dicatat verbatim dulu, sekarang semua sudah selesai & tervalidasi Playwright + data asli):

1. Response Time By Transaction (chart) — label "(graph)" + custom-select max 10 saat expand.
2. VUsers Overall — pindah ke bawah Overview.
3. TPS By Transaction (chart) — label "(graph)" saja.
4. TPS Summary By Transaction — toggle mode: by transaction / by group / by pass-failed group (total).
5. TPS Summary By API — awalnya "tidak diubah", TAPI kemudian user koreksi ulang dan minta dihapus total (lihat item riwayat #16 & #17 di atas — TPS itu konsep level transaksi, bukan level API).
6. CPU & Memory (SiteScope charts) — max 10 host + custom-select saat expand.
7. Panel baru "Response Time By API" — chart-only, scope `RPS_`, max 10 + custom-select.

**Riwayat pengerjaan (penting untuk konteks)**: sesi lain (kemungkinan "free model" yang disebut user) mengerjakan SEBAGIAN — scaffolding HTML lengkap (semua section/label/select/data-chart-selector attribute sudah ada), mekanisme generic `configureChartSelector`/`renderChartSelector` di `charts.js` (checkbox list max-10, styling di `styles.css`), dan backend `queryTpsSummaryByGroup`/`queryTpsSummaryPassFailByGroup` + endpoint-nya di `vite.config.js`. TAPI `main.js`/`tables.js`/`sitescope.js` **tidak disentuh** — jadi semua infrastruktur itu masih dead code sampai sesi ini menyambungkannya. Cek `git status`/diff kalau perlu verifikasi ulang siapa mengerjakan apa.

**Keputusan desain yang diambil TANPA konfirmasi eksplisit ke user** (pertanyaan klarifikasi sempat ditulis di sini tapi user tidak sempat jawab sebelum minta lanjut kerja) — kalau user komplain, ini yang perlu direvisit:

- **"Maksimal 10" berlaku SELALU** (bukan cuma saat expand) — chart collapsed pun sudah default nampilin 10 series pertama (diambil dari data yang sudah ke-load, bukan random). Alasan: kalau default collapsed tetap unlimited, itu jadi tidak konsisten dengan "cap 10" yang diminta, dan chart collapsed dengan ratusan/ribuan series akan tetap berat/rusak.
- **UI custom-select = checkbox list**, muncul HANYA saat panel di-expand (generic `.chart-series-selector` yang sudah dibangun sesi lain), hilang lagi saat collapse. Implementasi: `configureChartSelector(key, getNames, getSelected, setSelected)` di `main.js` boot, `state.chartSelections[key]` nyimpen pilihan per panel (`responseTime`, `responseTimeApi`, `siteScopeCpu`, `siteScopeMemory`).
- **"Response Time By Transaction"**: pool candidate untuk checkbox = apa pun yang sudah ke-load dari `/api/dashboard` (top-12 by volume, sudah ada sebelumnya) — TIDAK mengakses universe penuh 9248 transaksi. Kalau user mau bisa pilih dari SEMUA transaksi (bukan cuma top-12), perlu fetch-on-demand seperti fitur "Time Series" lama yang sudah dihapus (`ensureFocusSeriesLoaded`) — belum diimplementasi ulang, sengaja diskip demi scope.
- **"Response Time By API"**: BEDA — dibuatkan backend baru `queryResponseTimeSeries` (endpoint `/api/response-time-series`) yang ranking top-30 KHUSUS measurement berprefix `RPS_` (terpisah dari cap `/api/dashboard` yang biasa), supaya tidak kalah bersaing sama transaksi reguler yang volumenya jauh lebih besar (kalau digabung, RPS_ nyaris pasti tidak pernah masuk top-12). Fetch tambahan di `refreshDashboardData`. Pool untuk checkbox = 30 kandidat, default tampil 10.
- **CPU/Memory chart**: pool checkbox = SEMUA host (74 CPU + 74 Memory, sudah unlimited dari fix sebelumnya) — bukan subset, karena datanya memang sudah kecil semua kebutuh di-load.
- **TPS Summary mode "by group"/"by pass-failed group"**: kolom yang dipilih — "by group": Group/Min/Avg/Max TPS/Points (tanpa kolom Transaction). "by pass/failed group": Group/Pass/Fail/Total/Min/Avg/Max TPS/Points, dengan Total = pass+fail (bukan avg TPS). Header tabel (`#tpsSummaryHead`) di-swap dinamis via `renderTpsSummaryHead(target, mode)` di `tables.js`. Sort key di-reset ke `groupName` saat pindah mode selain "transaction" (karena field `name` tidak ada di mode itu).
- **Panel "Response Time By API"**: ditaruh persis setelah "Response Time By Transaction" di urutan section & nav sidebar (id `section-rt-api-chart`, sudah begitu di scaffolding sesi lain, saya ikuti saja).
- **Data by-group/pass-fail-by-group DI-FETCH SELALU** tiap `refreshDashboardData` (bukan on-demand saat ganti mode) — konsisten dengan pola RPS_ transactions yang juga selalu di-fetch. Konsekuensinya, tiap ganti filter waktu/granularity sekarang ada 3 request tambahan (response-time-series, tps-summary-by-group, tps-summary-pass-fail-by-group) — total loading time bertambah sedikit (masih di bawah 2 detik untuk RawResults_21).

Kalau user tidak setuju dengan salah satu keputusan di atas (terutama soal universe checkbox "Response Time By Transaction" yang cuma top-12, bukan semua 9248), itu next follow-up yang paling mungkin diminta.

## Yang BELUM dikerjakan / bisa jadi follow-up

- Tidak ada automated test suite — semua validasi manual/ad-hoc Playwright per sesi.
- `.hermes/` folder muncul sebagai untracked di git status sejak awal sesi — belum pernah disentuh, kemungkinan bukan punya kerjaan ini, jangan dihapus tanpa tanya.
- Backend `/api/dashboard` masih punya param `focusGraphType`/`focusMeasurementId` yang dulunya dipakai fitur "Time Series" (sudah dihapus) — dead capability di backend, tidak berbahaya tapi bisa dibersihkan kalau mau strict.

## Prompt lanjutan

Salin teks di bawah ini sebagai pesan pertama ke model/sesi baru:

> Lanjutkan kerja di project `loadrunner-raw-loader` (dashboard LoadRunner + DuckDB). Baca `HANDOFF.md` di root project ini dulu untuk context lengkap — arsitektur, riwayat fix bug, dan cara validasi (pakai Playwright sementara + data asli di `C:\Users\adidata.ardiansyah\Downloads\RawResults_16` atau `RawResults_21`, JANGAN cuma percaya `npm run build` sukses).
>
> Semua task yang diminta sejauh ini sudah selesai dan tervalidasi. Baca section **"Task '7 poin' — SELESAI"** khususnya bagian "Keputusan desain yang diambil TANPA konfirmasi eksplisit" — itu asumsi yang saya ambil sendiri tanpa sempat dikonfirmasi user, jadi kalau user komplain soal salah satu perilaku fitur baru, cek dulu apa itu related ke salah satu asumsi di situ. Tunggu instruksi task berikutnya dari user setelah kamu selesai baca.
