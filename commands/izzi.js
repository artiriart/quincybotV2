const {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
} = require("discord.js");
const { buttonHandlers } = require("../functions/interactions/button");

const CLAIM_ROUTE_PREFIX = "cardclaims";

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
    .map((row) => `* **${String(row?.rarity || "Unknown")}** - \`${Number(row?.amount || 0).toLocaleString()}\``)
    .join("\n");
}

function buildClaimMenuPayload(userId, botKey) {
  const meta = getClaimBotMeta(botKey);
  const container = new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent("### Claimed Cards"))
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`${CLAIM_ROUTE_PREFIX}:switch:${userId}:${meta.switchTo}`)
            .setStyle(ButtonStyle.Secondary)
            .setLabel(meta.switchLabel),
        ),
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
  data: new SlashCommandBuilder()
    .setContexts("PrivateChannel", "Guild", "BotDM")
    .setName("izzi")
    .setDescription("Izzi commands")
    .addSubcommand((subcommand) =>
      subcommand.setName("claims").setDescription("Your claimed card stats"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("raids")
        .setDescription("Command to filter best raids")
        .addStringOption((option) =>
          option
            .setName("price")
            .setDescription("min. Card Price")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("rarity")
            .setDescription("Rarity which the price is based on. Default: Immortal")
            .setRequired(false)
            .addChoices(
              { name: "Immortal", value: "immortal" },
              { name: "Exclusive", value: "exclusive" },
              { name: "Ultimate", value: "ultimate" },
              { name: "Mythical", value: "mythical" },
            ),
        ),
    ),
  async execute(interaction) {
    if (!interaction?.isChatInputCommand?.()) return;

    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand === "claims") {
      await interaction.reply(buildClaimMenuPayload(interaction.user.id, "izzi"));
      return;
    }

    await interaction.reply({
      content: "This izzi subcommand is not implemented yet.",
      flags: MessageFlags.Ephemeral,
    });
  },
};

if (!buttonHandlers.has(CLAIM_ROUTE_PREFIX)) {
  buttonHandlers.set(CLAIM_ROUTE_PREFIX, handleClaimMenuButton);
}
