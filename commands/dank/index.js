const { MessageFlags, SlashCommandBuilder } = require("discord.js");
const { runDankStats } = require("./stats");
const {
  runDankMultiplierEdit,
  runDankMultiplierCalculate,
  runDankOmegaPrestigeCalculate,
} = require("./multipliers");

async function runDank(interaction) {
  if (!interaction?.isChatInputCommand?.()) return;

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand(false);

  if (subcommand === "stats") {
    await runDankStats(interaction);
    return;
  }

  if (subcommandGroup === "multiplier" && subcommand === "edit") {
    const type = interaction.options.getString("type", true).toLowerCase();
    await runDankMultiplierEdit(interaction, type);
    return;
  }

  if (
    subcommandGroup === "calculate" &&
    ["xp", "coins", "luck", "level"].includes(subcommand)
  ) {
    await runDankMultiplierCalculate(interaction, subcommand);
    return;
  }

  if (subcommandGroup === "calculate" && subcommand === "omega-prestige") {
    await runDankOmegaPrestigeCalculate(interaction);
    return;
  }

  await interaction.reply({
    content: "This dank subcommand is not implemented yet.",
    flags: MessageFlags.Ephemeral,
  });
}

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
            .setDescription("Calculate Omega / Prestige requirements")
            .addStringOption((option) =>
              option
                .setName("type")
                .setDescription("Calculation type")
                .setRequired(true)
                .addChoices(
                  { name: "OMEGA", value: "omega" },
                  { name: "Prestige", value: "prestige" },
                ),
            )
            .addNumberOption((option) =>
              option
                .setName("number")
                .setDescription("Target amount to calculate")
                .setRequired(true)
                .setMinValue(1),
            ),
        ),
    )
    .addSubcommandGroup((subcommandGroup) =>
      subcommandGroup
        .setName("multiplier")
        .setDescription("Manage multiplier profiles")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("edit")
            .setDescription("Edit multiplier profile for calculations")
            .addStringOption((option) =>
              option
                .setName("type")
                .setDescription("Multiplier type")
                .setRequired(true)
                .addChoices(
                  { name: "XP", value: "xp" },
                  { name: "Coins", value: "coins" },
                  { name: "Luck", value: "luck" },
                ),
            ),
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
  async execute(interaction) {
    await runDank(interaction);
  },
};
