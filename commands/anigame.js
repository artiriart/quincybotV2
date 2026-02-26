const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setContexts("PrivateChannel", "Guild", "BotDM")
    .setName("anigame")
    .setDescription("Anigame commands")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("raids")
        .setDescription("Shows your anigame profile")
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
              "Rarity which the price is based on. Default: Super Rare",
            )
            .setRequired(false)
            .addChoices(
              { name: "Common", value: "common" },
              { name: "Uncommon", value: "uncommon" },
              { name: "Rare", value: "rare" },
              { name: "Super Rare", value: "super_rare" },
              { name: "Ultra Rare", value: "ultra_rare" },
            ),
        ),
    )
    .addSubcommandGroup((subcommandGroup) =>
      subcommandGroup
        .setName("reminders")
        .setDescription("Anigame reminder utility")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("list")
            .setDescription("Shows your anigame reminders"),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("set")
            .setDescription("Sets a new reminder or deletes an existing one")
            .addStringOption((option) =>
              option
                .setName("type")
                .setDescription("Type of reminder")
                .setRequired(true)
                .addChoices(
                  { name: "Clan Shop", value: "clan_shop" },
                  { name: "Fragment Shop", value: "fragment_shop" },
                ),
            )
            .addStringOption((option) =>
              option
                .setName("card-name")
                .setDescription("Name of the card")
                .setRequired(true)
                .setAutocomplete(true),
            )
            .addStringOption((option) =>
              option
                .setName("rarity")
                .setDescription(
                  "Card rarity, only needed for clan shop, default: ultra rare",
                )
                .setRequired(false)
                .addChoices(
                  { name: "Common", value: "common" },
                  { name: "Uncommon", value: "uncommon" },
                  { name: "Rare", value: "rare" },
                  { name: "Super Rare", value: "super_rare" },
                  { name: "Ultra Rare", value: "ultra_rare" },
                ),
            )
            .addBooleanOption((option) =>
              option
                .setName("delete")
                .setDescription("Delete the reminder, default: false")
                .setRequired(false),
            ),
        ),
    ),
};
