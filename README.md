# LoadRunner Raw Loader

Parser dan dashboard untuk membaca raw result LoadRunner / OpenText Performance Engineering dari folder result seperti `RawResults_12`.

## Requirement

- Node.js 18 atau lebih baru.

## Cara menjalankan dashboard

```powershell
npm install
npm run dev
```

Dashboard tersedia di `http://127.0.0.1:8787`. Ada dua cara memuat result:

- **Upload ZIP** — drop file ZIP raw result (hasil download dari LoadRunner) ke kotak di toolbar.
- **Raw result path** — isi path folder result di mesin yang menjalankan server, contoh:

```
D:\transfer-kantor\RawResults_12
```

Di mode dev kedua-duanya aktif. `npm run dev` hanya mendengar di `127.0.0.1`; untuk membukanya ke
jaringan (device lain mengakses lewat IP laptop) pakai:

```powershell
npm run dev:lan
```

Vite akan mencetak baris *Network* berisi alamat yang dipakai device lain, misalnya
`http://10.113.55.189:8787/`.

> **Perhatian:** di mode dev, kolom *Raw result path* aktif tanpa batasan folder, jadi siapa pun
> yang bisa menjangkau port itu bisa menyuruh server membaca folder mana saja di laptop kamu.
> Untuk dipakai bersama, jalankan mode produksi (`npm start`) yang membatasi path lewat
> `LR_RESULTS_ROOT` — lihat [Menjalankan di server](#menjalankan-di-server-dipakai-banyak-orang).

## Fitur dashboard

- **Transaction Summary** — tabel min, avg, max, P90, std deviation, success, fail, total per transaksi.
- **TPS By Transaction** — throughput per transaksi dengan granularity bucket yang bisa diatur (default 10s).
- **VUsers Overall** — grafik running vusers sepanjang waktu skenario.
- **Response Time By Transaction** — grafik multi-line per transaksi.
- **SiteScope CPU & Memory** — grafik dan tabel min/avg/max per host (mendukung UNIXRES dan WINRES).
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

## Build untuk production / offline

```powershell
npm run build
```

Output di folder `dist/`, disajikan oleh `node server.js`.

## Menjalankan di server (dipakai banyak orang)

Aplikasi bisa dijalankan di satu server; user membuka lewat browser dari device masing-masing
dan meng-upload file ZIP raw result (bentuk asli hasil download dari LoadRunner). Parsing dan
DuckDB seluruhnya berjalan di server — device user hanya butuh browser.

```powershell
npm install
npm run build
$env:PORT = "8787"
npm start
```

Server offline (tanpa internet): jalankan `npm install` di mesin yang punya internet dengan
Windows/arsitektur yang sama, lalu salin folder `node_modules` apa adanya ke server bersama
source code.

### Jalan dari laptop sendiri, diakses device lain

Tidak harus di server khusus — laptop biasa sudah cukup, selama semua device berada di jaringan
yang sama.

```powershell
npm run build
$env:HOST = "0.0.0.0"
$env:PORT = "8787"
$env:LR_RESULTS_ROOT = "C:\Users\<user>\Downloads"   # opsional, supaya mode path lokal tetap aktif
npm start
```

Cari alamat laptop dengan `ipconfig` (baris *IPv4 Address*), lalu buka dari device lain:
`http://<ip-laptop>:8787`.

Saat pertama kali `npm start`, Windows menampilkan dialog *Allow Node.js to communicate on these
networks* — centang **Private** lalu Allow. Kalau dialognya tidak muncul, buka port secara manual
dari PowerShell **as Administrator** (lihat perintah di bawah).

Yang perlu diingat pada skema ini:

- IP laptop berasal dari DHCP, jadi bisa berubah setelah pindah jaringan atau reconnect.
- Laptop harus menyala dan tidak sleep; begitu sleep, semua sesi yang terbuka putus.
- Upload dari device lain memakai disk laptop kamu (`.loadrunner-cache\<key>.duckdb` menetap).
- Sebagian Wi-Fi kantor/tamu memblokir komunikasi antar-client (AP isolation). Kalau firewall
  sudah dibuka tapi tetap tidak bisa diakses, itu penyebab paling umum.

### Environment variable

| Variable | Default | Keterangan |
|---|---|---|
| `HOST` | `0.0.0.0` | Alamat listen. Isi `127.0.0.1` untuk membatasi ke lokal saja |
| `PORT` | `8787` | Port HTTP |
| `LR_CACHE_DIR` | `.loadrunner-cache` | Lokasi cache DuckDB dan daftar session per browser |
| `LR_UPLOAD_DIR` | `.loadrunner-uploads` | Folder sementara upload dan hasil ekstraksi |
| `LR_RESULTS_ROOT` | *(kosong)* | Kalau diisi, mode "Raw result path" aktif dan path wajib berada di dalam folder ini. Kalau kosong, mode path dimatikan dan hanya upload yang tersedia |
| `LR_MAX_UPLOAD_BYTES` | `4294967296` (4 GB) | Batas ukuran ZIP yang diterima |
| `LR_MAX_EXTRACT_BYTES` | `17179869184` (16 GB) | Batas total byte hasil ekstraksi |
| `LR_INGEST_CONCURRENCY` | `1` | Jumlah ingest yang boleh berjalan bersamaan |
| `LR_KEEP_EXTRACTED` | `0` | Isi `1` untuk menyimpan file mentah hasil ekstraksi (debug) |
| `LR_DUCKDB_MEMORY_LIMIT` | separuh RAM mesin, dibatasi 1-8GB | Batas memori DuckDB. Tanpa batas ini DuckDB memakai sampai 80% RAM mesin |
| `LR_DUCKDB_THREADS` | *(default DuckDB)* | Batasi jumlah thread DuckDB di server kecil, misal `2` |
| `LR_WORKER_MAX_OLD_MB` | *(default Node)* | Batas heap worker ingest dalam MB |

### Kalau muncul "File is already open in node.exe (PID ...)"

DuckDB hanya mengizinkan satu proses membuka file cache untuk **menulis**. Error ini berarti ada
proses Node lain yang masih memegang file tersebut — biasanya `npm run dev` yang belum ditutup di
terminal lain, atau `npm start` sebelumnya yang masih jalan.

```powershell
Get-Process node | Select-Object Id, Path, StartTime      # cari prosesnya
Stop-Process -Id <PID>                                     # hentikan yang tidak terpakai
```

Query dashboard sendiri dibuka read-only, jadi beberapa instance boleh membaca cache yang sama
bersamaan; yang eksklusif hanya proses ingest, dan lock-nya dilepas begitu ingest selesai.

### Kalau muncul "Memory Error: could not allocate block of size ..."

Ini pesan dari DuckDB, artinya `memory_limit` terlalu kecil untuk result tersebut — bukan RAM
mesin yang habis. Default-nya mengikuti RAM mesin (separuh, dibatasi 1-8GB), tapi kalau kamu
pernah menyetel `LR_DUCKDB_MEMORY_LIMIT` ke nilai kecil, naikkan lagi:

```powershell
$env:LR_DUCKDB_MEMORY_LIMIT = "4GB"
```

### Kalau ingest gagal dengan "JavaScript heap out of memory"

Error `FATAL ERROR: ... Committing semi space failed` berarti mesin kehabisan memori yang bisa
di-commit, bukan berarti result-nya rusak. Urutan penanganan:

1. Turunkan porsi DuckDB: `$env:LR_DUCKDB_MEMORY_LIMIT = "512MB"` dan `$env:LR_DUCKDB_THREADS = "2"`.
2. Pastikan hanya satu ingest berjalan (`LR_INGEST_CONCURRENCY=1`, sudah default).
3. Kalau RAM server memang kecil, perbesar pagefile Windows — ingest result 1,4 GB memuncak di
   sekitar 550 MB RSS.

Sebagai referensi di mesin dev (Node 22, Windows x64):

| Result | Ukuran folder | Waktu ingest | Peak RSS |
|---|---|---|---|
| `RawResults_16` | 523 MB | 22 detik | 286 MB |
| `RawResults_49` | 1407 MB | 57 detik | 542 MB |
| `RawResults_204` | 3856 MB | 4 menit | 1651 MB |

Jangan lupa membuka port di Windows Firewall (PowerShell **as Administrator**):

```powershell
New-NetFirewallRule -DisplayName "LoadRunner Dashboard" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private
```

### Cara kerja upload

1. Browser mengirim ZIP ke `/api/upload` (dengan progress bar).
2. Server mengekstrak **hanya** file yang dibaca parser (lihat tabel *File yang dibaca*) — log
   mdrv, folder host, script, dan `output.mdb` dilewati.
3. Ingest berjalan di worker thread terpisah, satu antrean per result, jadi upload besar tidak
   membekukan dashboard user lain.
4. Setelah masuk DuckDB, file mentah dan ZIP-nya dihapus; query berjalan dari
   `.loadrunner-cache\<key>.duckdb`.

Identitas cache diambil dari sha256 isi ZIP. Meng-upload ulang ZIP yang sama — termasuk oleh
orang lain — langsung memakai ulang cache tanpa parsing ulang.

### Session per browser

Satu browser di satu device = satu workspace, ditandai cookie `lr_client`:

- Semua tab pada browser yang sama melihat result yang sama; tab baru otomatis terisi.
- Result browser lain tidak bisa dibuka, walau session key-nya diketahui.
- Untuk membuka dua result sekaligus, pakai browser atau device yang berbeda.

> **Catatan:** ini isolasi, bukan autentikasi. Siapa pun yang bisa menjangkau port tersebut tetap
> bisa membuka aplikasi dan meng-upload result miliknya sendiri.
