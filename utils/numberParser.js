const MULTIPLIERS = {
  k: 1e3,
  m: 1e6,
  b: 1e9,
  t: 1e12,
};

function parseCompactNumber(input) {
  const text = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/,/g, "");
  if (!text) return null;

  const match = text.match(/^([+-]?)(\d+(?:\.\d+)?)([kmbt]?)$/i);
  if (!match) return null;

  const sign = match[1] === "-" ? -1 : 1;
  const base = Number(match[2]);
  const suffix = (match[3] || "").toLowerCase();
  if (!Number.isFinite(base)) return null;

  const multiplier = suffix ? MULTIPLIERS[suffix] : 1;
  if (!multiplier) return null;

  const value = sign * base * multiplier;
  if (!Number.isFinite(value)) return null;

  return Math.trunc(value);
}

function expandCompactNumbersInExpression(expression) {
  return String(expression || "").replace(
    /(^|[^\w.])([+-]?\d+(?:\.\d+)?[kmbt])(?=($|[^\w.]))/gi,
    (full, prefix, value) => {
      const parsed = parseCompactNumber(value);
      if (parsed == null) return full;
      return `${prefix}${parsed}`;
    },
  );
}

module.exports = {
  parseCompactNumber,
  expandCompactNumbersInExpression,
};
