const { SlashCommandBuilder } = require("discord.js");

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
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("faq")
        .setDescription("Shows gameplay related topics about 7w7")
        .addStringOption((option) =>
          option
            .setName("topic")
            .setDescription("The topic to get info about")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),
};
