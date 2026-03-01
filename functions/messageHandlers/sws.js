const {
  EmbedBuilder,
  ContainerBuilder,
  SectionBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextDisplayBuilder,
  MessageFlags,
} = require("discord.js");
const { createV2Message } = require("../../utils/componentsV2");
const {
  extractMentionedUserId,
  resolveReferencedAuthor,
} = require("../handleMessageHelpers");
const {
  isSwsAllyInfoEmbed,
  parseEdit3ReactionIdentifier,
} = require("../swsPresetUtils");

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
const SWS_RAID_TICKET_NOTIFY_STATE = "sws_raid_ticket_notify_state";

function getRaidTicketEmojiUrl() {
  const ticketRow = global.db.safeQuery(
    `
    SELECT emoji_id
    FROM sws_items
    WHERE LOWER(name) = LOWER(?)
       OR LOWER(name) LIKE LOWER(?)
    ORDER BY
      CASE WHEN LOWER(name) = LOWER(?) THEN 0 ELSE 1 END,
      LENGTH(name) ASC
    LIMIT 1
    `,
    ["Raid Ticket", "%raid%ticket%", "Raid Ticket"],
  )?.[0];
  const emojiId = String(ticketRow?.emoji_id || "").trim();
  if (!emojiId) return null;
  return `https://cdn.discordapp.com/emojis/${emojiId}.webp`;
}

function parseTicketSummaryLines(embedDescription) {
  const lines = String(embedDescription || "")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  if (!lines.length) return [];
  if (!/^raid started!?$/i.test(lines[0])) return [];

  const entries = [];
  for (const line of lines.slice(1)) {
    const match = line.match(/\((\d+)\s+left\)/i);
    if (!match) continue;
    const left = Number.parseInt(match[1], 10);
    if (!Number.isFinite(left)) continue;
    entries.push({ left, line });
  }
  return entries;
}

function getReadyButtonUserIds(message) {
  const row = message?.components?.[0]?.components;
  if (!Array.isArray(row) || !row.length) return [];

  return row.map((button) => {
    const parts = String(button?.customId || "").split(";=;");
    return String(parts?.[1] || "").trim() || null;
  });
}

async function sendRaidTicketReminder(message, userId, ticketEmojiUrl) {
  const mention = `<@${userId}>`;
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${mention} Buy new Raid Tickets\n## \`+buy 32 [amt]\``,
      ),
    )
    .setThumbnailAccessory((thumb) => {
      thumb.setURL(ticketEmojiUrl || "https://cdn.discordapp.com/embed/avatars/0.png");
      return thumb;
    });

  const container = new ContainerBuilder().addSectionComponents(section);
  await message.channel.send({
    content: mention,
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}

function loadRaidTicketNotifyState(userId) {
  const raw = global.db.getState(SWS_RAID_TICKET_NOTIFY_STATE, userId);
  if (!raw) {
    return {
      thresholdValue: null,
      thresholdNotified: false,
      zeroNotified: false,
      lastTickets: null,
    };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      thresholdValue: Number.isFinite(Number(parsed?.thresholdValue))
        ? Number(parsed.thresholdValue)
        : null,
      thresholdNotified: Boolean(parsed?.thresholdNotified),
      zeroNotified: Boolean(parsed?.zeroNotified),
      lastTickets: Number.isFinite(Number(parsed?.lastTickets))
        ? Number(parsed.lastTickets)
        : null,
    };
  } catch {
    return {
      thresholdValue: null,
      thresholdNotified: false,
      zeroNotified: false,
      lastTickets: null,
    };
  }
}

function saveRaidTicketNotifyState(userId, state) {
  global.db.upsertState(
    SWS_RAID_TICKET_NOTIFY_STATE,
    JSON.stringify({
      thresholdValue: Number.isFinite(Number(state?.thresholdValue))
        ? Number(state.thresholdValue)
        : null,
      thresholdNotified: Boolean(state?.thresholdNotified),
      zeroNotified: Boolean(state?.zeroNotified),
      lastTickets: Number.isFinite(Number(state?.lastTickets))
        ? Number(state.lastTickets)
        : null,
      updatedAt: Date.now(),
    }),
    userId,
    true,
  );
}

async function handleSwsMessage(message, oldMessage, settings) {
  if (!oldMessage && message?.embeds?.[0]?.description) {
    const ticketEntries = parseTicketSummaryLines(message.embeds[0].description);
    if (ticketEntries.length) {
      const raiderUserIds = getReadyButtonUserIds(message);
      if (raiderUserIds.length) {
        const ticketEmojiUrl = getRaidTicketEmojiUrl();
        const reminders = [];

        for (let index = 0; index < Math.min(ticketEntries.length, raiderUserIds.length); index += 1) {
          const userId = raiderUserIds[index];
          const left = ticketEntries[index]?.left;
          if (!userId || !Number.isFinite(left)) continue;

          const threshold = settings.getUserNumberSetting(
            userId,
            "sws_raid_ticket_reminder",
            0,
          );
          if (!threshold || threshold <= 0 || threshold > 50) continue;

          const notifyState = loadRaidTicketNotifyState(userId);
          if (notifyState.thresholdValue !== threshold) {
            notifyState.thresholdValue = threshold;
            notifyState.thresholdNotified = false;
            notifyState.zeroNotified = false;
          }

          // New ticket cycle (after buying), allow threshold/zero reminders again.
          if (left > threshold) {
            notifyState.thresholdNotified = false;
            notifyState.zeroNotified = false;
            notifyState.lastTickets = left;
            saveRaidTicketNotifyState(userId, notifyState);
            continue;
          }

          const hitThreshold = left === threshold && !notifyState.thresholdNotified;
          const hitZero = left === 0 && !notifyState.zeroNotified;
          if (!hitThreshold && !hitZero) {
            notifyState.lastTickets = left;
            saveRaidTicketNotifyState(userId, notifyState);
            continue;
          }

          if (hitThreshold) notifyState.thresholdNotified = true;
          if (hitZero) notifyState.zeroNotified = true;
          notifyState.lastTickets = left;
          saveRaidTicketNotifyState(userId, notifyState);
          reminders.push(userId);
        }

        if (reminders.length) {
          for (const userId of new Set(reminders)) {
            await sendRaidTicketReminder(message, userId, ticketEmojiUrl);
          }
          return;
        }
      }
    }
  }

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

  if (isSwsAllyInfoEmbed(message?.embeds?.[0])) {
    const reactionEmoji = parseEdit3ReactionIdentifier();
    await message.react(reactionEmoji).catch(() => {});
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
