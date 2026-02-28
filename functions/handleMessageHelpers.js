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

  function toggleKey(userId, type) {
    return `${userId}:${type}`;
  }

  function numberKey(userId, type) {
    return `${userId}:${type}`;
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

  return {
    getUserToggle,
    getUserNumberSetting,
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
};
