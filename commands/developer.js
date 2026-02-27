const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dev")
    .setDescription("Developer commands")
    .addSubcommand((subcommand) =>
      subcommand.setName("eval").setDescription("Evaluate code"),
    )
    .addSubcommandGroup((subcommandGroup) =>
      subcommandGroup
        .setName("edit")
        .setDescription("Edit bot values")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("multiplier")
            .setDescription(
              "Panel to manually edit dankmemer multipliers (e.g. for adding emoji/description)",
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("other-items")
            .setDescription(
              "Panel to edit dankmemer extra items (mostly fishing related items)",
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("randomevents")
            .setDescription(
              "Panel to edit dankmemer random events list (e.g. for changing lb order)",
            ),
        ),
    ),
};
