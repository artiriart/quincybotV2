const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setContexts("PrivateChannel", "Guild", "BotDM")
    .setName("dank")
    .setDescription("Dank commands")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("stats")
        .setDescription(
          "Shows your dank stats (Adventure/Random Event/Fish items)",
        ),
    )
    .addSubcommandGroup((subcommandGroup) =>
      subcommandGroup
        .setName("calculate")
        .setDescription("Calculate your stats")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("xp")
            .setDescription("Predict your XP multipliers"),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("luck")
            .setDescription("Predict your Luck multipliers"),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("coins")
            .setDescription("Predict your Coins multipliers"),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("level")
            .setDescription(
              "Predict your Level runs (uses your XP multipliers)",
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("omega-prestige")
            .setDescription("Calculate Omega / Prestige requirements"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("nuke").setDescription("Your Nuke Stats"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("itemcalc")
        .setDescription("Bulk calculate item values")
        .addStringOption((option) =>
          option
            .setName("prompt")
            .setDescription("Item amount+name separated by commas")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("random-event")
        .setDescription("Random Event Rating & Loot"),
    ),
};
