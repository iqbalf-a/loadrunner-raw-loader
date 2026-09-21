# LoadRunner Raw Loader — Fitur & Fungsi

Dokumen ini menjelaskan **apa** yang dilakukan aplikasi dan **kenapa**, tanpa menyinggung tampilan.
Dipakai sebagai acuan kalau antarmukanya dirancang ulang: semua yang ada di sini harus tetap ada,
bebas disusun dengan tata letak apa pun.

## Tujuan

LoadRunner Analysis (LRA) lambat dan sering crash saat membuka raw result berukuran besar, sehingga
analisis hasil performance test tertahan dan menghambat jalannya project. Aplikasi ini membaca
folder raw result LoadRunner langsung dan menyajikan metriknya dalam hitungan detik.

**Prinsip yang tidak boleh hilang:**

1. **Angkanya harus apple to apple dengan LRA.** Kalau berbeda, orang tidak akan percaya dan kembali
   ke LRA. Aturan granularity dan cara hitung Min/Avg/Max sengaja meniru LRA.
2. **Cepat pada result besar.** Result 4 GB harus tetap bisa dibuka; parsing dilakukan sekali lalu
   di-cache.
3. **Jalan tanpa internet.** Semua dependensi dipasang lokal, tidak ada CDN.

## Pengguna dan konteks

Performance engineer di tim testing. Alur kerjanya: menjalankan test di Controller, mengumpulkan
folder result, lalu perlu menjawab pertanyaan seperti "transaksi mana yang lambat", "berapa TPS yang
tercapai", "apakah errornya di aplikasi atau di injector", dan "apakah server sanggup".

## Sumber data

Semua dibaca dari folder result, tanpa database eksternal.

| Sumber | Isi |
|---|---|
| `*.lrr` | Metadata skenario dan daftar script (untuk resolusi group name) |
| `RunInfo.ini` | Nama project, nama skenario, tanggal run |
| `sum_data/sum_dat.ini` | Peta graph dan measurement |
| `sum_data/graph_*.dat` | Data time-series: response time, TPS, vusers, SiteScope, monitoring load generator |
| `RawData.map` | Mapping event raw |
| `offline.dat` + `offl_*.def` | Data SiteScope (dipakai CLI) |
| `SqliteDb.db` | Error vuser dan Controller (opsional, boleh di luar folder result) |

Berkas graph dicari di `sum_data` lebih dulu, lalu di folder result. Sebagian result yang dibagikan
sebagai ZIP menaruh salah satu graph (terlihat pada `graph_0.dat` berisi data SiteScope) di akar
folder result, dan pengguna tidak boleh diminta merapikan berkas sebelum memuat result.

## Alur kerja pengguna

1. Isi path folder raw result, lalu muat. Path terakhir yang berhasil diingat untuk sesi berikutnya.
2. Aplikasi mem-parsing lalu menyimpannya sebagai cache; membuka result yang sama lagi jauh lebih cepat.
3. Selama proses, pengguna melihat tahap yang sedang berjalan dan persentase kemajuannya, dan setelah
   selesai melihat total waktu muat.
4. Pengguna mempersempit analisis dengan filter, lalu membaca panel-panel metrik.

## Kontrol global

- **Filter waktu** — batasi analisis ke rentang `HH:MM:SS`. Semua panel mengikuti.
- **Granularity grafik** — lebar bucket waktu dalam detik. Default dipilih otomatis dari durasi run:
  pangkat dua terkecil yang membuat grafik muat dalam 32 titik (meniru LRA). Bisa diubah manual dan
  dikembalikan ke otomatis.
- **Filter group name** — menyaring tabel transaksi dan TPS berdasarkan nama script, memakai wildcard
  `%` (contoh `%mcm%`). Group di-resolve dari kode BP di nama transaksi, bukan dari nama penuh.
- **Tema terang/gelap** — pilihan pengguna, diingat antar sesi.

## Panel

### Overview
Identitas run (project, nama skenario, tanggal), rentang waktu penuh vs rentang yang difilter, dan
ringkasan: jumlah sukses, gagal (berikut persentasenya), total, rata-rata response time, serta puncak
VUsers.

### VUsers Overall
Jumlah vuser berjalan sepanjang skenario.

### Transactions Summary (BP) dan (RPS_)
Satu baris per transaksi: Min, Avg, Max, P90, P95, P99, Std Deviation, Success, Fail, Total, dan
kolom Group. Dipisah dua panel karena `BP` adalah transaksi bisnis, sedangkan `RPS_` adalah rincian
per request di dalam transaksi yang sama.

### Response Time By Transaction dan By API
Grafik response time sepanjang waktu. Panel API khusus measurement berprefiks `RPS_`, dengan
pemeringkatan terpisah supaya tidak kalah bersaing dengan transaksi biasa yang volumenya jauh lebih besar.

### TPS dan RPS
Throughput per satuan waktu, beserta tabel Min/Avg/Max TPS dan jumlah titik per transaksi.
Min dan Max adalah pembacaan grafik sehingga ikut berubah mengikuti granularity, sedangkan Avg adalah
laju murni (total transaksi dibagi rentang waktu) sehingga tidak bergantung granularity — sama dengan
penamaan di LRA.

### TPS Detail
TPS diakumulasi per BP group, bukan per transaksi.

### TPS Overall
TPS seluruh transaksi BP digabung menjadi satu angka dan satu garis.

### CPU Utilization dan Memory Utilization (SiteScope)
Pemakaian CPU dan memory per host yang dipantau, beserta tabel Min/Avg/Max. Mendukung UNIXRES dan
WINRES. Nilai negatif adalah sentinel kegagalan pengambilan data SiteScope, bukan angka asli, dan
tidak ikut dihitung.

### Load Generator Health
CPU, Memory, dan Disk tiap load generator, beserta tabel Avg/Max per host. Host ditandai perlu
diperiksa bila Max CPU atau Memory mencapai 80%, karena di atas itu injector sendiri bisa menjadi
bottleneck sehingga angka response time dan TPS yang terukur tidak murni mencerminkan aplikasi.

### Errors
Dibaca dari `SqliteDb.db`. Path database diisi terpisah dan boleh berupa berkas atau folder, sehingga
panel ini bisa dipakai tanpa memuat raw result; bila dikosongkan, database dicari di folder result dan
folder induknya.

Menampilkan jumlah error per satuan waktu per script, dan tabel yang dikelompokkan per kombinasi
script + kode error + pesan, dengan kolom:

| Kolom | Isi |
|---|---|
| Script | Script asal error |
| Code | Kode error LoadRunner (contoh `-26611`) |
| API Code | Status HTTP aplikasi yang diambil dari teks pesan (contoh `500`) |
| API | Endpoint yang gagal, diambil dari URL di teks pesan |
| Message | Teks pesan error |
| Count | Jumlah kejadian |
| VUsers | Jumlah vuser berbeda yang mengalaminya |
| Injector | Load generator asal |
| First / Last | Kapan pertama dan terakhir terjadi |

Filter khusus panel ini: script, kode error, pencarian teks pesan (mendukung wildcard `%`), dan
rentang waktu opsional yang terpisah dari filter waktu dashboard.

## Perilaku umum

**Tabel**
- Semua kolom bisa diurutkan naik dan turun, termasuk kolom teks.
- Tabel panel menampilkan 20 baris teratas; daftar lengkap dibuka lewat "Show All".
- Daftar lengkap bisa disalin sebagai teks bertab, siap ditempel ke spreadsheet.

**Grafik**
- Setiap panel grafik bisa diperbesar ke layar penuh dan disimpan sebagai PNG.
- Maksimal 10 garis tampil bersamaan; pengguna memilih sendiri lewat pencarian saat panel diperbesar.
- Kandidat garis dibatasi 30 teratas berdasarkan volume, kecuali SiteScope dan monitoring load
  generator yang selalu menampilkan semua host karena jumlahnya memang sedikit dan sudah terkurasi.

**Kemajuan proses**
Persentase dilaporkan dari pekerjaan yang benar-benar berjalan (byte yang sudah dibaca, jumlah query
yang selesai), bukan animasi perkiraan.

## Batasan yang disengaja

- **Tidak ada "TPS per API".** TPS adalah metrik level transaksi bisnis; `RPS_` adalah rincian request
  di dalam transaksi yang sama, sehingga menjumlahkannya sebagai TPS independen salah secara konsep.
- **Hanya membaca.** Aplikasi tidak pernah mengubah folder result. Database error pun dibaca dari
  salinan, karena SQLite membuat berkas pendamping di sebelah berkas aslinya.
- **Satu result per sesi**, tanpa pembandingan antar run.
- **Tanpa autentikasi dan tanpa multi-user** pada versi lokal.

## Antarmuka data (untuk implementasi ulang)

| Endpoint | Fungsi |
|---|---|
| `/api/load` | Parsing dan ingest folder result, mengembalikan metadata skenario |
| `/api/progress` | Kemajuan proses yang sedang berjalan |
| `/api/dashboard` | Data time-series untuk grafik, per bucket waktu |
| `/api/transactions` | Agregat per transaksi (percentile, sukses, gagal) |
| `/api/tps-summary`, `/api/tps-series` | Ringkasan dan time-series TPS per transaksi |
| `/api/tps-detail-summary`, `/api/tps-detail-series` | TPS per BP group |
| `/api/tps-overall` | TPS seluruh transaksi digabung |
| `/api/response-time-series` | Time-series response time, dengan pemeringkatan terpisah untuk `RPS_` |
| `/api/errors` | Ringkasan, rincian, dan pilihan filter dari `SqliteDb.db` |

## Kebutuhan teknis

- Node.js 18+. Panel Errors membutuhkan Node.js 22.5+ karena memakai pembaca SQLite bawaan.
- Parsing dan query berjalan di DuckDB dengan batas memori yang menyesuaikan RAM mesin.
- Tersedia juga mode CLI untuk menghasilkan ringkasan transaksi tanpa membuka antarmuka.
