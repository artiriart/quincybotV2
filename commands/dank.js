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
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { buttonHandlers } = require("../functions/interactions/button");
const { selectMenuHandlers } = require("../functions/interactions/selectMenu");
const { modalHandlers } = require("../functions/interactions/modal");

const VIEW_STATE_TYPE = "dank_stats_view";
const ROUTE_PREFIX = "dankstats";
const ITEMS_PER_PAGE = 8;
const DELETE_QUERY_INPUT_ID = "delete_query";

function createViewToken(userId) {
  const rand = Math.random().toString(36).slice(2, 7);
  return `${userId.slice(-6)}${Date.now().toString(36)}${rand}`.slice(0, 40);
}

function saveViewState(token, state) {
  global.db.upsertState(VIEW_STATE_TYPE, JSON.stringify(state), token, false);
}

function loadViewState(token) {
  const raw = global.db.getState(VIEW_STATE_TYPE, token);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

  if (text.length <= 8) {
    return { name: text };
  }

  return null;
}

function formatEmojiForHeadline(raw) {
  const parsed = parseEmojiValue(raw);
  if (!parsed) return "";
  if (parsed.id && parsed.name) {
    return `<${parsed.animated ? "a" : ""}:${parsed.name}:${parsed.id}>`;
  }
  return parsed.name || "";
}

function parseDeleteScope(scopeValue) {
  const parts = String(scopeValue || "").split("|");
  if (parts[0] === "main" && parts[1]) {
    return { type: "main", main: parts[1], sub: null };
  }
  if (parts[0] === "sub" && parts[1] && parts[2]) {
    return { type: "sub", main: parts[1], sub: parts[2] };
  }
  return null;
}

function buildDeleteScopeOptions(main, sub, hasSubcategory) {
  const options = [];
  options.push({
    label: `All ${main}`.slice(0, 100),
    value: `main|${main}`.slice(0, 100),
    default: sub === "__all__" || !hasSubcategory,
    description: `Delete all ${main} records`.slice(0, 100),
  });

  if (hasSubcategory && sub !== "__all__") {
    options.unshift({
      label: `${main} / ${sub}`.slice(0, 100),
      value: `sub|${main}|${sub}`.slice(0, 100),
      default: true,
      description: `Delete only ${sub} records`.slice(0, 100),
    });
  }

  return options;
}

function buildScopeFilterSql(scope) {
  if (scope?.type === "main") {
    return {
      where: "(stat_type = ? OR stat_type LIKE ?)",
      params: [scope.main, `${scope.main}_%`],
    };
  }
  if (scope?.type === "sub") {
    return {
      where: "stat_type = ?",
      params: [`${scope.main}_${scope.sub}`],
    };
  }
  return {
    where: "1 = 0",
    params: [],
  };
}

function findDankItemByLooseName(query) {
  const raw = String(query || "").trim();
  if (!raw) return null;
  const compact = raw.toLowerCase().replace(/\s+/g, "");

  return (
    global.db.safeQuery(
      `
      SELECT name
      FROM dank_items
      WHERE REPLACE(LOWER(name), ' ', '') = ?
      LIMIT 1
      `,
      [compact],
    )?.[0] ||
    global.db.safeQuery(
      `
      SELECT name
      FROM dank_items
      WHERE REPLACE(LOWER(name), ' ', '') LIKE ?
      ORDER BY
        CASE
          WHEN REPLACE(LOWER(name), ' ', '') LIKE ? THEN 0
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

function getOptionMeta(scope, value) {
  const row =
    global.db.safeQuery(
      `
      SELECT item_name, description
      FROM dank_stats_option_meta
      WHERE scope = ? AND option_value = ?
      LIMIT 1
      `,
      [scope, value],
    )?.[0] || null;
  if (!row?.item_name) {
    return {
      item_name: null,
      item_emoji: null,
      item_display_name: null,
      description: row?.description || null,
    };
  }

  const item = global.db.safeQuery(
    `
    SELECT name, application_emoji
    FROM dank_items
    WHERE LOWER(name) = LOWER(?)
    LIMIT 1
    `,
    [row.item_name],
  )?.[0];

  return {
    item_name: row.item_name,
    item_emoji: item?.application_emoji || null,
    item_display_name: item?.name || row.item_name,
    description: row?.description || null,
  };
}

function normalizeStatType(statType) {
  const text = String(statType || "").trim();
  if (!text) return { main: "Other", sub: "General" };

  const splitAt = text.indexOf("_");
  if (splitAt === -1) {
    return { main: text, sub: "General" };
  }

  return {
    main: text.slice(0, splitAt).trim() || "Other",
    sub: text.slice(splitAt + 1).trim() || "General",
  };
}

function buildStatsTree(rows) {
  const tree = new Map();
  for (const row of rows) {
    const amount = Number(row?.item_amount || 0);
    if (!Number.isFinite(amount) || amount === 0) continue;

    const { main, sub } = normalizeStatType(row?.stat_type);
    if (!tree.has(main)) tree.set(main, new Map());
    const subMap = tree.get(main);
    if (!subMap.has(sub)) subMap.set(sub, new Map());

    const itemMap = subMap.get(sub);
    const itemName = String(row?.item_name || "Unknown");
    itemMap.set(itemName, (itemMap.get(itemName) || 0) + amount);
  }
  return tree;
}

function listMainCategories(tree) {
  return [...tree.keys()].sort((a, b) => a.localeCompare(b));
}

function listSubCategories(tree, main) {
  const subs = tree.get(main);
  if (!subs) return [];
  return [...subs.keys()].sort((a, b) => a.localeCompare(b));
}

function hasMeaningfulSubcategories(subCategories) {
  if (!subCategories.length) return false;
  if (subCategories.length === 1 && subCategories[0] === "General") return false;
  return true;
}

function flattenItems(tree, main, sub) {
  const subMap = tree.get(main);
  if (!subMap) return [];

  const merged = new Map();
  if (sub === "__all__") {
    for (const itemMap of subMap.values()) {
      for (const [name, amount] of itemMap.entries()) {
        merged.set(name, (merged.get(name) || 0) + amount);
      }
    }
  } else {
    for (const [name, amount] of subMap.get(sub)?.entries() || []) {
      merged.set(name, amount);
    }
  }

  return [...merged.entries()].map(([name, amount]) => ({ name, amount }));
}

function getItemMetaMap(items) {
  const map = new Map();
  for (const item of items) {
    if (item.name === "DMC") {
      map.set(item.name, { value: 1, emoji: null });
      continue;
    }

    const row = global.db.safeQuery(
      `
      SELECT market, application_emoji
      FROM dank_items
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
      [item.name],
    )?.[0];

    map.set(item.name, {
      value: Number(row?.market || 0),
      emoji: row?.application_emoji || null,
    });
  }
  return map;
}

function buildStatsLines(items, itemMetaMap, cornerEmoji) {
  const normalized = [];
  let total = 0;

  for (const item of items) {
    const meta = itemMetaMap.get(item.name) || { value: 0, emoji: null };
    const unit = Number.isFinite(meta.value) ? meta.value : 0;
    const lineValue = item.name === "DMC" ? item.amount : item.amount * unit;
    total += lineValue;

    normalized.push({
      ...item,
      emoji: meta.emoji,
      lineValue,
    });
  }

  normalized.sort((a, b) => b.lineValue - a.lineValue || a.name.localeCompare(b.name));

  const lines = normalized.map((entry) => {
    const itemLine = `${entry.amount.toLocaleString()} ${entry.emoji ? `${entry.emoji} ` : ""}**${entry.name}**`;
    const valueLine = `-# ${cornerEmoji} ⏣ ${Math.max(0, entry.lineValue).toLocaleString()}`;
    return `${itemLine}\n${valueLine}`;
  });

  return { lines, total };
}

function buildMainOptions(mainCategories, selectedMain) {
  return mainCategories.slice(0, 25).map((main) => {
    const meta = getOptionMeta("main", main);
    const option = {
      label: main.slice(0, 100),
      value: main,
      default: main === selectedMain,
      description: (meta?.description || `View ${main} stats`).slice(0, 100),
    };

    const emoji = parseEmojiValue(meta?.item_emoji);
    if (emoji) option.emoji = emoji;

    return option;
  });
}

function buildSubOptions(main, subCategories, selectedSub) {
  const allValue = "__all__";
  const allMeta = getOptionMeta(`sub:${main}`, allValue);
  const allEmoji = parseEmojiValue(allMeta?.item_emoji);
  const options = [
    {
      label: `All ${main}`.slice(0, 100),
      value: allValue,
      default: selectedSub === allValue,
      description: (allMeta?.description || `Show total for all ${main}`).slice(0, 100),
      ...(allEmoji ? { emoji: allEmoji } : {}),
    },
  ];

  for (const sub of subCategories.slice(0, 24)) {
    const meta = getOptionMeta(`sub:${main}`, sub);
    const option = {
      label: sub.slice(0, 100),
      value: sub,
      default: sub === selectedSub,
      description: (meta?.description || `View ${sub}`).slice(0, 100),
    };

    const emoji = parseEmojiValue(meta?.item_emoji);
    if (emoji) option.emoji = emoji;

    options.push(option);
  }

  return options;
}

function buildDankStatsPayload(viewState) {
  const rows = global.db.safeQuery(
    `
    SELECT item_name, item_amount, stat_type
    FROM dank_stats
    WHERE user_id = ?
    `,
    [viewState.userId],
  );

  const tree = buildStatsTree(rows);
  const mainCategories = listMainCategories(tree);
  if (!mainCategories.length) {
    return {
      content: "No dank stats found yet.",
      flags: MessageFlags.Ephemeral,
    };
  }

  const safeMain = mainCategories.includes(viewState.main)
    ? viewState.main
    : mainCategories[0];
  const subCategories = listSubCategories(tree, safeMain);
  const showSubcategorySelect = hasMeaningfulSubcategories(subCategories);
  const safeSub = showSubcategorySelect &&
      (viewState.sub === "__all__" || subCategories.includes(viewState.sub))
    ? viewState.sub
    : "__all__";
  const currentDeleteScope =
    parseDeleteScope(viewState.deleteScope) ||
    parseDeleteScope(
      showSubcategorySelect && safeSub !== "__all__"
        ? `sub|${safeMain}|${safeSub}`
        : `main|${safeMain}`,
    );
  const mainMeta = getOptionMeta("main", safeMain);
  const subMeta = showSubcategorySelect
    ? getOptionMeta(`sub:${safeMain}`, safeSub)
    : null;
  const mainEmoji = formatEmojiForHeadline(mainMeta?.item_emoji);
  const subEmoji = formatEmojiForHeadline(subMeta?.item_emoji);
  const mainLabel = `${mainEmoji ? `${mainEmoji} ` : ""}${safeMain}`;
  const subLabel = `${subEmoji ? `${subEmoji} ` : ""}${safeSub === "__all__" ? `All ${safeMain}` : safeSub}`;

  const items = flattenItems(tree, safeMain, safeSub);
  const itemMetaMap = getItemMetaMap(items);
  const corner = global.db.getFeatherEmojiMarkdown("corner-down-right") || "↳";

  const { lines, total } = buildStatsLines(items, itemMetaMap, corner);

  const totalPages = Math.max(1, Math.ceil(lines.length / ITEMS_PER_PAGE));
  const page = Math.min(Math.max(0, Number(viewState.page || 0)), totalPages - 1);
  const pagedLines = lines.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  const leftEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("chevron-left")) || {
    name: "◀️",
  };
  const rightEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("chevron-right")) || {
    name: "▶️",
  };

  const contentLines = pagedLines.length ? pagedLines.join("\n") : "-# No tracked items";

  const container1 = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${mainLabel} - ${subLabel}`,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(contentLines))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### Total: ⏣ ${Math.max(0, total).toLocaleString()}`),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${ROUTE_PREFIX}:prev:${viewState.token}`)
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(leftEmoji)
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId(`${ROUTE_PREFIX}:page:${viewState.token}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel(`${page + 1}/${totalPages}`)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`${ROUTE_PREFIX}:next:${viewState.token}`)
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(rightEmoji)
          .setDisabled(page >= totalPages - 1),
        new ButtonBuilder()
          .setCustomId(`${ROUTE_PREFIX}:sep:${viewState.token}`)
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(
            parseEmojiValue(global.db.getFeatherEmojiMarkdown("more-horizontal")) || {
              name: "⋯",
            },
          )
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`${ROUTE_PREFIX}:delete:${viewState.token}`)
          .setStyle(ButtonStyle.Danger)
          .setLabel("Delete Data")
          .setEmoji(
            parseEmojiValue(global.db.getFeatherEmojiMarkdown("trash")) || {
              name: "🗑️",
            },
          ),
      ),
    );

  const container2 = new ContainerBuilder();
  if (showSubcategorySelect) {
    container2
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("### Select Subcategory"),
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ROUTE_PREFIX}:sub:${viewState.token}`)
            .setPlaceholder("Select Subcategory")
            .addOptions(buildSubOptions(safeMain, subCategories, safeSub)),
        ),
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  }

  container2
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Select Main Category"),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ROUTE_PREFIX}:main:${viewState.token}`)
          .setPlaceholder("Select Main Category")
          .addOptions(buildMainOptions(mainCategories, safeMain)),
      ),
    );

  if (viewState.showDeleteUI) {
    container2
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("### Delete Scope"),
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ROUTE_PREFIX}:del_scope:${viewState.token}`)
            .setPlaceholder("Select what to delete")
            .addOptions(
              buildDeleteScopeOptions(
                safeMain,
                safeSub,
                showSubcategorySelect,
              ).map((opt) => ({
                ...opt,
                default:
                  currentDeleteScope &&
                  opt.value ===
                    (currentDeleteScope.type === "sub"
                      ? `sub|${currentDeleteScope.main}|${currentDeleteScope.sub}`
                      : `main|${currentDeleteScope.main}`),
              })),
            ),
        ),
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${ROUTE_PREFIX}:del_input:${viewState.token}`)
            .setLabel("Delete Data")
            .setStyle(ButtonStyle.Danger)
            .setEmoji(
              parseEmojiValue(global.db.getFeatherEmojiMarkdown("trash")) || {
                name: "🗑️",
              },
            ),
        ),
      );
  }

  return {
    content: "",
    components: [container1, container2],
    flags: MessageFlags.IsComponentsV2,
    state: {
      ...viewState,
      main: safeMain,
      sub: safeSub,
      page,
      deleteScope:
        currentDeleteScope &&
        (currentDeleteScope.type === "sub"
          ? `sub|${currentDeleteScope.main}|${currentDeleteScope.sub}`
          : `main|${currentDeleteScope.main}`),
    },
  };
}

async function runDank(interaction) {
  if (!interaction?.isChatInputCommand?.()) return;

  const subcommand = interaction.options.getSubcommand(false);
  if (subcommand !== "stats") {
    await interaction.reply({
      content: "This dank subcommand is not implemented yet.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const token = createViewToken(interaction.user.id);
  const initialState = {
    token,
    userId: interaction.user.id,
    main: "Adventure",
    sub: "__all__",
    page: 0,
  };
  saveViewState(token, initialState);

  const payload = buildDankStatsPayload(initialState);
  if (payload?.state) {
    saveViewState(token, payload.state);
    delete payload.state;
  }

  await interaction.reply(payload);
}

async function handleDankStatsButton(interaction) {
  const customId = String(interaction.customId || "");
  const [, action, token] = customId.split(":");
  if (!token) return;

  const state = loadViewState(token);
  if (!state || state.userId !== interaction.user.id) {
    await interaction.reply({
      content: "This stats panel expired. Run `/dank stats` again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "prev") {
    state.page = Math.max(0, Number(state.page || 0) - 1);
  } else if (action === "next") {
    state.page = Number(state.page || 0) + 1;
  } else if (action === "delete") {
    state.showDeleteUI = true;
    state.page = 0;
  } else if (action === "del_input") {
    const modal = new ModalBuilder()
      .setCustomId(`${ROUTE_PREFIX}:del_modal:${token}`)
      .setTitle("Delete Dank Stats Data")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(DELETE_QUERY_INPUT_ID)
            .setLabel('Type "all" or comma-separated item names')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder("all OR black hole, meteorite"),
        ),
      );

    await interaction.showModal(modal);
    return;
  } else {
    return;
  }

  const payload = buildDankStatsPayload(state);
  if (payload?.state) {
    saveViewState(token, payload.state);
    delete payload.state;
  }

  await interaction.update(payload);
}

async function handleDankStatsSelect(interaction) {
  const customId = String(interaction.customId || "");
  const [, action, token] = customId.split(":");
  if (!token) return;

  const state = loadViewState(token);
  if (!state || state.userId !== interaction.user.id) {
    await interaction.reply({
      content: "This stats panel expired. Run `/dank stats` again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selected = interaction.values?.[0];
  if (!selected) return;

  if (action === "main") {
    state.main = selected;
    state.sub = "__all__";
    state.page = 0;
  } else if (action === "sub") {
    state.sub = selected;
    state.page = 0;
  } else if (action === "del_scope") {
    state.deleteScope = selected;
    state.showDeleteUI = true;
  } else {
    return;
  }

  const payload = buildDankStatsPayload(state);
  if (payload?.state) {
    saveViewState(token, payload.state);
    delete payload.state;
  }

  await interaction.update(payload);
}

async function handleDankStatsModal(interaction) {
  const customId = String(interaction.customId || "");
  const [, action, token] = customId.split(":");
  if (action !== "del_modal" || !token) return;

  const state = loadViewState(token);
  if (!state || state.userId !== interaction.user.id) {
    await interaction.reply({
      content: "This stats panel expired. Run `/dank stats` again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const scope = parseDeleteScope(state.deleteScope);
  if (!scope) {
    await interaction.reply({
      content: "No delete scope selected. Open delete menu first.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const query = interaction.fields.getTextInputValue(DELETE_QUERY_INPUT_ID).trim();
  if (!query) {
    await interaction.reply({
      content: "Delete query cannot be empty.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const filter = buildScopeFilterSql(scope);
  const lowered = query.toLowerCase();

  if (lowered === "all") {
    global.db.safeQuery(
      `DELETE FROM dank_stats WHERE user_id = ? AND ${filter.where}`,
      [state.userId, ...filter.params],
    );
  } else {
    const parts = query
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const matched = [];
    for (const part of parts) {
      const item = findDankItemByLooseName(part);
      if (item?.name) matched.push(item.name);
    }

    const unique = [...new Set(matched)];
    if (!unique.length) {
      await interaction.reply({
        content: "No matching dank item names found for deletion.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const placeholders = unique.map(() => "?").join(", ");
    global.db.safeQuery(
      `DELETE FROM dank_stats WHERE user_id = ? AND ${filter.where} AND LOWER(item_name) IN (${placeholders})`,
      [state.userId, ...filter.params, ...unique.map((name) => name.toLowerCase())],
    );
  }

  state.showDeleteUI = false;
  const payload = buildDankStatsPayload(state);
  if (payload?.state) {
    saveViewState(token, payload.state);
    delete payload.state;
  }

  await interaction.reply(payload);
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
            .setDescription("Calculate Omega / Prestige requirements"),
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

if (!buttonHandlers.has(ROUTE_PREFIX)) {
  buttonHandlers.set(ROUTE_PREFIX, handleDankStatsButton);
}

if (!selectMenuHandlers.has(ROUTE_PREFIX)) {
  selectMenuHandlers.set(ROUTE_PREFIX, handleDankStatsSelect);
}

if (!modalHandlers.has(ROUTE_PREFIX)) {
  modalHandlers.set(ROUTE_PREFIX, handleDankStatsModal);
}
