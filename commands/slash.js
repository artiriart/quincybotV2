const { SlashCommandBuilder } = require("discord.js");
const { routeSlashCommand } = require("../functions/interactions/slashRouter");

module.exports = {
  data: [
    new SlashCommandBuilder()
      .setName("calculator")
      .setDescription("Your mobile Discord Calculator")
      .addStringOption((option) =>
        option
          .setName("prompt")
          .setDescription(
            "The calculation you want to perform, accepts almost any math equation, return with beatiful LATEX",
          )
          .setRequired(true),
      ),
    new SlashCommandBuilder().setName("help").setDescription("Help command"),
    new SlashCommandBuilder().setName("repo").setDescription("Project repository info"),
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Bot latency & server information"),
    new SlashCommandBuilder()
      .setName("invite")
      .setDescription("Get bot invite link"),
    new SlashCommandBuilder()
      .setName("dice")
      .setDescription("Roll a custom dice")
      .addIntegerOption((option) =>
        option
          .setName("range")
          .setDescription("The range of the dice (default: 1-6)")
          .setRequired(false),
      )
      .addIntegerOption((option) =>
        option
          .setName("amount")
          .setDescription("The amount of dice to roll (default: 1)")
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option
          .setName("unique")
          .setDescription("Only unique numbers (default: true)")
          .setRequired(false),
      ),
    new SlashCommandBuilder()
      .setName("settings")
      .setDescription("toggle settings"),
    new SlashCommandBuilder()
      .setName("reminder")
      .setDescription("Create a personal reminder")
      .addIntegerOption((option) =>
        option
          .setName("duration")
          .setDescription("Reminder duration in minutes (default: 5)")
          .setMinValue(1)
          .setMaxValue(10080)
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName("information")
          .setDescription("Reminder text (default: Custom Reminder)")
          .setRequired(false),
      ),
  ],
  async execute(interaction, client) {
    if (!interaction?.isChatInputCommand?.()) return;
    await routeSlashCommand(interaction, client);
  },
};
