const SWS_PRESET_DRAFT_STATE = "sws_preset_draft";

function parseEmojiValue(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const custom = text.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
  if (custom) {
    return {
      id: custom[3],
      name: custom[2],
      animated: custom[1] === "a",
    };
  }

  if (text.length <= 8) {
    return { name: text };
  }

  return null;
}

function parseEdit3ReactionIdentifier() {
  const raw = global.db.getFeatherEmojiMarkdown("edit-3") || "✏️";
  const parsed = parseEmojiValue(raw);
  if (!parsed) return "✏️";
  if (parsed.id && parsed.name) return `${parsed.name}:${parsed.id}`;
  return parsed.name || "✏️";
}

function parseSaveEmoji() {
  return parseEmojiValue(global.db.getFeatherEmojiMarkdown("save") || "💾") || {
    name: "💾",
  };
}

function normalizeFieldText(field, keyA, keyB) {
  const primary = String(field?.[keyA] || "").trim();
  if (primary) return primary;
  return String(field?.[keyB] || "").trim();
}

function isSwsAllyInfoEmbed(embed) {
  const authorName = String(embed?.author?.name || "").trim();
  if (!authorName || !/ally\s*:/i.test(authorName)) return false;

  const fields = Array.isArray(embed?.fields) ? embed.fields : [];
  const hasEquipmentField = fields.some((field) => {
    const value = normalizeFieldText(field, "value", "rawValue");
    return /`[a-z0-9]{3,}`/i.test(value);
  });

  return hasEquipmentField;
}

function extractRequesterIdFromEmbed(embed) {
  const icon =
    String(embed?.author?.iconURL || "").trim() ||
    String(embed?.author?.icon_url || "").trim() ||
    "";

  return icon.match(/\/avatars\/(\d{16,22})\//)?.[1] || null;
}

function extractAllyName(embed) {
  const authorName = String(embed?.author?.name || "").trim();
  const allyPart = authorName.split(/ally\s*:/i)?.[1] || "";
  const normalized = allyPart.trim();
  if (!normalized) return "Unknown";

  return normalized
    .replace(/^[`"'\s]+|[`"'\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function detectSlotFromLine(lineText) {
  const text = String(lineText || "").toLowerCase();
  const slots = [
    "necklace",
    "earring",
    "ring",
    "bracelet",
    "accessory",
    "amulet",
    "charm",
    "outfit",
    "armor",
    "weapon",
  ];

  for (const slot of slots) {
    if (text.includes(slot)) {
      if (slot === "weapon") return "Item";
      return slot.charAt(0).toUpperCase() + slot.slice(1);
    }
  }

  return "Item";
}

function parseEquipmentObjectFromEmbed(embed) {
  const fields = Array.isArray(embed?.fields) ? embed.fields : [];
  const equipment = {};

  for (const field of fields) {
    const fieldName = normalizeFieldText(field, "name", "rawName");
    if (/stats/i.test(fieldName)) continue;

    const value = normalizeFieldText(field, "value", "rawValue");
    if (!value) continue;

    for (const line of value.split("\n")) {
      const trimmed = String(line || "").trim();
      if (!trimmed || /^no\s+/i.test(trimmed)) continue;

      const idMatch = trimmed.match(/`([a-z0-9]{4,8})`/i);
      const itemId = String(idMatch?.[1] || "").trim();
      if (!itemId) continue;

      const slot = detectSlotFromLine(trimmed);
      equipment[slot] = itemId;
    }
  }

  return equipment;
}

function buildEquipmentSummaryLines(equipment) {
  const keys = Object.keys(equipment || {});
  if (!keys.length) return ["No equipment IDs parsed."];

  const order = ["Item", ...keys.filter((key) => key !== "Item").sort()];
  return order
    .filter((key) => equipment[key])
    .map((key) => `${key}: ${equipment[key]}`);
}

function createDraftToken(userId) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${String(userId || "").slice(-6)}${Date.now().toString(36)}${rand}`.slice(0, 45);
}

function savePresetDraft(token, draft) {
  global.db.upsertState(SWS_PRESET_DRAFT_STATE, JSON.stringify(draft), token, false);
}

function loadPresetDraft(token) {
  const raw = global.db.getState(SWS_PRESET_DRAFT_STATE, token);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseSwsPresetFromEmbed(embed) {
  if (!isSwsAllyInfoEmbed(embed)) return null;

  const ownerId = extractRequesterIdFromEmbed(embed);
  const allyName = extractAllyName(embed);
  const equipment = parseEquipmentObjectFromEmbed(embed);
  if (!ownerId || !allyName || !Object.keys(equipment).length) return null;

  return {
    ownerId,
    allyName,
    equipment,
  };
}

module.exports = {
  buildEquipmentSummaryLines,
  createDraftToken,
  extractRequesterIdFromEmbed,
  isSwsAllyInfoEmbed,
  loadPresetDraft,
  parseEdit3ReactionIdentifier,
  parseEmojiValue,
  parseSaveEmoji,
  parseSwsPresetFromEmbed,
  savePresetDraft,
};
