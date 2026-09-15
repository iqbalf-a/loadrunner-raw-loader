# LoadRunner Raw Loader

Parser dan dashboard untuk membaca raw result LoadRunner / OpenText Performance Engineering dari folder result seperti `RawResults_12`.

**Author:** Moh. Iqbal Firman Ardiansyah

Dibuat karena LoadRunner Analysis (LRA) lambat dan sering crash saat membuka raw result besar,
sehingga analisis hasil test tertahan dan menghambat jalannya project di tim testing.

Ini branch **`lokal`**: dashboard hanya berjalan di mesin sendiri lewat `npm run dev`, dengan raw
result dibaca dari folder di komputer yang sama. Versi terbaru dan terlengkap (upload ZIP dan mode
server untuk dipakai banyak orang) ada di branch `main` dan dipelihara penulis.

## Requirement

- Node.js 18 atau lebih baru. Panel **Errors** butuh Node.js 22.5+ (memakai `node:sqlite` bawaan).

## Cara menjalankan dashboard

```powershell
npm install
npm run dev
```

Dashboard tersedia di `http://127.0.0.1:8787`. Isi path raw result, contoh:

```
D:\transfer-kantor\RawResults_12
```

## Fitur dashboard

- **Transaction Summary** — tabel min, avg, max, P90, std deviation, success, fail, total per transaksi.
- **TPS By Transaction** — throughput per transaksi dengan granularity bucket yang bisa diatur (default 10s).
- **VUsers Overall** — grafik running vusers sepanjang waktu skenario.
- **Response Time By Transaction** — grafik multi-line per transaksi.
- **SiteScope CPU & Memory** — grafik dan tabel min/avg/max per host (mendukung UNIXRES dan WINRES).
- **Errors** — grafik jumlah error per bucket (per script) dan tabel error per script + kode + pesan
  (count, jumlah vuser, injector, first/last), dibaca dari `SqliteDb.db`. Path DB diisi terpisah
  di panel (file atau folder, bisa tanpa load result); kalau kosong dicari dari folder result. Filter by script, error
  code, teks pesan (`%` sebagai wildcard), dan rentang waktu `HH:MM:SS` opsional yang terpisah dari
  filter waktu dashboard.
- **Filter waktu** — batasi analisis ke rentang `HH:MM:SS` tertentu.
- **Filter group name** — filter tabel transaksi dan TPS berdasarkan group name dengan logika LIKE (`%mcm%`).
- **Kolom Group** — nama group (lowercase) tampil di tabel Transaction Summary dan TPS.
- **Timer load** — menampilkan elapsed time saat loading, dan total waktu load setelah selesai.
- **Dark mode** — toggle dark/light, disimpan di `localStorage`.
- **Expand panel** — setiap panel grafik bisa di-expand full screen.
- **Download PNG** — export grafik sebagai file PNG.

## Filter group name

Group name di-resolve dari `[Scripts]` di file `.lrr`. Contoh group: `bp01_memberlist`, `bp02_mgmfamily_summary`.

Filter menggunakan wildcard `%`:

| Input | Hasil |
|---|---|
| `%mcm%` | Semua transaksi yang group-nya mengandung `mcm` |
| `bp01%` | Semua transaksi milik group yang diawali `bp01` |
| `%_summary` | Group yang diakhiri `_summary` |

Tekan Enter atau klik **Apply** untuk menerapkan filter. Filter berlaku serentak di tabel Transaction Summary dan TPS.

> **Catatan:** Resolusi group name menggunakan heuristik — menghapus segmen angka dari nama transaksi (contoh: `BP01_01_MemberList` → `BP01_MemberList`) lalu mencocokkan dengan nama script. Jika naming convention tidak konsisten, kolom Group akan menampilkan `-`.

## CLI — ringkasan transaksi

```powershell
node .\loadrunner-raw-loader.js "D:\transfer-kantor\RawResults_12" --summary
```

Export ke file:

```powershell
node .\loadrunner-raw-loader.js "D:\transfer-kantor\RawResults_12" --summary --out .\summary.json
```

Export data lengkap termasuk rows time-series:

```powershell
node .\loadrunner-raw-loader.js "D:\transfer-kantor\RawResults_12" --json --out .\full.json
```

## File yang dibaca

| File | Keterangan |
|---|---|
| `*.lrr` | Metadata scenario, script groups |
| `RunInfo.ini` | Info report (company, session, run date) |
| `RawData.map` | Mapping event raw |
| `sum_data\sum_dat.ini` | Mapping graph dan measurement |
| `sum_data\graph_*.dat` | Data graph agregat (response time, TPS, vusers, dll.) |
| `offline.dat` + `offl_*.def` | Data SiteScope (CPU, memory) |
| `SqliteDb.db` | Error vuser dan Controller. Dicari di folder result, lalu di folder induknya (`..\SqliteDb.db` atau `..\SqliteDb.db\SqliteDb.db`). Dibaca dari salinan di `.loadrunner-cache`, file aslinya tidak diubah. |

## Build untuk production / offline

```powershell
npm run build
```

Output di folder `dist/`. Sajikan dengan `vite preview` atau server statis lain.

## Penggunaan memori

Ingest dan query berjalan di DuckDB dengan `memory_limit` yang mengikuti RAM mesin (separuh,
dibatasi 1-8GB). Kalau muncul `Memory Error: could not allocate block of size ...` untuk result
yang sangat besar, naikkan batasnya:

```powershell
$env:LR_DUCKDB_MEMORY_LIMIT = "8GB"
npm run dev
```

`LR_DUCKDB_THREADS` bisa diisi (misal `2`) untuk menekan pemakaian memori di mesin kecil.

Sebagai referensi di mesin dev (Node 22, Windows x64, RAM 16 GB):

| Result | Ukuran folder | Waktu ingest | Peak RSS |
|---|---|---|---|
| `RawResults_16` | 523 MB | 22 detik | 286 MB |
| `RawResults_49` | 1407 MB | 57 detik | 542 MB |
| `RawResults_204` | 3856 MB | 4 menit | 1651 MB |
