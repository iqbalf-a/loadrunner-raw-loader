// Definisi kolom tabel TPS/RPS, dipakai tiga tempat: template halaman (src/pages.js), renderer
// tabel dan modal (src/tables.js), serta penulis XLSX (src/export.js). Semuanya harus menunjukkan
// urutan dan label kolom yang sama persis -- termasuk tag granularity di Min/Max -- jadi definisinya
// hanya ada di sini.
//
// Bentuk tiap kolom: { key, label, align, format, grained }.
// `align` hanya dipakai markup header. `format` dipakai XLSX (menentukan tampilan sel, bukan
// angkanya) dan snapshot PNG; `grained` menandai kolom yang angkanya ikut lebar bucket, jadi
// labelnya membawa tag @Ns -- Min/Max TPS, bukan Avg.

const tickColumns = (metric) => [
  { key: "minTps", label: `Min ${metric}`, align: "right", format: "dec3", grained: true },
  { key: "avgTps", label: `Avg ${metric}`, align: "right", format: "dec3", grained: false },
  { key: "maxTps", label: `Max ${metric}`, align: "right", format: "dec3", grained: true },
  { key: "points", label: "Points", align: "right", format: "int", grained: false },
];

const withGroup = (nameLabel) => [
  { key: "name", label: nameLabel, align: "left", format: "text", grained: false },
  { key: "groupName", label: "Group", align: "left", format: "text", grained: false },
  ...tickColumns("TPS"),
];

export const TPS_MODE_COLUMNS = {
  transaction: withGroup("Transaction"),
  api: withGroup("API"),
  // TPS Detail: one row per BP group, so the name IS the group -- no separate Group column.
  detail: [
    { key: "name", label: "BP Group", align: "left", format: "text", grained: false },
    ...tickColumns("TPS"),
  ],
  // SiteScope CPU/Memory: satu baris per host, angkanya persen -- bukan TPS, jadi tanpa tag bucket.
  sitescope: [
    { key: "host", label: "Host", align: "left", format: "text", grained: false },
    { key: "min", label: "Min (%)", align: "right", format: "dec3", grained: false },
    { key: "avg", label: "Avg (%)", align: "right", format: "dec3", grained: false },
    { key: "max", label: "Max (%)", align: "right", format: "dec3", grained: false },
  ],
};

// Panel "Overall" hanya punya satu baris, jadi kolom nama tidak ada -- sisanya sama dengan metrik
// yang diukur (TPS untuk transaksi, RPS untuk API).
export function overallColumns(metric) {
  return tickColumns(metric);
}

// Kolom untuk sheet XLSX / tabel PNG. Tag granularity ditambahkan ke header kolom yang bergrained,
// karena label "Min TPS" polos akan dibaca sebagai angka absolut padahal ikut berubah saat bucket
// di Apply. Key groupName dipetakan ke accessor-nya supaya sel kosong jadi "-" seperti di tabel.
export function xlsxColumns(columns, granularityTag) {
  return columns.map(({ key, label, format, grained }) => ({
    header: grained ? `${label} ${granularityTag}` : label,
    key: key === "groupName" ? (row) => row.groupName ?? "-" : key,
    format,
  }));
}
