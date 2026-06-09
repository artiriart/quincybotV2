const {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require("discord.js");

const CLAIM_ROUTE_PREFIX = "cardclaims";

function parseEmojiValue(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const custom = text.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
  if (custom) {
    return {
      id: custom[3],
      name: custom[2],
      animated: custom[1] === "a",
    };
  }

  if (text.length <= 8) return { name: text };
  return null;
}

function applyButtonEmoji(button, emoji) {
  if (emoji) button.setEmoji(emoji);
  return button;
}

function getAnigameRarityEmoji(rarityValue) {
  const key = String(rarityValue || "").trim().toLowerCase().replace(/ /g, "_");
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

function getClaimBotMeta(rawBot) {
  const botKey = String(rawBot || "").trim().toLowerCase();
  if (botKey === "izzi") {
    return { key: "izzi", dbName: "Izzi", switchLabel: "Anigame", switchTo: "anigame" };
  }
  return { key: "anigame", dbName: "Anigame", switchLabel: "Izzi", switchTo: "izzi" };
}

function buildClaimRecordsText(userId, botKey) {
  const meta = getClaimBotMeta(botKey);
  const rows = global.db.safeQuery(
    `
    SELECT rarity, SUM(amount) AS amount
    FROM card_stats
    WHERE user_id = ? AND bot_name = ?
    GROUP BY rarity
    ORDER BY amount DESC, rarity ASC
    `,
    [userId, meta.dbName],
    [],
  );

  if (!rows.length) {
    return "-# No claim stats tracked yet.";
  }

  return rows
    .map((row) => {
      const rarity = String(row?.rarity || "Unknown");
      const emoji =
        meta.key === "anigame" ? getAnigameRarityEmoji(rarity) || "" : "";
      return `* ${emoji ? `${emoji} ` : ""}**${rarity}** - \`${Number(row?.amount || 0).toLocaleString()}\``.trim();
    })
    .join("\n");
}

function buildClaimMenuPayload(userId, botKey) {
  const meta = getClaimBotMeta(botKey);
  const menuEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("menu"));

  const container = new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${meta.dbName} Claims`),
        )
        .setButtonAccessory((button) => {
          applyButtonEmoji(
            button
              .setCustomId(`${CLAIM_ROUTE_PREFIX}:switch:${userId}:${meta.switchTo}`)
              .setStyle(ButtonStyle.Secondary)
              .setLabel(meta.switchLabel),
            menuEmoji,
          );
          return button;
        }),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(buildClaimRecordsText(userId, meta.key)),
    );

  return {
    content: "",
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

async function handleClaimMenuButton(interaction) {
  const [route, action, ownerId, botKey] = String(interaction.customId || "").split(":");
  if (route !== CLAIM_ROUTE_PREFIX || action !== "switch") return;

  if (!ownerId || interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "Only the command user can switch this menu.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.update(buildClaimMenuPayload(ownerId, botKey));
}

module.exports = {
  CLAIM_ROUTE_PREFIX,
  buildClaimMenuPayload,
  handleClaimMenuButton,
};
