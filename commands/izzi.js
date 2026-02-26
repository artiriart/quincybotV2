const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("izzi")
    .setDescription("Izzi commands")
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
            .setDescription(
              "Rarity which the price is based on. Default: Immortal",
            )
            .setRequired(false)
            .addChoices(
              { name: "Immortal", value: "immortal" },
              { name: "Exclusive", value: "exclusive" },
              { name: "Ultimate", value: "ultimate" },
              { name: "Mythical", value: "mythical" },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("claims").setDescription("Your claimed card stats"),
    ),
};
