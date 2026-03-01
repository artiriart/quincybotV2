const {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require("discord.js");

function normalizeCompact(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s']/g, "");
}

function parseItemQueryEntry(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const match = text.match(/^(\d[\d,]*)(?:\s+)?(.+)$/);
  if (match) {
    const amount = Number.parseInt(String(match[1] || "").replaceAll(",", ""), 10);
    const name = String(match[2] || "").trim();
    if (!name) return null;
    return {
      amount: Number.isFinite(amount) && amount > 0 ? amount : 1,
      query: name,
    };
  }

  return {
    amount: 1,
    query: text,
  };
}

function findDankItemByLooseName(query) {
  const raw = String(query || "").trim();
  if (!raw) return null;
  const compact = normalizeCompact(raw);

  return (
    global.db.safeQuery(
      `
      SELECT name, market, application_emoji
      FROM dank_items
      WHERE REPLACE(REPLACE(LOWER(name), ' ', ''), '''', '') = ?
      LIMIT 1
      `,
      [compact],
    )?.[0] ||
    global.db.safeQuery(
      `
      SELECT name, market, application_emoji
      FROM dank_items
      WHERE REPLACE(REPLACE(LOWER(name), ' ', ''), '''', '') LIKE ?
      ORDER BY
        CASE
          WHEN REPLACE(REPLACE(LOWER(name), ' ', ''), '''', '') LIKE ? THEN 0
          ELSE 1
        END,
        LENGTH(name) ASC
      LIMIT 1
      `,
      [`%${compact}%`, `${compact}%`],
    )?.[0] ||
    null
  );
}

function formatCoins(value) {
  return Number(value || 0).toLocaleString("en-US");
}

async function runDankItemCalc(interaction) {
  const prompt = interaction.options.getString("prompt", true);
  const entries = String(prompt || "")
    .split(",")
    .map((part) => parseItemQueryEntry(part))
    .filter(Boolean);

  if (!entries.length) {
    await interaction.reply({
      content: "No valid items found in your input.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const resolved = [];
  const unresolved = [];

  for (const entry of entries) {
    const item = findDankItemByLooseName(entry.query);
    if (!item?.name) {
      unresolved.push(entry.query);
      continue;
    }

    const oneMarket = Number.parseInt(String(item.market || 0), 10);
    const marketOne = Number.isFinite(oneMarket) ? oneMarket : 0;
    resolved.push({
      amount: entry.amount,
      name: String(item.name || "Unknown"),
      emoji: String(item.application_emoji || "").trim(),
      one: marketOne,
      total: marketOne * entry.amount,
    });
  }

  if (!resolved.length) {
    await interaction.reply({
      content: `Could not resolve any item names.${unresolved.length ? ` Tried: ${unresolved.join(", ")}` : ""}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const listEmoji = global.db.getFeatherEmojiMarkdown("list") || "";
  const totalValue = resolved.reduce((sum, row) => sum + row.total, 0);
  const itemLines = resolved.map(
    (row) =>
      `* \`${row.amount}\` ${row.emoji ? `${row.emoji} ` : ""}**${row.name}** - ⏣ ${formatCoins(row.total)} (⏣ ${formatCoins(row.one)})`,
  );

  if (unresolved.length) {
    itemLines.push(`-# Not found: ${unresolved.join(", ")}`);
  }

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${listEmoji ? `${listEmoji} ` : ""}Item Calculator`,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(itemLines.join("\n")))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### Total: ⏣ ${formatCoins(totalValue)}`,
      ),
    );

  await interaction.reply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}

module.exports = {
  runDankItemCalc,
};
