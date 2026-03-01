const {
  EmbedBuilder,
  ContainerBuilder,
  SectionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const { createV2Message } = require("../../utils/componentsV2");
const {
  extractMentionedUserId,
  resolveReferencedAuthor,
} = require("../handleMessageHelpers");

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

async function handleSwsMessage(message, oldMessage, settings) {
  if (
    /with your partner|hanging out with|with your wife|spent some time with your/i.test(
      String(message?.embeds?.[0]?.title || ""),
    )
  ) {
    const title = String(message?.embeds?.[0]?.title || "");
    const partner =
      /with your partner/i.test(title) ||
      /spent some time with your partner/i.test(title);
    const refAuthor = await resolveReferencedAuthor(message);
    const userId = refAuthor?.id;
    if (!userId) return;

    const toggleKey = partner ? "sws_partner_reminder" : "sws_wife_reminder";
    const enabled = settings.getUserToggle(userId, toggleKey, true);
    if (!enabled) return;

    const cdBuff = Number(global.db.getState("swsCdPerk", userId)) || 1;
    const totalCd = 5 * cdBuff;

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
      .setAuthor({
        name: `${gem} broke`,
        iconURL: user.avatarURL() || undefined,
      })
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

    const container = new ContainerBuilder().addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents((td) =>
          td.setContent(
            `### Raid started!\n${raidUsers.map((user) => `<@${user.id}>`).join(", ")}`,
          ),
        )
        .setThumbnailAccessory((thumb) => {
          thumb.setURL(
            String(
              message?.embeds?.[0]?.thumbnail?.url ||
                "https://cdn.discordapp.com/embed/avatars/0.png",
            ),
          );
          return thumb;
        }),
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
    const userId =
      message?.components?.[0]?.components?.[0]?.customId?.split(";=;")[1];
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

module.exports = {
  handleSwsMessage,
};
