const { SlashCommandBuilder } = require("discord.js");
const { buttonHandlers } = require("../functions/interactions/button");
const { modalHandlers } = require("../functions/interactions/modal");
const {
  ROUTE_PREFIX,
  runLabAutocomplete,
  runLabCombine,
  runLabDiscoveries,
  runLabElements,
  runLabHelp,
  runLabMenu,
  handleLabButton,
  handleLabModal,
} = require("../functions/lab");

module.exports = {
  data: new SlashCommandBuilder()
    .setContexts("PrivateChannel", "Guild", "BotDM")
    .setName("lab")
    .setDescription("Lab commands")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("menu")
        .setDescription("Open the Lab home menu"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("combine")
        .setDescription("Combine two owned elements")
        .addStringOption((option) =>
          option
            .setName("element1")
            .setDescription("First owned element")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((option) =>
          option
            .setName("element2")
            .setDescription("Second owned element")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("elements")
        .setDescription("Show unlocked Lab elements")
        .addStringOption((option) =>
          option
            .setName("search")
            .setDescription("Jump to the page containing a matching element")
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName("page")
            .setDescription("Page number")
            .setRequired(false)
            .setMinValue(1),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("User whose Lab elements should be shown")
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("discoveries")
        .setDescription("Show first discoveries")
        .addStringOption((option) =>
          option
            .setName("search")
            .setDescription("Jump to the page containing a matching discovery")
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName("page")
            .setDescription("Page number")
            .setRequired(false)
            .setMinValue(1),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("User whose first discoveries should be shown")
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("help")
        .setDescription("Show Lab help"),
    ),
  async autocomplete(interaction) {
    await runLabAutocomplete(interaction);
  },
  async execute(interaction) {
    if (!interaction?.isChatInputCommand?.()) return;

    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand === "menu") {
      await runLabMenu(interaction);
      return;
    }
    if (subcommand === "combine") {
      await runLabCombine(interaction);
      return;
    }
    if (subcommand === "elements") {
      await runLabElements(interaction);
      return;
    }
    if (subcommand === "discoveries") {
      await runLabDiscoveries(interaction);
      return;
    }
    if (subcommand === "help") {
      await runLabHelp(interaction);
    }
  },
};

if (!buttonHandlers.has(ROUTE_PREFIX)) {
  buttonHandlers.set(ROUTE_PREFIX, handleLabButton);
}

if (!modalHandlers.has(ROUTE_PREFIX)) {
  modalHandlers.set(ROUTE_PREFIX, handleLabModal);
}
