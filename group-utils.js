// Resolusi nama transaksi -> BP group, dipakai baik di browser (src/state.js, lewat state.data)
// maupun di server (loadrunner-duckdb-cache.js, lewat session.result) - makanya fungsi di sini
// murni (scriptGroups jadi parameter), tidak menyentuh state global manapun.
export function scriptPrefix(name) {
  const segments = String(name ?? "").split("_");
  return segments.find((segment) => /^[A-Za-z]+\d+[A-Za-z]*$/.test(segment)) ?? null;
}

export function resolveGroupName(name, scriptGroups) {
  if (!scriptGroups?.length) return null;
  const prefix = scriptPrefix(name);
  if (!prefix) return null;
  return scriptGroups.find((g) => scriptPrefix(g.scriptName) === prefix)?.groupName ?? null;
}
