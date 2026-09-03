---
name: tps-auto-granularity
description: Granularity grafik mengikuti aturan pangkat-2 LRA (pangkat 2 terkecil dengan <=32 titik), plus suffix granularity di header Max TPS
metadata:
  type: project
---

Perubahan yang disetujui user pada 2026-09-03, dikerjakan di branch `lokal`:

1. **Auto-granularity ala LRA** (`src/state.js`) — `autoGranularitySeconds(durationSeconds)`
   memilih langkah terkecil dari `GRANULARITY_STEPS_SECONDS =
   [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]` (pangkat 2, detik) sehingga jumlah titik
   grafik <= `TARGET_GRAPH_POINTS` (32). Dipakai saat load result dan saat tombol Reset Default
   (`src/main.js`). `DEFAULT_GRAPH_GRANULARITY_SECONDS = 4` hanya fallback kalau durasi tidak
   terbaca.
2. **Suffix granularity di header** — `updateTpsGranularityHeaders()` (`src/tables.js`) mengisi
   `[data-granularity-suffix]` di header `Max TPS` (3 tempat di `index.html`), dan
   `renderTpsSummaryHead` menempelkannya untuk tabel modal. Hanya kolom Max yang diberi suffix.

**Why:** User mengecek LRA dan melihat default granularity 256 pada run 8148 detik. Angka itu
bukan konstanta: `8148/256 = 31.8` titik sedangkan `128s` sudah 63.7 titik — jadi aturannya
pangkat 2 terkecil yang muat dalam 32 titik. Menyamakan lebar bucket dengan LRA membuat angka
TPS apple to apple, sekaligus menjauhkan Max dari lantai kuantisasi di [[tps-max-granularity]].

**How to apply:** Jangan mematok 256 secara tetap. Pada run 933s, 256s hanya menghasilkan 4
titik grafik dan menurunkan `SUM(avg)` dari 14.89 ke 13.50 TPS (~9%), karena 4 x 256 = 1024
detik melebihi durasi run sehingga pembagi avg kebesaran — itu merusak
[[tps-avg-untuk-excel]]. Aturan pangkat-2 memberi 32s untuk run itu dan `SUM(avg)` tetap 14.89.
Terverifikasi lewat API pada run 8148s: granularity 256s, median rasio max/avg 1.07x
(terburuk 1.52x), `SUM(avg)` 31.09 TPS. Input granularity manual tetap ada untuk override.
Kolom Min TPS sama-sama terikat bucket tapi sengaja belum diberi suffix.
