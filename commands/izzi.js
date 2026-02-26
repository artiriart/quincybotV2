const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("izzi")
    .setDescription("Izzi commands")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("raids")
        .setDescription("Command to filter best raids"),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("claims").setDescription("Your claimed card stats"),
    ),
};
