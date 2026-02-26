const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setContexts("PrivateChannel", "Guild", "BotDM")
    .setName("lab")
    .setDescription("Lab commands")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("elements")
        .setDescription("Shows your unlocked lab elements")
        .addIntegerOption((option) =>
          option
            .setName("page")
            .setDescription("The page of the lab elements")
            .setRequired(false)
            .setMinValue(1),
        )
        .addBooleanOption((option) =>
          option
            .setName("show-first-discoveries")
            .setDescription("only show your first discoveries")
            .setRequired(false),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The user to show the lab elements of")
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("home")
        .setDescription("Shows your lab home where you can combine elements"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("help").setDescription("Shows help for lab module"),
    ),
};
