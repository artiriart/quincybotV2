const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { buttonHandlers } = require("../functions/interactions/button");
const { modalHandlers } = require("../functions/interactions/modal");

const ROUTE_PREFIX = "anigamerem";
const CLAIM_ROUTE_PREFIX = "cardclaims";
const ITEMS_PER_PAGE = 5;
const CARD_NAME_INPUT_ID = "card_name";
const RARITY_INPUT_ID = "rarity";

const REMINDER_TYPES = {
  fragment_shop: {
    title: "Fragment Shop",
    switchTo: "clan_shop",
    switchLabel: "Clan Shop",
  },
  clan_shop: {
    title: "Clan Shop",
    switchTo: "fragment_shop",
    switchLabel: "Fragment Shop",
  },
};

function encodePart(value) {
  return encodeURIComponent(String(value ?? ""));
}

function decodePart(value) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return "";
  }
}

function buildReminderCustomId(viewState, action, page = viewState.page, extra = "") {
  const parts = [
    ROUTE_PREFIX,
    action,
    String(viewState.userId || ""),
    encodePart(viewState.type || "fragment_shop"),
    String(Number(page || 0)),
  ];
  if (extra !== "") parts.push(String(extra));
  return parts.join(":");
}

function parseReminderCustomId(customId) {
  const [route, action, userId, typeEnc, pageRaw, extra] = String(customId || "").split(":");
  if (route !== ROUTE_PREFIX || !action || !userId) return null;
  return {
    action,
    state: {
      userId: String(userId),
      type: decodePart(typeEnc) || "fragment_shop",
      page: Math.max(0, Number(pageRaw || 0)),
    },
    extra: String(extra || ""),
  };
}

function parseEmojiValue(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const custom = text.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
  if (custom) {
    return {
      id: custom[3],
      name: custom[2],
      animated: custom[1] === "a",
    };
  }

  if (text.length <= 8) return { name: text };
  return null;
}

function applyButtonEmoji(button, emoji) {
  if (emoji) {
    button.setEmoji(emoji);
  }
  return button;
}

function getAnigameRarityEmoji(rarityValue) {
  const key = String(rarityValue || "").trim().toLowerCase();
  if (key === "common") return global.db.getFeatherEmojiMarkdown("anigame_common") || "";
  if (key === "uncommon") {
    return [
      global.db.getFeatherEmojiMarkdown("anigame_uncommon_1") || "",
      global.db.getFeatherEmojiMarkdown("anigame_uncommon_2") || "",
    ]
      .filter(Boolean)
      .join("");
  }
  if (key === "rare") return global.db.getFeatherEmojiMarkdown("anigame_rare_1") || "";
  if (key === "super_rare") {
    return [
      global.db.getFeatherEmojiMarkdown("anigame_super_rare_1") || "",
      global.db.getFeatherEmojiMarkdown("anigame_super_rare_2") || "",
    ]
      .filter(Boolean)
      .join("");
  }
  if (key === "ultra_rare") {
    return [
      global.db.getFeatherEmojiMarkdown("anigame_ultra_rare_1") || "",
      global.db.getFeatherEmojiMarkdown("anigame_ultra_rare_2") || "",
    ]
      .filter(Boolean)
      .join("");
  }
  return "";
}

function parseBaseStats(rawStats) {
  if (!rawStats) {
    return { ATK: "?", DEF: "?", HP: "?", SPD: "?" };
  }

  try {
    const parsed =
      typeof rawStats === "string" ? JSON.parse(rawStats) : rawStats || {};
    return {
      ATK: String(parsed?.ATK || "?"),
      DEF: String(parsed?.DEF || "?"),
      HP: String(parsed?.HP || "?"),
      SPD: String(parsed?.SPD || "?"),
    };
  } catch {
    return { ATK: "?", DEF: "?", HP: "?", SPD: "?" };
  }
}

function toRarityLabel(raw) {
  const value = String(raw || "").trim().toLowerCase();
  const labels = {
    common: "Common",
    uncommon: "Uncommon",
    rare: "Rare",
    super_rare: "Super Rare",
    ultra_rare: "Ultra Rare",
  };
  return labels[value] || "Ultra Rare";
}

function toRarityValue(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  const aliases = {
    sr: "super_rare",
    ur: "ultra_rare",
  };

  const normalized = aliases[value] || value;
  const valid = new Set([
    "common",
    "uncommon",
    "rare",
    "super_rare",
    "ultra_rare",
  ]);

  return valid.has(normalized) ? normalized : null;
}

function resolveCardByLooseName(query) {
  const normalized = String(query || "").trim();
  if (!normalized) return null;

  return (
    global.db.safeQuery(
      `
      SELECT name, base_stats, card_url
      FROM anigame_cards
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
      [normalized],
    )?.[0] ||
    global.db.safeQuery(
      `
      SELECT name, base_stats, card_url
      FROM anigame_cards
      WHERE LOWER(name) LIKE LOWER(?)
      ORDER BY
        CASE
          WHEN LOWER(name) LIKE LOWER(?) THEN 0
          ELSE 1
        END,
        LENGTH(name) ASC,
        name ASC
      LIMIT 1
      `,
      [`%${normalized}%`, `${normalized}%`],
    )?.[0] ||
    null
  );
}

function listReminderRows(userId, type) {
  return global.db.safeQuery(
    `
    SELECT
      r.card_name,
      r.type,
      r.rarity,
      c.base_stats,
      c.card_url
    FROM anigame_reminders r
    LEFT JOIN anigame_cards c
      ON LOWER(c.name) = LOWER(r.card_name)
    WHERE r.user_id = ? AND r.type = ?
    ORDER BY LOWER(r.card_name) ASC, COALESCE(r.rarity, '') ASC
    `,
    [userId, type],
    [],
  );
}

function normalizeReminderRowRarity(type, rarity) {
  if (type === "clan_shop") return toRarityValue(rarity) || "ultra_rare";
  return "";
}

function dedupeReminderRows(rows, type) {
  const seen = new Set();
  const uniqueRows = [];
  for (const row of rows || []) {
    const nameKey = String(row?.card_name || "").trim().toLowerCase();
    if (!nameKey) continue;
    const rarityKey = normalizeReminderRowRarity(type, row?.rarity);
    const key = type === "clan_shop" ? `${nameKey}:${rarityKey}` : nameKey;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRows.push({ ...row, rarity: rarityKey });
  }
  return uniqueRows;
}

function buildReminderPanelPayload(viewState, ephemeral = false, notice = "") {
  const fallbackThumbnailUrl = "https://cdn.discordapp.com/embed/avatars/0.png";
  const stateType = REMINDER_TYPES[viewState.type] ? viewState.type : "fragment_shop";
  const typeMeta = REMINDER_TYPES[stateType];
  const rows = dedupeReminderRows(listReminderRows(viewState.userId, stateType), stateType);

  const totalPages = Math.max(1, Math.ceil(rows.length / ITEMS_PER_PAGE));
  const page = Math.min(
    Math.max(0, Number(viewState.page || 0)),
    Math.max(0, totalPages - 1),
  );
  const paged = rows.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  const leftEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("chevron-left")) || {
    name: "◀️",
  };
  const rightEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("chevron-right")) || {
    name: "▶️",
  };
  const sepEmoji = parseEmojiValue(
    global.db.getFeatherEmojiMarkdown("more-horizontal"),
  ) || { name: "⋯" };
  const addEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("plus-circle")) || {
    name: "➕",
  };
  const copyEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("copy")) || null;
  const trashEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("trash")) || {
    name: "🗑️",
  };

  const container = new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### Manage your ${typeMeta.title} reminders`,
          ),
        )
        .setButtonAccessory(
          (button) => {
            applyButtonEmoji(
                button
                .setCustomId(
                  buildReminderCustomId(
                    {
                      ...viewState,
                      type: typeMeta.switchTo,
                      page: 0,
                    },
                    "page",
                    0,
                  ),
                )
                .setStyle(ButtonStyle.Secondary)
                .setLabel(typeMeta.switchLabel),
              copyEmoji,
            );
            return button;
          },
        ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const noticeText = String(notice || "").trim();
  if (noticeText) {
    container
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# ${noticeText}`),
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  }

  if (!paged.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# No reminders added yet."),
    );
  } else {
    for (let i = 0; i < paged.length; i += 1) {
      const row = paged[i];
      const stats = parseBaseStats(row?.base_stats);
      const rarityEmoji = stateType === "clan_shop" ? getAnigameRarityEmoji(row?.rarity) : "";
      const title =
        stateType === "clan_shop"
          ? `**${rarityEmoji ? `${rarityEmoji} ` : ""}${row?.card_name || "Unknown"}**`
          : `**${row?.card_name || "Unknown"}**`;
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${title}\n-# Atk: ${stats.ATK} | Def: ${stats.DEF} | Hp: ${stats.HP} | Spd: ${stats.SPD}`,
        ),
      );

      const cardUrl = String(row?.card_url || "").trim();
      section.setThumbnailAccessory((thumb) => {
        thumb.setURL(/^https?:\/\//i.test(cardUrl) ? cardUrl : fallbackThumbnailUrl);
        return thumb;
      });

      container.addSectionComponents(section);
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          applyButtonEmoji(
            new ButtonBuilder()
              .setCustomId(
                buildReminderCustomId(
                  viewState,
                  "remove",
                  page,
                  page * ITEMS_PER_PAGE + i,
                ),
              )
              .setStyle(ButtonStyle.Danger)
              .setLabel("Remove Reminder"),
            trashEmoji,
          ),
        ),
      );
    }
  }

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildReminderCustomId(viewState, "page", page - 1))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(leftEmoji)
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId(buildReminderCustomId(viewState, "page", page))
          .setStyle(ButtonStyle.Secondary)
          .setLabel(`${page + 1}/${totalPages}`)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(buildReminderCustomId(viewState, "page", page + 1))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(rightEmoji)
          .setDisabled(page >= totalPages - 1),
        new ButtonBuilder()
          .setCustomId(buildReminderCustomId(viewState, "sep", page))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(sepEmoji)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(buildReminderCustomId(viewState, "add", page))
          .setStyle(ButtonStyle.Primary)
          .setLabel("Add Reminder")
          .setEmoji(addEmoji),
      ),
    );

  return {
    content: "",
    components: [container],
    flags: (ephemeral ? MessageFlags.Ephemeral : 0) | MessageFlags.IsComponentsV2,
  };
}

function getClaimBotMeta(rawBot) {
  const botKey = String(rawBot || "").trim().toLowerCase();
  if (botKey === "izzi") {
    return { key: "izzi", dbName: "Izzi", switchLabel: "Anigame", switchTo: "anigame" };
  }
  return { key: "anigame", dbName: "Anigame", switchLabel: "Izzi", switchTo: "izzi" };
}

function buildClaimRecordsText(userId, botKey) {
  const meta = getClaimBotMeta(botKey);
  const rows = global.db.safeQuery(
    `
    SELECT rarity, SUM(amount) AS amount
    FROM card_stats
    WHERE user_id = ? AND bot_name = ?
    GROUP BY rarity
    ORDER BY amount DESC, rarity ASC
    `,
    [userId, meta.dbName],
    [],
  );

  if (!rows.length) {
    return "-# No claim stats tracked yet.";
  }

  return rows
    .map((row) => `* **${String(row?.rarity || "Unknown")}** - \`${Number(row?.amount || 0).toLocaleString()}\``)
    .join("\n");
}

function buildClaimMenuPayload(userId, botKey) {
  const meta = getClaimBotMeta(botKey);
  const container = new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent("### Claimed Cards"))
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`${CLAIM_ROUTE_PREFIX}:switch:${userId}:${meta.switchTo}`)
            .setStyle(ButtonStyle.Secondary)
            .setLabel(meta.switchLabel),
        ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(buildClaimRecordsText(userId, meta.key)),
    );

  return {
    content: "",
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

async function handleClaimMenuButton(interaction) {
  const [route, action, ownerId, botKey] = String(interaction.customId || "").split(":");
  if (route !== CLAIM_ROUTE_PREFIX || action !== "switch") return;

  if (!ownerId || interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "Only the command user can switch this menu.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.update(buildClaimMenuPayload(ownerId, botKey));
}

async function runReminderList(interaction) {
  const state = {
    userId: interaction.user.id,
    type: "fragment_shop",
    page: 0,
  };
  await interaction.reply(buildReminderPanelPayload(state, true));
}

async function runReminderSet(interaction) {
  const type = interaction.options.getString("type", true);
  const cardInput = interaction.options.getString("card-name", true);
  const remove = interaction.options.getBoolean("delete") === true;
  const card = resolveCardByLooseName(cardInput);

  if (!card?.name) {
    await interaction.reply({
      content: `No anigame card found for: ${cardInput}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let rarity = "";
  if (type === "clan_shop") {
    rarity = toRarityValue(interaction.options.getString("rarity")) || "ultra_rare";
  }

  if (remove) {
    global.db.safeQuery(
      `
      DELETE FROM anigame_reminders
      WHERE user_id = ?
        AND LOWER(card_name) = LOWER(?)
        AND type = ?
        AND COALESCE(rarity, '') = COALESCE(?, '')
      `,
      [interaction.user.id, card.name, type, rarity],
    );

    await interaction.reply({
      content: `Removed reminder: **${card.name}**${type === "clan_shop" ? ` (${toRarityLabel(rarity)})` : ""}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  global.db.safeQuery(
    `
    INSERT INTO anigame_reminders (user_id, card_name, type, rarity)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, card_name, type, rarity) DO NOTHING
    `,
    [interaction.user.id, card.name, type, rarity],
  );

  await interaction.reply({
    content: `Added reminder: **${card.name}**${type === "clan_shop" ? ` (${toRarityLabel(rarity)})` : ""}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleReminderButton(interaction) {
  const parsed = parseReminderCustomId(interaction.customId);
  if (!parsed) return;
  const { action, state, extra } = parsed;
  if (state.userId !== interaction.user.id) {
    await interaction.reply({
      content: "Only the panel owner can use these controls.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "page") {
    state.page = Math.max(0, Number(state.page || 0));
  } else if (action === "add") {
    const isClan = state.type === "clan_shop";
    const modal = new ModalBuilder()
      .setCustomId(buildReminderCustomId(state, "add_modal", state.page))
      .setTitle(isClan ? "Add Clan Shop Reminder" : "Add Fragment Shop Reminder")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(CARD_NAME_INPUT_ID)
            .setLabel("Card name (substring search)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder("ex: rimuru"),
        ),
      );

    if (isClan) {
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(RARITY_INPUT_ID)
            .setLabel("Rarity")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder("common / uncommon / rare / super rare / ultra rare"),
        ),
      );
    }

    await interaction.showModal(modal);
    return;
  } else if (action === "remove") {
    const allRows = dedupeReminderRows(listReminderRows(state.userId, state.type), state.type);
    const rowIndex = Number(extra);
    const target = Number.isInteger(rowIndex) && rowIndex >= 0 ? allRows[rowIndex] : null;
    if (!target?.card_name) {
      const payload = buildReminderPanelPayload(
        state,
        false,
        "That reminder no longer exists.",
      );
      await interaction.update(payload);
      return;
    }

    const targetRarity = normalizeReminderRowRarity(state.type, target?.rarity);
    global.db.safeQuery(
      `
      DELETE FROM anigame_reminders
      WHERE user_id = ?
        AND type = ?
        AND LOWER(card_name) = LOWER(?)
        AND COALESCE(rarity, '') = COALESCE(?, '')
      `,
      [state.userId, state.type, target.card_name, targetRarity],
    );

    state.page = Math.max(0, Number(state.page || 0));
    const payload = buildReminderPanelPayload(
      state,
      false,
      `Removed reminder: ${target.card_name}${state.type === "clan_shop" ? ` (${toRarityLabel(targetRarity)})` : ""}.`,
    );
    await interaction.update(payload);
    return;
  } else {
    return;
  }

  await interaction.update(buildReminderPanelPayload(state));
}

async function handleReminderModal(interaction) {
  const parsed = parseReminderCustomId(interaction.customId);
  if (!parsed || parsed.action !== "add_modal") return;
  const state = parsed.state;
  if (state.userId !== interaction.user.id) {
    await interaction.reply({
      content: "Only the panel owner can use these controls.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const cardQuery = interaction.fields.getTextInputValue(CARD_NAME_INPUT_ID)?.trim();
  if (!cardQuery) {
    await interaction.reply({
      content: "Card name cannot be empty.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const card = resolveCardByLooseName(cardQuery);
  if (!card?.name) {
    await interaction.reply({
      content: `No anigame card found for: ${cardQuery}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let rarity = "";
  if (state.type === "clan_shop") {
    const rawRarity = interaction.fields.getTextInputValue(RARITY_INPUT_ID) || "ultra rare";
    rarity = toRarityValue(rawRarity);

    if (!rarity) {
      await interaction.reply({
        content:
          "Invalid rarity. Use: common, uncommon, rare, super rare, or ultra rare.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  const result = global.db.safeQuery(
    `
    INSERT INTO anigame_reminders (user_id, card_name, type, rarity)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, card_name, type, rarity) DO NOTHING
    `,
    [state.userId, card.name, state.type, rarity],
    null,
  );

  const added = Number(result?.changes || 0) > 0;
  state.page = 0;
  const payload = buildReminderPanelPayload(
    state,
    true,
    added
      ? `Added reminder: ${card.name}${state.type === "clan_shop" ? ` (${toRarityLabel(rarity)})` : ""}.`
      : `Reminder already exists: ${card.name}${state.type === "clan_shop" ? ` (${toRarityLabel(rarity)})` : ""}.`,
  );
  await interaction.update(payload);
}

if (!buttonHandlers.has(ROUTE_PREFIX)) {
  buttonHandlers.set(ROUTE_PREFIX, handleReminderButton);
}

if (!buttonHandlers.has(CLAIM_ROUTE_PREFIX)) {
  buttonHandlers.set(CLAIM_ROUTE_PREFIX, handleClaimMenuButton);
}

if (!modalHandlers.has(ROUTE_PREFIX)) {
  modalHandlers.set(ROUTE_PREFIX, handleReminderModal);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setContexts("PrivateChannel", "Guild", "BotDM")
    .setName("anigame")
    .setDescription("Anigame commands")
    .addSubcommand((subcommand) =>
      subcommand.setName("claims").setDescription("Your claimed card stats"),
    )
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
  async autocomplete(interaction) {
    const subcommandGroup = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(false);
    const focused = interaction.options.getFocused(true);

    if (
      subcommandGroup !== "reminders" ||
      subcommand !== "set" ||
      focused?.name !== "card-name"
    ) {
      await interaction.respond([]);
      return;
    }

    const query = String(focused.value || "").trim();
    const rows = query
      ? global.db.safeQuery(
          `
          SELECT name
          FROM anigame_cards
          WHERE LOWER(name) LIKE LOWER(?)
          ORDER BY
            CASE
              WHEN LOWER(name) = LOWER(?) THEN 0
              WHEN LOWER(name) LIKE LOWER(?) THEN 1
              ELSE 2
            END,
            LENGTH(name) ASC,
            name ASC
          LIMIT 25
          `,
          [`%${query}%`, query, `${query}%`],
        )
      : global.db.safeQuery(
          `
          SELECT name
          FROM anigame_cards
          ORDER BY name ASC
          LIMIT 25
          `,
        );

    await interaction.respond(
      rows.map((row) => {
        const name = String(row?.name || "Unknown").slice(0, 100);
        return { name, value: name };
      }),
    );
  },
  async execute(interaction) {
    if (!interaction?.isChatInputCommand?.()) return;

    const subcommandGroup = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(false);

    if (!subcommandGroup && subcommand === "claims") {
      await interaction.reply(buildClaimMenuPayload(interaction.user.id, "anigame"));
      return;
    }

    if (subcommandGroup === "reminders" && subcommand === "list") {
      await runReminderList(interaction);
      return;
    }

    if (subcommandGroup === "reminders" && subcommand === "set") {
      await runReminderSet(interaction);
      return;
    }

    await interaction.reply({
      content: "This anigame subcommand is not implemented yet.",
      flags: MessageFlags.Ephemeral,
    });
  },
};
