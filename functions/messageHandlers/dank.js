const {
  ContainerBuilder,
  EmbedBuilder,
  SectionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  TextDisplayBuilder,
  SeparatorBuilder,
} = require("discord.js");
const {
  extractUserFromMention,
  findUserByUsername,
  getLast,
  parseRewardEntry,
  resolveDankUser,
  indexDankMultiplierSnapshot,
  upsertDankStat,
} = require("../handleMessageHelpers");

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

function collectComponentText(input, output = []) {
  if (Array.isArray(input)) {
    for (const entry of input) {
      collectComponentText(entry, output);
    }
    return output;
  }

  if (!input || typeof input !== "object") {
    return output;
  }

  if (typeof input.content === "string" && input.content.trim()) {
    output.push(input.content);
  }

  if (Array.isArray(input.components)) {
    collectComponentText(input.components, output);
  }

  return output;
}

function collectComponents(input, output = []) {
  if (Array.isArray(input)) {
    for (const entry of input) collectComponents(entry, output);
    return output;
  }

  if (!input || typeof input !== "object") return output;

  output.push(input);
  if (Array.isArray(input.components)) collectComponents(input.components, output);
  if (Array.isArray(input.items)) collectComponents(input.items, output);
  if (input.accessory) collectComponents(input.accessory, output);

  return output;
}

function formatDailyMerchantTrade(trade, index) {
  const continuedEmoji =
    global.db.getFeatherEmojiMarkdown("chevrons-right") ||
    global.db.getFeatherEmojiMarkdown("chevrons_right") ||
    "»";
  const endEmoji =
    global.db.getFeatherEmojiMarkdown("chevron-right") ||
    global.db.getFeatherEmojiMarkdown("chevron_right") ||
    "›";
  const numberEmoji = ["1️⃣", "2️⃣", "3️⃣"][index] || `${index + 1}.`;
  const tradeText = String(trade?.text || "").trim();
  const [offer, cost] = tradeText.split(/\s+for your\s+/, 2);

  return [
    `${numberEmoji} | Trade ${index + 1}: [Max. ${trade.max}]`,
    ` ${continuedEmoji}**${offer}**`,
    ` ${endEmoji}for your ${cost || ""}`.trimEnd(),
  ].join("\n");
}

function getTodaysBoost(day) {
  const continuedEmoji =
    global.db.getFeatherEmojiMarkdown("chevrons-right") ||
    global.db.getFeatherEmojiMarkdown("chevrons_right") ||
    "»";
  const endEmoji =
    global.db.getFeatherEmojiMarkdown("chevron-right") ||
    global.db.getFeatherEmojiMarkdown("chevron_right") ||
    "›";
  const itemEmoji = (name) => global.db.getDankItemEmojiMarkdown(name) || "";
  const fishEntityEmoji = (type, name) => {
    const rows = global.db.safeQuery(
      `
      SELECT application_emoji
      FROM dank_fish_entities
      WHERE entity_type = ? AND LOWER(name) = LOWER(?)
      LIMIT 1
      `,
      [type, name],
      [],
    );
    return rows?.[0]?.application_emoji || "";
  };

  switch (day) {
    case 1:
      return [
        `${continuedEmoji}${itemEmoji("Exclusive Gems Box")} Additional free reroll`,
        `${endEmoji}${getMultiplierEmojiMarkdown("luck")} +15% Luck`,
      ].join("\n-# ");
    case 2:
      return [
        `${continuedEmoji}${fishEntityEmoji("bait", "lucky-bait")} +2% Fishing luck`,
        `${endEmoji}${itemEmoji("Tool Box")} No fishing fails`,
      ].join("\n-# ");
    case 3:
      return `${endEmoji}**${getMultiplierEmojiMarkdown("xp")} Double XP**`;
    case 4:
      return `${endEmoji}${itemEmoji("Winning Lottery Ticket")} No market Tax on 1d offers`;
    case 5:
      return [
        `${continuedEmoji}${global.db.getFeatherEmojiMarkdown("skip-forward") || ""} Halved Work CD`,
        `${endEmoji}${getMultiplierEmojiMarkdown("coins")} Double Work Coins / ${itemEmoji("Ban Hammer")} Item drop **rate**`,
      ].join("\n-# ");
    case 6:
      return [
        `${continuedEmoji}${getMultiplierEmojiMarkdown("coins")} Tripple Adventure coin rewards`,
        `${endEmoji}${itemEmoji("Adventure Compass")} Halved Adventure CD / ${itemEmoji("Adventure Ticket")} Entry cost (Rounded **DOWN**)`,
      ].join("\n-# ");
    case 0:
      return `${endEmoji}**${getMultiplierEmojiMarkdown("xp")} Double XP**`;
    default:
      return "Something went wrong fetching Boosts";
  }
}

function getComponentText(message) {
  return collectComponentText(message?.components || []).join("\n");
}

function getAllCustomIds(message) {
  return collectComponents(message?.components || [])
    .map((component) => component?.customId || component?.custom_id)
    .filter((customId) => typeof customId === "string" && customId.trim());
}

function extractCollectionUserId(message) {
  for (const customId of getAllCustomIds(message)) {
    const match = customId.match(/\|(\d{15,25})(?::|$)/);
    if (match) return match[1];
  }

  return (
    message?.interactionMetadata?.user?.id ||
    message?.interaction?.user?.id ||
    null
  );
}

function isCollectionBundleBoxPage(message) {
  const text = getComponentText(message);
  return (
    text.includes("### Collection") &&
    text.includes("Bundle Box") &&
    text.includes("You can claim rewards once every calendar week.")
  );
}

function getCollectionClaimButton(message) {
  return (
    collectComponents(message?.components || []).find(
      (component) =>
        component?.type === 2 &&
        component?.label === "Claim" &&
        /collection-view:claim:rewards/.test(
          String(component?.customId || component?.custom_id || ""),
        ),
    ) || null
  );
}

function getMultiplierEmojiMarkdown(multiplierType) {
  const key = String(multiplierType || "")
    .trim()
    .toLowerCase();
  const candidates =
    key === "xp"
      ? ["dank_multiplier_xp", "multiplier_xp"]
      : key === "luck"
        ? ["dank_multiplier_luck", "multiplier_luck"]
        : [
            "dank_multiplier_coins",
            "dank_multiplier_coin",
            "multiplier_coins",
            "multiplier_coin",
          ];

  for (const name of candidates) {
    const markdown = global.db.getFeatherEmojiMarkdown(name);
    if (markdown) return markdown;
  }
  return "";
}

function toCompactMultiplierEntry(rawReward) {
  const reward = String(rawReward || "")
    .replace(/^<a?:[a-zA-Z0-9_]+:\d+>\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/multiplier/i.test(reward)) return null;

  const match = reward.match(
    /^([+-]?\d+(?:\.\d+)?(?:x|%))\s+(xp|luck|coin|coins)\s+multiplier\s+for\s+(.+)$/i,
  );
  if (!match) return null;

  const amount = String(match[1] || "").trim();
  const typeKey = String(match[2] || "")
    .trim()
    .toLowerCase();
  const duration = String(match[3] || "").trim();
  if (!amount || !duration) return null;

  const normalizedType =
    typeKey === "coin" || typeKey === "coins" ? "coins" : typeKey;
  const emoji = getMultiplierEmojiMarkdown(normalizedType);
  return `MULTIPLIER::${amount} ${emoji ? `${emoji} ` : ""}for ${duration}`;
}

function shouldIgnoreTrackedReward(rawReward) {
  const reward = String(rawReward || "").trim().toLowerCase();
  if (!reward) return true;
  return reward.includes("crafting speed") || reward.includes("farming speed");
}

function shouldTrackDankStats(getUserToggle, userId) {
  if (!userId) return false;
  return !getUserToggle(userId, "dank_optout_all_stat_tracking", false);
}

function extractDankLevelRewardBlocks(message) {
  return (
    message?.components?.[0]?.components
      ?.filter(
        (c) =>
          c?.type === 10 && /Level\s+\d[\d,]*/.test(String(c?.content || "")),
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

  reward = reward.replace(/^(<a?:[a-zA-Z0-9_]+:\d+>\s*)+/, "").trim();
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
      const emojiId = String(rawLine || "").match(
        /<a?:[a-zA-Z0-9_]+:(\d+)>/,
      )?.[1];
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

  const noAmountItem = reward.replace(/^<a?:[a-zA-Z0-9_]+:\d+>\s*/, "").trim();
  if (noAmountItem) {
    return { amount: 1, item: noAmountItem, title: false };
  }

  return null;
}

async function handleDankMessage(message, oldMessage, settings) {
  if (
    message?.components?.[0]?.components?.some(
      (c) => c?.type === 10 && c?.content === "### Traveling Merchant"
    )
  ) {
    const todayStr = new Date().toISOString().split("T")[0];
    const lastSentDate = global.db.getState("dank_daily_merchant_last_sent");
    const trades = [];
    let currentTradeText = null;
    let currentTradeMax = 0;

    for (const comp of message.components[0].components || []) {
      if (comp.type === 10 && comp.content?.includes("for your")) {
        currentTradeText = comp.content;
      } else if (comp.type === 1 && currentTradeText) {
        const tradeButton = comp.components?.find((c) =>
          c.label?.startsWith("Trade")
        );
        if (tradeButton) {
          const maxMatch = tradeButton.label.match(/Trade \(\d+\/(\d+)\)/);
          currentTradeMax = maxMatch ? Number(maxMatch[1]) : 1;
        }

        if (currentTradeMax > 0 && currentTradeText) {
          let newText = currentTradeText.replace(
            /<a?:[a-zA-Z0-9_]+:\d+>/g,
            (match, offset, str) => {
              let after = str.substring(offset + match.length).trim();
              let itemName = "";
              for (let i = 0; i < after.length; i++) {
                if (after[i] === "*" || after[i] === "\n") break;
                itemName += after[i];
              }
              itemName = itemName.trim();
              let dbEmoji = global.db.getDankItemEmojiMarkdown(itemName);
              return dbEmoji ? dbEmoji : "";
            }
          );
          newText = newText.replace(/\s{2,}/g, " ").trim();
          newText = newText.replace(/\*\*/g, "");

          trades.push({ max: currentTradeMax, text: newText });
        }

        currentTradeText = null;
        currentTradeMax = 0;
      }
    }

    if (lastSentDate !== todayStr) {
      if (trades.length > 0) {
        global.db.upsertState("dank_daily_merchant_last_sent", todayStr);

        const usersToDMRows = global.db.safeQuery(
          "SELECT user_id FROM user_settings_toggles WHERE type = ? AND toggle = 1",
          ["dank_daily_merchant_reminder"]
        );

        if (usersToDMRows && usersToDMRows.length > 0) {
          const utcDay = new Date().getUTCDay();
          const tradeDescription = trades.map(formatDailyMerchantTrade).join("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
          const dailyBoost = `**Daily Boost**\n-# ${getTodaysBoost(utcDay)}`;
          const embed = new EmbedBuilder()
            .setTitle("Merchant Trades")
            .setDescription(`${tradeDescription}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${dailyBoost}`);

          (async () => {
            for (const row of usersToDMRows) {
              try {
                const userObj = await message.client.users.fetch(row.user_id).catch(() => null);
                if (userObj) {
                  await userObj.send({
                    content: "-# Dank Daily Merchant Reset",
                    embeds: [embed],
                  }).catch(() => {});
                }
              } catch (e) {
                // Ignore DM errors
              }
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          })();
        }
      }
    }
  }

  if (
    message?.embeds?.[0]?.title?.startsWith("Prestige ") &&
    message.embeds[0].title.endsWith(" Requirements")
  ) {
    const user = await resolveDankUser(message);
    const userId = user?.id || null;

    const enabled = userId
      ? settings.getUserToggle(userId, "dank_prestige_excess_detection", true)
      : true;
    if (!enabled) return;

    const description = message.embeds[0].description || "";
    const coinMatch = description.match(/⏣\s+([\d,]+)\/([\d,]+)/);
    const levelMatch = description.match(/\*\*Level Required\*\*\s*\n.*?\s+([\d,]+)\/([\d,]+)/);
    
    if (coinMatch && levelMatch) {
      const currentCoins = Number(coinMatch[1].replaceAll(",", ""));
      const requiredCoins = Number(coinMatch[2].replaceAll(",", ""));
      const currentLevel = Number(levelMatch[1].replaceAll(",", ""));
      const requiredLevel = Number(levelMatch[2].replaceAll(",", ""));

      const lines = [];

      if (currentCoins >= requiredCoins) {
        const excessCoins = currentCoins - requiredCoins;
        lines.push(`${global.db.getFeatherEmojiMarkdown("trending-up")}extra coins: \`${excessCoins.toLocaleString()}\``);
      } else {
        const coinsNeeded = requiredCoins - currentCoins;
        lines.push(`${global.db.getFeatherEmojiMarkdown("trending-down")}needed coins: \`${coinsNeeded.toLocaleString()}\``);
      }

      if (currentLevel >= requiredLevel) {
        const excessLevels = currentLevel - requiredLevel;
        lines.push(`-# ${global.db.getFeatherEmojiMarkdown("check-circle")}extra levels: \`${excessLevels.toLocaleString()}\``);
      } else {
        const levelsNeeded = requiredLevel - currentLevel;
        lines.push(`${global.db.getFeatherEmojiMarkdown("x")}needed levels: \`${levelsNeeded.toLocaleString()}\``);
      }

      const container = new ContainerBuilder()
        .setAccentColor(0xd2a11ae5)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent("## Prestige Calculator")
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(lines.join("\n"))
        );

      await message.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      }).catch(() => {});
    }
  }

  if (
    isCollectionBundleBoxPage(oldMessage) &&
    isCollectionBundleBoxPage(message) &&
    oldMessage
  ) {
    const oldClaim = getCollectionClaimButton(oldMessage);
    const newClaim = getCollectionClaimButton(message);
    const userId = extractCollectionUserId(message) || extractCollectionUserId(oldMessage);

    if (
      oldClaim &&
      newClaim &&
      oldClaim.disabled !== true &&
      newClaim.disabled === true
    ) {
      if (!userId) {
        return;
      }

      const oneWeekinMinutes = 60 * 24 * 7;
      global.db.createReminder(
        userId,
        message.channel,
        oneWeekinMinutes,
        "Weekly Bundle Box",
        {
          command: `pls collection`,
          information: `You can collect your weekly ${global.db.getDankItemEmojiMarkdown("Bundle Box")} bundle box again`,
        },
        true,
      );
    }
  }

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
    message?.embeds?.[0]?.description?.includes(
      "your lactose intolerance is acting up",
    ) ||
    message?.embeds?.[0]?.description?.includes("three o'clock in the")
  ) {
    const userId =
      message?.components?.[0]?.components?.[0]?.customId?.split(":")?.[1];
    const enabled = settings.getUserToggle(
      userId,
      "dank_cheese_autodelete",
      true,
    );
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

    const adv = message?.embeds?.[0]?.fields?.find(
      (f) => f.name === "Name",
    )?.value;
    if (!adv) return;

    const rewardsField = message?.embeds?.[0]?.fields?.find(
      (f) => f.name === "Rewards",
    )?.value;
    for (let reward of rewardsField?.split("\n") || []) {
      reward = reward.split("-")[1]?.trim();
      if (!reward) continue;
      if (shouldIgnoreTrackedReward(reward)) continue;
      const compactMultiplier = toCompactMultiplierEntry(reward);
      if (compactMultiplier) {
        continue;
      }
      if (reward.includes("Title") || reward.includes("Pet")) {
        continue;
      }

      const parsed = parseRewardEntry(reward);
      if (!parsed) continue;
      upsertDankStat(user.id, parsed.item, parsed.amount, `Adventure_${adv}`);
    }

    const reducedCostDay = new Date().getDay() === 6;
    const entryTicketCost = Number(dank_adventure_ticket_map[adv]);
    const ticketCost = reducedCostDay
      ? Math.floor(entryTicketCost / 2)
      : entryTicketCost;
    if (Number.isFinite(ticketCost)) {
      upsertDankStat(
        user.id,
        "Adventure Ticket",
        ticketCost * -1,
        `Adventure_${adv}`,
      );
    }
    return;
  }

  if (
    ["Terrible work!", "Great work!"]?.includes(message?.embeds?.[0]?.title)
  ) {
    const user = await resolveDankUser(message);
    const work = message?.embeds[0]?.footer?.text?.split("as a")[1]?.trim();
    const rewards = message?.embeds?.[0]?.description
      ?.split("\n")
      ?.slice(1)
      ?.map((line) => line?.split("-")?.[1]?.split("for")?.[0]?.trim())
      ?.filter(Boolean);
    for (const reward of rewards) {
      const parsed = parseRewardEntry(reward);
      if (!parsed) continue;
      upsertDankStat(user.id, parsed.item, parsed.amount, `Work_${work}`);
    }
  }

  if (
    message?.embeds?.[0]?.title &&
    message?.embeds?.[0]?.description?.startsWith("> ") &&
    /received:\s*$/i.test(String(message?.embeds?.[0]?.fields?.[0]?.name || ""))
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
      if (shouldIgnoreTrackedReward(reward)) continue;
      const compactMultiplier = toCompactMultiplierEntry(reward);
      if (compactMultiplier) {
        continue;
      }
      if (reward.includes("Title") || reward.includes("Pet")) {
        continue;
      }

      const parsed = parseRewardEntry(reward);
      if (!parsed) continue;
      upsertDankStat(
        user.id,
        parsed.item,
        parsed.amount,
        `Random Event_${eventType}`,
      );
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
      if (!user || !shouldTrackDankStats(settings.getUserToggle, user.id))
        continue;

      reward = reward.split("for")[0].trim();
      const rewardLines = reward.split("and").map((r) => r.trim());

      for (const rewardLine of rewardLines) {
        if (shouldIgnoreTrackedReward(rewardLine)) continue;
        const compactMultiplier = toCompactMultiplierEntry(rewardLine);
        if (compactMultiplier) {
          continue;
        }
        const parsed = parseRewardEntry(rewardLine);
        if (!parsed) continue;
        upsertDankStat(
          user.id,
          parsed.item,
          parsed.amount,
          "Random Event_Boss Battle",
        );
      }
    }
    return;
  }

  const lastComponent = getLast(message?.components);
  const hasFishing = lastComponent?.components?.some(
    (c) =>
      c?.type === 9 &&
      c?.components?.[0]?.content?.includes("You caught something!"),
  );

  if (hasFishing) {
    const user = await resolveDankUser(message);
    if (!user || !shouldTrackDankStats(settings.getUserToggle, user.id)) return;

    const fishingText = lastComponent.components?.find(
      (c) =>
        c?.type === 9 &&
        c?.components?.[0]?.content?.includes("You caught something!"),
    )?.components?.[0]?.content;
    const fishingItem = getLast(fishingText?.split("\n"))
      ?.split("- ")?.[1]
      ?.trim();
    const parsed = parseRewardEntry(fishingItem);
    if (!parsed) return;

    upsertDankStat(user.id, parsed.item, parsed.amount, "Fishing");
    return;
  }

  const componentTexts = collectComponentText(message?.components);
  const componentText = componentTexts.find((text) =>
    String(text || "").includes("Coin Nuke**"),
  );
  const hasInventoryText = componentTexts.some((text) =>
    /\binventory\b/i.test(String(text || "")),
  );

  if (componentText && !hasInventoryText) {
    const hostUser = await resolveDankUser(message);
    const hostUserId = String(hostUser?.id || "").trim();
    if (!hostUserId) return;

    const host =
      String(hostUser?.globalName || hostUser?.username || "").trim() ||
      componentText?.split("'s")[0]?.trim();
    if (!host) return;

    let totalPayout = 0;
    const nukePayouts = [];

    for (const nukePayout of componentText?.split("\n") || []) {
      const line = String(nukePayout || "").trim();
      if (!line.startsWith("+") || !line.includes("⏣")) {
        continue;
      }

      const [leftRaw, rightRaw] = line.split("⏣");
      if (!leftRaw || !rightRaw) {
        continue;
      }

      const left = leftRaw.slice(1).trim(); // remove the leading "+"
      const joined = String(
        left
          .split(" ")
          .map((chunk) => chunk.trim())
          .filter(Boolean)?.[0] || "",
      ).trim();
      if (!joined) {
        continue;
      }

      const right = String(rightRaw || "").trim();
      const amountToken =
        right
          .split(" ")
          .map((chunk) => chunk.trim())
          .filter(Boolean)?.[0] || "";
      const userPayout = String(amountToken || "")
        .replaceAll(",", "")
        .trim();
      const parsedPayout = Number.parseInt(userPayout, 10);
      if (!Number.isFinite(parsedPayout)) continue;

      totalPayout += parsedPayout;
      nukePayouts.push({
        user: joined,
        amount: parsedPayout,
      });
    }

    if (!nukePayouts.length || totalPayout <= 0) return;

    const container = new ContainerBuilder().addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### ${host}'s ${global.db.getDankItemEmojiMarkdown("Coin Nuke")} Coin Nuke\n# ⏣ ${totalPayout.toLocaleString()}`,
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setLabel("Add to tracker")
            .setEmoji(global.db.getFeatherEmojiMarkdown("database"))
            .setStyle(ButtonStyle.Primary)
            .setCustomId(`danknuke:claim:${hostUserId}`),
        ),
    );

    const reply = await message.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });

    if (reply?.id) {
      global.db.upsertState(
        "nuke_payout",
        JSON.stringify(nukePayouts),
        reply.id,
        false,
      );
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

module.exports = {
  handleDankMessage,
};
