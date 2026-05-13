# LoadRunner Raw Loader

Parser sederhana untuk membaca raw result LoadRunner/OpenText Performance Engineering dari folder result seperti `RawResults_12`.

## Requirement

- Node.js 18 atau lebih baru.

## Cara menjalankan

Dari PowerShell:

```powershell
cd "C:\Users\user\Documents\Codex\2026-05-12\d-transfer-kantor-rawresults-12-itu\loadrunner-raw-loader"

node .\loadrunner-raw-loader.js "D:\transfer-kantor\RawResults_12" --summary
```

Untuk export summary ke file:

```powershell
node .\loadrunner-raw-loader.js "D:\transfer-kantor\RawResults_12" --summary --out .\loadrunner-summary.json
```

Output summary transaksi berisi `success`, `fail`, `samples` sebagai total transaksi (`success + fail`), serta `min`, `avg`, `max`, dan `percentile90` untuk response time. Field `responseTimeSamples` adalah jumlah titik data agregat response time, bukan total transaksi. Jika graph fail tidak ada di raw result, nilai `fail` akan `0`.

Untuk export data lengkap, termasuk rows time-series:

```powershell
node .\loadrunner-raw-loader.js "D:\transfer-kantor\RawResults_12" --json --out .\loadrunner-full.json
```

## Pakai untuk raw result lain

Ganti argumen folder result-nya saja:

```powershell
node .\loadrunner-raw-loader.js "D:\path\ke\RawResults_lain" --summary
```

Loader ini membaca:

- `*.lrr` untuk metadata scenario.
- `RunInfo.ini` untuk info report.
- `RawData.map` untuk mapping event raw.
- `sum_data\sum_dat.ini` untuk mapping graph dan measurement.
- `sum_data\graph_*.dat` untuk data graph agregat.
- `offline.dat` dan `offl_*.def` untuk SiteScope/offline datapoint.
## Dashboard HTML

Untuk development dengan Vite:

```powershell
npm install
npm run dev
```

Vite dashboard akan tersedia di:

```text
http://127.0.0.1:5173/dashboard.html
```

Untuk build static:

```powershell
npm run build
node .\server.js
```

Setelah build, `server.js` otomatis menyajikan `dist\index.html`.

Jalankan server lokal:

```powershell
cd "D:\transfer-kantor\loadrunner-raw-loader"
node .\server.js
```

Buka browser ke:

```text
http://127.0.0.1:8787
```

Di dashboard, isi raw result path, contoh:

```text
D:\transfer-kantor\RawResults_12
```

Filter waktu memakai format `HH:MM:SS`, misalnya `00:00:00` sampai `00:05:00`.

Dashboard memakai Tailwind CSS dan Chart.js dari dependency/file lokal, bukan CDN. Jalankan `npm run build` sebelum deploy agar CSS Tailwind dikompilasi ke `dist\assets\*.css`; setelah itu dashboard bisa berjalan offline di Windows Server lewat `node .\server.js`.

