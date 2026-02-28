const {
  EmbedBuilder,
  ContainerBuilder,
  SectionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
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
  upsertCardClaim,
  upsertDankStat,
} = require("./handleMessageHelpers");

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

function shouldTrackDankStats(getUserToggle, userId) {
  if (!userId) return false;
  return !getUserToggle(userId, "dank_optout_all_stat_tracking", false);
}

function extractDankLevelRewardBlocks(message) {
  return (
    message?.components?.[0]?.components
      ?.filter((c) => c?.type === 10 && /Level\s+\d+/.test(String(c?.content || "")))
      ?.map((c) => String(c.content)) || []
  );
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
          .setThumbnailAccessory(thumb => thumb.setURL(message?.embeds?.[0]?.thumbnail?.url))
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
    return;
  }

  if (
    message?.components?.[0]?.components?.some(
      (c) => c?.type === 10 && c?.content?.includes("Clan Shop"),
    ) &&
    !oldMessage
  ) {
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
      const levelMatch = block.match(/Level (\d+)/);
      const level = Number.parseInt(levelMatch?.[1], 10);
      if (!Number.isFinite(level)) continue;

      const rewards = String(block)
        ?.split("\n")
        .filter((l) => l && !l.startsWith("<:Reply:") && !/Level\s+\d+/.test(l));

      for (let reward of rewards || []) {
        reward = String(reward)
          .replace(/^[-*]\s*/, "")
          .trim();

        if (reward.includes(">")) {
          const maybeAfterEmoji = reward.split(">")[1]?.trim();
          if (maybeAfterEmoji) reward = maybeAfterEmoji;
        }

        if (!reward || reward.includes("Multiplier")) continue;

        let amount = null;
        let item = null;
        let title = false;

        if (reward.includes("⏣")) {
          amount = Number.parseInt(reward.split("⏣")[1]?.replaceAll(",", "").trim(), 10);
          item = "DMC";
        } else if (reward.includes("Title")) {
          title = true;
          amount = 1;
          item = reward.split("'")[1]?.trim();
        } else {
          amount = Number.parseInt(reward.split("<")[0]?.trim(), 10);
          item = reward.split(">").at(-1)?.trim();
        }

        if (!item || !Number.isFinite(amount)) continue;

        global.db.safeQuery(
          `INSERT OR IGNORE INTO dank_level_rewards (level, name, amount, title) VALUES (?, ?, ?, ?)`,
          [level, item, amount, title ? 1 : 0],
        );
      }
    }
  }
}

async function handleKarutaMessage(message, settings) {
  if (message?.embeds?.[0]?.title !== "Visit Character") return;

  let reminderHours = null;
  if (message?.embeds?.[0]?.description?.includes("you were recently rejected.")) {
    reminderHours = 24;
  } else if (message?.embeds?.[0]?.description?.includes("date was successful!")) {
    reminderHours = 10;
  }

  const user = extractUserFromMention(message?.embeds?.[0]?.description);
  const userId = user?.id;

  if (userId && reminderHours) {
    const enabled = settings.getUserToggle(userId, "karuta_visit_reminders", true);
    if (enabled) {
      global.db.createReminder(
        userId,
        message.channel,
        reminderHours * 60,
        "Karuta Visit",
        {
          command: `kvi ${message?.embeds?.[0]?.description?.split("`")?.[1] || ""}`,
          information: "You can visit your partner again",
        },
        true,
      );
    }
  }
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
