const {
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require("discord.js");
const { createV2Message } = require("../../utils/componentsV2");
const {
  resolveReferencedAuthor,
  findUserByUsername,
  upsertCardClaim,
} = require("../handleMessageHelpers");

const anigame_emoji_map = {
  "<:common:1068421015509684224>": "Common",
  "<:not:1068421022606426182><:common:1068421020739981312>": "Uncommon",
  "<:rare:1068421016893800469>": "Rare",
  "<:super:1068421019645247550><:rare:1068421018374377535>": "Super Rare",
  "<a:ultra:1068416715890892861><a:rare:1068416713592414268>": "Ultra Rare",
};

function parseAnigameBaseStats(rawStats) {
  try {
    const parsed =
      typeof rawStats === "string" ? JSON.parse(rawStats) : rawStats || {};
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

function getAnigameRarityEmoji(rarityValue) {
  const key = String(rarityValue || "")
    .trim()
    .toLowerCase();
  if (key === "common")
    return global.db.getFeatherEmojiMarkdown("anigame_common") || "";
  if (key === "uncommon") {
    return [
      global.db.getFeatherEmojiMarkdown("anigame_uncommon_1") || "",
      global.db.getFeatherEmojiMarkdown("anigame_uncommon_2") || "",
    ]
      .filter(Boolean)
      .join("");
  }
  if (key === "rare")
    return global.db.getFeatherEmojiMarkdown("anigame_rare_1") || "";
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
  const name = String(cardName || "")
    .trim()
    .toLowerCase();
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
  const targetKey = String(rarityValue || "")
    .trim()
    .toLowerCase();
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
    const cardName = String(reminder?.card_name || "")
      .trim()
      .toLowerCase();
    if (!userId || !cardName) continue;

    const dedupeKey = `${userId}:${shopType}:${cardName}:${String(reminder?.rarity || "")}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const user =
      global.bot.users.cache.get(userId) ||
      (await global.bot.users.fetch(userId).catch(() => null));
    if (!user) continue;

    await user
      .send(buildAnigameReminderDmPayload(reminder, shopType))
      .catch(() => {});
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
        createV2Message(
          "-# Deleted **.rd lobbies** message to keep the chat clean!",
        ),
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

module.exports = {
  handleAnigameMessage,
};
