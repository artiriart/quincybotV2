const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const colors = require("colors");

const DANK_ITEMS_URL = "https://dankmemer.lol/api/bot/items";
const DANK_FISH_DATA_URL = "https://dankmemer.lol/api/bot/fish/data";
const FEATHER_ICONS_URL =
  "https://api.github.com/repos/feathericons/feather/contents/icons";
const IZZI_CARDS_URL =
  "https://api.izzi-xenex.xyz/api/v1/ums/xendex?per_page=2000";
const IZZI_ABILITIES_URL = "https://api.izzi-xenex.xyz/api/v1/ums/abilities";
const IZZI_ITEMS_URL = "https://api.izzi-xenex.xyz/api/v1/ums/items";
const ANIGAME_SHEET_GVIZ_URL =
  "https://docs.google.com/spreadsheets/d/14qAWkLyjMCI6VXgEgtWWDlDq5MQfotHhLYW6p-Qntlc/gviz/tq?tqx=out:json&sheet=cards";

const CUSTOM_DANK_VALUES_PATH = path.join(
  __dirname,
  "..",
  "utils",
  "customDankItemValues.json",
);
const DECO_EMOJIS_PATH = path.join(__dirname, "..", "utils", "decoEmojis.json");
const EMOJI_RESET_STATE_KEY = "startup_emoji_reset_v1";
const DANK_CUSTOM_ITEM_IMAGES = {
  "Fish Tokens": "https://cdn.discordapp.com/emojis/1157677856596435086.png",
  "Skin Fragments": "https://cdn.discordapp.com/emojis/1060272407471984710.png",
  DMC: "https://cdn.discordapp.com/emojis/1105833876032606350.png",
};

let startupSyncPromise = null;

function colorSyncLabel(label) {
  return colors.bold.cyan(label);
}

function colorMetric(value, tone = "green") {
  const text = String(value);
  if (tone === "yellow") return colors.bold.yellow(text);
  if (tone === "magenta") return colors.bold.magenta(text);
  return colors.bold.green(text);
}

function toInt(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function toNullableInt(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function normalizeEmojiName(rawName, prefix = "") {
  const cleaned = String(rawName || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const combined = `${prefix}${cleaned}`
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  let name = combined || `${prefix}emoji`;

  if (!/^[a-z]/.test(name)) {
    name = `e_${name}`;
  }
  if (name.length < 2) {
    name = `${name}_x`;
  }
  if (name.length > 32) {
    name = name.slice(0, 32);
  }
  return name;
}

function emojiMarkdown(emoji) {
  if (!emoji?.id || !emoji?.name) return null;
  return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
}

function extractListPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

async function fetchJson(url, label, headers = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: "application/json",
      ...headers,
    },
  });

  if (!response.ok) {
    throw new Error(`${label} request failed (${response.status})`);
  }

  return response.json();
}

async function fetchText(url, label) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`${label} request failed (${response.status})`);
  }

  return response.text();
}

function loadCustomDankValues() {
  try {
    const raw = fs.readFileSync(CUSTOM_DANK_VALUES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    console.error(
      "Custom dank item values load failed:",
      error.message || error,
    );
    return [];
  }
}

function loadDecoEmojis() {
  try {
    const raw = fs.readFileSync(DECO_EMOJIS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => ({
        name: String(row?.name || "").trim(),
        url: String(row?.url || "").trim(),
      }))
      .filter((row) => row.name && row.url);
  } catch (error) {
    console.error("Deco emoji config load failed:", error?.message || error);
    return [];
  }
}

async function getApplicationEmojiMap() {
  const map = new Map();
  const app = global.bot?.application;
  if (!app?.emojis) {
    return map;
  }

  const collection = await app.emojis.fetch().catch(() => null);
  if (!collection) {
    return map;
  }

  for (const emoji of collection.values()) {
    map.set(String(emoji.name).toLowerCase(), emoji);
  }

  return map;
}

async function ensureApplicationEmoji(
  app,
  existingByName,
  emojiName,
  attachment,
  contextLabel,
) {
  const lookup = emojiName.toLowerCase();
  const existing = existingByName.get(lookup);
  if (existing) {
    return existing;
  }

  if (!attachment) {
    return null;
  }

  const created = await app.emojis
    .create({
      attachment,
      name: emojiName,
    })
    .catch((error) => {
      console.error(
        `${contextLabel} emoji upload failed for ${emojiName}:`,
        error?.message || error,
      );
      return null;
    });

  if (created) {
    existingByName.set(lookup, created);
  }

  return created;
}

function convertSvgToPngBuffer(svgText) {
  return sharp(Buffer.from(svgText))
    .resize(128, 128, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function getFeatherPngAttachment(iconName, downloadUrl) {
  if (!downloadUrl) return null;
  const svg = await fetchText(downloadUrl, `Feather svg ${iconName}`);
  const pngBuffer = await convertSvgToPngBuffer(svg);
  return pngBuffer;
}

async function runOneTimeEmojiReset(sqlite) {
  const alreadyDone = sqlite
    .prepare(`SELECT state FROM states WHERE id='global' AND type=? LIMIT 1`)
    .get(EMOJI_RESET_STATE_KEY);

  if (alreadyDone) {
    return;
  }

  const app = global.bot?.application;
  if (!app?.emojis) {
    console.warn(
      "One-time emoji reset skipped: application emoji manager unavailable.",
    );
    return;
  }

  const collection = await app.emojis.fetch().catch(() => null);
  if (!collection) {
    console.warn(
      "One-time emoji reset skipped: unable to fetch application emojis.",
    );
    return;
  }

  let deleted = 0;
  for (const emoji of collection.values()) {
    const ok = await app.emojis.delete(emoji.id).catch(() => false);
    if (ok) {
      deleted += 1;
    }
  }

  sqlite.prepare(`DELETE FROM feather_emojis`).run();
  sqlite.prepare(`UPDATE dank_items SET application_emoji = NULL`).run();
  sqlite.prepare(`UPDATE izzi_talents SET application_emoji = NULL`).run();
  sqlite
    .prepare(
      `
      INSERT INTO states (id, type, state)
      VALUES ('global', ?, ?)
      ON CONFLICT(id, type) DO UPDATE SET state=excluded.state
      `,
    )
    .run(EMOJI_RESET_STATE_KEY, JSON.stringify({ done: true, at: Date.now() }));

  console.log(
    `One-time emoji reset complete: deleted ${deleted} application emojis and cleared emoji fields in DB.`,
  );
}

function normalizeBaseStats(stats, mapping) {
  return JSON.stringify({
    ATK: String(toInt(stats?.[mapping.ATK], 80)),
    HP: String(toInt(stats?.[mapping.HP], 80)),
    DEF: String(toInt(stats?.[mapping.DEF], 80)),
    SPD: String(toInt(stats?.[mapping.SPD], 80)),
    ARM: String(toInt(stats?.[mapping.ARM], 80)),
  });
}

function normalizeIzziItemStats(stats) {
  return JSON.stringify({
    ATK: String(toInt(stats?.strength, 80)),
    HP: String(toInt(stats?.vitality, 80)),
    DEF: String(toInt(stats?.defense, 80)),
    SPD: String(toInt(stats?.dexterity, 80)),
    ARM: String(toInt(stats?.intelligence, 80)),
  });
}

function titleFromId(value) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function resolveFishEntityEmoji({
  app,
  existingEmojis,
  entityType,
  entityName,
  imageURL,
}) {
  if (!imageURL) return null;
  const emojiName = normalizeEmojiName(`${entityType}_${entityName}`, "dank_");
  let emoji = existingEmojis.get(emojiName.toLowerCase()) || null;
  if (!emoji && app?.emojis) {
    emoji = await ensureApplicationEmoji(
      app,
      existingEmojis,
      emojiName,
      imageURL,
      `Fish ${entityType}`,
    );
  }
  return emojiMarkdown(emoji);
}

async function syncDankFishEntities(sqlite, existingEmojis, fishPayload) {
  const app = global.bot?.application;
  const creatures = Array.isArray(fishPayload?.data?.creatures?.items)
    ? fishPayload.data.creatures.items
    : [];
  const locations = Array.isArray(fishPayload?.data?.locations?.items)
    ? fishPayload.data.locations.items
    : [];
  const baits = Array.isArray(fishPayload?.data?.baits?.items)
    ? fishPayload.data.baits.items
    : [];
  const tools = Array.isArray(fishPayload?.data?.tools?.items)
    ? fishPayload.data.tools.items
    : [];

  const locationIds = new Set();
  for (const creature of creatures) {
    const locations = Array.isArray(creature?.extra?.locations)
      ? creature.extra.locations
      : [];
    for (const locationId of locations) {
      if (locationId) locationIds.add(String(locationId));
    }
  }

  const upsertEntity = sqlite.prepare(`
    INSERT INTO dank_fish_entities (
      entity_type, entity_id, name, application_emoji, image_url, rarity, is_boss, is_mythical, metadata_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(entity_type, entity_id) DO UPDATE SET
      name = excluded.name,
      application_emoji = COALESCE(excluded.application_emoji, dank_fish_entities.application_emoji),
      image_url = excluded.image_url,
      rarity = excluded.rarity,
      is_boss = excluded.is_boss,
      is_mythical = excluded.is_mythical,
      metadata_json = excluded.metadata_json,
      updated_at = CURRENT_TIMESTAMP
  `);

  let entityCount = 0;
  let mythicalCount = 0;

  for (const creature of creatures) {
    const entityId = String(creature?.id || "").trim();
    const name = String(creature?.name || "").trim();
    if (!entityId || !name) continue;

    const rarity = String(creature?.extra?.rarity || "").trim() || null;
    const isBoss = creature?.extra?.boss ? 1 : 0;
    const isMythical = creature?.extra?.mythical ? 1 : 0;
    const imageURL = String(creature?.imageURL || "").trim() || null;
    const markdown = await resolveFishEntityEmoji({
      app,
      existingEmojis,
      entityType: "creature",
      entityName: name,
      imageURL,
    });

    upsertEntity.run(
      "creature",
      entityId,
      name,
      markdown,
      imageURL,
      rarity,
      isBoss,
      isMythical,
      JSON.stringify(creature?.extra || {}),
    );

    entityCount += 1;
    if (isMythical) mythicalCount += 1;
  }

  for (const tool of tools) {
    const entityId = String(tool?.id || "").trim();
    const name = String(tool?.name || "").trim();
    if (!entityId || !name) continue;
    const imageURL = String(tool?.imageURL || "").trim() || null;
    const markdown = await resolveFishEntityEmoji({
      app,
      existingEmojis,
      entityType: "tool",
      entityName: name,
      imageURL,
    });

    upsertEntity.run(
      "tool",
      entityId,
      name,
      markdown,
      imageURL,
      null,
      0,
      0,
      JSON.stringify(tool?.extra || {}),
    );
    entityCount += 1;
  }

  for (const bait of baits) {
    const entityId = String(bait?.id || "").trim();
    const name = String(bait?.name || "").trim();
    if (!entityId || !name) continue;
    const imageURL = String(bait?.imageURL || "").trim() || null;
    const markdown = await resolveFishEntityEmoji({
      app,
      existingEmojis,
      entityType: "bait",
      entityName: name,
      imageURL,
    });

    upsertEntity.run(
      "bait",
      entityId,
      name,
      markdown,
      imageURL,
      null,
      0,
      0,
      JSON.stringify(bait?.extra || {}),
    );
    entityCount += 1;
  }

  for (const locationId of locationIds) {
    const rawLocation = locations.find((loc) => String(loc?.id || "") === locationId);
    const locationName = String(rawLocation?.name || "").trim() || titleFromId(locationId);
    const locationImage = String(rawLocation?.imageURL || "").trim() || null;
    const locationEmoji = await resolveFishEntityEmoji({
      app,
      existingEmojis,
      entityType: "location",
      entityName: locationName,
      imageURL: locationImage,
    });
    upsertEntity.run(
      "location",
      locationId,
      locationName,
      locationEmoji,
      locationImage,
      null,
      0,
      0,
      JSON.stringify(rawLocation?.extra || {}),
    );
    entityCount += 1;
  }

  console.log(
    `${colorSyncLabel("Dank fish sync complete:")} ${colorMetric(entityCount)} entities upserted (${colorMetric(mythicalCount, "magenta")} mythicals).`,
  );
}

async function syncDankItemsAndEmojis(sqlite, existingEmojis) {
  const app = global.bot?.application;
  const dankPayload = extractListPayload(
    await fetchJson(DANK_ITEMS_URL, "Dank items"),
  );
  const fishPayload = await fetchJson(DANK_FISH_DATA_URL, "Dank fish data");
  const customValues = loadCustomDankValues();

  const byName = new Map();
  for (const raw of dankPayload) {
    const name = String(raw?.name || "").trim();
    if (!name) continue;

    byName.set(name, {
      name,
      dankId: Number.isFinite(Number(raw?.id)) ? Number(raw.id) : null,
      market: toInt(raw?.marketValue),
      value: toInt(raw?.value),
      imageURL: String(raw?.imageURL || "").trim() || null,
      rawEmoji: String(raw?.emoji || "").trim() || null,
      customEmojiURL: null,
      fishing: 0,
    });
  }

  for (const custom of customValues) {
    const name = String(custom?.name || "").trim();
    if (!name) continue;

    const existing = byName.get(name) || {
      name,
      dankId: null,
      market: 0,
      value: 0,
      imageURL: null,
      rawEmoji: null,
      customEmojiURL: null,
      fishing: 0,
    };

    existing.market = toInt(custom?.market, existing.market);
    existing.value = toInt(custom?.value, existing.value);
    existing.customEmojiURL =
      String(custom?.emoji_url || "").trim() || existing.customEmojiURL;
    existing.fishing = custom?.fishing ? 1 : existing.fishing;
    byName.set(name, existing);
  }

  const normalizedItems = new Map(
    Array.from(byName.values()).map((item) => [
      String(item.name || "")
        .trim()
        .toLowerCase(),
      {
        market: Number(item.market) || 0,
        value: Number(item.value) || 0,
      },
    ]),
  );

  const avgFishTokenPerUnit = (() => {
    const { totalRatio, count } = Object.entries({
      "tentacled temptation": 225,
      "inflated delicacy": 563,
      "prismatic delight": 749,
    }).reduce(
      (acc, [specialName, tokenValue]) => {
        const item = normalizedItems.get(specialName);
        const coinValue = item?.market || item?.value || 0;
        if (coinValue > 0) {
          acc.totalRatio += coinValue / tokenValue;
          acc.count += 1;
        }
        return acc;
      },
      { totalRatio: 0, count: 0 },
    );

    let avg = count > 0 ? totalRatio / count : 1;
    return avg > 0 ? avg : 1;
  })();

  const setOrMergeCustomDankItem = (itemName, patch) => {
    const existingKey = Array.from(byName.keys()).find(
      (key) => key.toLowerCase() === itemName.toLowerCase(),
    );
    const targetKey = existingKey || itemName;
    const existing = byName.get(targetKey) || {
      name: itemName,
      dankId: null,
      market: 0,
      value: 0,
      imageURL: null,
      rawEmoji: null,
      customEmojiURL: null,
      fishing: 0,
    };

    byName.set(targetKey, {
      ...existing,
      ...patch,
      name: existing.name || itemName,
    });
  };

  setOrMergeCustomDankItem("Fish Tokens", {
    market: Math.ceil(avgFishTokenPerUnit),
    value: 1,
    imageURL: DANK_CUSTOM_ITEM_IMAGES["Fish Tokens"],
    fishing: 1,
  });

  const fishingTokenMap = {
    harpoon: 38,
    "fishing bow": 64,
    net: 49,
    "fishing rod": 11,
    "deadly bait": 282,
    "golden bait": 27,
    "lucky bait": 90,
    "xp bait": 113,
    "timely bait": 45,
    // NOT THERE IN SHOP (PERSONAL OPINION)
    dynamite: 150,
    "magnet fishing rope": 200,
    "eyeball bait": 400,
    "farmer bait": 150,
    "ghastly bait": 100,
    "gift bait": 500,
    "jerky bait": 500,
  };

  const fishBaits = Array.isArray(fishPayload?.data?.baits?.items)
    ? fishPayload.data.baits.items
    : [];
  const fishTools = Array.isArray(fishPayload?.data?.tools?.items)
    ? fishPayload.data.tools.items
    : [];
  await syncDankFishEntities(sqlite, existingEmojis, fishPayload);

  for (const fishItem of [...fishBaits, ...fishTools]) {
    const itemName = String(fishItem?.name || "").trim();
    if (!itemName) continue;

    const tokenCount =
      fishingTokenMap[itemName.toLowerCase()] == null
        ? 100
        : fishingTokenMap[itemName.toLowerCase()];

    setOrMergeCustomDankItem(itemName, {
      market: Math.ceil(tokenCount * avgFishTokenPerUnit),
      value: 1,
      imageURL: String(fishItem?.imageURL || "").trim() || null,
      fishing: 1,
    });
  }

  setOrMergeCustomDankItem("Skin Fragments", {
    value: 10000,
    imageURL: DANK_CUSTOM_ITEM_IMAGES["Skin Fragments"],
  });
  setOrMergeCustomDankItem("DMC", {
    value: 1,
    imageURL: DANK_CUSTOM_ITEM_IMAGES.DMC,
  });

  const upsertDank = sqlite.prepare(`
    INSERT INTO dank_items (name, dank_id, market, value, application_emoji, fishing)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      dank_id = excluded.dank_id,
      market = excluded.market,
      value = excluded.value,
      application_emoji = COALESCE(excluded.application_emoji, dank_items.application_emoji),
      fishing = excluded.fishing
  `);

  let createdEmojiCount = 0;
  let indexedEmojiCount = 0;

  for (const item of byName.values()) {
    const emojiName = normalizeEmojiName(item.name, "dank_");
    const attachment = item.customEmojiURL || item.imageURL;

    let emoji = existingEmojis.get(emojiName.toLowerCase()) || null;
    if (!emoji && app?.emojis) {
      emoji = await ensureApplicationEmoji(
        app,
        existingEmojis,
        emojiName,
        attachment,
        "Dank item",
      );
      if (emoji) createdEmojiCount += 1;
    }

    const markdown = emojiMarkdown(emoji) || item.rawEmoji || null;
    if (markdown) indexedEmojiCount += 1;

    upsertDank.run(
      item.name,
      toNullableInt(item.dankId),
      item.market,
      item.value,
      markdown,
      item.fishing,
    );
  }

  sqlite.prepare(`UPDATE dank_items SET dank_id = NULL`).run();

  // Ensure dank_id is refreshed for all canonical API items by name.
  const updateDankIdByName = sqlite.prepare(`
    UPDATE dank_items
    SET dank_id = ?
    WHERE LOWER(name) = LOWER(?)
  `);
  let idBackfillCount = 0;
  for (const raw of dankPayload) {
    const itemName = String(raw?.name || "").trim();
    const itemId = Number(raw?.id);
    if (!itemName || !Number.isFinite(itemId)) continue;
    const result = updateDankIdByName.run(itemId, itemName);
    idBackfillCount += Number(result?.changes || 0);
  }

  console.log(
    `${colorSyncLabel("Dank sync complete:")} ${colorMetric(byName.size)} items upserted, ${colorMetric(createdEmojiCount, "yellow")} emojis created, ${colorMetric(indexedEmojiCount, "magenta")} emoji refs indexed, ${colorMetric(idBackfillCount)} ids refreshed.`,
  );
}

async function syncFeatherEmojis(sqlite, existingEmojis) {
  const app = global.bot?.application;
  const featherPayload = extractListPayload(
    await fetchJson(FEATHER_ICONS_URL, "Feather icons", {
      "User-Agent": "quincybotV2",
    }),
  );

  const upsertFeather = sqlite.prepare(`
    INSERT INTO feather_emojis (name, markdown)
    VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET markdown = excluded.markdown
  `);

  let created = 0;
  let indexed = 0;

  for (const icon of featherPayload) {
    if (!icon || icon.type !== "file") continue;

    const iconName = String(icon.name || "")
      .replace(/\.svg$/i, "")
      .trim();
    if (!iconName) continue;

    const emojiName = normalizeEmojiName(iconName, "feather_");
    let emoji = existingEmojis.get(emojiName.toLowerCase()) || null;

    if (!emoji && app?.emojis) {
      const attachment = await getFeatherPngAttachment(
        iconName,
        icon.download_url,
      ).catch((error) => {
        console.error(
          `Feather png conversion failed for ${emojiName}:`,
          error?.message || error,
        );
        return null;
      });

      emoji = await ensureApplicationEmoji(
        app,
        existingEmojis,
        emojiName,
        attachment,
        "Feather",
      );
      if (emoji) created += 1;
    }

    if (!emoji) continue;

    upsertFeather.run(iconName, emojiMarkdown(emoji));
    indexed += 1;
  }

  console.log(
    `${colorSyncLabel("Feather sync complete:")} ${colorMetric(indexed)} indexed, ${colorMetric(created, "yellow")} created.`,
  );
}

async function syncDecoEmojis(sqlite, existingEmojis) {
  const app = global.bot?.application;
  if (!app?.emojis) {
    console.warn(
      "Deco emoji sync skipped: application emoji manager unavailable.",
    );
    return;
  }

  const items = loadDecoEmojis();
  if (!items.length) {
    console.log("Deco emoji sync skipped: no items configured.");
    return;
  }

  const upsertFeather = sqlite.prepare(`
    INSERT INTO feather_emojis (name, markdown)
    VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET markdown = excluded.markdown
  `);

  let created = 0;
  let indexed = 0;

  for (const item of items) {
    const emojiName = normalizeEmojiName(item.name, "");
    let emoji = existingEmojis.get(emojiName.toLowerCase()) || null;

    if (!emoji) {
      emoji = await ensureApplicationEmoji(
        app,
        existingEmojis,
        emojiName,
        item.url,
        "Deco",
      );
      if (emoji) created += 1;
    }

    const markdown = emojiMarkdown(emoji);
    if (!markdown) continue;

    upsertFeather.run(emojiName, markdown);

    if (emojiName.startsWith("dank_")) {
      const alias = emojiName.slice(5).trim();
      if (alias) {
        upsertFeather.run(alias, markdown);
      }
    }

    indexed += 1;
  }

  console.log(
    `${colorSyncLabel("Deco emoji sync complete:")} ${colorMetric(indexed)} indexed, ${colorMetric(created, "yellow")} created.`,
  );
}

async function syncIzziCards(sqlite) {
  const cards = extractListPayload(
    await fetchJson(IZZI_CARDS_URL, "Izzi cards"),
  );
  const upsertCard = sqlite.prepare(`
    INSERT INTO izzi_cards (name, ability, element, event, base_stats, darkzone)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      ability = excluded.ability,
      element = excluded.element,
      event = excluded.event,
      base_stats = excluded.base_stats,
      darkzone = excluded.darkzone
  `);

  for (const raw of cards) {
    const name = String(raw?.name || "").trim();
    if (!name) continue;

    const stats = normalizeBaseStats(raw?.stats || {}, {
      ATK: "strength",
      HP: "vitality",
      DEF: "defense",
      SPD: "dexterity",
      ARM: "intelligence",
    });

    upsertCard.run(
      name,
      String(raw?.passivename || "").trim() || null,
      String(raw?.type || "").trim() || null,
      raw?.has_event_ended ? 1 : 0,
      stats,
      raw?.isDarkZone || raw?.is_dark_zone ? 1 : 0,
    );
  }

  console.log(
    `${colorSyncLabel("Izzi card sync complete:")} ${colorMetric(cards.length)} rows upserted.`,
  );
}

async function syncIzziAbilities(sqlite) {
  const abilities = extractListPayload(
    await fetchJson(IZZI_ABILITIES_URL, "Izzi abilities"),
  );

  const upsertAbility = sqlite.prepare(`
    INSERT INTO izzi_talents (name, description, application_emoji)
    VALUES (?, ?, NULL)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      application_emoji = COALESCE(izzi_talents.application_emoji, excluded.application_emoji)
  `);

  for (const raw of abilities) {
    const name = String(raw?.name || "").trim();
    if (!name) continue;
    upsertAbility.run(name, String(raw?.description || "").trim() || null);
  }

  console.log(
    `${colorSyncLabel("Izzi abilities sync complete:")} ${colorMetric(abilities.length)} rows upserted.`,
  );
}

async function syncIzziItems(sqlite) {
  const items = extractListPayload(
    await fetchJson(IZZI_ITEMS_URL, "Izzi items"),
  );

  const upsertItem = sqlite.prepare(`
    INSERT INTO izzi_items (name, category, description, price, stats)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      category = excluded.category,
      description = excluded.description,
      price = excluded.price,
      stats = excluded.stats
  `);

  for (const raw of items) {
    const name = String(raw?.name || "").trim();
    if (!name) continue;

    upsertItem.run(
      name,
      JSON.stringify(Array.isArray(raw?.category) ? raw.category : []),
      String(raw?.description || "").trim() || null,
      toInt(raw?.price),
      normalizeIzziItemStats(raw?.stats || {}),
    );
  }

  console.log(
    `${colorSyncLabel("Izzi items sync complete:")} ${colorMetric(items.length)} rows upserted.`,
  );
}

function parseGvizJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Invalid GViz payload.");
  }

  return JSON.parse(text.slice(start, end + 1));
}

async function fetchAnigameRows() {
  const gvizText = await fetchText(
    ANIGAME_SHEET_GVIZ_URL,
    "Anigame sheet GViz",
  );
  const gviz = parseGvizJson(gvizText);
  const headers = (gviz?.table?.cols || []).map((col) =>
    String(col?.label || "").trim(),
  );
  const rows = (gviz?.table?.rows || []).map((row) =>
    (row?.c || []).map((cell) => {
      if (!cell) return "";
      if (cell.v != null) return cell.v;
      if (cell.f != null) return cell.f;
      return "";
    }),
  );

  return { headers, rows };
}

async function syncAnigameCards(sqlite) {
  const { headers, rows } = await fetchAnigameRows();
  const indexByHeader = new Map(
    headers.map((header, index) => [
      String(header || "")
        .trim()
        .toLowerCase(),
      index,
    ]),
  );

  const getIndex = (...keys) => {
    for (const key of keys) {
      const idx = indexByHeader.get(String(key).toLowerCase());
      if (idx != null) return idx;
    }
    return -1;
  };

  const nameIdx = getIndex("card_name", "name");
  const elementIdx = getIndex("card_type", "element");
  const talentIdx = getIndex("talent_normal", "talent", "card_talent");
  const hpIdx = getIndex("card_hp", "hp");
  const atkIdx = getIndex("card_atk", "atk");
  const defIdx = getIndex("card_def", "def");
  const spdIdx = getIndex("card_spd", "spd");
  const cardUrlIdx = getIndex(
    "card_url",
    "art",
    "card_art",
    "art_url",
    "image_url",
    "image",
    "img",
    "image link",
    "card_image",
    "thumbnail",
    "thumbnail_url",
    "url",
    "link",
  );

  if (nameIdx === -1) {
    throw new Error("Anigame sheet missing card name column.");
  }

  const upsertCard = sqlite.prepare(`
    INSERT INTO anigame_cards (name, talent, element, card_url, base_stats)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      talent = excluded.talent,
      element = excluded.element,
      card_url = excluded.card_url,
      base_stats = excluded.base_stats
  `);

  let count = 0;
  for (const row of rows) {
    const name = String(row?.[nameIdx] || "").trim();
    if (!name) continue;

    const baseStats = JSON.stringify({
      ATK: String(toInt(row?.[atkIdx], 80)),
      HP: String(toInt(row?.[hpIdx], 80)),
      DEF: String(toInt(row?.[defIdx], 80)),
      SPD: String(toInt(row?.[spdIdx], 80)),
    });

    upsertCard.run(
      name,
      talentIdx === -1 ? null : String(row?.[talentIdx] || "").trim() || null,
      elementIdx === -1 ? null : String(row?.[elementIdx] || "").trim() || null,
      cardUrlIdx === -1
        ? null
        : (() => {
            const raw = String(row?.[cardUrlIdx] || "").trim();
            if (!raw) return null;
            if (/^https?:\/\//i.test(raw)) return raw;
            const match = raw.match(/https?:\/\/[^"\s)]+/i);
            return match ? match[0] : null;
          })(),
      baseStats,
    );

    count += 1;
  }

  console.log(
    `${colorSyncLabel("Anigame card sync complete:")} ${colorMetric(count)} rows upserted.`,
  );
}

async function runStartupSync() {
  if (startupSyncPromise) {
    return startupSyncPromise;
  }

  startupSyncPromise = (async () => {
    const sqlite = global.db?.db;
    if (!sqlite) {
      console.warn("Startup sync skipped: sqlite handle unavailable.");
      return;
    }

    await runOneTimeEmojiReset(sqlite);
    const existingEmojis = await getApplicationEmojiMap();

    const steps = [
      () => syncDankItemsAndEmojis(sqlite, existingEmojis),
      async () => {
        const { ensureStartupMythicalChancesIndex } = require("./dank/fishSimulator");
        await ensureStartupMythicalChancesIndex({ onlyIfMissing: true });
      },
      () => syncFeatherEmojis(sqlite, existingEmojis),
      () => syncDecoEmojis(sqlite, existingEmojis),
      () => syncIzziCards(sqlite),
      () => syncIzziAbilities(sqlite),
      () => syncIzziItems(sqlite),
      () => syncAnigameCards(sqlite),
    ];

    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        console.error("Startup sync step failed:", error?.message || error);
      }
    }

    console.log(colors.rainbow(colors.bold("Startup sync complete.")));
  })();

  return startupSyncPromise;
}

module.exports = {
  runStartupSync,
};
