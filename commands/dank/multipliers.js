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

const MULTIPLIER_VIEW_STATE_TYPE = "dank_multiplier_view";
const MULTIPLIER_ROUTE_PREFIX = "dankmulti";
const MULTIPLIER_PREMIUM_STATE_TYPE = "dank_multiplier_premium_global";
const MULTIPLIER_PAGE_SIZE = 8;
const LEVEL_MODAL_CUSTOM_ID_PREFIX = `${MULTIPLIER_ROUTE_PREFIX}:level_modal`;
const LEVEL_VIEW_STATE_TYPE = "dank_level_calc_view";
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

function createViewToken(userId) {
  const rand = Math.random().toString(36).slice(2, 7);
  return `${userId.slice(-6)}${Date.now().toString(36)}${rand}`.slice(0, 40);
}

function saveMultiplierViewState(token, state) {
  global.db.upsertState(
    MULTIPLIER_VIEW_STATE_TYPE,
    JSON.stringify(state),
    token,
    false,
  );
}

function loadMultiplierViewState(token) {
  const raw = global.db.getState(MULTIPLIER_VIEW_STATE_TYPE, token);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveLevelViewState(token, state) {
  global.db.upsertState(LEVEL_VIEW_STATE_TYPE, JSON.stringify(state), token, false);
}

function loadLevelViewState(token) {
  const raw = global.db.getState(LEVEL_VIEW_STATE_TYPE, token);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
    SELECT name, MAX(amount) AS amount, MIN(description) AS description, MAX(emoji) AS emoji
    FROM dank_multipliers
    WHERE type = ?
    GROUP BY name
    ORDER BY LOWER(name) ASC
    `,
    [multiplierType],
  );
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
  let entries = [];

  if (usingTracked) {
    const emojiByName = new Map(
      knownRows.map((row) => [String(row.name || ""), String(row.emoji || "")]),
    );
    entries = trackedRows.map((row) => ({
      name: row.name,
      amount: Number(row.amount),
      emoji: emojiByName.get(String(row.name || "")) || null,
      source: "tracked",
    }));
  } else {
    const byName = new Map(
      knownRows.map((row) => [
        row.name,
        {
          amount: Number(row.amount),
          emoji: String(row.emoji || ""),
        },
      ]),
    );
    entries = (profile.selected || [])
      .filter((name) => !/premium/i.test(String(name || "")))
      .map((name) => ({
        name,
        amount: Number(byName.get(name)?.amount),
        emoji: byName.get(name)?.emoji || null,
        source: "manual",
      }))
      .filter((row) => row.name && Number.isFinite(row.amount));

    if (multiplierType === "xp") {
      const omega = Math.max(0, Math.trunc(Number(profile.omega || 0)));
      const prestige = Math.max(0, Math.trunc(Number(profile.prestige || 0)));
      if (omega > 0) {
        entries.push({
          name: "Omega",
          amount: Number((1 + omega * 0.05).toFixed(2)),
          source: "derived",
        });
      }
      if (prestige > 0) {
        entries.push({
          name: "Prestige",
          amount: Number((1 + prestige * 0.012).toFixed(2)),
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
    if (multiplierType === "xp" && Number.isFinite(premium.xp) && premium.xp > 0) {
      entries.push({ name: premium.name, amount: premium.xp, source: "premium" });
    }
    if (multiplierType === "coins" && Number.isFinite(premium.coins)) {
      entries.push({ name: premium.name, amount: premium.coins, source: "premium" });
    }
    if (multiplierType === "luck" && Number.isFinite(premium.luck)) {
      entries.push({ name: premium.name, amount: premium.luck, source: "premium" });
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

function buildMultiplierOptions(rows, selectedSet, multiplierType) {
  return rows.map((row) => {
    const amount = formatMultiplierAmount(multiplierType, row.amount);
    const option = {
      label: `${String(row.name)} [${amount}]`.slice(0, 100),
      value: String(row.name).slice(0, 100),
      default: selectedSet.has(String(row.name)),
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
  return PREMIUM_TIERS.map((tier) => ({
    label: tier.label.slice(0, 100),
    value: tier.value.slice(0, 100),
    description: tier.description.slice(0, 100),
    default: tier.value === selected,
  }));
}

function buildMultiplierEditPayload(viewState) {
  const profile = loadMultiplierProfile(viewState.userId, viewState.type);
  const rows = listKnownMultipliers(viewState.type);
  const trackedRows = loadTrackedMultiplierEntries(viewState.userId, viewState.type);
  const sortedRows = splitMultiplierRows(rows);
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
  const selectedSet = new Set(profile.selected || []);
  const hasOmegaMultiplier =
    [...selectedSet].some((name) => /omega/i.test(String(name || ""))) ||
    trackedRows.some((entry) => /omega/i.test(String(entry?.name || "")));
  const hasPrestigeMultiplier =
    [...selectedSet].some((name) => /prestige/i.test(String(name || ""))) ||
    trackedRows.some((entry) => /prestige/i.test(String(entry?.name || "")));
  const trackLabel = profile.track ? "On" : "Off";

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
          .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:edit_prev:${viewState.token}`)
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(leftEmoji)
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:edit_page:${viewState.token}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel(`${page + 1}/${totalPages}`)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:edit_next:${viewState.token}`)
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
          .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:edit_select:${viewState.token}`)
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
          .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:go_calc:${viewState.token}`)
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
          .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:edit_premium:${viewState.token}`)
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
            `Select your OMEGA tier\n-# Current: ${hasOmegaMultiplier ? "auto" : Math.max(0, Math.trunc(Number(profile.omega || 0)))}`,
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:edit_omega:${viewState.token}`)
            .setStyle(ButtonStyle.Secondary)
            .setLabel("Set OMEGA"),
        ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `Select your Prestige tier\n-# Current: ${hasPrestigeMultiplier ? "auto" : Math.max(0, Math.trunc(Number(profile.prestige || 0)))}`,
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:edit_prestige:${viewState.token}`)
            .setStyle(ButtonStyle.Secondary)
            .setLabel("Set Prestige"),
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
            .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:edit_track:${viewState.token}`)
            .setStyle(profile.track ? ButtonStyle.Success : ButtonStyle.Danger)
            .setLabel(profile.track ? "Tracking: On" : "Tracking: Off"),
        ),
    );

  return {
    content: "",
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    state: {
      ...viewState,
      page,
    },
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

  const totalLine =
    multiplierType === "xp"
      ? `# Total: ${result.total.toFixed(2)}x`
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
        new ButtonBuilder()
          .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:calc_edit:${multiplierType}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Edit Multipliers"),
        new ButtonBuilder()
          .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:calc_clean:${multiplierType}`)
          .setStyle(ButtonStyle.Danger)
          .setLabel("Clean all multipliers"),
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
            .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:calc_back_xp:${state.token}`)
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
          .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:level_prev:${state.token}`)
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(leftEmoji)
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:level_page:${state.token}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel(`${page + 1}/${totalPages}`)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:level_next:${state.token}`)
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
    state: {
      ...state,
      startLevel,
      endLevel,
      tacoEnabled,
      page,
    },
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
          .setThumbnailAccessory((thumb) =>
            thumb.setURL("https://cdn.discordapp.com/emojis/573151130154958851.webp"),
          ),
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
        .setThumbnailAccessory((thumb) =>
          thumb.setURL("https://cdn.discordapp.com/emojis/901598556790587453.webp"),
        ),
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
  const token = createViewToken(interaction.user.id);
  const viewState = {
    token,
    userId: interaction.user.id,
    type,
    page: 0,
  };
  const payload = buildMultiplierEditPayload(viewState);
  if (payload?.state) {
    saveMultiplierViewState(token, payload.state);
    delete payload.state;
  } else {
    saveMultiplierViewState(token, viewState);
  }
  await interaction.reply(payload);
}

async function runDankMultiplierCalculate(interaction, type) {
  if (type === "level") {
    const token = createViewToken(interaction.user.id);
    const initialState = {
      token,
      userId: interaction.user.id,
      sourceType: "xp",
      startLevel: DEFAULT_LEVEL_START,
      endLevel: DEFAULT_LEVEL_END,
      tacoEnabled: DEFAULT_TACO_ENABLED,
      page: 0,
    };
    const payload = buildLevelCalculatorPayload({
      ...initialState,
    });
    if (payload?.state) {
      saveLevelViewState(token, payload.state);
      delete payload.state;
    } else {
      saveLevelViewState(token, initialState);
    }
    await interaction.reply(
      payload,
    );
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
    token: createViewToken(userId),
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
    saveLevelViewState(levelState.token, levelState);
    const modal = new ModalBuilder()
      .setCustomId(`${LEVEL_MODAL_CUSTOM_ID_PREFIX}:${levelState.token}`)
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
    const levelState = loadLevelViewState(tokenOrType);
    const type = levelState?.sourceType || "xp";
    await interaction.update(buildMultiplierCalculatePayload(interaction.user.id, type));
    return;
  }

  if (action === "level_prev" || action === "level_next") {
    const levelState = loadLevelViewState(tokenOrType);
    if (!levelState || levelState.userId !== interaction.user.id) {
      await interaction.reply({
        content: "This level calculator panel expired. Open it again from XP Calculator.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    levelState.page = Math.max(
      0,
      Number(levelState.page || 0) + (action === "level_next" ? 1 : -1),
    );
    const payload = buildLevelCalculatorPayload(levelState);
    if (payload?.state) {
      saveLevelViewState(tokenOrType, payload.state);
      delete payload.state;
    }
    await interaction.update(payload);
    return;
  }

  if (action === "level_page") {
    return;
  }

  if (action === "calc_edit") {
    const type = tokenOrType;
    if (!["xp", "coins", "luck"].includes(type)) return;
    const token = createViewToken(interaction.user.id);
    const viewState = {
      token,
      userId: interaction.user.id,
      type,
      page: 0,
    };
    const payload = buildMultiplierEditPayload(viewState);
    if (payload?.state) {
      saveMultiplierViewState(token, payload.state);
      delete payload.state;
    } else {
      saveMultiplierViewState(token, viewState);
    }
    await interaction.update(payload);
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
    const token = tokenOrType;
    const view = loadMultiplierViewState(token);
    if (!view || view.userId !== interaction.user.id) {
      await interaction.reply({
        content: "This multiplier editor expired. Run `/dank multiplier edit` again.",
      });
      return;
    }
    await interaction.update(buildMultiplierCalculatePayload(interaction.user.id, view.type));
    return;
  }

  const token = tokenOrType;
  const view = loadMultiplierViewState(token);
  if (!view || view.userId !== interaction.user.id) {
    await interaction.reply({
      content: "This multiplier editor expired. Run `/dank multiplier edit` again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const profile = loadMultiplierProfile(view.userId, view.type);

  if (action === "edit_prev") {
    view.page = Math.max(0, Number(view.page || 0) - 1);
    const payload = buildMultiplierEditPayload(view);
    if (payload?.state) {
      saveMultiplierViewState(token, payload.state);
      delete payload.state;
    }
    await interaction.update(payload);
    return;
  }

  if (action === "edit_next") {
    view.page = Number(view.page || 0) + 1;
    const payload = buildMultiplierEditPayload(view);
    if (payload?.state) {
      saveMultiplierViewState(token, payload.state);
      delete payload.state;
    }
    await interaction.update(payload);
    return;
  }

  if (action === "edit_track") {
    profile.track = !profile.track;
    saveMultiplierProfile(view.userId, view.type, profile);
    const payload = buildMultiplierEditPayload(view);
    if (payload?.state) {
      saveMultiplierViewState(token, payload.state);
      delete payload.state;
    }
    await interaction.update(payload);
    return;
  }

  if (action === "edit_omega" || action === "edit_prestige") {
    const modal = new ModalBuilder()
      .setCustomId(`${MULTIPLIER_ROUTE_PREFIX}:${action}_modal:${token}`)
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
  const customId = String(interaction.customId || "");
  const [, action, token] = customId.split(":");
  if (!action || !token) return;

  const view = loadMultiplierViewState(token);
  if (!view || view.userId !== interaction.user.id) {
    await interaction.reply({
      content: "This multiplier editor expired. Run `/dank multiplier edit` again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const profile = loadMultiplierProfile(view.userId, view.type);
  const rows = listKnownMultipliers(view.type);
  const sortedRows = splitMultiplierRows(rows);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / MULTIPLIER_PAGE_SIZE));
  const page = Math.min(Math.max(0, Number(view.page || 0)), totalPages - 1);
  const pageRows = sortedRows.slice(
    page * MULTIPLIER_PAGE_SIZE,
    (page + 1) * MULTIPLIER_PAGE_SIZE,
  );
  const pageNames = new Set(pageRows.map((row) => String(row.name)));

  if (action === "edit_select") {
    const beforeOnPage = new Set(
      (profile.selected || []).filter((name) => pageNames.has(name)),
    );
    const keep = [];
    for (const name of profile.selected || []) {
      if (pageNames.has(name)) continue;
      keep.push(name);
    }
    const add = (interaction.values || []).map((v) => String(v || "").trim()).filter(Boolean);
    const afterOnPage = new Set(add);
    const added = add.filter((name) => !beforeOnPage.has(name));
    const removed = [...beforeOnPage].filter((name) => !afterOnPage.has(name));
    profile.selected = [...new Set([...keep, ...add])];
    saveMultiplierProfile(view.userId, view.type, profile);
    syncManualSelectedMultiplierRows(view.userId, view.type, profile.selected);
    const payload = buildMultiplierEditPayload(view);
    if (payload?.state) {
      saveMultiplierViewState(token, payload.state);
      delete payload.state;
    }
    await interaction.update(payload);

    if (added.length || removed.length) {
      const logIn = global.db.getFeatherEmojiMarkdown("log-in") || "➕";
      const logOut = global.db.getFeatherEmojiMarkdown("log-out") || "➖";
      const lines = [
        ...added.map((name) => `${logIn} Added: **${name}**`),
        ...removed.map((name) => `${logOut} Removed: **${name}**`),
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
    const payload = buildMultiplierEditPayload(view);
    if (payload?.state) {
      saveMultiplierViewState(token, payload.state);
      delete payload.state;
    }
    await interaction.update(payload);
  }
}

async function handleDankMultiplierModal(interaction) {
  const customId = String(interaction.customId || "");
  const [, action, token] = customId.split(":");
  if (!action || !token) return;

  if (action === "level_modal") {
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
    const levelState = loadLevelViewState(token);
    if (!levelState || levelState.userId !== interaction.user.id) {
      await interaction.reply({
        content: "This level calculator panel expired. Open it again from XP Calculator.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const nextState = {
      ...levelState,
      startLevel,
      endLevel,
      tacoEnabled,
      page: 0,
    };
    const payload = buildLevelCalculatorPayload(nextState);
    if (payload?.state) {
      saveLevelViewState(token, payload.state);
      delete payload.state;
    }
    await interaction.update(payload);
    return;
  }

  const view = loadMultiplierViewState(token);
  if (!view || view.userId !== interaction.user.id) {
    await interaction.reply({
      content: "This multiplier editor expired. Run `/dank multiplier edit` again.",
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
  const payload = buildMultiplierEditPayload(view);
  if (payload?.state) {
    saveMultiplierViewState(token, payload.state);
    delete payload.state;
  }
  await interaction.reply(payload);
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
