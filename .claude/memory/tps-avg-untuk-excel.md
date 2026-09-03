---
name: tps-avg-untuk-excel
description: Kolom Avg TPS sengaja tidak diubah supaya user bisa SUM manual di Excel
metadata:
  type: feedback
---

User menghitung total TPS dengan `SUM` kolom Avg TPS secara manual di Excel. Kolom Avg
diminta dibiarkan apa adanya.

**Why:** Desain shared time base di `queryTpsSummary` (`total_buckets` dihitung sekali untuk
seluruh grup yang difilter, bukan per transaksi) memang yang membuat penjumlahan itu sah —
tanpa itu, transaksi yang jarang akan dibagi bucket aktifnya sendiri dan hasil penjumlahannya
jauh overstated.

**How to apply:** Jangan ubah rumus avg tanpa diminta. Ada penyimpangan kecil yang sudah
diketahui dan sengaja dibiarkan: `total_buckets` memakai `count(DISTINCT bucket_index)`
(bucket kosong tidak dihitung), pada run 8148s jadi 812 alih-alih 815, sehingga hasil `SUM`
sekitar 0.4% lebih tinggi. User sudah diberi tahu dan memilih membiarkannya.
Konteks: [[tps-max-granularity]].
