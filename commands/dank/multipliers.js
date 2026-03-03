const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { buttonHandlers } = require("../../functions/interactions/button");
const { selectMenuHandlers } = require("../../functions/interactions/selectMenu");
const { modalHandlers } = require("../../functions/interactions/modal");

const MULTIPLIER_ROUTE_PREFIX = "dankmulti";
const MULTIPLIER_PREMIUM_STATE_TYPE = "dank_multiplier_premium_global";
const MULTIPLIER_PAGE_SIZE = 20;
const LEVEL_MODAL_CUSTOM_ID_PREFIX = `${MULTIPLIER_ROUTE_PREFIX}:level_modal`;
const LEVEL_INPUT_START_ID = "level_start";
const LEVEL_INPUT_END_ID = "level_end";
const LEVEL_INPUT_TACO_ID = "level_taco";
const DEFAULT_LEVEL_START = 50;
const DEFAULT_LEVEL_END = 20000;
const DEFAULT_TACO_ENABLED = true;
const BASE_XP_PER_HOUR = 900;
const LEVEL_REWARDS_PER_PAGE = 8;

const PREMIUM_TIERS = [
  { value: "none", label: "None", description: "No premium tier bonuses" },
  {
    value: "credit_card",
    label: "Credit Card",
    description: "Only luck multiplier support",
  },
  {
    value: "meme_enthusiast",
    label: "Meme Enthusiast",
    description: "+50% Coins, 1.05x XP, +5% Luck",
  },
  {
    value: "elite_memer",
    label: "Elite Memer",
    description: "+100% Coins, 1.15x XP, +5% Luck",
  },
  {
    value: "platinum_memer",
    label: "Platinum Memer",
    description: "+200% Coins, 1.20x XP, +5% Luck",
  },
  {
    value: "meme_maestro",
    label: "Meme Maestro",
    description: "+250% Coins, 1.25x XP, +5% Luck",
  },
  {
    value: "meme_mogul",
    label: "Meme Mogul",
    description: "+300% Coins, 1.50x XP, +5% Luck",
  },
];

function encodePart(value) {
  return encodeURIComponent(String(value ?? ""));
}

function decodePart(value) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return "";
  }
}

function buildEditCustomId(viewState, action, page = viewState.page) {
  return [
    MULTIPLIER_ROUTE_PREFIX,
    action,
    String(viewState.userId || ""),
    String(viewState.type || "xp"),
    String(Math.max(0, Number(page || 0))),
  ].join(":");
}

function parseEditCustomId(customId) {
  const [route, action, ownerId, type, pageRaw] = String(customId || "").split(":");
  if (route !== MULTIPLIER_ROUTE_PREFIX || !action || !ownerId) return null;
  return {
    action,
    state: {
      userId: String(ownerId),
      type: String(type || "xp"),
      page: Math.max(0, Number(pageRaw || 0)),
    },
  };
}

function buildLevelCustomId(state, action, page = state.page) {
  return [
    MULTIPLIER_ROUTE_PREFIX,
    action,
    String(state.userId || ""),
    String(state.sourceType || "xp"),
    String(Math.max(1, Math.trunc(Number(state.startLevel ?? DEFAULT_LEVEL_START)))),
    String(Math.max(2, Math.trunc(Number(state.endLevel ?? DEFAULT_LEVEL_END)))),
    state.tacoEnabled ? "1" : "0",
    String(Math.max(0, Number(page || 0))),
  ].join(":");
}

function parseLevelCustomId(customId) {
  const [route, action, ownerId, sourceType, startRaw, endRaw, tacoRaw, pageRaw] = String(
    customId || "",
  ).split(":");
  if (route !== MULTIPLIER_ROUTE_PREFIX || !action || !ownerId) return null;
  const startLevel = Math.max(1, Math.trunc(Number(startRaw || DEFAULT_LEVEL_START)));
  const endLevel = Math.max(startLevel + 1, Math.trunc(Number(endRaw || DEFAULT_LEVEL_END)));
  return {
    action,
    state: {
      userId: String(ownerId),
      sourceType: String(sourceType || "xp"),
      startLevel,
      endLevel,
      tacoEnabled: String(tacoRaw || "0") === "1",
      page: Math.max(0, Number(pageRaw || 0)),
    },
  };
}

function getMultiplierProfileType(multiplierType) {
  return `dank_multiplier_profile_${multiplierType}`;
}

function getTrackedMultiplierStateType(multiplierType) {
  return `dank_tracked_multipliers_${multiplierType}`;
}

function defaultMultiplierProfile() {
  return {
    track: true,
    selected: [],
    premium: "none",
    omega: 0,
    prestige: 0,
  };
}

function loadGlobalPremium(userId) {
  const raw = String(global.db.getState(MULTIPLIER_PREMIUM_STATE_TYPE, userId) || "none");
  return PREMIUM_TIERS.some((tier) => tier.value === raw) ? raw : "none";
}

function loadMultiplierProfile(userId, multiplierType) {
  const raw = global.db.getState(getMultiplierProfileType(multiplierType), userId);
  if (!raw) {
    return {
      ...defaultMultiplierProfile(),
      premium: loadGlobalPremium(userId),
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ...defaultMultiplierProfile(),
      ...parsed,
      selected: Array.isArray(parsed?.selected)
        ? [...new Set(parsed.selected.map((v) => String(v || "").trim()).filter(Boolean))]
        : [],
      track: parsed?.track !== false,
      premium: loadGlobalPremium(userId),
      omega: Math.max(0, Math.trunc(Number(parsed?.omega || 0))),
      prestige: Math.max(0, Math.trunc(Number(parsed?.prestige || 0))),
    };
  } catch {
    return {
      ...defaultMultiplierProfile(),
      premium: loadGlobalPremium(userId),
    };
  }
}

function saveMultiplierProfile(userId, multiplierType, profile) {
  global.db.upsertState(
    getMultiplierProfileType(multiplierType),
    JSON.stringify({
      ...defaultMultiplierProfile(),
      ...profile,
      selected: Array.isArray(profile?.selected)
        ? [...new Set(profile.selected.map((v) => String(v || "").trim()).filter(Boolean))]
        : [],
      premium: String(profile?.premium || "none"),
      omega: Math.max(0, Math.trunc(Number(profile?.omega || 0))),
      prestige: Math.max(0, Math.trunc(Number(profile?.prestige || 0))),
      track: profile?.track !== false,
    }),
    userId,
    true,
  );
}

function setPremiumForAllTypes(userId, premiumValue) {
  const premium = PREMIUM_TIERS.some((tier) => tier.value === premiumValue)
    ? premiumValue
    : "none";
  global.db.upsertState(MULTIPLIER_PREMIUM_STATE_TYPE, premium, userId, true);

  for (const type of ["xp", "coins", "luck"]) {
    const profile = loadMultiplierProfile(userId, type);
    profile.premium = premium;
    saveMultiplierProfile(userId, type, profile);
  }
}

function loadTrackedMultiplierEntries(userId, multiplierType) {
  const raw = global.db.getState(getTrackedMultiplierStateType(multiplierType), userId);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        name: String(entry?.name || "").trim(),
        amount: Number(entry?.amount),
      }))
      .filter((entry) => entry.name && Number.isFinite(entry.amount));
  } catch {
    return [];
  }
}

function listKnownMultipliers(multiplierType) {
  return global.db.safeQuery(
    `
    SELECT name, amount, MIN(description) AS description, MAX(emoji) AS emoji
    FROM dank_multipliers
    WHERE type = ?
    GROUP BY name, amount
    ORDER BY LOWER(name) ASC, amount DESC
    `,
    [multiplierType],
  );
}

function makeMultiplierSelectionKey(name, amount) {
  const safeName = String(name || "").trim();
  const safeAmount = Number(amount).toFixed(4);
  const base = `${safeName}::${safeAmount}`;
  if (base.length <= 100) return base;

  // Discord select option values are capped at 100 chars.
  let hash = 0;
  for (let i = 0; i < safeName.length; i += 1) {
    hash = Math.imul(31, hash) + safeName.charCodeAt(i);
    hash |= 0;
  }
  const hashPart = Math.abs(hash).toString(36);
  const trimmedName = safeName.slice(0, 82);
  return `${trimmedName}#${hashPart}::${safeAmount}`.slice(0, 100);
}

function normalizeSelectedMultiplierKeys(selectedValues, rows) {
  const keyMap = new Map();
  const highestByName = new Map();

  for (const row of rows || []) {
    const key = makeMultiplierSelectionKey(row?.name, row?.amount);
    keyMap.set(key, row);

    const name = String(row?.name || "").trim();
    if (!name) continue;
    const prev = highestByName.get(name);
    if (!prev || Number(row?.amount || 0) > Number(prev.amount || 0)) {
      highestByName.set(name, row);
    }
  }

  const out = [];
  const seen = new Set();
  for (const rawValue of selectedValues || []) {
    const value = String(rawValue || "").trim();
    if (!value) continue;

    if (keyMap.has(value)) {
      if (!seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
      continue;
    }

    const fallbackRow = highestByName.get(value);
    if (!fallbackRow) {
      // Keep special synthetic entries that are not part of the selectable pool.
      if (/(omega|prestige|premium)/i.test(value) && !seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
      continue;
    }

    const fallbackKey = makeMultiplierSelectionKey(
      fallbackRow.name,
      fallbackRow.amount,
    );
    if (!seen.has(fallbackKey)) {
      seen.add(fallbackKey);
      out.push(fallbackKey);
    }
  }

  return out;
}

function getPremiumConfig(value) {
  const tier = String(value || "none");
  if (tier === "meme_enthusiast") return { xp: 1.05, coins: 50, luck: 5, name: "Premium" };
  if (tier === "elite_memer") return { xp: 1.15, coins: 100, luck: 5, name: "Premium" };
  if (tier === "platinum_memer") return { xp: 1.2, coins: 200, luck: 5, name: "Premium" };
  if (tier === "meme_maestro") return { xp: 1.25, coins: 250, luck: 5, name: "Premium" };
  if (tier === "meme_mogul") return { xp: 1.5, coins: 300, luck: 5, name: "Premium" };
  if (tier === "credit_card") return { xp: null, coins: null, luck: 5, name: "Premium" };
  return { xp: null, coins: null, luck: null, name: "Premium" };
}

function getMultiplierUiEmoji(name, fallback = "") {
  return global.db.getFeatherEmojiMarkdown(name) || fallback;
}

function getPremiumTierEmoji(tierValue) {
  const tier = String(tierValue || "none");
  if (tier === "credit_card") {
    return (
      global.db.getDankItemEmojiMarkdown("Credit Card") ||
      getMultiplierUiEmoji("dank_gecko", "")
    );
  }

  return getMultiplierUiEmoji(`dank_membership_${tier}`, "");
}

function formatMultiplierAmount(multiplierType, amount) {
  if (multiplierType === "xp") return `${Number(amount).toFixed(2)}x`;
  return `${Number(amount) >= 0 ? "+" : ""}${Number(amount).toFixed(2)}%`;
}

function parseTruthyInput(input, fallback = true) {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return fallback;
  if (["true", "1", "yes", "y", "on", "t"].includes(text)) return true;
  if (["false", "0", "no", "n", "off", "f"].includes(text)) return false;
  return fallback;
}

function computeLevelXpRequirement(level, tacoEnabled) {
  const x = Number(level);
  const value = 0.0000117058 * x * x + 0.0142744 * x + 92.6934;
  return value;
}

function computeTotalLevelXp(startLevel, endLevel, tacoEnabled) {
  let total = 0;
  for (let level = startLevel; level < endLevel; level += 1) {
    total += computeLevelXpRequirement(level, tacoEnabled);
  }
  return Math.max(0, Math.round(total));
}

function formatEtaHours(hoursFloat) {
  const totalMinutes = Math.max(0, Math.round(Number(hoursFloat || 0) * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `~${hours.toLocaleString()}h ${minutes}min`;
}

function parseEmojiMarkdownFromText(text) {
  const raw = String(text || "");
  const match = raw.match(/<a?:[a-zA-Z0-9_]+:\d+>/);
  return match ? match[0] : null;
}

function loadLevelRewardsSummary(startLevel, endLevel, tacoEnabled) {
  const rewardRows = global.db.safeQuery(
    `
    SELECT name, amount, title
    FROM dank_level_rewards
    WHERE level > ? AND level <= ?
    `,
    [startLevel, endLevel],
  );

  const byItem = new Map();
  const valueRows = global.db.safeQuery(
    `
    SELECT name, market, application_emoji, fishing
    FROM dank_items
    `,
  );
  const valueMap = new Map(
    valueRows.map((row) => [
      String(row?.name || "").toLowerCase(),
      {
        name: String(row?.name || ""),
        market: Number(row?.market || 0),
        emoji: row?.application_emoji || null,
        fishing: Number(row?.fishing || 0) === 1,
      },
    ]),
  );
  const byEmojiId = new Map();
  for (const row of valueRows) {
    const emoji = String(row?.application_emoji || "");
    const match = emoji.match(/:(\d+)>$/);
    if (match?.[1]) {
      byEmojiId.set(match[1], String(row?.name || ""));
    }
  }

  function normalizeRewardName(rawName) {
    let name = String(rawName || "").trim();
    if (!name) return "";

    const emojiIdMatch = name.match(/:(\d+)>?/);
    const mappedByEmoji = emojiIdMatch?.[1] ? byEmojiId.get(emojiIdMatch[1]) : null;
    if (mappedByEmoji) {
      return mappedByEmoji;
    }

    name = name.replace(/^\d+\s+/, "").trim();
    name = name.replace(/^<a?:[a-zA-Z0-9_]+:\d+>?/, "").trim();
    return name;
  }

  for (const row of rewardRows) {
    if (Number(row?.title) === 1) continue;
    const name = normalizeRewardName(row?.name);
    const amount = Number(row?.amount || 0);
    if (!name || !Number.isFinite(amount) || amount <= 0) continue;
    byItem.set(name, (byItem.get(name) || 0) + amount);
  }

  const items = [...byItem.entries()].map(([name, amount]) => ({ name, amount }));
  if (!items.length) {
    return {
      topLines: ["-# No reward data found in `dank_level_rewards` for this range."],
      totalValue: 0,
      totalEntries: 0,
    };
  }

  const enriched = items.map((item) => {
    const lower = item.name.toLowerCase();
    const itemData = valueMap.get(lower);
    const tacoRewardMultiplier = tacoEnabled && !itemData?.fishing ? 2 : 1;
    const adjustedAmount = Math.max(0, Math.round(item.amount * tacoRewardMultiplier));
    const unitValue = lower === "dmc" ? 1 : Number(itemData?.market || 0);
    const lineValue = Math.max(0, Math.round(adjustedAmount * unitValue));
    const emoji = itemData?.emoji || null;
    return {
      ...item,
      amount: adjustedAmount,
      lineValue,
      emoji,
    };
  });

  enriched.sort((a, b) => b.lineValue - a.lineValue || a.name.localeCompare(b.name));
  const totalValue = enriched.reduce((sum, row) => sum + row.lineValue, 0);
  return {
    entries: enriched,
    totalValue,
    totalEntries: enriched.length,
  };
}

function computeMultiplierResult(multiplierType, profile, knownRows, trackedRows) {
  const usingTracked = profile.track === true;
  const emojiByName = new Map(
    knownRows.map((row) => [
      String(row?.name || "").toLowerCase(),
      String(row?.emoji || ""),
    ]),
  );
  let entries = [];

  if (usingTracked) {
    entries = trackedRows.map((row) => ({
      name: row.name,
      amount: Number(row.amount),
      emoji: emojiByName.get(String(row.name || "").toLowerCase()) || null,
      source: "tracked",
    }));
  } else {
    const byKey = new Map(
      knownRows.map((row) => [
        makeMultiplierSelectionKey(row?.name, row?.amount),
        {
          name: String(row?.name || ""),
          amount: Number(row.amount),
          emoji: String(row.emoji || ""),
        },
      ]),
    );
    const selectedKeys = normalizeSelectedMultiplierKeys(profile.selected || [], knownRows);
    entries = selectedKeys
      .filter((key) => !/premium/i.test(String(key || "")))
      .map((key) => {
        const row = byKey.get(key);
        return {
          name: String(row?.name || ""),
          amount: Number(row?.amount),
          emoji: row?.emoji || null,
          source: "manual",
        };
      })
      .filter((row) => row.name && Number.isFinite(row.amount))
      .map((row) => ({
        ...row,
        source: "manual",
      }));

    if (multiplierType === "xp") {
      const omega = Math.max(0, Math.trunc(Number(profile.omega || 0)));
      const prestige = Math.max(0, Math.trunc(Number(profile.prestige || 0)));
      if (omega > 0) {
        entries.push({
          name: "Omega",
          amount: Number((1 + omega * 0.1).toFixed(2)),
          emoji:
            emojiByName.get("omega") ||
            getMultiplierUiEmoji("dank_omega", null),
          source: "derived",
        });
      }
      if (prestige > 0) {
        entries.push({
          name: "Prestige",
          amount: Number((1 + prestige * 0.012).toFixed(2)),
          emoji:
            emojiByName.get("prestige") ||
            getMultiplierUiEmoji("dank_prestige", null),
          source: "derived",
        });
      }
    }

    if (multiplierType === "coins") {
      const prestige = Math.max(0, Math.trunc(Number(profile.prestige || 0)));
      if (prestige > 0) {
        entries.push({
          name: "Prestige",
          amount: prestige * 5,
          emoji:
            emojiByName.get("prestige") ||
            getMultiplierUiEmoji("dank_prestige", null),
          source: "derived",
        });
      }
    }
  }

  const hasPremiumInEntries = entries.some((entry) =>
    /premium/i.test(String(entry?.name || "")),
  );
  if (!hasPremiumInEntries) {
    const premium = getPremiumConfig(profile.premium);
    const premiumEmoji =
      emojiByName.get("premium") ||
      getPremiumTierEmoji(profile.premium) ||
      null;
    if (multiplierType === "xp" && Number.isFinite(premium.xp) && premium.xp > 0) {
      entries.push({
        name: premium.name,
        amount: premium.xp,
        emoji: premiumEmoji,
        source: "premium",
      });
    }
    if (multiplierType === "coins" && Number.isFinite(premium.coins)) {
      entries.push({
        name: premium.name,
        amount: premium.coins,
        emoji: premiumEmoji,
        source: "premium",
      });
    }
    if (multiplierType === "luck" && Number.isFinite(premium.luck)) {
      entries.push({
        name: premium.name,
        amount: premium.luck,
        emoji: premiumEmoji,
        source: "premium",
      });
    }
  }

  if (multiplierType === "xp") {
    let total = 1;
    for (const row of entries) {
      total *= Number(row.amount);
    }
    return {
      entries: entries.filter((row) => Number.isFinite(row.amount) && row.amount > 0),
      total: Number(total.toFixed(4)),
      usingTracked,
    };
  }

  let total = 0;
  for (const row of entries) {
    total += Number(row.amount);
  }

  if (multiplierType === "coins") {
    total = Math.min(1000, total);
  }

  return {
    entries: entries.filter((row) => Number.isFinite(row.amount)),
    total: Number(total.toFixed(2)),
    usingTracked,
  };
}

function splitMultiplierRows(rows) {
  const sorted = [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return sorted;
}

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
  if (text.length <= 8) return { name: text };
  return null;
}

function applyButtonEmoji(button, emoji) {
  if (emoji) {
    button.setEmoji(emoji);
  }
  return button;
}

function buildMultiplierOptions(rows, selectedSet, multiplierType) {
  return rows.map((row) => {
    const amount = formatMultiplierAmount(multiplierType, row.amount);
    const key = makeMultiplierSelectionKey(row?.name, row?.amount);
    const option = {
      label: `${String(row.name)} [${amount}]`.slice(0, 100),
      value: key,
      default: selectedSet.has(key),
    };
    const emoji = parseEmojiValue(row.emoji);
    if (emoji) option.emoji = emoji;
    const desc = String(row.description || "").trim();
    if (desc) {
      option.description = desc.slice(0, 100);
    }
    return option;
  });
}

function buildPremiumOptions(selected) {
  return PREMIUM_TIERS.map((tier) => {
    const option = {
      label: tier.label.slice(0, 100),
      value: tier.value.slice(0, 100),
      description: tier.description.slice(0, 100),
      default: tier.value === selected,
    };
    const emoji = parseEmojiValue(getPremiumTierEmoji(tier.value));
    if (emoji) option.emoji = emoji;
    return option;
  });
}

function buildMultiplierEditPayload(viewState) {
  const profile = loadMultiplierProfile(viewState.userId, viewState.type);
  const rows = listKnownMultipliers(viewState.type);
  const trackedRows = loadTrackedMultiplierEntries(viewState.userId, viewState.type);
  const sortedRows = splitMultiplierRows(rows);
  const normalizedSelected = normalizeSelectedMultiplierKeys(
    profile.selected || [],
    sortedRows,
  );
  profile.selected = normalizedSelected;
  saveMultiplierProfile(viewState.userId, viewState.type, profile);
  const totalPages = Math.max(
    1,
    Math.ceil(sortedRows.length / MULTIPLIER_PAGE_SIZE),
  );
  const page = Math.min(
    Math.max(0, Number(viewState.page || 0)),
    totalPages - 1,
  );
  const pageRows = sortedRows.slice(
    page * MULTIPLIER_PAGE_SIZE,
    (page + 1) * MULTIPLIER_PAGE_SIZE,
  );
  const selectedSet = new Set(normalizedSelected);
  const hasOmegaMultiplier =
    [...selectedSet].some((name) => /omega/i.test(String(name || ""))) ||
    trackedRows.some((entry) => /omega/i.test(String(entry?.name || "")));
  const hasPrestigeMultiplier =
    [...selectedSet].some((name) => /prestige/i.test(String(name || ""))) ||
    trackedRows.some((entry) => /prestige/i.test(String(entry?.name || "")));
  const trackLabel = profile.track ? "On" : "Off";
  const edit3Emoji = parseEmojiValue(getMultiplierUiEmoji("edit-3", ""));
  const omegaTierEmoji = getMultiplierUiEmoji("dank_omega", "");
  const prestigeTierEmoji = getMultiplierUiEmoji("dank_prestige", "");

  const typeLabel =
    viewState.type === "xp" ? "XP" : viewState.type === "coins" ? "Coins" : "Luck";

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Edit semi-permanent Multipliers"),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Temporary Multipliers"),
    );

  if (sortedRows.length > MULTIPLIER_PAGE_SIZE) {
    const leftEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("chevron-left")) || {
      name: "◀️",
    };
    const rightEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("chevron-right")) || {
      name: "▶️",
    };
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildEditCustomId(viewState, "edit_prev", page - 1))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(leftEmoji)
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId(buildEditCustomId(viewState, "edit_page", page))
          .setStyle(ButtonStyle.Secondary)
          .setLabel(`${page + 1}/${totalPages}`)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(buildEditCustomId(viewState, "edit_next", page + 1))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(rightEmoji)
          .setDisabled(page >= totalPages - 1),
      ),
    );
  }

  if (pageRows.length) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(buildEditCustomId(viewState, "edit_select", page))
          .setPlaceholder("Select Multiplier")
          .setMinValues(0)
          .setMaxValues(pageRows.length)
          .addOptions(buildMultiplierOptions(pageRows, selectedSet, viewState.type)),
      ),
    );
  }

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildEditCustomId(viewState, "go_calc", page))
          .setStyle(ButtonStyle.Primary)
          .setLabel("Go to Calculator"),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Edit Premium Tier"),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(buildEditCustomId(viewState, "edit_premium", page))
          .setPlaceholder("Select Premium Tier")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(buildPremiumOptions(profile.premium || "none")),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${omegaTierEmoji ? `${omegaTierEmoji} ` : ""}Select your OMEGA tier\n-# Current: ${hasOmegaMultiplier ? "auto" : Math.max(0, Math.trunc(Number(profile.omega || 0)))}`,
          ),
        )
        .setButtonAccessory(
          applyButtonEmoji(
            new ButtonBuilder()
              .setCustomId(buildEditCustomId(viewState, "edit_omega", page))
              .setStyle(ButtonStyle.Secondary)
              .setLabel("Set OMEGA"),
            edit3Emoji,
          ),
        ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${prestigeTierEmoji ? `${prestigeTierEmoji} ` : ""}Select your Prestige tier\n-# Current: ${hasPrestigeMultiplier ? "auto" : Math.max(0, Math.trunc(Number(profile.prestige || 0)))}`,
          ),
        )
        .setButtonAccessory(
          applyButtonEmoji(
            new ButtonBuilder()
              .setCustomId(buildEditCustomId(viewState, "edit_prestige", page))
              .setStyle(ButtonStyle.Secondary)
              .setLabel("Set Prestige"),
            edit3Emoji,
          ),
        ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `Track my ${typeLabel} multipliers for changes\n-# Uses live /multiplier tracking when enabled.\n-# Current: ${trackLabel}`,
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(buildEditCustomId(viewState, "edit_track", page))
            .setStyle(profile.track ? ButtonStyle.Success : ButtonStyle.Danger)
            .setLabel(profile.track ? "Tracking: On" : "Tracking: Off"),
        ),
    );

  return {
    content: "",
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function syncManualSelectedMultiplierRows(userId, multiplierType, selected) {
  global.db.safeQuery(
    `DELETE FROM dank_selected_multipliers WHERE user_id = ? AND type = ?`,
    [userId, multiplierType],
  );

  for (const name of [...new Set(selected)]) {
    global.db.safeQuery(
      `INSERT INTO dank_selected_multipliers (user_id, name, type) VALUES (?, ?, ?) ON CONFLICT(user_id, name, type) DO NOTHING`,
      [userId, name, multiplierType],
    );
  }
}

function clearAllMultiplierSelections(userId, multiplierType) {
  const profile = loadMultiplierProfile(userId, multiplierType);
  profile.selected = (profile.selected || []).filter((name) =>
    /(omega|prestige|premium)/i.test(String(name || "")),
  );
  saveMultiplierProfile(userId, multiplierType, profile);

  const tracked = loadTrackedMultiplierEntries(userId, multiplierType);
  const trackedPermanent = tracked.filter((entry) =>
    /(omega|prestige|premium)/i.test(String(entry?.name || "")),
  );

  global.db.safeQuery(
    `DELETE FROM dank_selected_multipliers
     WHERE user_id = ?
       AND type = ?
       AND LOWER(name) NOT LIKE '%omega%'
       AND LOWER(name) NOT LIKE '%prestige%'
       AND LOWER(name) NOT LIKE '%premium%'`,
    [userId, multiplierType],
  );

  global.db.upsertState(
    getTrackedMultiplierStateType(multiplierType),
    JSON.stringify(trackedPermanent),
    userId,
    true,
  );
}

function buildMultiplierCalculatePayload(userId, multiplierType) {
  const profile = loadMultiplierProfile(userId, multiplierType);
  const knownRows = listKnownMultipliers(multiplierType);
  const trackedRows = loadTrackedMultiplierEntries(userId, multiplierType);
  const result = computeMultiplierResult(multiplierType, profile, knownRows, trackedRows);
  const typeLabel =
    multiplierType === "xp" ? "XP" : multiplierType === "coins" ? "Coins" : "Luck";
  const totalTypeEmoji =
    multiplierType === "xp"
      ? getMultiplierUiEmoji("dank_multiplier_xp", "")
      : multiplierType === "coins"
        ? getMultiplierUiEmoji("dank_multiplier_coins", "")
        : getMultiplierUiEmoji("dank_multiplier_luck", "");
  const editEmoji =
    parseEmojiValue(global.db.getFeatherEmojiMarkdown("edit")) ||
    parseEmojiValue(global.db.getFeatherEmojiMarkdown("edit-3"));
  const trashEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("trash"));

  const totalLine =
    multiplierType === "xp"
      ? `# Total: ${result.total.toFixed(2)}x${totalTypeEmoji ? ` ${totalTypeEmoji}` : ""}`
      : `# Total: +${result.total.toFixed(2)}%`;
  const entriesText = result.entries.length
    ? result.entries
        .map(
          (entry) =>
            `◈ \`${formatMultiplierAmount(multiplierType, entry.amount)}\` - ${entry.emoji ? `${entry.emoji} ` : ""}**${entry.name}**`,
        )
        .join("\n")
    : "-# No multipliers selected yet";

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${typeLabel} Calculator™`),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${totalLine}\n-# Mode: ${result.usingTracked ? "Tracked" : "Manual"}`,
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:calc_level:${multiplierType}`)
            .setLabel("Level Calculator")
            .setStyle(ButtonStyle.Secondary),
        ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(entriesText))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        applyButtonEmoji(
          new ButtonBuilder()
            .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:calc_edit:${multiplierType}`)
            .setStyle(ButtonStyle.Secondary)
            .setLabel("Edit Multipliers"),
          editEmoji,
        ),
        applyButtonEmoji(
          new ButtonBuilder()
            .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:calc_clean:${multiplierType}`)
            .setStyle(ButtonStyle.Danger)
            .setLabel("Clean all multipliers"),
          trashEmoji,
        ),
      ),
    );

  return {
    content: "",
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function buildLevelCalculatorPayload(state = {}) {
  const userId = state.userId;
  const startLevel = Math.max(
    1,
    Math.trunc(Number(state.startLevel ?? DEFAULT_LEVEL_START)),
  );
  const endLevel = Math.max(
    startLevel + 1,
    Math.trunc(Number(state.endLevel ?? DEFAULT_LEVEL_END)),
  );
  const tacoEnabled = Boolean(state.tacoEnabled ?? DEFAULT_TACO_ENABLED);

  const xpProfile = loadMultiplierProfile(userId, "xp");
  const xpKnownRows = listKnownMultipliers("xp");
  const xpTrackedRows = loadTrackedMultiplierEntries(userId, "xp");
  const xpResult = computeMultiplierResult("xp", xpProfile, xpKnownRows, xpTrackedRows);
  const xpMulti = Math.max(0.01, Number(xpResult.total || 1));
  const effectiveMulti = tacoEnabled ? xpMulti * 1.1 : xpMulti;

  const totalXp = computeTotalLevelXp(startLevel, endLevel, tacoEnabled);
  const baseXp = Math.max(0, Math.round(totalXp / effectiveMulti));
  const etaHours = baseXp / BASE_XP_PER_HOUR;
  const etaText = formatEtaHours(etaHours);
  const rewards = loadLevelRewardsSummary(startLevel, endLevel, tacoEnabled);
  const totalPages = Math.max(
    1,
    Math.ceil(rewards.entries.length / LEVEL_REWARDS_PER_PAGE),
  );
  const page = Math.min(Math.max(0, Number(state.page || 0)), totalPages - 1);
  const pageEntries = rewards.entries.slice(
    page * LEVEL_REWARDS_PER_PAGE,
    (page + 1) * LEVEL_REWARDS_PER_PAGE,
  );
  const remaining = Math.max(0, rewards.totalEntries - (page + 1) * LEVEL_REWARDS_PER_PAGE);

  const timerEmoji = global.db.getFeatherEmojiMarkdown("timer") || "⏱️";
  const xpEmoji =
    global.db.getDankItemEmojiMarkdown("XP") ||
    global.db.getFeatherEmojiMarkdown("zap") ||
    "✨";
  const baseInfo = `${timerEmoji} ETA: **${etaText}** (@ ${BASE_XP_PER_HOUR} XP/h)\n${xpEmoji} Multiplier: ${effectiveMulti.toFixed(2)}x\n-# Total XP: **${totalXp.toLocaleString()}** | Base XP: **${baseXp.toLocaleString()}**`;
  const tacoLine = `-# Taco: ${tacoEnabled ? "On" : "Off"}`;

  const topRewardsText = pageEntries.length
    ? [
        ...pageEntries.map((entry) => {
          const displayEmoji = entry.emoji || "";
          return `✶ ${entry.amount.toLocaleString()} ${displayEmoji ? `${displayEmoji} ` : ""}**${entry.name}** — ⏣ ${entry.lineValue.toLocaleString()}`;
        }),
        ...(remaining > 0 ? [`-# ... ${remaining} Entries not shown`] : []),
      ].join("\n")
    : "-# No rewards found";

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### Level Calculator™\n-# Level \`${startLevel.toLocaleString()} - ${endLevel.toLocaleString()}\``,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`${baseInfo}\n${tacoLine}`),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:calc_back_xp:${state.sourceType || "xp"}`)
            .setStyle(ButtonStyle.Secondary)
            .setLabel("XP Calculator"),
        ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## Top Rewards\n${topRewardsText}`),
    );

  if (rewards.totalEntries > LEVEL_REWARDS_PER_PAGE) {
    const leftEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("chevron-left")) || {
      name: "◀️",
    };
    const rightEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("chevron-right")) || {
      name: "▶️",
    };
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildLevelCustomId(state, "level_prev", page - 1))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(leftEmoji)
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId(buildLevelCustomId(state, "level_page", page))
          .setStyle(ButtonStyle.Secondary)
          .setLabel(`${page + 1}/${totalPages}`)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(buildLevelCustomId(state, "level_next", page + 1))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(rightEmoji)
          .setDisabled(page >= totalPages - 1),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  }

  container
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## Total: ⏣ ${rewards.totalValue.toLocaleString()}`),
    );

  return {
    content: "",
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function formatInt(value) {
  return Math.max(0, Math.trunc(Number(value || 0))).toLocaleString();
}

function ceilTo2(value) {
  return Math.ceil(Number(value || 0) * 100) / 100;
}

function buildOmegaPrestigePayload(calcType, amount, ownerUserId = null) {
  const type = String(calcType || "").toLowerCase();
  const n = Math.max(1, Math.trunc(Number(amount || 1)));
  const premiumEmoji = global.db.getFeatherEmojiMarkdown("dollar-sign") || "$";
  const deleteCustomId = `utility:delete:${ownerUserId || "null"}`;

  if (type === "prestige") {
    const coinsNormal = 28_500_000 * n;
    const coinsPremium = 15_000_000 * n;
    const levelNormal = 85 * n;
    const levelPremium = 65 * n;
    const xpReward = ceilTo2(0.012 * n);
    const coinsReward = 5 * n;

    const container = new ContainerBuilder()
      .setAccentColor(0x606bff)
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `# Prestige ${formatInt(n)} requirements:\n\n### * Coins: \`⏣ ${formatInt(coinsNormal)}\`\n-# * Coins: [${premiumEmoji}]: \`⏣ ${formatInt(coinsPremium)}\`\n### * Level: \`${formatInt(levelNormal)}\`\n-# * Level: [${premiumEmoji}]: \`${formatInt(levelPremium)}\``,
            ),
          )
          .setThumbnailAccessory((thumb) => {
            thumb.setURL("https://cdn.discordapp.com/emojis/573151130154958851.webp");
            return thumb;
          }),
      )
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `## Rewards:\n-# * XP Multi: \`${xpReward.toFixed(2)}x\`\n-# * Coins Multi: \`${formatInt(coinsReward)}%\``,
            ),
          )
          .setButtonAccessory(
            new ButtonBuilder()
              .setCustomId(deleteCustomId)
              .setStyle(ButtonStyle.Danger)
              .setLabel("🚮"),
          ),
      );

    return {
      content: "",
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    };
  }

  const omega = n;
  const prestigeReq = Math.ceil(omega * 1.35);
  const coinsReq = 150_000_000 * omega;
  const xpReward = 1 + omega * 0.1;
  const maxBank = 1_000_000_000 * omega;

  const container = new ContainerBuilder()
    .setAccentColor(0x606bff)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `# Omega ${formatInt(omega)} requirements:\n\n### * Prestige: \`${formatInt(prestigeReq)}\`\n### * Coins: \`⏣ ${formatInt(coinsReq)}\``,
          ),
        )
        .setThumbnailAccessory((thumb) => {
          thumb.setURL("https://cdn.discordapp.com/emojis/901598556790587453.webp");
          return thumb;
        }),
    )
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## Rewards:\n-# * XP Multi: \`${xpReward.toFixed(1)}x\`\n-# * Max. Bank: \`${formatInt(maxBank)}\``,
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(deleteCustomId)
            .setStyle(ButtonStyle.Danger)
            .setLabel("🚮"),
        ),
    );

  return {
    content: "",
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

async function runDankMultiplierEdit(interaction, type) {
  const viewState = {
    userId: interaction.user.id,
    type,
    page: 0,
  };
  await interaction.reply(buildMultiplierEditPayload(viewState));
}

async function runDankMultiplierCalculate(interaction, type) {
  if (type === "level") {
    const initialState = {
      userId: interaction.user.id,
      sourceType: "xp",
      startLevel: DEFAULT_LEVEL_START,
      endLevel: DEFAULT_LEVEL_END,
      tacoEnabled: DEFAULT_TACO_ENABLED,
      page: 0,
    };
    await interaction.reply(buildLevelCalculatorPayload(initialState));
    return;
  }
  await interaction.reply(buildMultiplierCalculatePayload(interaction.user.id, type));
}

async function runDankOmegaPrestigeCalculate(interaction) {
  const type = interaction.options.getString("type", true);
  const number = interaction.options.getNumber("number", true);
  await interaction.reply(
    buildOmegaPrestigePayload(type, number, interaction.user?.id || null),
  );
}

function buildDefaultLevelState(userId, sourceType = "xp") {
  return {
    userId,
    sourceType,
    startLevel: DEFAULT_LEVEL_START,
    endLevel: DEFAULT_LEVEL_END,
    tacoEnabled: DEFAULT_TACO_ENABLED,
    page: 0,
  };
}

async function handleDankMultiplierButton(interaction) {
  const customId = String(interaction.customId || "");
  const [, action, tokenOrType] = customId.split(":");
  if (!action || !tokenOrType) return;

  if (action === "calc_level") {
    const type = tokenOrType;
    if (type !== "xp") {
      await interaction.reply({
        content: "Level Calculator is only available from XP Calculator.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const levelState = buildDefaultLevelState(interaction.user.id, type);
    const modal = new ModalBuilder()
      .setCustomId(
        `${LEVEL_MODAL_CUSTOM_ID_PREFIX}:${interaction.user.id}:${encodePart(type)}`,
      )
      .setTitle("Level Calculator")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(LEVEL_INPUT_START_ID)
            .setLabel("Start Level")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(DEFAULT_LEVEL_START)),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(LEVEL_INPUT_END_ID)
            .setLabel("End Level")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(DEFAULT_LEVEL_END)),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(LEVEL_INPUT_TACO_ID)
            .setLabel("Taco (true/false)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(DEFAULT_TACO_ENABLED)),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (action === "calc_back_xp") {
    const type = tokenOrType || "xp";
    await interaction.update(buildMultiplierCalculatePayload(interaction.user.id, type));
    return;
  }

  if (action === "level_prev" || action === "level_next" || action === "level_page") {
    const parsedLevel = parseLevelCustomId(customId);
    if (!parsedLevel) return;
    const levelState = parsedLevel.state;
    if (levelState.userId !== interaction.user.id) {
      await interaction.reply({
        content: "Only the panel owner can use these controls.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (action === "level_prev" || action === "level_next") {
      levelState.page = Math.max(
        0,
        Number(levelState.page || 0) + (action === "level_next" ? 1 : -1),
      );
    }
    await interaction.update(buildLevelCalculatorPayload(levelState));
    return;
  }

  if (action === "calc_edit") {
    const type = tokenOrType;
    if (!["xp", "coins", "luck"].includes(type)) return;
    const viewState = {
      userId: interaction.user.id,
      type,
      page: 0,
    };
    await interaction.update(buildMultiplierEditPayload(viewState));
    return;
  }

  if (action === "calc_clean") {
    const type = tokenOrType;
    if (!["xp", "coins", "luck"].includes(type)) return;
    clearAllMultiplierSelections(interaction.user.id, type);
    await interaction.update(buildMultiplierCalculatePayload(interaction.user.id, type));
    return;
  }

  if (action === "go_calc") {
    const parsed = parseEditCustomId(customId);
    if (!parsed) return;
    const view = parsed.state;
    if (view.userId !== interaction.user.id) {
      await interaction.reply({
        content: "Only the panel owner can use these controls.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.update(buildMultiplierCalculatePayload(interaction.user.id, view.type));
    return;
  }

  const parsed = parseEditCustomId(customId);
  if (!parsed) return;
  const { state: view } = parsed;
  if (view.userId !== interaction.user.id) {
    await interaction.reply({
      content: "Only the panel owner can use these controls.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const profile = loadMultiplierProfile(view.userId, view.type);

  if (action === "edit_prev") {
    view.page = Math.max(0, Number(view.page || 0) - 1);
    await interaction.update(buildMultiplierEditPayload(view));
    return;
  }

  if (action === "edit_next") {
    view.page = Number(view.page || 0) + 1;
    await interaction.update(buildMultiplierEditPayload(view));
    return;
  }

  if (action === "edit_track") {
    profile.track = !profile.track;
    saveMultiplierProfile(view.userId, view.type, profile);
    await interaction.update(buildMultiplierEditPayload(view));
    return;
  }

  if (action === "edit_omega" || action === "edit_prestige") {
    const modal = new ModalBuilder()
      .setCustomId(
        [
          MULTIPLIER_ROUTE_PREFIX,
          `${action}_modal`,
          String(view.userId),
          String(view.type),
          String(Math.max(0, Number(view.page || 0))),
        ].join(":"),
      )
      .setTitle(action === "edit_omega" ? "Set OMEGA tier" : "Set Prestige tier")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("value")
            .setLabel("Enter a non-negative number")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(
              String(
                action === "edit_omega"
                  ? Math.max(0, Math.trunc(Number(profile.omega || 0)))
                  : Math.max(0, Math.trunc(Number(profile.prestige || 0))),
              ),
            ),
        ),
      );

    await interaction.showModal(modal);
  }
}

async function handleDankMultiplierSelect(interaction) {
  const parsed = parseEditCustomId(interaction.customId);
  if (!parsed) return;
  const { action, state: view } = parsed;
  if (view.userId !== interaction.user.id) {
    await interaction.reply({
      content: "Only the panel owner can use these controls.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const profile = loadMultiplierProfile(view.userId, view.type);
  const rows = listKnownMultipliers(view.type);
  const sortedRows = splitMultiplierRows(rows);
  profile.selected = normalizeSelectedMultiplierKeys(profile.selected || [], sortedRows);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / MULTIPLIER_PAGE_SIZE));
  const page = Math.min(Math.max(0, Number(view.page || 0)), totalPages - 1);
  const pageRows = sortedRows.slice(
    page * MULTIPLIER_PAGE_SIZE,
    (page + 1) * MULTIPLIER_PAGE_SIZE,
  );
  const pageKeys = new Set(
    pageRows.map((row) => makeMultiplierSelectionKey(row?.name, row?.amount)),
  );

  if (action === "edit_select") {
    const beforeOnPage = new Set(
      (profile.selected || []).filter((key) => pageKeys.has(key)),
    );
    const keep = [];
    for (const key of profile.selected || []) {
      if (pageKeys.has(key)) continue;
      keep.push(key);
    }
    const add = (interaction.values || [])
      .map((v) => String(v || "").trim())
      .filter((v) => pageKeys.has(v));
    const afterOnPage = new Set(add);
    const added = add.filter((key) => !beforeOnPage.has(key));
    const removed = [...beforeOnPage].filter((key) => !afterOnPage.has(key));
    profile.selected = [...new Set([...keep, ...add])];
    saveMultiplierProfile(view.userId, view.type, profile);
    syncManualSelectedMultiplierRows(view.userId, view.type, profile.selected);
    await interaction.update(buildMultiplierEditPayload(view));

    if (added.length || removed.length) {
      const logIn = global.db.getFeatherEmojiMarkdown("log-in") || "➕";
      const logOut = global.db.getFeatherEmojiMarkdown("log-out") || "➖";
      const rowByKey = new Map(
        pageRows.map((row) => [
          makeMultiplierSelectionKey(row?.name, row?.amount),
          row,
        ]),
      );
      const formatKey = (key) => {
        const row = rowByKey.get(key);
        if (!row) return key;
        return `${row.name} [${formatMultiplierAmount(view.type, row.amount)}]`;
      };
      const lines = [
        ...added.map((key) => `${logIn} Added: **${formatKey(key)}**`),
        ...removed.map((key) => `${logOut} Removed: **${formatKey(key)}**`),
      ];
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n")),
      );
      await interaction.followUp({
        content: "",
        components: [container],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }
    return;
  }

  if (action === "edit_premium") {
    const premium = String(interaction.values?.[0] || "none");
    setPremiumForAllTypes(view.userId, premium);
    await interaction.update(buildMultiplierEditPayload(view));
  }
}

async function handleDankMultiplierModal(interaction) {
  const customId = String(interaction.customId || "");
  const parts = customId.split(":");
  const [, action] = parts;
  if (!action) return;

  if (action === "level_modal") {
    const ownerId = String(parts[2] || "");
    const sourceType = decodePart(parts[3] || "xp") || "xp";
    const startRaw = interaction.fields.getTextInputValue(LEVEL_INPUT_START_ID);
    const endRaw = interaction.fields.getTextInputValue(LEVEL_INPUT_END_ID);
    const tacoRaw = interaction.fields.getTextInputValue(LEVEL_INPUT_TACO_ID);

    const startLevel = Math.max(1, Math.trunc(Number(startRaw)));
    const endLevel = Math.max(startLevel + 1, Math.trunc(Number(endRaw)));
    if (!Number.isFinite(startLevel) || !Number.isFinite(endLevel)) {
      await interaction.reply({
        content: "Invalid levels. Please provide numbers only.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const tacoEnabled = parseTruthyInput(tacoRaw, DEFAULT_TACO_ENABLED);
    if (ownerId !== interaction.user.id) {
      await interaction.reply({
        content: "Only the panel owner can use these controls.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.update(
      buildLevelCalculatorPayload({
        userId: ownerId,
        sourceType,
        page: 0,
        startLevel,
        endLevel,
        tacoEnabled,
      }),
    );
    return;
  }

  const ownerId = String(parts[2] || "");
  const type = String(parts[3] || "xp");
  const page = Math.max(0, Number(parts[4] || 0));
  if (!ownerId) return;
  const view = { userId: ownerId, type, page };
  if (view.userId !== interaction.user.id) {
    await interaction.reply({
      content: "Only the panel owner can use these controls.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const raw = interaction.fields.getTextInputValue("value");
  const value = Math.max(0, Math.trunc(Number(raw)));
  if (!Number.isFinite(value)) {
    await interaction.reply({
      content: "Please enter a valid non-negative number.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const profile = loadMultiplierProfile(view.userId, view.type);
  if (action === "edit_omega_modal") {
    profile.omega = value;
  } else if (action === "edit_prestige_modal") {
    profile.prestige = value;
  } else {
    return;
  }

  saveMultiplierProfile(view.userId, view.type, profile);
  await interaction.update(buildMultiplierEditPayload(view));
}

if (!buttonHandlers.has(MULTIPLIER_ROUTE_PREFIX)) {
  buttonHandlers.set(MULTIPLIER_ROUTE_PREFIX, handleDankMultiplierButton);
}

if (!selectMenuHandlers.has(MULTIPLIER_ROUTE_PREFIX)) {
  selectMenuHandlers.set(MULTIPLIER_ROUTE_PREFIX, handleDankMultiplierSelect);
}

if (!modalHandlers.has(MULTIPLIER_ROUTE_PREFIX)) {
  modalHandlers.set(MULTIPLIER_ROUTE_PREFIX, handleDankMultiplierModal);
}

module.exports = {
  runDankMultiplierEdit,
  runDankMultiplierCalculate,
  runDankOmegaPrestigeCalculate,
};
