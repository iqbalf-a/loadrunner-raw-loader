---
name: tps-max-granularity
description: Kolom Max TPS terikat lebar bucket, bukan peak beban — sebab keluhan "max terlalu jauh dari avg" dan cara penanganannya
metadata:
  type: project
---

Max TPS di tabel TPS Summary **sudah** identik dengan "Maximum" di legend grafik LoadRunner
Analysis: `queryTpsSummary` memakai `max(bucket_total / granularity)` dan `queryTpsSeries`
memplot `bucket_total / granularity`, dengan bucketing dan granularity yang sama
(`src/main.js` mengirim satu `state.appliedTpsGranularity` ke kedua endpoint).

Raw `es_tr_tprange_pass` adalah data **event-level**, bukan rate: `value` rata-rata 1.002
(min 1, max 5), jarak antar sample kelipatan 5 detik. Akibatnya untuk transaksi yang jarang,
bucket terpadat hanya berisi 1 transaksi dan Max jatuh ke lantai kuantisasi `1/granularity`.
Terukur di run 8148s (RawResults_136, 765 transaksi BP): pada bucket 10s, 726 dari 765
transaksi menampilkan Max = 0.1 TPS persis.

**Why:** Rasio max/avg yang terlihat ekstrem adalah fungsi dari lebar bucket, bukan sifat
sistem yang dites. Terbukti dari `BP007A_03_Login`: max 0.2000 @5s -> 0.0333 @30s (turun 6x
mengikuti rasio granularity) sementara avg tetap 0.0052. Inilah alasan LRA tidak menaruh
Max di tabel summary, hanya di legend grafik yang granularity-nya terlihat.

**How to apply:** Jangan "perbaiki" rumus Max — rumusnya sudah benar. Yang menentukan
kewajaran angka adalah granularity default. Jangan pernah menjumlahkan kolom Max
(`SUM(max)` = 80.9 vs `SUM(avg)` = 31.4 TPS pada run yang sama, overstated 2.6x).
Lihat [[tps-auto-granularity]] dan [[tps-avg-untuk-excel]].
