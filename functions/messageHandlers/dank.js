const {
  ContainerBuilder,
  SectionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
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

function getMultiplierEmojiMarkdown(multiplierType) {
  const key = String(multiplierType || "").trim().toLowerCase();
  const candidates =
    key === "xp"
      ? ["dank_multiplier_xp", "multiplier_xp"]
      : key === "luck"
        ? ["dank_multiplier_luck", "multiplier_luck"]
        : ["dank_multiplier_coins", "dank_multiplier_coin", "multiplier_coins", "multiplier_coin"];

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
  const typeKey = String(match[2] || "").trim().toLowerCase();
  const duration = String(match[3] || "").trim();
  if (!amount || !duration) return null;

  const normalizedType = typeKey === "coin" || typeKey === "coins" ? "coins" : typeKey;
  const emoji = getMultiplierEmojiMarkdown(normalizedType);
  return `MULTIPLIER::${amount} ${emoji ? `${emoji} ` : ""}for ${duration}`;
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
      (c) => c?.type === 10 && c?.content === "### Collection",
    ) &&
    oldMessage
  ) {
    const getClaimButton = (msg) =>
      msg?.components?.[0]?.components?.find(
        (c) => c.type === 9 && c?.accessory?.label === "Claim",
      )?.accessory || null;

    const oldClaim = getClaimButton(oldMessage);
    const newClaim = getClaimButton(message);

    if (
      oldClaim &&
      newClaim &&
      oldClaim.disabled === false &&
      newClaim.disabled === true
    ) {
      const userId =
        message?.components?.[0]?.components?.[0]?.customId?.split(":")?.[1];

      const user = await resolveDankUser(message);
      if (!user || !shouldTrackDankStats(settings.getUserToggle, user.id))
        return;

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
      const compactMultiplier = toCompactMultiplierEntry(reward);
      if (compactMultiplier) {
        upsertDankStat(user.id, compactMultiplier, 1, `Adventure_${adv}`);
        continue;
      }
      if (
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
      const compactMultiplier = toCompactMultiplierEntry(reward);
      if (compactMultiplier) {
        upsertDankStat(user.id, compactMultiplier, 1, `Random Event_${eventType}`);
        continue;
      }
      if (
        reward.includes("Title") ||
        reward.includes("Pet")
      ) {
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
        const compactMultiplier = toCompactMultiplierEntry(rewardLine);
        if (compactMultiplier) {
          upsertDankStat(
            user.id,
            compactMultiplier,
            1,
            "Random Event_Boss Battle",
          );
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
    (c) => c?.type === 10 && c?.content?.includes("You caught something!"),
  );

  if (hasFishing) {
    const user = await resolveDankUser(message);
    if (!user || !shouldTrackDankStats(settings.getUserToggle, user.id)) return;

    const fishingText = lastComponent.components?.find(
      (c) => c?.type === 10 && c?.content?.includes("You caught something!"),
    )?.content;
    const fishingItem = getLast(fishingText?.split("\n"))
      ?.split("- ")?.[1]
      ?.trim();
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
            .setCustomId("danknuke:claim"),
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
