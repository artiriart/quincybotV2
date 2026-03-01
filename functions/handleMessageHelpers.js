function getLast(array) {
  if (!Array.isArray(array) || array.length === 0) return null;
  return array[array.length - 1];
}

function extractMentionedUserId(text) {
  const match = String(text || "").match(/<@!?(\d+)>/);
  return match ? match[1] : null;
}

function extractUserFromMention(text) {
  const userId = extractMentionedUserId(text);
  if (!userId) return null;
  return global.bot?.users?.cache?.get(userId) || null;
}

async function findUserByUsername(username) {
  const normalized = String(username || "").trim();
  if (!normalized) return null;
  return global.bot?.users?.cache?.find((u) => u.username === normalized) || null;
}

async function resolveReferencedAuthor(message) {
  if (!message?.reference?.messageId || !message?.channel?.messages?.fetch) {
    return null;
  }

  const refMsg = await message.channel.messages
    .fetch(message.reference.messageId)
    .catch(() => null);
  return refMsg?.author || null;
}

async function resolveDankUser(message) {
  if (message?.interaction?.user) {
    return message.interaction.user;
  }

  return resolveReferencedAuthor(message);
}

function createSettingsReader() {
  const toggleCache = new Map();
  const numberCache = new Map();
  const guildToggleCache = new Map();

  function toggleKey(userId, type) {
    return `${userId}:${type}`;
  }

  function numberKey(userId, type) {
    return `${userId}:${type}`;
  }

  function guildToggleKey(guildId, type) {
    return `${guildId}:${type}`;
  }

  function getUserToggle(userId, type, defaultValue = true) {
    if (!userId || !type) return defaultValue;

    const key = toggleKey(userId, type);
    if (toggleCache.has(key)) {
      return toggleCache.get(key);
    }

    const row = global.db.safeQuery(
      `SELECT toggle FROM user_settings_toggles WHERE user_id = ? AND type = ? LIMIT 1`,
      [userId, type],
    )?.[0];

    const enabled = row ? row.toggle === 1 || row.toggle === true : defaultValue;
    toggleCache.set(key, enabled);
    return enabled;
  }

  function getUserNumberSetting(userId, type, defaultValue = 0) {
    if (!userId || !type) return defaultValue;

    const key = numberKey(userId, type);
    if (numberCache.has(key)) {
      return numberCache.get(key);
    }

    const raw = global.db.getState(type, userId);
    if (raw == null) {
      numberCache.set(key, defaultValue);
      return defaultValue;
    }

    const direct = Number(raw);
    if (Number.isFinite(direct) && direct >= 0) {
      const value = Math.trunc(direct);
      numberCache.set(key, value);
      return value;
    }

    try {
      const parsed = JSON.parse(raw);
      const nested = Number(parsed);
      if (Number.isFinite(nested) && nested >= 0) {
        const value = Math.trunc(nested);
        numberCache.set(key, value);
        return value;
      }
    } catch {}

    numberCache.set(key, defaultValue);
    return defaultValue;
  }

  function getGuildToggle(guildId, type, defaultValue = true) {
    if (!guildId || !type) return defaultValue;

    const key = guildToggleKey(guildId, type);
    if (guildToggleCache.has(key)) {
      return guildToggleCache.get(key);
    }

    const raw = global.db.getState(type, guildId);
    if (raw == null) {
      guildToggleCache.set(key, defaultValue);
      return defaultValue;
    }

    const text = String(raw).trim().toLowerCase();
    const value = !(text === "0" || text === "false" || text === "off" || text === "disabled");
    guildToggleCache.set(key, value);
    return value;
  }

  return {
    getUserToggle,
    getUserNumberSetting,
    getGuildToggle,
  };
}

function parseRewardEntry(rewardText) {
  const reward = String(rewardText || "").trim();
  if (!reward) return null;

  if (reward.includes("⏣")) {
    const amountRaw = reward.split("⏣")[1]?.replaceAll(",", "").trim();
    const amount = Number.parseInt(amountRaw, 10);
    if (!Number.isFinite(amount)) return null;
    return { amount, item: "DMC" };
  }

  const amountRaw = reward.split("<")[0]?.trim();
  const item = reward.split(">").at(-1)?.trim();
  const amount = Number.parseInt(amountRaw, 10);

  if (!item || !Number.isFinite(amount)) return null;
  return { amount, item };
}

function upsertDankStat(userId, item, amount, statType) {
  if (!userId || !item || !Number.isFinite(amount) || !statType) return;

  global.db.safeQuery(
    `INSERT INTO dank_stats (user_id, item_name, item_amount, stat_type) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_name, stat_type) DO UPDATE SET item_amount = item_amount + excluded.item_amount`,
    [userId, item, amount, statType],
  );
}

function upsertCardClaim(userId, botName, rarity, amount = 1) {
  if (!userId || !botName || !rarity || !Number.isFinite(amount)) return;

  global.db.safeQuery(
    `INSERT INTO card_stats (user_id, bot_name, rarity, amount) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, bot_name, rarity) DO UPDATE SET amount = amount + excluded.amount`,
    [userId, botName, rarity, amount],
  );
}

function stripLeadingCustomEmoji(text) {
  let value = String(text || "").trim();
  while (value.startsWith("<")) {
    const end = value.indexOf(">");
    if (end === -1) break;
    value = value.slice(end + 1).trim();
  }
  return value;
}

function stripExpirySuffix(text) {
  const value = String(text || "");
  const marker = " (expires ";
  const idx = value.toLowerCase().indexOf(marker);
  if (idx === -1) return value.trim();
  return value.slice(0, idx).trim();
}

function stripMarkdownLink(text) {
  const value = String(text || "").trim();
  if (!value.startsWith("[")) return value;
  const close = value.indexOf("]");
  const openLink = value.indexOf("(", close + 1);
  const closeLink = value.indexOf(")", openLink + 1);
  if (close > 1 && openLink === close + 1 && closeLink > openLink) {
    return value.slice(1, close).trim();
  }
  return value;
}

function parseMultiplierAmount(token, type) {
  const compact = String(token || "").replaceAll(" ", "").trim();
  if (!compact) return null;

  if (type === "xp") {
    const marker = compact.toLowerCase().indexOf("x");
    if (marker <= 0) return null;
    const raw = compact.slice(0, marker).replaceAll("+", "");
    const amount = Number(raw);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  const marker = compact.indexOf("%");
  if (marker <= 0) return null;
  const raw = compact.slice(0, marker).replaceAll("+", "");
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : null;
}

function normalizeMultiplierName(rawName) {
  let name = String(rawName || "").trim();
  if (!name) return "";
  name = stripLeadingCustomEmoji(name);
  name = stripMarkdownLink(name);
  name = stripExpirySuffix(name);
  return name.trim();
}

function parseMultiplierLines(description, type) {
  const lines = String(description || "").split("\n");
  const parsed = [];

  for (const line of lines) {
    const trimmed = String(line || "").trim();
    if (!trimmed.startsWith("`")) continue;

    const closeTick = trimmed.indexOf("`", 1);
    if (closeTick <= 1) continue;

    const token = trimmed.slice(1, closeTick).trim();
    const amount = parseMultiplierAmount(token, type);
    if (amount == null) continue;

    const rawName = trimmed.slice(closeTick + 1).trim();
    const name = normalizeMultiplierName(rawName);
    if (!name) continue;

    parsed.push({
      name,
      amount,
      description: "",
    });
  }

  return parsed;
}

function normalizePermanentMultiplierKey(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.includes("omega")) return "omega";
  if (lower.includes("prestige")) return "prestige";
  return null;
}

function dedupePermanentMultiplierEntries(entries) {
  const out = [];
  let omegaIndex = -1;
  let prestigeIndex = -1;
  let premiumIndex = -1;

  for (const entry of entries) {
    const key = normalizePermanentMultiplierKey(entry?.name);
    if (key === "omega") {
      if (omegaIndex !== -1) {
        out[omegaIndex] = entry;
      } else {
        omegaIndex = out.length;
        out.push(entry);
      }
      continue;
    }
    if (key === "prestige") {
      if (prestigeIndex !== -1) {
        out[prestigeIndex] = entry;
      } else {
        prestigeIndex = out.length;
        out.push(entry);
      }
      continue;
    }
    if (/premium/i.test(String(entry?.name || ""))) {
      if (premiumIndex !== -1) {
        const prev = Number(out[premiumIndex]?.amount || 0);
        const next = Number(entry?.amount || 0);
        out[premiumIndex] = next >= prev ? entry : out[premiumIndex];
      } else {
        premiumIndex = out.length;
        out.push(entry);
      }
      continue;
    }
    out.push(entry);
  }

  return out;
}

function shouldIgnoreInMaster(type, name) {
  const lower = String(name || "").toLowerCase();
  if (lower.includes("premium")) return true;
  if (type === "xp") {
    return lower.includes("omega") || lower.includes("prestige");
  }
  if (type === "coins") {
    if (lower.includes("badge")) return true;
    if (/\d+\s*d\s*streak/i.test(lower)) return true;
  }
  return false;
}

function resolvePremiumTierFromAmount(type, amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;

  if (type === "xp") {
    if (n >= 1.5) return "meme_mogul";
    if (n >= 1.25) return "meme_maestro";
    if (n >= 1.2) return "platinum_memer";
    if (n >= 1.15) return "elite_memer";
    if (n >= 1.05) return "meme_enthusiast";
  }

  if (type === "coins") {
    if (n >= 300) return "meme_mogul";
    if (n >= 250) return "meme_maestro";
    if (n >= 200) return "platinum_memer";
    if (n >= 100) return "elite_memer";
    if (n >= 50) return "meme_enthusiast";
  }

  if (type === "luck" && n >= 5) {
    return "credit_card";
  }

  return null;
}

function premiumTierRank(tier) {
  const order = {
    none: 0,
    credit_card: 1,
    meme_enthusiast: 2,
    elite_memer: 3,
    platinum_memer: 4,
    meme_maestro: 5,
    meme_mogul: 6,
  };
  return order[String(tier || "none")] || 0;
}

function indexDankMultiplierSnapshot(userId, type, description) {
  if (!userId || !type || !description) return;

  const normalizedType = String(type).toLowerCase();
  if (!["xp", "coins", "luck"].includes(normalizedType)) return;

  const parsed = dedupePermanentMultiplierEntries(
    parseMultiplierLines(description, normalizedType),
  );
  if (!parsed.length) return;

  const premiumEntry = parsed.find((entry) =>
    /premium/i.test(String(entry?.name || "")),
  );
  const inferredTier = premiumEntry
    ? resolvePremiumTierFromAmount(normalizedType, premiumEntry.amount)
    : null;
  if (inferredTier) {
    const currentTier = String(
      global.db.getState("dank_multiplier_premium_global", userId) || "none",
    );
    const nextTier =
      premiumTierRank(inferredTier) >= premiumTierRank(currentTier)
        ? inferredTier
        : currentTier;
    global.db.upsertState(
      "dank_multiplier_premium_global",
      nextTier,
      userId,
      true,
    );
  }

  global.db.upsertState(
    `dank_tracked_multipliers_${normalizedType}`,
    JSON.stringify(parsed),
    userId,
    true,
  );

  global.db.safeQuery(
    `DELETE FROM dank_selected_multipliers WHERE user_id = ? AND type = ?`,
    [userId, normalizedType],
  );

  const uniqueNames = [...new Set(parsed.map((entry) => entry.name))];
  for (const name of uniqueNames) {
    global.db.safeQuery(
      `INSERT INTO dank_selected_multipliers (user_id, name, type) VALUES (?, ?, ?) ON CONFLICT(user_id, name, type) DO NOTHING`,
      [userId, name, normalizedType],
    );
  }

  for (const entry of parsed) {
    if (shouldIgnoreInMaster(normalizedType, entry.name)) continue;

    const isShreddedCheeseXp =
      normalizedType === "xp" &&
      String(entry.name || "").toLowerCase() === "shredded cheese";
    const amountToStore = isShreddedCheeseXp ? 1.5 : entry.amount;

    if (isShreddedCheeseXp) {
      global.db.safeQuery(
        `DELETE FROM dank_multipliers WHERE type = 'xp' AND LOWER(name) = LOWER(?) AND amount <> 1.5`,
        [entry.name],
      );
    }

    if (/premium/i.test(String(entry?.name || ""))) {
      global.db.safeQuery(
        `DELETE FROM dank_multipliers WHERE type = ? AND LOWER(name) LIKE '%premium%'`,
        [normalizedType],
      );
    }

    global.db.safeQuery(
      `
      INSERT INTO dank_multipliers (name, amount, description, type)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(name, amount, type) DO UPDATE SET
        description = CASE
          WHEN excluded.description IS NOT NULL AND excluded.description <> ''
            THEN excluded.description
          ELSE dank_multipliers.description
        END
      `,
      [entry.name, amountToStore, entry.description, normalizedType],
    );
  }
}

module.exports = {
  createSettingsReader,
  extractMentionedUserId,
  extractUserFromMention,
  findUserByUsername,
  getLast,
  parseRewardEntry,
  resolveDankUser,
  resolveReferencedAuthor,
  upsertCardClaim,
  upsertDankStat,
  indexDankMultiplierSnapshot,
};
