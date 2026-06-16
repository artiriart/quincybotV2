const {
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const bossList = require("../../functions/dank/bossList");
const { buttonHandlers } = require("../../functions/interactions/button");
const { selectMenuHandlers } = require("../../functions/interactions/selectMenu");
const { parseEmojiMarkdown } = require("../../functions/dank/fishSimulator");

// Safely converts an emoji markdown string like <:name:id> or <a:name:id>
// into a Discord-compatible emoji object for use in components.
function safeEmoji(markdown, fallback = null) {
  const parsed = parseEmojiMarkdown(String(markdown || ""));
  if (parsed) return parsed;
  const trimmed = String(markdown || "").trim();
  if (trimmed && !/^</.test(trimmed)) return trimmed || fallback;
  return fallback;
}

// Build a select option with optional emoji
function makeOption(label, value, isDefault, emojiMarkdown) {
  const opt = {
    label: String(label).slice(0, 100),
    value: String(value).slice(0, 100),
    default: !!isDefault,
  };
  const emoji = safeEmoji(emojiMarkdown, null);
  if (emoji) opt.emoji = emoji;
  return opt;
}

const ROUTE_PREFIX = "dankfishcalc";
const GET_SIMULATOR_URL = "https://dankmemer.lol/api/bot/fish/simulator";
const POST_SIMULATOR_URL = "https://dankmemer.lol/api/bot/fish/simulator";

const bossPricesPath = path.join(__dirname, "../../functions/dank/boss_prices.json");
const mythicalPricesPath = path.join(__dirname, "../../functions/dank/mythical_prices.json");

let bossPrices = {};
let mythicalPrices = {};

try {
  bossPrices = JSON.parse(fs.readFileSync(bossPricesPath, "utf-8"));
  mythicalPrices = JSON.parse(fs.readFileSync(mythicalPricesPath, "utf-8"));
} catch (e) {
  console.error("Failed to load fish prices", e);
}

function isBoss(creatureID) {
  return bossList.includes(creatureID);
}

function getFishPrice(creatureID, isMythical) {
  if (isMythical) return mythicalPrices[creatureID] || 25000000;
  if (isBoss(creatureID)) return bossPrices[creatureID] || 5000000;
  return 0;
}

function getExpectedTokens(cId, postData) {
  const variants = postData?.variants?.[cId] || [];
  let uniqueChromaChance = 0;
  let hqChance = 0;
  for (const v of variants) {
    if (v.type === "unique" || v.type === "chroma") uniqueChromaChance += Number(v.chance || 0);
    if (v.type === "high quality") hqChance += Number(v.chance || 0);
  }
  const normalChance = Math.max(0, 100 - uniqueChromaChance - hqChance);
  return (uniqueChromaChance * 2 + hqChance * 3 + normalChance * 1) / 100;
}

// State keyed by message ID
const calcStateCache = new Map();

async function buildCalcPayload(state) {
  const { locationID, toolID, baitsIDs, enabledMythical, skills, getData, emojiMap } = state;

  // --- Cooldown calculation ---
  let cooldown = 15;
  const tkTier = skills["time-keeper"] || 0;
  if (tkTier >= 2) cooldown = 8;
  else if (tkTier >= 1) cooldown = 10;

  const tcTier = skills["theory-crafter"] || 0;
  if (toolID === "fishing-bow") cooldown *= 0.5;
  if (toolID === "harpoon" && tcTier >= 2) cooldown -= 1;

  let noCooldownChance = 0;
  if (tkTier >= 6) noCooldownChance = 0.25;
  else if (tkTier >= 3) noCooldownChance = 0.15;

  const effectiveCooldown = cooldown * (1 - noCooldownChance);
  const catchesPerHour = 3600 / Math.max(1, effectiveCooldown);

  function getEmoji(type, id) {
    return emojiMap.get(`${type}:${id}`) || "";
  }

  const locationEntity = getData.locations?.find(l => l.id === locationID);
  const locationName = locationEntity ? locationEntity.name : locationID;
  const mythicalsInLocation = locationEntity ? (locationEntity.mythicalFish || []) : [];

  const bossSet = new Set();

  const now = new Date();
  now.setMinutes(0, 0, 0);
  const baseTime = now.getTime();

  // --- Run 9 simulator requests (±4 hours) ---
  const results = [];
  for (let i = -4; i <= 4; i++) {
    const hourlyTime = baseTime + i * 3600000;
    const payload = {
      skills,
      bosses: true,
      locationID,
      toolID,
      baitsIDs,
      time: hourlyTime,
      events: [],
      locationWinner: false,
      bonusBossMultiplier: 1,
      bonusMythicalMultiplier: 1,
      forceTrash: false,
      mythicalFishID: enabledMythical || null,
      discoveredCreatures: null,
      anglerTuesday: new Date(hourlyTime).getUTCDay() === 2,
      invasion: null,
    };

    const postResponse = await fetch(POST_SIMULATOR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Referer: "https://dankmemer.lol/fish/simulator" },
      body: JSON.stringify(payload),
    });

    if (!postResponse.ok) continue;
    const postData = await postResponse.json();

    let hourTokens = 0;
    let hourCoins = 0;
    const hourBossesCaught = new Map();

    for (const row of (Array.isArray(postData?.table) ? postData.table : [])) {
      const chance = Number(row.chance || 0) / 100;
      const expectedCatches = chance * catchesPerHour;
      const val = row.value || {};
      const type = String(val.type || "");

      if (type === "fish-creature" || type === "boss-creature") {
        const cId = val.creatureID;
        const isMythic = mythicalsInLocation.includes(cId);
        const isB = isBoss(cId);

        hourTokens += expectedCatches * getExpectedTokens(cId, postData);

        if (isMythic) {
          if (enabledMythical === cId) {
            const price = getFishPrice(cId, true);
            hourCoins += expectedCatches * price;
            hourBossesCaught.set(cId, (hourBossesCaught.get(cId) || 0) + expectedCatches);
          }
        } else if (isB) {
          const price = getFishPrice(cId, false);
          hourCoins += expectedCatches * price;
          hourBossesCaught.set(cId, (hourBossesCaught.get(cId) || 0) + expectedCatches);
          bossSet.add(cId);
        }
      }
    }

    results.push({ time: hourlyTime, tokens: hourTokens, coins: hourCoins, bossesCaught: hourBossesCaught });
  }

  const fishTokensEmoji = global.db.getFeatherEmojiMarkdown?.("fish_token") || "<:fishtoken:1157677856596435086>";

  // --- Config: boss list + selected mythical ---
  const bossLines = [];
  for (const b of bossSet) {
    const name = getData.fish?.[b]?.name || b;
    const price = getFishPrice(b, false);
    const emoji = getEmoji("creature", b) || "🐟";
    const priceStr = price >= 1_000_000 ? `${(price / 1_000_000).toFixed(0)}m` : price.toLocaleString();
    bossLines.push(`${emoji} **${name}** (⏣ ${priceStr})`);
  }
  if (enabledMythical) {
    const name = getData.fish?.[enabledMythical]?.name || enabledMythical;
    const price = getFishPrice(enabledMythical, true);
    const emoji = getEmoji("creature", enabledMythical) || "✨";
    const priceStr = price >= 1_000_000 ? `${(price / 1_000_000).toFixed(0)}m` : price.toLocaleString();
    bossLines.push(`${emoji} **${name}** (⏣ ${priceStr}) ✨`);
  }

  const configText = `### Configuration\n${bossLines.length ? bossLines.join(", ") : "No bosses spotted in this location"}`;

  // --- Select menu: Location (max 1) ---
  const locationOptions = (getData.locations || []).slice(0, 25).map(l =>
    makeOption(l.name, l.id, l.id === locationID, getEmoji("location", l.id))
  );
  const locationSelect = new StringSelectMenuBuilder()
    .setCustomId(`${ROUTE_PREFIX}:loc_select`)
    .setPlaceholder("📍 Select Location")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(locationOptions.length ? locationOptions : [{ label: "Unknown", value: "unknown" }]);

  // --- Select menu: Mythical fish (max 1, has "None") ---
  const mythicalOptions = [makeOption("None", "none", !enabledMythical, null)];
  for (const m of mythicalsInLocation) {
    const name = getData.fish?.[m]?.name || m;
    mythicalOptions.push(makeOption(name, m, enabledMythical === m, getEmoji("creature", m)));
  }
  const mythicalSelect = new StringSelectMenuBuilder()
    .setCustomId(`${ROUTE_PREFIX}:mythical_select`)
    .setPlaceholder("✨ Select Mythical Fish (optional)")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(mythicalOptions.slice(0, 25));

  // --- Select menu: Tool (max 1) ---
  const toolOptions = (getData.tools || []).slice(0, 25).map(t =>
    makeOption(t.name, t.id, t.id === toolID, getEmoji("tool", t.id))
  );
  const toolSelect = new StringSelectMenuBuilder()
    .setCustomId(`${ROUTE_PREFIX}:tool_select`)
    .setPlaceholder("🛠️ Select Tool")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(toolOptions.length ? toolOptions : [{ label: "Unknown", value: "unknown" }]);

  // --- Select menu: Bait (max 2, has "None") ---
  const baitOptions = [makeOption("None", "none", baitsIDs.length === 0, null)];
  for (const b of (getData.baits || [])) {
    baitOptions.push(makeOption(b.name, b.id, baitsIDs.includes(b.id), getEmoji("bait", b.id)));
  }
  const baitSelect = new StringSelectMenuBuilder()
    .setCustomId(`${ROUTE_PREFIX}:bait_select`)
    .setPlaceholder("🎣 Select Bait (up to 2)")
    .setMinValues(1)
    .setMaxValues(2)
    .addOptions(baitOptions.slice(0, 25));

  // --- Hourly breakdown ---
  const hoursDisplay = results.map(r => {
    const ts = Math.floor(r.time / 1000);
    const coinsStr = Math.round(r.coins).toLocaleString();
    const tokensStr = Math.round(r.tokens).toLocaleString();
    let line = `* <t:${ts}:t> - ⏣ ~${coinsStr} | ${fishTokensEmoji} ~${tokensStr}`;

    if (r.bossesCaught.size > 0) {
      const caughtStrs = [];
      for (const [cId, count] of r.bossesCaught.entries()) {
        if (count < 0.01) continue;
        const emoji = getEmoji("creature", cId) || "🐟";
        const name = getData.fish?.[cId]?.name || cId;
        caughtStrs.push(`${count.toFixed(2)}x ${emoji} **${name}**`);
      }
      if (caughtStrs.length > 0) line += `\n-# ${caughtStrs.join(", ")}`;
    }
    return line;
  }).join("\n\n");

  // --- Assemble container ---
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("## Expected Income"))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(hoursDisplay))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(configText))
    .addActionRowComponents(new ActionRowBuilder().addComponents(locationSelect))
    .addActionRowComponents(new ActionRowBuilder().addComponents(mythicalSelect))
    .addActionRowComponents(new ActionRowBuilder().addComponents(toolSelect))
    .addActionRowComponents(new ActionRowBuilder().addComponents(baitSelect));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

async function runDankCalcLocation(interaction) {
  const locInput = interaction.options.getString("location");
  const toolInput = interaction.options.getString("tool");
  const baitInput = interaction.options.getString("bait");

  await interaction.deferReply();
  const reply = await interaction.fetchReply();

  const userId = interaction.user.id;
  const getResponse = await fetch(
    `${GET_SIMULATOR_URL}?id=${encodeURIComponent(userId)}`,
    { headers: { Accept: "application/json", Referer: "https://dankmemer.lol/fish/simulator" } }
  );
  if (!getResponse.ok) return interaction.editReply("Failed to fetch simulator data.");

  const getJson = await getResponse.json();
  const settings = getJson?.settings || {};
  const getData = getJson?.data || {};

  const locationID = locInput || settings.location || "river";
  const toolID = toolInput || settings.tool || "fishing-rod";
  const baitsIDs = baitInput ? [baitInput] : (Array.isArray(settings.baits) ? settings.baits : []);
  const skills = settings.skills || {};

  const dbRows = await global.db.safeQuery(
    `SELECT entity_type, entity_id, application_emoji FROM dank_fish_entities`, [], []
  );
  const emojiMap = new Map();
  for (const row of dbRows) {
    emojiMap.set(`${row.entity_type}:${row.entity_id}`, row.application_emoji || "");
  }

  const state = {
    userId,
    locationID,
    toolID,
    baitsIDs,
    enabledMythical: null, // single selection or null
    skills,
    getData,
    emojiMap,
  };
  calcStateCache.set(reply.id, state);

  const payload = await buildCalcPayload(state);
  await interaction.editReply(payload);
}

// All select menus route here
async function handleDankFishCalcSelect(interaction) {
  const [, action] = String(interaction.customId || "").split(":");
  const msgId = interaction.message.id;
  const state = calcStateCache.get(msgId);

  if (!state) {
    return interaction.reply({
      content: "This calculation has expired. Please run the command again.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (action === "loc_select") {
    state.locationID = interaction.values[0];
    state.enabledMythical = null; // reset mythical when location changes
  } else if (action === "mythical_select") {
    const val = interaction.values[0];
    state.enabledMythical = val === "none" ? null : val;
  } else if (action === "tool_select") {
    state.toolID = interaction.values[0];
  } else if (action === "bait_select") {
    // Filter out "none" placeholder; selecting only "none" means no bait
    state.baitsIDs = interaction.values.filter(v => v !== "none").slice(0, 2);
  } else {
    return;
  }

  await interaction.deferUpdate();
  const payload = await buildCalcPayload(state);
  await interaction.editReply(payload);
}

// Register handlers (buttons no longer used but keep route to avoid conflicts)
if (!buttonHandlers.has(ROUTE_PREFIX)) {
  buttonHandlers.set(ROUTE_PREFIX, async () => {});
}
if (!selectMenuHandlers.has(ROUTE_PREFIX)) {
  selectMenuHandlers.set(ROUTE_PREFIX, handleDankFishCalcSelect);
}

module.exports = { runDankCalcLocation };
