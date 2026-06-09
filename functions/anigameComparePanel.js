const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require("discord.js");
const { buttonHandlers } = require("./interactions/button");
const { getAnigameShopCardLabel } = require("../utils/anigameShopMarks");

const ROUTE_PREFIX = "anigamecmp";
const ITEMS_PER_PAGE = 5;

function parseEmojiValue(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const custom = text.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
  if (custom) return { id: custom[3], name: custom[2], animated: custom[1] === "a" };
  if (text.length <= 8) return { name: text };
  return null;
}

function buildCompareCustomId(element, ability, page) {
  return `${ROUTE_PREFIX}:${encodeURIComponent(element)}:${encodeURIComponent(ability)}:${page}`;
}

function parseCompareCustomId(customId) {
  const parts = customId.split(":");
  if (parts[0] !== ROUTE_PREFIX || parts.length < 4) return null;
  return {
    element: decodeURIComponent(parts[1]),
    ability: decodeURIComponent(parts[2]),
    page: parseInt(parts[3], 10),
  };
}

function parseBaseStats(rawStats) {
  if (!rawStats) return { ATK: 0, DEF: 0, HP: 0, SPD: 0 };
  try {
    const parsed = typeof rawStats === "string" ? JSON.parse(rawStats) : rawStats;
    return {
      ATK: Number(parsed?.ATK) || 0,
      DEF: Number(parsed?.DEF) || 0,
      HP: Number(parsed?.HP) || 0,
      SPD: Number(parsed?.SPD) || 0,
    };
  } catch {
    return { ATK: 0, DEF: 0, HP: 0, SPD: 0 };
  }
}

function buildComparePanelPayload(element, ability, page = 0, ephemeral = false) {
  const rows = global.db.safeQuery(
    `
    SELECT c.name, c.series, c.base_stats, c.card_url, p.market_average as sr_price, p2.market_average as ur_price
    FROM anigame_cards c
    LEFT JOIN anigame_market_prices p ON LOWER(p.name) = LOWER(c.name) AND p.rarity = 'super_rare'
    LEFT JOIN anigame_market_prices p2 ON LOWER(p2.name) = LOWER(c.name) AND p2.rarity = 'ultra_rare'
    WHERE LOWER(c.element) = LOWER(?) AND c.talent LIKE '%' || ? || '%'
    `,
    [element, ability],
    []
  );

  const cards = rows.map(row => {
    const stats = parseBaseStats(row.base_stats);
    const total = stats.ATK + stats.DEF + stats.HP + stats.SPD;
    return { ...row, stats, total };
  });

  cards.sort((a, b) => b.total - a.total);

  let maxATK = -1, maxDEF = -1, maxHP = -1, maxSPD = -1;
  for (const c of cards) {
    if (c.stats.ATK > maxATK) maxATK = c.stats.ATK;
    if (c.stats.DEF > maxDEF) maxDEF = c.stats.DEF;
    if (c.stats.HP > maxHP) maxHP = c.stats.HP;
    if (c.stats.SPD > maxSPD) maxSPD = c.stats.SPD;
  }

  const totalPages = Math.max(1, Math.ceil(cards.length / ITEMS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const paged = cards.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE);

  const trashEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("trash")) || { name: "🗑️" };

  const container = new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Anigame Comparision`))
        .setButtonAccessory(new ButtonBuilder().setCustomId("utility:delete:null").setStyle(ButtonStyle.Danger).setEmoji(trashEmoji))
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  if (paged.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`No cards found for Element: **${element}** and Ability: **${ability}**.`)
    );
  } else {
    for (const c of paged) {
      const atkStr = `ATK: \`${c.stats.ATK}\`${c.stats.ATK === maxATK && maxATK > 0 ? " 🌟" : ""}`;
      const defStr = `DEF: \`${c.stats.DEF}\`${c.stats.DEF === maxDEF && maxDEF > 0 ? " 🌟" : ""}`;
      const hpStr = `HP: \`${c.stats.HP}\`${c.stats.HP === maxHP && maxHP > 0 ? " 🌟" : ""}`;
      const spdStr = `SPD: \`${c.stats.SPD}\`${c.stats.SPD === maxSPD && maxSPD > 0 ? " 🌟" : ""}`;
      
      const fallbackThumb = "https://cdn.discordapp.com/embed/avatars/0.png";
      const thumbUrl = /^https?:\/\//i.test(c.card_url) ? c.card_url : fallbackThumb;
      const markerLabel = getAnigameShopCardLabel(c);
      const nameLine = `**${c.name}**${markerLabel ? ` [${markerLabel}]` : ""}`;
      
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${nameLine}\n${atkStr} | ${defStr} | ${hpStr} | ${spdStr}\n**Total Stats: ${c.total}**\n**Market**: SR: ${c.sr_price || "N/A"} | UR: ${c.ur_price || "N/A"}`
        )
      ).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbUrl));

      container.addSectionComponents(section);
    }
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  if (totalPages > 1) {
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(buildCompareCustomId(element, ability, safePage - 1))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("◀️")
        .setDisabled(safePage <= 0),
      new ButtonBuilder()
        .setCustomId(`anigamecmp_page`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(`${safePage + 1}/${totalPages}`)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(buildCompareCustomId(element, ability, safePage + 1))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("▶️")
        .setDisabled(safePage >= totalPages - 1)
    );
    container.addActionRowComponents(actionRow);
  }

  return {
    content: "",
    components: [container],
    flags: (ephemeral ? MessageFlags.Ephemeral : 0) | MessageFlags.IsComponentsV2,
  };
}

async function handleCompareButton(interaction) {
  const parsed = parseCompareCustomId(interaction.customId);
  if (!parsed) return;

  if (interaction.user.id !== interaction.message.interaction?.user?.id) {
    // Only author can interact? Optional, maybe we don't care since we don't store user ID.
  }

  await interaction.update(buildComparePanelPayload(parsed.element, parsed.ability, parsed.page));
}

if (!buttonHandlers.has(ROUTE_PREFIX)) {
  buttonHandlers.set(ROUTE_PREFIX, handleCompareButton);
}

module.exports = {
  buildComparePanelPayload,
};
