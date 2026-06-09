const fs = require("fs");
const path = require("path");

const MARKS_PATH = path.join(__dirname, "..", "anigame_shop_marks.json");
const DEFAULT_MARKS = {
  clanshop_series: [],
  event_only_series: [],
  calendarfragmentshop_cards: [],
};

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeMarks(raw) {
  const marks = { ...DEFAULT_MARKS, ...(raw && typeof raw === "object" ? raw : {}) };
  for (const key of Object.keys(DEFAULT_MARKS)) {
    marks[key] = Array.isArray(marks[key])
      ? marks[key].map((value) => String(value || "").trim()).filter(Boolean)
      : [];
  }
  return marks;
}

function readAnigameShopMarks() {
  try {
    if (!fs.existsSync(MARKS_PATH)) return { ...DEFAULT_MARKS };
    return normalizeMarks(JSON.parse(fs.readFileSync(MARKS_PATH, "utf8")));
  } catch (error) {
    console.error("[anigame] Failed to read shop marker JSON:", error);
    return { ...DEFAULT_MARKS };
  }
}

function writeAnigameShopMarks(marks) {
  const normalized = normalizeMarks(marks);
  fs.writeFileSync(`${MARKS_PATH}.tmp`, `${JSON.stringify(normalized, null, 2)}\n`);
  fs.renameSync(`${MARKS_PATH}.tmp`, MARKS_PATH);
}

function addUnique(values, nextValue) {
  const value = String(nextValue || "").trim();
  if (!value) return false;

  const existing = new Set(values.map(normalizeKey));
  if (existing.has(normalizeKey(value))) return false;

  values.push(value);
  values.sort((a, b) => a.localeCompare(b));
  return true;
}

function addCalendarFragmentShopCard(cardName) {
  const marks = readAnigameShopMarks();
  const changed = addUnique(marks.calendarfragmentshop_cards, cardName);
  if (changed) writeAnigameShopMarks(marks);
  return changed;
}

function addClanShopSeries(seriesName) {
  const marks = readAnigameShopMarks();
  const changed = addUnique(marks.clanshop_series, seriesName);
  if (changed) writeAnigameShopMarks(marks);
  return changed;
}

function addClanShopSeriesForCard(cardName) {
  const name = String(cardName || "").trim();
  if (!name || !global.db?.safeQuery) return false;

  const row = global.db.safeQuery(
    `
    SELECT series
    FROM anigame_cards
    WHERE LOWER(name) = LOWER(?)
      AND COALESCE(series, '') <> ''
    LIMIT 1
    `,
    [name],
    [],
  )?.[0];

  return addClanShopSeries(row?.series);
}

function isCalendarFragmentShopCard(cardName) {
  const target = normalizeKey(cardName);
  if (!target) return false;
  const marks = readAnigameShopMarks();
  return marks.calendarfragmentshop_cards.some((name) => normalizeKey(name) === target);
}

function isClanShopSeries(seriesName) {
  const target = normalizeKey(seriesName);
  if (!target) return false;
  const marks = readAnigameShopMarks();
  return marks.clanshop_series.some((series) => normalizeKey(series) === target);
}

function getAnigameShopCardLabel(card) {
  if (isCalendarFragmentShopCard(card?.name)) return "Vote Card";
  if (isClanShopSeries(card?.series)) return "Clan Shop";
  return "";
}

function getAnigameRaidlistExclusions() {
  const marks = readAnigameShopMarks();
  return {
    series: [...marks.clanshop_series, ...marks.event_only_series],
    cards: marks.calendarfragmentshop_cards,
  };
}

module.exports = {
  MARKS_PATH,
  addCalendarFragmentShopCard,
  addClanShopSeries,
  addClanShopSeriesForCard,
  getAnigameRaidlistExclusions,
  getAnigameShopCardLabel,
  isCalendarFragmentShopCard,
  isClanShopSeries,
  readAnigameShopMarks,
};
