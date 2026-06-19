const {
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const bossList = require("../../functions/dank/bossList");
const { toTitleFromId } = require("../../functions/dank/fishSimulator");

const GET_SIMULATOR_URL = "https://dankmemer.lol/api/bot/fish/simulator";
const POST_SIMULATOR_URL = "https://dankmemer.lol/api/bot/fish/simulator";

const bossPricesPath = path.join(__dirname, "../../functions/dank/boss_prices.json");
const mythicalPricesPath = path.join(__dirname, "../../functions/dank/mythical_prices.json");

let bossPrices = {};
let mythicalPrices = {};

try {
  bossPrices = JSON.parse(fs.readFileSync(bossPricesPath, "utf-8"));
  mythicalPrices = JSON.parse(fs.readFileSync(mythicalPricesPath, "utf-8"));
} catch (error) {
  console.error("Failed to load fish prices", error);
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function compactMarkdown(markdown) {
  return markdown ? `${markdown} ` : "";
}

function getFeather(name, fallback = "") {
  return global.db.getFeatherEmojiMarkdown(name) || fallback;
}

function formatPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return number.toFixed(3).replace(/\.?0+$/, "");
}

function formatCoins(value) {
  return `⏣ ${Math.trunc(Number(value || 0)).toLocaleString()}`;
}

function getFishPrice(fishId, isBossFish, isMythicalFish) {
  if (isMythicalFish) return mythicalPrices[fishId] || 25_000_000;
  if (isBossFish) return bossPrices[fishId] || 5_000_000;
  return 0;
}

function isBossFish(row, meta) {
  return Number(row?.is_boss || 0) === 1 || !!meta?.boss || bossList.includes(String(row?.entity_id || ""));
}

function isMythicalFish(row, meta) {
  return Number(row?.is_mythical || 0) === 1 || !!meta?.mythical;
}

function getEntity(type, id) {
  return (
    global.db.safeQuery(
      `
      SELECT entity_type, entity_id, name, application_emoji, image_url, rarity, is_boss, is_mythical, metadata_json
      FROM dank_fish_entities
      WHERE entity_type = ? AND entity_id = ?
      LIMIT 1
      `,
      [type, id],
      [],
    )?.[0] || null
  );
}

function findFish(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return (
    global.db.safeQuery(
      `
      SELECT entity_type, entity_id, name, application_emoji, image_url, rarity, is_boss, is_mythical, metadata_json
      FROM dank_fish_entities
      WHERE entity_type = 'creature'
        AND (entity_id = ? OR LOWER(name) = LOWER(?))
      LIMIT 1
      `,
      [text, text],
      [],
    )?.[0] || null
  );
}

function findLocation(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return (
    global.db.safeQuery(
      `
      SELECT entity_type, entity_id, name, application_emoji, image_url, metadata_json
      FROM dank_fish_entities
      WHERE entity_type = 'location'
        AND (entity_id = ? OR LOWER(name) = LOWER(?))
      LIMIT 1
      `,
      [text, text],
      [],
    )?.[0] || null
  );
}

function getAllToolsFromDb() {
  return global.db.safeQuery(
    `
    SELECT entity_id, name, application_emoji
    FROM dank_fish_entities
    WHERE entity_type = 'tool'
    ORDER BY LOWER(name) ASC
    `,
    [],
    [],
  );
}

function getCandidateTools(fishMeta, getData) {
  const apiTools = Array.isArray(getData?.tools) ? getData.tools : [];
  const dbTools = getAllToolsFromDb();
  const byId = new Map();

  for (const tool of dbTools) {
    byId.set(String(tool.entity_id), {
      id: String(tool.entity_id),
      name: tool.name || toTitleFromId(tool.entity_id),
      emoji: tool.application_emoji || "",
    });
  }
  for (const tool of apiTools) {
    const id = String(tool?.id || "").trim();
    if (!id) continue;
    byId.set(id, {
      id,
      name: String(tool?.name || byId.get(id)?.name || toTitleFromId(id)),
      emoji: byId.get(id)?.emoji || "",
    });
  }

  const toolMeta = fishMeta?.tools && typeof fishMeta.tools === "object" ? fishMeta.tools : null;
  const isRelevantTool = (tool) => tool?.id !== "idle-fishing-machine";
  if (!toolMeta) return [...byId.values()].filter(isRelevantTool);

  return Object.entries(toolMeta)
    .filter(([id, range]) => id !== "idle-fishing-machine" && Number(range?.max || 0) > 0)
    .map(([id]) => byId.get(String(id)) || { id: String(id), name: toTitleFromId(id), emoji: "" })
    .filter(isRelevantTool);
}

async function fetchSimulatorData(userId) {
  const response = await fetch(`${GET_SIMULATOR_URL}?id=${encodeURIComponent(userId)}`, {
    headers: { Accept: "application/json", Referer: "https://dankmemer.lol/fish/simulator" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Simulator GET failed: HTTP ${response.status}`);
  return response.json();
}

async function fetchCatchChance({ settings, fishId, fishIsMythical, locationId, toolId, time }) {
  const useNoBait = toolId === "bare-hand" || toolId === "dynamite";
  const payload = {
    skills: settings?.skills || {},
    bosses: true,
    locationID: locationId,
    toolID: toolId,
    baitsIDs: useNoBait ? [] : Array.isArray(settings?.baits) ? settings.baits : [],
    time,
    events: [],
    locationWinner: false,
    bonusBossMultiplier: 1,
    bonusMythicalMultiplier: 1,
    forceTrash: false,
    mythicalFishID: fishIsMythical ? fishId : null,
    discoveredCreatures: null,
    anglerTuesday: new Date(time).getUTCDay() === 2,
    invasion: null,
  };

  const response = await fetch(POST_SIMULATOR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Referer: "https://dankmemer.lol/fish/simulator" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Simulator POST failed: HTTP ${response.status}`);

  const data = await response.json();
  const table = Array.isArray(data?.table) ? data.table : [];
  const row = table.find((entry) => String(entry?.value?.creatureID || "") === fishId);
  return Number(row?.chance || 0);
}

function buildHourTimes() {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);
  return Array.from({ length: 24 }, (_, index) => start + index * 60 * 60 * 1000);
}

// Max characters of component text per message before we start a new followUp.
const CATCH_INFO_CHAR_LIMIT = 3600;

/**
 * Build the per-tool text block content string (tool header + 24 hour lines).
 */
function buildToolBlockContent(result, currentHour, trend, atSign) {
  const peak = Math.max(...result.hours.map((hour) => Number(hour.chance || 0)));
  const lines = result.hours.map((hour) => {
    const date = new Date(hour.time);
    const hourUtc = date.getUTCHours();
    const peakLabel = Number(hour.chance || 0) === peak && peak > 0 ? ` (${trend})` : "";
    const currentLabel = hourUtc === currentHour ? ` (${atSign})` : "";
    const prefix = hourUtc === currentHour ? "### " : "";
    return `${prefix}<t:${Math.floor(hour.time / 1000)}:t> - **${formatPercent(hour.chance)}%**${peakLabel}${currentLabel}`;
  });
  return [`## ${compactMarkdown(result.tool.emoji)}${result.tool.name}`, ...lines].join("\n");
}

/**
 * Build a single ContainerBuilder payload from an array of text block strings.
 * `includeHeader` controls whether the fish/location header is prepended.
 */
function buildChunkContainer(header, toolBlocks, includeHeader) {
  const container = new ContainerBuilder();

  if (includeHeader) {
    container
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  }

  for (const content of toolBlocks) {
    container
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  }

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Returns an array of message payloads — the first is for editReply, the rest
 * for followUp. Each fits within CATCH_INFO_CHAR_LIMIT characters of text.
 */
function buildCatchInfoPayloads({ fish, fishMeta, location, toolResults }) {
  const arrow = getFeather("arrow-right-circle", "➜");
  const info = getFeather("info", "ℹ️");
  const trend = getFeather("trending-up", "↗");
  const atSign = getFeather("at-sign", "@");
  const fishEmoji = compactMarkdown(fish.application_emoji);
  const locationEmoji = compactMarkdown(location.application_emoji);
  const isBoss = isBossFish(fish, fishMeta);
  const isMythical = isMythicalFish(fish, fishMeta);
  const price = getFishPrice(fish.entity_id, isBoss, isMythical);
  const badges = [
    isBoss ? "💀" : "",
    isMythical ? "💎" : "",
    price ? formatCoins(price) : "",
  ].filter(Boolean);

  const header = [
    "## Peak Hour lookup",
    `${arrow} Fish: ${fishEmoji}**${fish.name}**${badges.length ? ` (${badges.join(" ")})` : ""}`,
    `${arrow} Location: ${locationEmoji}**${location.name}**`,
    `-# ${info} Fail chance NOT included in calc`,
  ].join("\n");

  const currentHour = new Date().getUTCHours();
  const allBlocks = toolResults.map((result) =>
    buildToolBlockContent(result, currentHour, trend, atSign),
  );

  if (!allBlocks.length) {
    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("-# No catch chances found for this fish and location."),
      );
    return [{ components: [container], flags: MessageFlags.IsComponentsV2 }];
  }

  // Greedily pack blocks into chunks, each staying under the char limit.
  const payloads = [];
  let currentChunk = [];
  let currentChars = 0;
  let isFirstChunk = true;

  for (const block of allBlocks) {
    const overhead = isFirstChunk ? header.length : 0;
    if (currentChunk.length > 0 && currentChars + overhead + block.length > CATCH_INFO_CHAR_LIMIT) {
      // Flush current chunk.
      payloads.push(buildChunkContainer(header, currentChunk, isFirstChunk));
      isFirstChunk = false;
      currentChunk = [];
      currentChars = 0;
    }
    currentChunk.push(block);
    currentChars += block.length;
  }

  // Flush remaining.
  if (currentChunk.length) {
    payloads.push(buildChunkContainer(header, currentChunk, isFirstChunk));
  }

  return payloads;
}

function buildFishInfoPayload(fish) {
  const arrow = getFeather("arrow-right-circle", "➜");
  const meta = parseJson(fish.metadata_json, {});
  const isBoss = isBossFish(fish, meta);
  const isMythical = isMythicalFish(fish, meta);
  const price = getFishPrice(fish.entity_id, isBoss, isMythical);
  const time = meta?.time || {};
  const hasTimeWindow = time.start != null && time.end != null;
  const allDay = !hasTimeWindow || (Number(time.start || 0) === 0 && Number(time.end || 0) === 24);
  const today = new Date();
  const displayStartHour = time.reversed ? Number(time.end || 0) : Number(time.start || 0);
  const displayEndHour = time.reversed ? Number(time.start || 0) : Number(time.end || 0);
  const startTs = Math.floor(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), displayStartHour, 0, 0) / 1000);
  const endTs = Math.floor(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), displayEndHour, 0, 0) / 1000);
  const variants = Array.isArray(meta?.variants) ? meta.variants : [];
  const locationIds = Array.isArray(meta?.locations) ? meta.locations : [];
  const locationNames = locationIds.map((id) => getEntity("location", id)?.name || toTitleFromId(id));
  const availability = allDay
    ? "**All Day**"
    : `Start: **<t:${startTs}:t>** | End: **<t:${endTs}:t>**`;
  const variantNames = variants.map((variant) => variant.name || toTitleFromId(variant.id));
  const details = [
    `${arrow} Rarity: **${fish.rarity || meta.rarity || "Unknown"}**`,
    `${arrow} Availability: ${availability}`,
    `${arrow} Variants (${variantNames.length}): ${variantNames.length ? variantNames.join(", ") : "None"}`,
    `${arrow} Locations (${locationNames.length}): ${locationNames.length ? locationNames.join(", ") : "Unknown"}`,
    `${arrow} Boss: **${isBoss ? "Yes" : "No"}**`,
    `${arrow} Mythical: **${isMythical ? "Yes" : "No"}**`,
  ];

  if (price) details.push(`${arrow} Price: **${formatCoins(price)}**`);

  const section = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(details.join("\n")),
  );
  if (fish.image_url) {
    section.setThumbnailAccessory((thumbnail) => thumbnail.setURL(fish.image_url));
  }

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Fish Info - ${compactMarkdown(fish.application_emoji)}${fish.name}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(section);

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

async function runDankFishCatchInfo(interaction) {
  const fishInput = interaction.options.getString("fish", true);
  const locationInput = interaction.options.getString("location", true);
  const fish = findFish(fishInput);
  const location = findLocation(locationInput);

  if (!fish || !location) {
    await interaction.reply({
      content: "Could not resolve that fish or location.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const simulator = await fetchSimulatorData(interaction.user.id);
    const settings = simulator?.settings || {};
    const getData = simulator?.data || {};
    const fishMeta = parseJson(fish.metadata_json, {});
    const fishIsMythical = isMythicalFish(fish, fishMeta);
    const tools = getCandidateTools(fishMeta, getData);
    const hourTimes = buildHourTimes();
    
    const fishTime = fishMeta.time || {};
    const validHourTimes = hourTimes.filter((timeMs) => {
      if (fishTime.start == null || fishTime.end == null) return true;
      const start = Number(fishTime.start || 0);
      const end = Number(fishTime.end || 0);
      if (start === 0 && end === 24) return true;
      
      const utcHour = new Date(timeMs).getUTCHours();
      
      let activeStart = start;
      let activeEnd = end;
      if (fishTime.reversed) {
        activeStart = end;
        activeEnd = start;
      }

      if (activeStart === 24) activeStart = 0;

      if (activeStart > activeEnd) {
        return utcHour >= activeStart || utcHour < activeEnd;
      } else {
        return utcHour >= activeStart && utcHour < activeEnd;
      }
    });

    const toolResults = [];

    for (const tool of tools) {
      const hours = await Promise.all(
        validHourTimes.map(async (time) => ({
          time,
          chance: await fetchCatchChance({
            settings,
            fishId: fish.entity_id,
            fishIsMythical,
            locationId: location.entity_id,
            toolId: tool.id,
            time,
          }),
        })),
      );
      if (hours.some((hour) => Number(hour.chance || 0) > 0)) {
        toolResults.push({ tool, hours });
      }
    }

    toolResults.sort((a, b) => {
      const aPeak = Math.max(...a.hours.map((hour) => Number(hour.chance || 0)));
      const bPeak = Math.max(...b.hours.map((hour) => Number(hour.chance || 0)));
      return bPeak - aPeak;
    });

    const payloads = buildCatchInfoPayloads({ fish, fishMeta, location, toolResults });
    await interaction.editReply(payloads[0]);
    for (let i = 1; i < payloads.length; i++) {
      await interaction.followUp(payloads[i]);
    }
  } catch (error) {
    console.error("[dank fish catch-info] failed:", error);
    await interaction.editReply("Failed to fetch catch info from the simulator.");
  }
}

async function runDankFishInfo(interaction) {
  const fishInput = interaction.options.getString("fish", true);
  const fish = findFish(fishInput);

  if (!fish) {
    await interaction.reply({
      content: "Could not resolve that fish.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply(buildFishInfoPayload(fish));
}

async function runDankFishAutocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  const name = focused?.name;
  const value = String(focused?.value || "").trim().toLowerCase();
  const type = name === "location" ? "location" : "creature";
  let viableLocationIds = null;

  if (type === "location") {
    const fishInput = interaction.options.getString("fish", false);
    const fish = findFish(fishInput);
    const fishMeta = fish ? parseJson(fish.metadata_json, {}) : {};
    if (Array.isArray(fishMeta.locations) && fishMeta.locations.length) {
      viableLocationIds = new Set(fishMeta.locations.map((id) => String(id)));
    }
  }

  const rows = global.db.safeQuery(
    `
    SELECT entity_id, name, application_emoji
    FROM dank_fish_entities
    WHERE entity_type = ?
      AND (? = '' OR LOWER(name) LIKE ? OR LOWER(entity_id) LIKE ?)
    ORDER BY LOWER(name) ASC
    LIMIT ?
    `,
    [type, value, `%${value}%`, `%${value}%`, viableLocationIds ? 250 : 25],
    [],
  ).filter((row) => !viableLocationIds || viableLocationIds.has(String(row.entity_id))).slice(0, 25);

  await interaction.respond(
    rows.map((row) => ({
      name: String(row.name || toTitleFromId(row.entity_id)).slice(0, 100),
      value: String(row.entity_id).slice(0, 100),
    })),
  );
}

module.exports = {
  runDankFishAutocomplete,
  runDankFishCatchInfo,
  runDankFishInfo,
};
