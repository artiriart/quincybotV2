const {
  EmbedBuilder,
  ContainerBuilder,
  SectionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require("discord.js");
const { createV2Message } = require("../utils/componentsV2");
const {
  createSettingsReader,
  extractMentionedUserId,
  extractUserFromMention,
  findUserByUsername,
  getLast,
  parseRewardEntry,
  resolveDankUser,
  resolveReferencedAuthor,
  indexDankMultiplierSnapshot,
  upsertCardClaim,
  upsertDankStat,
} = require("./handleMessageHelpers");
const { recognizeKarutaCardsFromUrl } = require("./karutaOcr");
const { recognizeKarutaCardsWithGemmaFromUrl } = require("./karutaGemma");

const anigame_emoji_map = {
  "<:common:1068421015509684224>": "Common",
  "<:not:1068421022606426182><:common:1068421020739981312>": "Uncommon",
  "<:rare:1068421016893800469>": "Rare",
  "<:super:1068421019645247550><:rare:1068421018374377535>": "Super Rare",
  "<a:ultra:1068416715890892861><a:rare:1068416713592414268>": "Ultra Rare",
};

const sws_emoji_map = {
  common: "Common",
  epic: "Epic",
  mythical: "Mythical",
  legendary: "Legendary",
  special: "Special",
  hidden: "Hidden",
  queen: "Queen",
  goddess: "Goddess",
  void: "Void",
  patreon: "Patreon",
};

const dank_adventure_ticket_map = {
  "Pepe goes out West": 2,
  "Pepe goes to Space!": 2,
  "Pepe goes Trick or Treating": 4,
  "Pepe's Winter Wonderland!": 2,
  "Pepe goes to the Museum!": 2,
  "Pepe goes on Vacation!": 2,
  "Pepe goes fishing with friends": 3,
  "Pepe goes down under": 2,
  "Pepe goes to Brazil!": 3,
};

const KARUTA_RECOG_STATE_TYPE = "karuta_recognition_settings";
const KARUTA_GUILD_DROP_CALC_STATE_TYPE = "karuta_drop_calculation_enabled";

function getKarutaRecognitionMode() {
  const raw = global.db.getState(KARUTA_RECOG_STATE_TYPE, "global");
  if (!raw) return "tesseract";
  try {
    const parsed = JSON.parse(raw);
    const mode = String(parsed?.mode || "").trim().toLowerCase();
    if (["off", "tesseract", "gemma3"].includes(mode)) return mode;
  } catch {}
  return "tesseract";
}

function normalizeKarutaLookup(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function getKarutaDropImageUrl(message) {
  const fromAttachment = (message?.attachments?.find((a) =>
    String(a?.contentType || "").toLowerCase().startsWith("image/"),
  ) || message?.attachments?.first?.())?.url;
  if (fromAttachment) return String(fromAttachment);

  const embed = message?.embeds?.[0];
  const fromEmbed = embed?.image?.url || embed?.thumbnail?.url || null;
  return fromEmbed ? String(fromEmbed) : null;
}

async function handleKarutaDropRecognition(message, settings) {
  if (!message?.guildId) return;
  const content = String(message?.content || "");
  if (!/\bis dropping\s+(3|4)\s+cards!/i.test(content)) return;

  const guildEnabled = settings.getGuildToggle(
    message.guildId,
    KARUTA_GUILD_DROP_CALC_STATE_TYPE,
    true,
  );
  if (!guildEnabled) return;

  const mode = getKarutaRecognitionMode();
  if (mode === "off") return;

  const imageUrl = getKarutaDropImageUrl(message);
  if (!imageUrl) return;

  let cards = [];
  let loadTimeSec = null;
  try {
    const result =
      mode === "gemma3"
        ? await recognizeKarutaCardsWithGemmaFromUrl(imageUrl)
        : await recognizeKarutaCardsFromUrl(imageUrl);
    cards = Array.isArray(result?.cards) ? result.cards.slice(0, 4) : [];
    loadTimeSec = Number(result?.load_time_sec);
  } catch (error) {
    console.error("[karuta-drop] recognition failed:", error?.message || error);
    return;
  }

  if (!cards.length) return;
  const dbEmoji = global.db.getFeatherEmojiMarkdown("database") || "";
  const clockEmoji = global.db.getFeatherEmojiMarkdown("clock") || "⏱️";
  const expireEmoji = global.db.getFeatherEmojiMarkdown("x-circle") || "❌";
  const numberEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];
  const lines = [];
  const pingUsers = new Set();

  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i] || {};
    const displayName = String(card?.name || "").trim() || "Unknown";
    const displaySeries = String(card?.series || "").trim() || "Unknown";
    const nameKey = normalizeKarutaLookup(displayName);
    const seriesKey = normalizeKarutaLookup(displaySeries);

    const knownCard = global.db.safeQuery(
      `
      SELECT 1
      FROM karuta_cards
      WHERE name = ? AND series = ?
      LIMIT 1
      `,
      [nameKey, seriesKey],
    )?.[0];

    const wishRows = global.db.safeQuery(
      `
      SELECT user_id
      FROM karuta_wishlists
      WHERE guild_id = ? AND series = ?
      ORDER BY user_id ASC
      `,
      [message.guildId, seriesKey],
      [],
    );
    const mentions = wishRows.map((row) => `<@${row.user_id}>`).filter(Boolean);
    for (const row of wishRows) {
      if (row?.user_id) pingUsers.add(String(row.user_id));
    }
    const mentionText = mentions.length ? mentions.join(", ") : "None";

    lines.push(
      `${numberEmojis[i] || `${i + 1}.`} **${displayName}** (${displaySeries})${knownCard ? "" : ` ${dbEmoji}`}`.trim(),
    );
    lines.push(`-# Series Wishlist: ${mentionText}`);
  }

  const expiresAtUnix = Math.floor(
    (Number(message?.createdTimestamp || Date.now()) + 60_000) / 1000,
  );
  const footerLine = `-# ${clockEmoji} ${Number.isFinite(loadTimeSec) ? `${loadTimeSec.toFixed(2)}s` : "?"} | ${expireEmoji} <t:${expiresAtUnix}:R>`;

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("### Karuta Drop"))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLine));

  await message.channel
    .send({
      content: "",
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: [...pingUsers], parse: [] },
    })
    .catch(() => {});
}

function parseAnigameBaseStats(rawStats) {
  try {
    const parsed = typeof rawStats === "string" ? JSON.parse(rawStats) : rawStats || {};
    return {
      ATK: String(parsed?.ATK || "?"),
      DEF: String(parsed?.DEF || "?"),
      HP: String(parsed?.HP || "?"),
      SPD: String(parsed?.SPD || "?"),
    };
  } catch {
    return { ATK: "?", DEF: "?", HP: "?", SPD: "?" };
  }
}

function toAnigameRarityLabel(raw) {
  const value = String(raw || "").trim().toLowerCase();
  const labels = {
    common: "Common",
    uncommon: "Uncommon",
    rare: "Rare",
    super_rare: "Super Rare",
    ultra_rare: "Ultra Rare",
  };
  return labels[value] || "Ultra Rare";
}

function getAnigameRarityEmoji(rarityValue) {
  const key = String(rarityValue || "").trim().toLowerCase();
  if (key === "common") return global.db.getFeatherEmojiMarkdown("anigame_common") || "";
  if (key === "uncommon") {
    return [
      global.db.getFeatherEmojiMarkdown("anigame_uncommon_1") || "",
      global.db.getFeatherEmojiMarkdown("anigame_uncommon_2") || "",
    ]
      .filter(Boolean)
      .join("");
  }
  if (key === "rare") return global.db.getFeatherEmojiMarkdown("anigame_rare_1") || "";
  if (key === "super_rare") {
    return [
      global.db.getFeatherEmojiMarkdown("anigame_super_rare_1") || "",
      global.db.getFeatherEmojiMarkdown("anigame_super_rare_2") || "",
    ]
      .filter(Boolean)
      .join("");
  }
  if (key === "ultra_rare") {
    return [
      global.db.getFeatherEmojiMarkdown("anigame_ultra_rare_1") || "",
      global.db.getFeatherEmojiMarkdown("anigame_ultra_rare_2") || "",
    ]
      .filter(Boolean)
      .join("");
  }
  return "";
}

function collectAnigameShopText(message) {
  const texts = [];

  const embed = message?.embeds?.[0];
  if (embed?.title) texts.push(String(embed.title));
  if (embed?.description) texts.push(String(embed.description));
  for (const field of embed?.fields || []) {
    if (field?.name) texts.push(String(field.name));
    if (field?.value) texts.push(String(field.value));
  }

  for (const row of message?.components || []) {
    for (const component of row?.components || []) {
      if (component?.content) texts.push(String(component.content));
      if (component?.label) texts.push(String(component.label));
    }
  }

  return texts.join("\n");
}

function reminderCardIsInShop(shopTextLower, cardName, rarityValue = null) {
  const name = String(cardName || "").trim().toLowerCase();
  if (!name) return false;

  const index = shopTextLower.indexOf(name);
  if (index === -1) return false;
  if (!rarityValue) return true;

  const rarityTerms = {
    common: ["common"],
    uncommon: ["uncommon"],
    rare: ["rare"],
    super_rare: ["super rare", "super_rare", "sr"],
    ultra_rare: ["ultra rare", "ultra_rare", "ur"],
  };

  const windowText = shopTextLower.slice(
    Math.max(0, index - 120),
    Math.min(shopTextLower.length, index + name.length + 120),
  );
  const targetKey = String(rarityValue || "").trim().toLowerCase();
  const targetTerms = rarityTerms[targetKey] || [];
  if (targetTerms.some((term) => windowText.includes(term))) {
    return true;
  }

  const anyRarityMentioned = Object.values(rarityTerms).some((terms) =>
    terms.some((term) => windowText.includes(term)),
  );
  return !anyRarityMentioned;
}

function buildAnigameReminderDmPayload(reminder, shopType) {
  const shopLabel = shopType === "clan_shop" ? "Clan Shop" : "Fragment Shop";
  const rarityEmoji =
    shopType === "clan_shop" ? getAnigameRarityEmoji(reminder?.rarity) : "";
  const stats = parseAnigameBaseStats(reminder?.base_stats);
  const cardUrl = String(reminder?.card_url || "").trim();
  const fallbackThumb = "https://cdn.discordapp.com/embed/avatars/0.png";
  const cardTitle =
    shopType === "clan_shop"
      ? `${rarityEmoji ? `${rarityEmoji} ` : ""}${reminder?.card_name || "Unknown"}`
      : `${reminder?.card_name || "Unknown"}`;

  const container = new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### A ${shopLabel} card from your reminders is available`,
          ),
        )
        .setThumbnailAccessory((thumb) => {
          thumb.setURL(fallbackThumb);
          return thumb;
        }),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### Name: ${cardTitle}\n-# Stats: Atk ${stats.ATK} | Def ${stats.DEF} | Hp ${stats.HP} | Spd ${stats.SPD}`,
          ),
        )
        .setThumbnailAccessory((thumb) => {
          thumb.setURL(/^https?:\/\//i.test(cardUrl) ? cardUrl : fallbackThumb);
          return thumb;
        }),
    );

  return {
    content: "",
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

async function notifyAnigameShopReminders(message, shopType) {
  const shopText = collectAnigameShopText(message);
  const shopTextLower = shopText.toLowerCase();
  if (!shopTextLower.trim()) return;

  const reminders = global.db.safeQuery(
    `
    SELECT
      r.user_id,
      r.card_name,
      r.rarity,
      c.base_stats,
      c.card_url
    FROM anigame_reminders r
    LEFT JOIN anigame_cards c
      ON LOWER(c.name) = LOWER(r.card_name)
    WHERE r.type = ?
    `,
    [shopType],
    [],
  );

  const matched = reminders.filter((row) =>
    reminderCardIsInShop(
      shopTextLower,
      row?.card_name,
      shopType === "clan_shop" ? row?.rarity : null,
    ),
  );

  const seen = new Set();
  for (const reminder of matched) {
    const userId = String(reminder?.user_id || "").trim();
    const cardName = String(reminder?.card_name || "").trim().toLowerCase();
    if (!userId || !cardName) continue;

    const dedupeKey = `${userId}:${shopType}:${cardName}:${String(reminder?.rarity || "")}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const user =
      global.bot.users.cache.get(userId) ||
      (await global.bot.users.fetch(userId).catch(() => null));
    if (!user) continue;

    await user.send(buildAnigameReminderDmPayload(reminder, shopType)).catch(() => {});
  }
}

function shouldTrackDankStats(getUserToggle, userId) {
  if (!userId) return false;
  return !getUserToggle(userId, "dank_optout_all_stat_tracking", false);
}

function extractDankLevelRewardBlocks(message) {
  return (
    message?.components?.[0]?.components
      ?.filter(
        (c) => c?.type === 10 && /Level\s+\d[\d,]*/.test(String(c?.content || "")),
      )
      ?.map((c) => String(c.content)) || []
  );
}

function parseDankLevelRewardLine(rawLine) {
  let reward = String(rawLine || "")
    .replace(/^[-*]\s*/, "")
    .trim();
  if (!reward || reward.includes("Multiplier")) return null;
  if (reward.includes("Skin")) return null;
  if (/\bpet\b/i.test(reward)) return null;

  // Remove leading reply-thread marker emojis used by Dank component messages.
  reward = reward
    .replace(/^(<a?:[a-zA-Z0-9_]+:\d+>\s*)+/, "")
    .trim();
  if (!reward) return null;

  if (reward.includes("⏣")) {
    const amount = Number.parseInt(
      reward.split("⏣")[1]?.replaceAll(",", "").trim(),
      10,
    );
    if (!Number.isFinite(amount)) return null;
    return { amount, item: "DMC", title: false };
  }

  if (reward.includes("Title")) {
    const item = reward.split("'")[1]?.trim();
    if (!item) return null;
    return { amount: 1, item, title: true };
  }

  const amountMatch = reward.match(/^(\d[\d,]*)\s+/);
  const amount = Number.parseInt(
    amountMatch?.[1]?.replaceAll(",", "") || "",
    10,
  );
  if (Number.isFinite(amount)) {
    reward = reward.replace(/^(\d[\d,]*)\s+/, "").trim();
    reward = reward.replace(/^<a?:[a-zA-Z0-9_]+:\d+>\s*/, "").trim();

    let item = reward;
    if (!item) {
      const emojiId = String(rawLine || "").match(/<a?:[a-zA-Z0-9_]+:(\d+)>/)?.[1];
      if (emojiId) {
        item =
          global.db.safeQuery(
            `
            SELECT name
            FROM dank_items
            WHERE application_emoji LIKE ?
            LIMIT 1
            `,
            [`%:${emojiId}>`],
          )?.[0]?.name || "";
      }
    }

    if (!item) return null;
    return { amount, item, title: false };
  }

  // Handle entries without explicit numeric amount, e.g. "<:Rock:...> Rock Pet".
  const noAmountItem = reward
    .replace(/^<a?:[a-zA-Z0-9_]+:\d+>\s*/, "")
    .trim();
  if (noAmountItem) {
    return { amount: 1, item: noAmountItem, title: false };
  }

  return null;
}

async function handleSwsMessage(message, oldMessage, settings) {
  if (
    message?.embeds?.[0]?.title?.includes("with your partner") ||
    message?.embeds?.[0]?.title?.includes("hanging out with")
  ) {
    const partner = message.embeds[0].title.includes("with your partner");
    const refAuthor = await resolveReferencedAuthor(message);
    const userId = refAuthor?.id;
    if (!userId) return;

    const toggleKey = partner ? "sws_partner_reminder" : "sws_wife_reminder";
    const enabled = settings.getUserToggle(userId, toggleKey, true);
    if (!enabled) return;

    const cdBuff = Number(global.db.getState("swsCdPerk", userId)) || 1;
    const totalCd = 300 * cdBuff;

    global.db.createReminder(
      userId,
      message.channel,
      totalCd,
      partner ? "7w7 Partner" : "7w7 Wife",
      partner
        ? {
            command: "+p i",
            information: "You can meet your partner again",
          }
        : {
            command: "+wife i",
            information: "You can interact with your wife again",
          },
    );
    return;
  }

  if (message?.content?.includes("Gem broke")) {
    const userId = extractMentionedUserId(message.content);
    const user = global.bot.users.cache.get(userId);
    if (!user) return;

    const enabled = settings.getUserToggle(user.id, "sws_gem_reminder", true);
    if (!enabled) return;

    const gem = message.content.split(">")[1]?.split("broke")[0]?.trim();
    if (!gem) return;

    const gemId = global.db.safeQuery(
      `SELECT id FROM sws_items WHERE name = ? LIMIT 1`,
      [gem],
    )?.[0]?.id;

    const embed = new EmbedBuilder()
      .setColor("Red")
      .setAuthor({ name: `${gem} broke`, iconURL: user.avatarURL() || undefined })
      .setDescription(gemId ? `+use ${gemId}` : "+use <gem-id>");

    await message.reply({
      embeds: [embed],
      content: `-# Gem Reminder <@${user.id}>`,
    });
    return;
  }

  if (
    message?.embeds?.[0]?.title === "Getting ready" &&
    !message?.content?.includes("Auto-setup raid") &&
    oldMessage
  ) {
    if (oldMessage?.embeds?.[0]?.title === "Getting ready") return;

    const raidUsers = [];
    for (const button of message?.components?.[0]?.components || []) {
      if (!button?.label?.includes("Ready")) continue;

      const user = global.bot.users.cache.get(button.customId?.split(";=;")[1]);
      if (!user) continue;

      const enabled = settings.getUserToggle(
        user.id,
        "sws_no_patreon_raid_reminder",
        true,
      );
      if (enabled) raidUsers.push(user);
    }

    if (!raidUsers.length) return;

    const container = new ContainerBuilder()
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(td => td.setContent(`### Raid started!\n${raidUsers.map((user) => `<@${user.id}>`).join(", ")}`))
          .setThumbnailAccessory((thumb) => {
            thumb.setURL(
              String(message?.embeds?.[0]?.thumbnail?.url || "https://cdn.discordapp.com/embed/avatars/0.png"),
            );
            return thumb;
          })
      );

    await message.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  if (message?.embeds?.[0]?.title?.includes("waifu appeared!") && !oldMessage) {
    const rarityKey = message.embeds[0].title.split(":")[1];
    const rarity = sws_emoji_map[rarityKey];
    if (!rarity || !message.guild?.id) return;

    const autodelete = global.db.safeQuery(
      `SELECT rarity FROM sws_autodelete WHERE rarity = ? AND guild_id = ? LIMIT 1`,
      [rarity, message.guild.id],
    )?.[0]?.rarity;

    if (!autodelete) return;

    await message.delete().catch(() => {});
    const container = new ContainerBuilder().addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents((td) =>
          td.setContent(
            `Deleted **${message?.embeds?.[0]?.author?.name || "Waifu"}** drop, since *Autodelete* was enabled!\n` +
              "-# Use `/settings` -> 7w7 -> Dropdown to edit",
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId("utility:delete:null")
            .setEmoji("🗑️")
            .setStyle(ButtonStyle.Secondary),
        ),
    );

    await message.channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  if (message?.embeds?.[0]?.author?.name?.includes("'s perks")) {
    const userId = message?.components?.[0]?.components?.[0]?.customId?.split(";=;")[1];
    const cdField = message?.embeds?.[0]?.fields?.find((f) =>
      String(f?.name || "").includes("interact feature cooldown"),
    );
    if (!userId || !cdField) return;

    const cdFieldText = String(cdField.name || "");
    const multMatch = cdFieldText.match(/x\s*([0-9]*\.?[0-9]+)/i);
    const cdMultiplier = multMatch ? Number(multMatch[1]) : null;

    if (Number.isFinite(cdMultiplier) && cdMultiplier > 0) {
      global.db.upsertState("swsCdPerk", String(cdMultiplier), userId);
    }
    return;
  }

  if (message?.embeds?.[0]?.author?.name?.includes("'s inventory")) {
    for (const item of message?.embeds?.[0]?.description?.split("\n") || []) {
      const itemId = Number.parseInt(item.split("`")[1]?.trim(), 10);
      const itemName = item.split("-").at(-1)?.trim();
      const emojiId = item.split(":").at(-1)?.split(">")[0]?.trim();
      if (!itemName || !Number.isFinite(itemId)) continue;

      global.db.safeQuery(
        `INSERT INTO sws_items (id, name, emoji_id) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET emoji_id = ?, id = ?`,
        [itemId, itemName, emojiId || null, emojiId || null, itemId],
      );
    }
    return;
  }

  if (
    message?.embeds?.[0]?.description?.includes("# Bazaar >") &&
    !message?.embeds?.[0]?.description?.split("\n")?.[0]?.includes("Waifus")
  ) {
    for (const offer of message.embeds[0].description
      .split("\n")
      .filter((o) => o.startsWith("-"))) {
      const itemName = offer.split("**")[1]?.trim();
      const itemMarket = offer.split("||")[1]?.trim();
      const emojiId = offer?.split("||")[0]?.includes(">")
        ? offer.split(":").at(-1)?.split(">")[0]?.trim()
        : null;

      if (!itemName || !itemMarket) continue;

      if (emojiId) {
        global.db.safeQuery(
          `INSERT INTO sws_items (name, market, emoji_id) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET market = ?, emoji_id = ?`,
          [itemName, itemMarket, emojiId, itemMarket, emojiId],
        );
      } else {
        global.db.safeQuery(
          `INSERT INTO sws_items (name, market) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET market = ?`,
          [itemName, itemMarket, itemMarket],
        );
      }
    }
  }
}

async function handleAnigameMessage(message, oldMessage, settings) {
  if (message?.embeds?.[0]?.title === "Raid Lobbies" && !oldMessage) {
    const refAuthor = await resolveReferencedAuthor(message);
    const threshold = settings.getUserNumberSetting(
      refAuthor?.id,
      "anigame_raid_input_autodelete",
      500,
    );

    if (!threshold || !message?.reference?.messageId) return;

    const refMsg = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);

    if (refMsg?.content?.length > threshold) {
      await message.delete().catch(() => {});
      await message.channel.send(
        createV2Message("-# Deleted **.rd lobbies** message to keep the chat clean!"),
      );
    }
    return;
  }

  if (message?.embeds?.[0]?.title === "Calendar Fragment Shop" && !oldMessage) {
    await notifyAnigameShopReminders(message, "fragment_shop");
    return;
  }

  if (
    message?.components?.[0]?.components?.some(
      (c) => c?.type === 10 && c?.content?.includes("Clan Shop"),
  ) &&
    !oldMessage
  ) {
    await notifyAnigameShopReminders(message, "clan_shop");
    return;
  }

  if (message?.embeds?.[0]?.title?.includes("claimed by")) {
    const claimedUsername = message.embeds[0].title.split("__")[1];
    const claimedUser = await findUserByUsername(claimedUsername);
    const claimedUserId = claimedUser?.id;
    const rarityEmoji = message?.embeds?.[0]?.description?.split("**")?.[0];
    const cardRarity = anigame_emoji_map[rarityEmoji];

    if (!claimedUserId || !cardRarity) return;

    const trackingEnabled = settings.getUserToggle(
      claimedUserId,
      "anigame_card_stat_tracking",
      true,
    );
    if (!trackingEnabled) return;

    upsertCardClaim(claimedUserId, "Anigame", cardRarity, 1);
  }
}

async function handleDankMessage(message, settings) {
  if (
    message?.embeds?.[0]?.title === "Your XP Multipliers" ||
    message?.embeds?.[0]?.title === "Your Coin Multipliers" ||
    message?.embeds?.[0]?.title === "Your Luck Multipliers"
  ) {
    const user = await resolveDankUser(message);
    if (!user || !shouldTrackDankStats(settings.getUserToggle, user.id)) return;

    const title = String(message.embeds[0].title || "");
    const description = String(message.embeds[0].description || "");
    if (!description) return;

    if (title === "Your XP Multipliers") {
      indexDankMultiplierSnapshot(user.id, "xp", description);
    } else if (title === "Your Coin Multipliers") {
      indexDankMultiplierSnapshot(user.id, "coins", description);
    } else if (title === "Your Luck Multipliers") {
      indexDankMultiplierSnapshot(user.id, "luck", description);
    }
    return;
  }

  if (
    message?.embeds?.[0]?.description?.includes("your lactose intolerance is acting up") ||
    message?.embeds?.[0]?.description?.includes("three o'clock in the")
  ) {
    const userId = message?.components?.[0]?.components?.[0]?.customId?.split(":")?.[1];
    const enabled = settings.getUserToggle(userId, "dank_cheese_autodelete", true);
    if (!enabled) return;

    const refMsg = await message.channel.messages
      .fetch(message.reference?.messageId)
      .catch(() => null);

    if (refMsg) {
      await refMsg.delete().catch(() => {});
    }
    return;
  }

  if (message?.embeds?.[0]?.author?.name === "Adventure Summary") {
    const user = await resolveDankUser(message);
    if (!user || !shouldTrackDankStats(settings.getUserToggle, user.id)) return;

    const adv = message?.embeds?.[0]?.fields?.find((f) => f.name === "Name")?.value;
    if (!adv) return;

    const rewardsField = message?.embeds?.[0]?.fields?.find((f) => f.name === "Rewards")?.value;
    for (let reward of rewardsField?.split("\n") || []) {
      reward = reward.split("-")[1]?.trim();
      if (!reward) continue;
      if (
        reward.includes("Multiplier") ||
        reward.includes("Title") ||
        reward.includes("Pet")
      ) {
        continue;
      }

      const parsed = parseRewardEntry(reward);
      if (!parsed) continue;
      upsertDankStat(user.id, parsed.item, parsed.amount, `Adventure_${adv}`);
    }

    const reducedCostDay = new Date().getDay() === 6;
    const entryTicketCost = Number(dank_adventure_ticket_map[adv]);
    const ticketCost = reducedCostDay ? Math.floor(entryTicketCost / 2) : entryTicketCost;
    if (Number.isFinite(ticketCost)) {
      upsertDankStat(user.id, "Adventure Ticket", ticketCost * -1, `Adventure_${adv}`);
    }
    return;
  }

  if (
    message?.embeds?.[0]?.title &&
    message?.embeds?.[0]?.description?.startsWith("> ") &&
    /received:\s*$/i.test(
      String(message?.embeds?.[0]?.fields?.[0]?.name || ""),
    )
  ) {
    let user = await resolveDankUser(message);
    if (!user) {
      const fieldName = String(message?.embeds?.[0]?.fields?.[0]?.name || "");
      const trimmedFieldName = fieldName.trim();
      const lowerFieldName = trimmedFieldName.toLowerCase();
      const username = lowerFieldName.endsWith("received:")
        ? trimmedFieldName.slice(0, -9).trim()
        : trimmedFieldName;
      user = await findUserByUsername(username);
    }

    if (!user || !shouldTrackDankStats(settings.getUserToggle, user.id)) return;

    const eventType = message.embeds[0].title.replace("-", " ").trim();
    const rewards = message?.embeds?.[0]?.fields?.[0]?.value
      ?.split("\n")
      .map((r) => r.split("-")[1]?.trim())
      .filter(Boolean);

    for (const reward of rewards || []) {
      if (
        reward.includes("Multiplier") ||
        reward.includes("Title") ||
        reward.includes("Pet")
      ) {
        continue;
      }

      const parsed = parseRewardEntry(reward);
      if (!parsed) continue;
      upsertDankStat(user.id, parsed.item, parsed.amount, `Random Event_${eventType}`);
    }
    return;
  }

  if (
    message?.embeds?.[0]?.title === "Boss Battle" &&
    message?.embeds?.[0]?.fields?.[0]?.name === "Rewards:"
  ) {
    const rewards = message?.embeds?.[0]?.fields?.[0]?.value
      ?.split("\n")
      .map((r) => r.split("-")[1]?.trim())
      .filter(Boolean);

    for (let reward of rewards || []) {
      if (reward.includes("Multiplier") || reward.includes("Title")) continue;

      const user = extractUserFromMention(reward);
      if (!user || !shouldTrackDankStats(settings.getUserToggle, user.id)) continue;

      reward = reward.split("for")[0].trim();
      const rewardLines = reward.split("and").map((r) => r.trim());

      for (const rewardLine of rewardLines) {
        const parsed = parseRewardEntry(rewardLine);
        if (!parsed) continue;
        upsertDankStat(user.id, parsed.item, parsed.amount, "Random Event_Boss Battle");
      }
    }
    return;
  }

  const lastComponent = getLast(message?.components);
  const hasFishing = lastComponent?.components?.some(
    (c) => c?.type === 10 && c?.content?.includes("You caught something!"),
  );

  if (hasFishing) {
    const user = await resolveDankUser(message);
    if (!user || !shouldTrackDankStats(settings.getUserToggle, user.id)) return;

    const fishingText = lastComponent.components
      ?.find((c) => c?.type === 10 && c?.content?.includes("You caught something!"))
      ?.content;
    const fishingItem = getLast(fishingText?.split("\n"))?.split("- ")?.[1]?.trim();
    const parsed = parseRewardEntry(fishingItem);
    if (!parsed) return;

    upsertDankStat(user.id, parsed.item, parsed.amount, "Fishing");
    return;
  }

  if (
    message?.components?.[0]?.components?.some(
      (c) => c?.type === 10 && c?.content?.includes("Coin Nuke**"),
    )
  ) {
    const componentText = message?.components?.[0]?.components?.find(
      (c) => c?.type === 10 && c?.content?.includes("Coin Nuke**"),
    )?.content;
    const host = componentText?.split("'s")[0]?.trim();
    if (!host) return;

    let totalPayout = 0;
    const nukePayouts = [];

    for (const nukePayout of componentText
      ?.split("\n")
      .filter((l) => l.startsWith("-") && l.includes("⏣")) || []) {
      const joined = nukePayout.split(" ")[1]?.trim();
      const userPayout = joined?.split("⏣")?.[1]?.replaceAll(",", "").trim();
      const parsedPayout = Number.parseInt(userPayout, 10);
      if (!Number.isFinite(parsedPayout)) continue;

      totalPayout += parsedPayout;
      nukePayouts.push({
        user: joined,
        amount: userPayout,
      });
    }

    const container = new ContainerBuilder().addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents((td) => {
          td.setContent(
            `### ${host}'s Coin Nuke dropped\n# ⏣ ${totalPayout.toLocaleString()}`,
          );
        })
        .setButtonAccessory(
          new ButtonBuilder()
            .setLabel("Add to tracker")
            .setStyle(ButtonStyle.Primary)
            .setCustomId(`dank:nukeclaim:${host}`),
        ),
    );

    const reply = await message.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });

    if (reply?.id) {
      global.db.upsertState("nuke_payout", JSON.stringify(nukePayouts), reply.id, false);
    }
    return;
  }

  if (
    message?.components?.[0]?.components?.some(
      (c) => c?.type === 10 && c?.content?.includes("Level Rewards"),
    )
  ) {
    const levelBlocks = extractDankLevelRewardBlocks(message);

    for (const block of levelBlocks) {
      const levelMatch = block.match(/Level (\d[\d,]*)/);
      const level = Number.parseInt(
        String(levelMatch?.[1] || "").replaceAll(",", ""),
        10,
      );
      if (!Number.isFinite(level)) continue;

      const rewards = String(block)
        ?.split("\n")
        .filter((l) => l && !/Level\s+\d[\d,]*/.test(l));

      for (const rewardLine of rewards || []) {
        const parsed = parseDankLevelRewardLine(rewardLine);
        if (!parsed) continue;

        global.db.safeQuery(
          `INSERT OR IGNORE INTO dank_level_rewards (level, name, amount, title) VALUES (?, ?, ?, ?)`,
          [level, parsed.item, parsed.amount, parsed.title ? 1 : 0],
        );
      }
    }
  }
}

async function handleKarutaMessage(message, settings) {
  await handleKarutaDropRecognition(message, settings);

  const embed = message?.embeds?.[0];
  const title = String(embed?.title || "");
  const description = String(embed?.description || "");

  const normalizeKarutaKey = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");

  const upsertKarutaCard = (input) => {
    const displayName = String(input?.displayName || "").trim();
    const displaySeries = String(input?.displaySeries || "").trim();
    const wishlistValue = Number.parseInt(
      String(input?.wishlist || "0").replaceAll(",", ""),
      10,
    );
    const wishlist = Number.isFinite(wishlistValue) ? wishlistValue : 0;
    const cardUrl = String(input?.cardUrl || "").trim();
    const name = normalizeKarutaKey(displayName);
    const series = normalizeKarutaKey(displaySeries);
    if (!name || !series) return;

    global.db.safeQuery(
      `
      INSERT INTO karuta_cards (name, series, display_name, display_series, wishlist, card_url)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name, series) DO UPDATE SET
        wishlist = excluded.wishlist,
        display_name = CASE
          WHEN COALESCE(excluded.display_name, '') <> '' THEN excluded.display_name
          ELSE karuta_cards.display_name
        END,
        display_series = CASE
          WHEN COALESCE(excluded.display_series, '') <> '' THEN excluded.display_series
          ELSE karuta_cards.display_series
        END,
        card_url = CASE
          WHEN COALESCE(karuta_cards.card_url, '') = '' AND COALESCE(excluded.card_url, '') <> ''
            THEN excluded.card_url
          ELSE karuta_cards.card_url
        END
      `,
      [name, series, displayName, displaySeries, wishlist, cardUrl],
    );
  };

  if (title === "Character Lookup") {
    const name = description.match(/Character\s*·\s*\*\*(.+?)\*\*/i)?.[1];
    const series = description.match(/Series\s*·\s*\*\*(.+?)\*\*/i)?.[1];
    const wishlist = description.match(/Wishlisted\s*·\s*\*\*(\d[\d,]*)\*\*/i)?.[1];
    const cardUrl = String(embed?.thumbnail?.url || "").trim();

    if (name && series && wishlist) {
      upsertKarutaCard({
        displayName: name,
        displaySeries: series,
        wishlist,
        cardUrl,
      });
    }
    return;
  }

  if (title === "Character Results") {
    const lines = String(embed?.fields?.[0]?.value || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const match = line.match(
        /`(?:\d+)`\.\s*`♡([\d,]+)`\s*·\s*(.+?)\s*·\s*\*\*(.+?)\*\*/i,
      );
      if (!match) continue;
      const [, wishlist, series, name] = match;
      upsertKarutaCard({
        displayName: name,
        displaySeries: series,
        wishlist,
        cardUrl: "",
      });
    }
    return;
  }

  if (title !== "Visit Character") return;

  let reminderHours = null;
  if (description.includes("you were recently rejected.")) {
    reminderHours = 24;
  } else if (description.includes("date was successful!")) {
    reminderHours = 10;
  }

  const user = extractUserFromMention(description);
  const userId = user?.id;
  if (!userId || !reminderHours) return;

  const enabled = settings.getUserToggle(userId, "karuta_visit_reminders", true);
  if (!enabled) return;

  global.db.createReminder(
    userId,
    message.channel,
    reminderHours * 60,
    "Karuta Visit",
    {
      command: `kvi ${description.split("`")?.[1] || ""}`,
      information: "You can visit your partner again",
    },
    true,
  );
}

async function handleIzziMessage(message, settings) {
  const content = String(message?.content || "");

  if (content.includes("has been added to")) {
    const boldParts = content.split("**");
    const ownerSegment = boldParts?.[3] || "";
    const claimedUsername = ownerSegment.endsWith("'s")
      ? ownerSegment.slice(0, -2)
      : ownerSegment;
    const claimedUser = await findUserByUsername(claimedUsername);
    const claimedUserId = claimedUser?.id;
    const cardRarity = content.split("__")?.[1];

    upsertCardClaim(claimedUserId, "Izzi", cardRarity, 1);
  }

  // Best-effort notifier until a strict Izzi event-shard parser is implemented.
  if (!/event\s+shard/i.test(content)) return;

  const mentionedId = extractMentionedUserId(content);
  const username = content.split("**")?.[1]?.split("'s**")?.[0];
  const user =
    (mentionedId && (await global.bot.users.fetch(mentionedId).catch(() => null))) ||
    (await findUserByUsername(username));
  const userId = user?.id;
  if (!userId) return;

  const threshold = settings.getUserNumberSetting(userId, "izzi_event_shard_notifier", 0);
  if (!threshold) return;

  const shardMatch = content.match(/(\d[\d,]*)\s*(event\s*shards?|shards?)/i);
  const shardCount = Number.parseInt(shardMatch?.[1]?.replaceAll(",", ""), 10);
  if (!Number.isFinite(shardCount) || shardCount < threshold) return;

  await message.reply({
    content: `-# Event Shard notifier <@${userId}> (${shardCount.toLocaleString()} shards)`,
  });
}

async function handleMessage(message, oldMessage = false) {
  if (!message?.author?.bot) return;

  const settings = createSettingsReader();

  switch (message.author.id) {
    case global.botIds.sws:
      await handleSwsMessage(message, oldMessage, settings);
      break;

    case global.botIds.anigame:
      await handleAnigameMessage(message, oldMessage, settings);
      break;

    case global.botIds.dank:
      await handleDankMessage(message, settings);
      break;

    case global.botIds.karuta:
      await handleKarutaMessage(message, settings);
      break;

    case global.botIds.izzi:
      await handleIzziMessage(message, settings);
      break;

    default:
      break;
  }
}

module.exports = handleMessage;
