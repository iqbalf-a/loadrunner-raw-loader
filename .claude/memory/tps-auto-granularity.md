---
name: tps-auto-granularity
description: Granularity grafik dipilih otomatis dari durasi run ala LRA, plus suffix granularity di header Max TPS
metadata:
  type: project
---

Perubahan yang disetujui user pada 2026-09-03, dikerjakan di branch `lokal`:

1. **Auto-granularity** (`src/state.js`) — `autoGranularitySeconds(durationSeconds)` memilih
   langkah terkecil dari `GRANULARITY_STEPS_SECONDS = [5, 10, 15, 30, 60, 120, 300, 600]`
   sehingga jumlah titik grafik <= `TARGET_GRAPH_POINTS` (300). Dipakai saat load result dan
   saat tombol Reset Default (`src/main.js`), menggantikan konstanta tetap 5s. Daftar dimulai
   dari 5s karena LoadRunner menulis raw sample dengan jarak kelipatan 5 detik.
2. **Suffix granularity di header** — `updateTpsGranularityHeaders()` (`src/tables.js`) mengisi
   `[data-granularity-suffix]` di header `Max TPS` (3 tempat di `index.html`), dan
   `renderTpsSummaryHead` menempelkannya untuk tabel modal. Hanya kolom Max yang diberi suffix.

**Why:** LRA memilih granularity menyesuaikan durasi run; dashboard ini sebelumnya fixed 5s
untuk run apa pun, yang memaksimalkan efek kuantisasi di [[tps-max-granularity]].

**How to apply:** Hasil terukur pada run 8148s: granularity auto jadi 30s, median rasio
max/avg turun dari 6.2x ke 1.3x, dan `SUM(avg)` praktis tidak berubah (31.42 -> 31.32 TPS)
sehingga [[tps-avg-untuk-excel]] tetap aman. Input granularity manual tetap ada untuk override.
Kolom Min TPS sama-sama terikat bucket tapi sengaja belum diberi suffix — kandidat jika
keluhan serupa muncul untuk Min.
