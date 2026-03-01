const {
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require("discord.js");
const {
  extractMentionedUserId,
  findUserByUsername,
  upsertCardClaim,
} = require("../handleMessageHelpers");

const IZZI_SHARD_LOBBY_STATE_TYPE = "izzi_shard_lobby_notify";

async function handleIzziMessage(message, settings) {
  const embed = message?.embeds?.[0];
  if (String(embed?.title || "").trim() === "Event Lobbies") {
    const authorIcon =
      String(embed?.author?.iconURL || "").trim() ||
      String(embed?.author?.icon_url || "").trim() ||
      "";
    const requesterId = authorIcon.match(/\/avatars\/(\d{16,22})\//)?.[1] || null;
    if (!requesterId) return;

    const threshold = settings.getUserNumberSetting(
      requesterId,
      "izzi_event_shard_notifier",
      0,
    );
    if (!threshold) return;

    const parsedRows = [];
    for (const field of embed?.fields || []) {
      const rawName = String(field?.name || "").trim();
      const rawValue = String(field?.value || "").trim();
      if (!rawName || !rawValue) continue;

      const shardAmount = Number.parseInt(
        String(
          rawValue.match(/(\d[\d,]*)\s*<:shard:/i)?.[1] || "",
        ).replaceAll(",", ""),
        10,
      );
      const raidId = String(rawValue.match(/ID:\s*(\d+)/i)?.[1] || "").trim();
      if (!Number.isFinite(shardAmount) || !raidId) continue;
      if (shardAmount < threshold) continue;

      const emojiName = (
        rawName.match(/<a?:([a-zA-Z0-9_]+):\d+>/)?.[1] || "unknown"
      ).toUpperCase();
      const difficulty = rawName.match(/\[([^\]]+)\]\s*$/)?.[1] || "Unknown";
      parsedRows.push({
        raidId,
        shards: shardAmount,
        headline: `* ${emojiName} [${difficulty}]`,
        detail: `-# ID: ${raidId} | Shards: ${shardAmount}`,
      });
    }

    if (!parsedRows.length) return;

    const stateKey = String(message.id);
    let state = null;
    try {
      state = JSON.parse(
        global.db.getState(IZZI_SHARD_LOBBY_STATE_TYPE, stateKey) || "null",
      );
    } catch {
      state = null;
    }

    const seenIds = new Set(Array.isArray(state?.raidIds) ? state.raidIds : []);
    const mergedRows = Array.isArray(state?.rows) ? [...state.rows] : [];
    let appended = false;
    for (const row of parsedRows) {
      if (seenIds.has(row.raidId)) continue;
      seenIds.add(row.raidId);
      mergedRows.push(row);
      appended = true;
    }
    if (!appended && state?.outputMessageId) return;

    const contentBody = mergedRows
      .map((row) => `${row.headline}\n${row.detail}`)
      .join("\n");

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("### Shard Raid ID's"),
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(contentBody));

    const payload = {
      content: "",
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    };

    let outputMessageId = String(state?.outputMessageId || "").trim();
    let sentMessage = null;

    if (outputMessageId) {
      const existing = await message.channel.messages
        .fetch(outputMessageId)
        .catch(() => null);
      if (existing) {
        await existing.edit(payload).catch(() => null);
      } else {
        sentMessage = await message.channel.send(payload).catch(() => null);
      }
    } else {
      sentMessage = await message.channel.send(payload).catch(() => null);
    }

    if (sentMessage?.id) {
      outputMessageId = String(sentMessage.id);
    }

    if (outputMessageId) {
      global.db.upsertState(
        IZZI_SHARD_LOBBY_STATE_TYPE,
        JSON.stringify({
          outputMessageId,
          requesterId,
          raidIds: [...seenIds],
          rows: mergedRows,
        }),
        stateKey,
        false,
      );
    }
    return;
  }

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

  if (!/event\s+shard/i.test(content)) return;

  const mentionedId = extractMentionedUserId(content);
  const username = content.split("**")?.[1]?.split("'s**")?.[0];
  const user =
    (mentionedId &&
      (await global.bot.users.fetch(mentionedId).catch(() => null))) ||
    (await findUserByUsername(username));
  const userId = user?.id;
  if (!userId) return;

  const threshold = settings.getUserNumberSetting(
    userId,
    "izzi_event_shard_notifier",
    0,
  );
  if (!threshold) return;

  const shardMatch = content.match(/(\d[\d,]*)\s*(event\s*shards?|shards?)/i);
  const shardCount = Number.parseInt(shardMatch?.[1]?.replaceAll(",", ""), 10);
  if (!Number.isFinite(shardCount) || shardCount < threshold) return;

  await message.reply({
    content: `-# Event Shard notifier <@${userId}> (${shardCount.toLocaleString()} shards)`,
  });
}

module.exports = {
  handleIzziMessage,
};
