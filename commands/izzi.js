const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");
const { buttonHandlers } = require("../functions/interactions/button");
const {
  CLAIM_ROUTE_PREFIX,
  buildClaimMenuPayload,
  handleClaimMenuButton,
} = require("../functions/cardClaimPanel");
const { parseCompactNumber } = require("../utils/numberParser");

const DEFAULT_RAIDLIST_COST = 200_000;
const RAIDLIST_DESCRIPTION_PREFIX = "iz rd lobbies -d i -n ";
const RAIDLIST_DESCRIPTION_LIMIT = 4096;

function formatCoins(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function normalizeRaidlistCost(raw) {
  if (raw == null) return DEFAULT_RAIDLIST_COST;
  const parsed = parseCompactNumber(raw);
  if (parsed == null || parsed < 0) return null;
  return parsed;
}

function buildRaidlistDescription(names) {
  let description = RAIDLIST_DESCRIPTION_PREFIX;
  let included = 0;

  for (const rawName of names || []) {
    const name = String(rawName || "").trim();
    if (!name) continue;

    const candidate =
      included === 0 ? `${description}${name}` : `${description},${name}`;
    if (candidate.length > RAIDLIST_DESCRIPTION_LIMIT) break;

    description = candidate;
    included += 1;
  }

  return { description, included };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setContexts("PrivateChannel", "Guild", "BotDM")
    .setName("izzi")
    .setDescription("Izzi commands")
    .addSubcommand((subcommand) =>
      subcommand.setName("claims").setDescription("Your claimed card stats"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("raidlist")
        .setDescription("Generate an Izzi raidlist command by minimum cost")
        .addStringOption((option) =>
          option
            .setName("cost")
            .setDescription("Minimum card price. Default: 200k")
            .setRequired(false),
        ),
    ),
  async execute(interaction) {
    if (!interaction?.isChatInputCommand?.()) return;

    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand === "claims") {
      await interaction.reply(buildClaimMenuPayload(interaction.user.id, "izzi"));
      return;
    }

    if (subcommand === "raidlist") {
      const minCost = normalizeRaidlistCost(
        interaction.options.getString("cost", false),
      );

      if (minCost == null) {
        await interaction.reply({
          content: "Invalid cost. Use a number like `200000`, `200k`, or `1.5m`.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const indexedPriceCount = Number(
        global.db.safeQuery(
          `
          SELECT COUNT(*) AS count
          FROM izzi_cards
          WHERE COALESCE(average_price, 0) > 0
          `,
          [],
          [],
        )?.[0]?.count || 0,
      );

      if (indexedPriceCount <= 0) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("Raidlist Command")
              .setDescription("No Izzi market prices are indexed yet."),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const rows = global.db.safeQuery(
        `
        SELECT c.name, c.average_price
        FROM izzi_cards c
        WHERE c.event = 0
          AND COALESCE(c.average_price, 0) >= ?
        ORDER BY c.average_price DESC, LOWER(c.name) ASC
        `,
        [minCost],
        [],
      );

      if (!rows.length) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("Raidlist Command")
              .setDescription(
                `No non-event Izzi cards were found at or above ⏣ ${formatCoins(minCost)}.`,
              ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { description, included } = buildRaidlistDescription(
        rows.map((row) => row.name),
      );

      const embed = new EmbedBuilder()
        .setTitle("Raidlist Command")
        .setDescription(description);

      if (included < rows.length) {
        embed.setFooter({
          text: `Showing ${included} of ${rows.length} cards due to Discord's 4096 character limit.`,
        });
      }

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: "This izzi subcommand is not implemented yet.",
      flags: MessageFlags.Ephemeral,
    });
  },
};

if (!buttonHandlers.has(CLAIM_ROUTE_PREFIX)) {
  buttonHandlers.set(CLAIM_ROUTE_PREFIX, handleClaimMenuButton);
}
