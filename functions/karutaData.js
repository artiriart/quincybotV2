function normalizeKarutaDisplay(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeKarutaKey(value) {
  return normalizeKarutaDisplay(value).toLowerCase();
}

function compactKarutaKey(value) {
  return canonicalizeKarutaKey(value).replace(/\s+/g, "");
}

function buildKarutaIdentity(input) {
  const displayName = normalizeKarutaDisplay(
    input?.displayName ?? input?.display_name ?? input?.name ?? "",
  );
  const displaySeries = normalizeKarutaDisplay(
    input?.displaySeries ?? input?.display_series ?? input?.series ?? "",
  );
  const name = canonicalizeKarutaKey(displayName);
  const series = canonicalizeKarutaKey(displaySeries);

  if (!name || !series) return null;

  return {
    name,
    series,
    displayName,
    displaySeries,
  };
}

function parseKarutaResultLine(rawLine) {
  const line = normalizeKarutaDisplay(rawLine);
  if (!line) return null;

  const match = line.match(
    /^(?:`?\d+`?)\.\s*`?\u2661([\d,]+)`?\s*[\u00B7\u2022]\s*(.+?)\s*[\u00B7\u2022]\s*\*\*(.+?)\*\*(?:\s*`[^`]+`)?$/i,
  );
  if (!match) return null;

  const wishlist = Number.parseInt(
    String(match[1] || "").replaceAll(",", ""),
    10,
  );
  const displaySeries = normalizeKarutaDisplay(match[2]);
  const displayName = normalizeKarutaDisplay(match[3]);

  if (!displayName || !displaySeries || !Number.isFinite(wishlist)) {
    return null;
  }

  return {
    displayName,
    displaySeries,
    wishlist,
  };
}

module.exports = {
  normalizeKarutaDisplay,
  canonicalizeKarutaKey,
  compactKarutaKey,
  buildKarutaIdentity,
  parseKarutaResultLine,
};
