const {
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("7w7")
    .setContexts("PrivateChannel", "Guild", "BotDM")
    .setDescription("7w7 commands")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("item")
        .setDescription("Gives you info about an item")
        .addStringOption((option) =>
          option
            .setName("item")
            .setDescription("The item to get info about")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("presets")
        .setDescription("Shows your presets & equip commands")
        .addStringOption((option) =>
          option
            .setName("jump")
            .setDescription("Jump to a preset")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),
  async autocomplete(interaction) {
    const subcommand = interaction.options.getSubcommand(false);
    const focused = interaction.options.getFocused(true);

    if (subcommand !== "item" || focused?.name !== "item") {
      await interaction.respond([]);
      return;
    }

    const query = String(focused.value || "").trim();
    const rows = query
      ? global.db.safeQuery(
          `
          SELECT id, name
          FROM sws_items
          WHERE LOWER(name) LIKE LOWER(?)
          ORDER BY
            CASE
              WHEN LOWER(name) = LOWER(?) THEN 0
              WHEN LOWER(name) LIKE LOWER(?) THEN 1
              ELSE 2
            END,
            name ASC
          LIMIT 25
          `,
          [`%${query}%`, query, `${query}%`],
        )
      : global.db.safeQuery(
          `
          SELECT id, name
          FROM sws_items
          ORDER BY name ASC
          LIMIT 25
          `,
        );

    const choices = rows.map((row) => {
      const id = row?.id ?? "?";
      const name = String(row?.name || "Unknown");
      const label = `[${id}] ${name}`.slice(0, 100);
      return { name: label, value: name.slice(0, 100) };
    });

    await interaction.respond(choices);
  },
  async execute(interaction) {
    if (!interaction?.isChatInputCommand?.()) return;

    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand !== "item") {
      await interaction.reply({
        content: "This subcommand is not implemented yet.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const itemName = interaction.options.getString("item", true);
    const item = global.db.safeQuery(
      `
      SELECT id, name, market, emoji_id, description
      FROM sws_items
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
      [itemName],
    )?.[0];

    if (!item) {
      await interaction.reply({
        content: `Item not found: ${itemName}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${item.name}`),
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# ${item.description || "None added yet"}`),
      );

    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Item ID**\n${item.id ?? "Unknown"}\n**Bazaar**\n${item.market || "Unknown"}`,
      ),
    );

    section.setThumbnailAccessory((thumb) => {
      thumb.setURL(
        item.emoji_id
          ? `https://cdn.discordapp.com/emojis/${item.emoji_id}.webp`
          : "https://cdn.discordapp.com/embed/avatars/0.png",
      );
      return thumb;
    });

    container.addSectionComponents(section);

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
