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
const { modalHandlers } = require("../functions/interactions/modal");
const { selectMenuHandlers } = require("../functions/interactions/selectMenu");

const CUSTOM_ID_PREFIX = "dev";

// 7w7 items editor
const EDIT_ITEM_BUTTON_ID = `${CUSTOM_ID_PREFIX}:7w7items:open_item_lookup`;
const ITEM_LOOKUP_MODAL_ID = `${CUSTOM_ID_PREFIX}:7w7items:lookup_modal`;
const ITEM_LOOKUP_INPUT_ID = "item_lookup_query";
const CHANGE_DESC_BUTTON_PREFIX = `${CUSTOM_ID_PREFIX}:7w7items:change_desc`;
const CHANGE_DESC_MODAL_PREFIX = `${CUSTOM_ID_PREFIX}:7w7items:change_desc_modal`;
const CHANGE_DESC_INPUT_ID = "new_description";

// Dank options editor
const DEV_DANK_VIEW_STATE_TYPE = "dev_dank_option_view";
const DANK_OPTION_EDIT_EMOJI_BUTTON_PREFIX = `${CUSTOM_ID_PREFIX}:dankoptions:edit_emoji`;
const DANK_OPTION_EDIT_DESCRIPTION_BUTTON_PREFIX = `${CUSTOM_ID_PREFIX}:dankoptions:edit_description`;
const DANK_OPTION_MAIN_SELECT_PREFIX = `${CUSTOM_ID_PREFIX}:dankoptions:main`;
const DANK_OPTION_SUB_SELECT_PREFIX = `${CUSTOM_ID_PREFIX}:dankoptions:sub`;
const DANK_OPTION_EDIT_EMOJI_MODAL_PREFIX = `${CUSTOM_ID_PREFIX}:dankoptions:edit_emoji_modal`;
const DANK_OPTION_EDIT_DESCRIPTION_MODAL_PREFIX = `${CUSTOM_ID_PREFIX}:dankoptions:edit_description_modal`;
const DANK_OPTION_ITEM_INPUT_ID = "option_item_name";
const DANK_OPTION_DESCRIPTION_INPUT_ID = "option_description";

// Dank multipliers editor
const DEV_DANK_MULTIPLIER_VIEW_STATE_TYPE = "dev_dank_multiplier_view";
const DANK_MULTIPLIER_TYPE_SELECT_PREFIX = `${CUSTOM_ID_PREFIX}:dankmultis:type`;
const DANK_MULTIPLIER_NAME_SELECT_PREFIX = `${CUSTOM_ID_PREFIX}:dankmultis:name`;
const DANK_MULTIPLIER_EDIT_EMOJI_BUTTON_PREFIX = `${CUSTOM_ID_PREFIX}:dankmultis:edit_emoji`;
const DANK_MULTIPLIER_EDIT_DESCRIPTION_BUTTON_PREFIX = `${CUSTOM_ID_PREFIX}:dankmultis:edit_description`;
const DANK_MULTIPLIER_EDIT_EMOJI_MODAL_PREFIX = `${CUSTOM_ID_PREFIX}:dankmultis:edit_emoji_modal`;
const DANK_MULTIPLIER_EDIT_DESCRIPTION_MODAL_PREFIX = `${CUSTOM_ID_PREFIX}:dankmultis:edit_description_modal`;
const DANK_MULTIPLIER_EMOJI_INPUT_ID = "multi_emoji";
const DANK_MULTIPLIER_DESCRIPTION_INPUT_ID = "multi_description";
const KARUTA_RECOG_STATE_TYPE = "karuta_recognition_settings";

function isDevAllowed(userId) {
  const owners = Array.isArray(global.ownerIds) ? global.ownerIds : [];
  if (!owners.length) return true;
  return owners.includes(userId);
}

function createViewToken(userId) {
  const rand = Math.random().toString(36).slice(2, 7);
  return `${userId.slice(-6)}${Date.now().toString(36)}${rand}`.slice(0, 40);
}

function saveDankOptionView(token, state) {
  global.db.upsertState(DEV_DANK_VIEW_STATE_TYPE, JSON.stringify(state), token, false);
}

function loadDankOptionView(token) {
  const raw = global.db.getState(DEV_DANK_VIEW_STATE_TYPE, token);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveDankMultiplierView(token, state) {
  global.db.upsertState(
    DEV_DANK_MULTIPLIER_VIEW_STATE_TYPE,
    JSON.stringify(state),
    token,
    false,
  );
}

function loadDankMultiplierView(token) {
  const raw = global.db.getState(DEV_DANK_MULTIPLIER_VIEW_STATE_TYPE, token);
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

  if (text.length <= 8) return { name: text };
  return null;
}

function resolveNamedEmojiMarkdown(rawInput) {
  const text = String(rawInput || "").trim();
  if (!text) return null;

  // Keep valid emoji input as-is.
  if (parseEmojiValue(text)) return text;

  const normalized = text
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+|_+$/g, "");

  if (!normalized) return null;

  const candidates = [...new Set([normalized, `dank_${normalized}`])];
  for (const candidate of candidates) {
    const row = global.db.safeQuery(
      `
      SELECT markdown
      FROM feather_emojis
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
      [candidate],
    )?.[0];
    if (row?.markdown) {
      return String(row.markdown).trim();
    }
  }

  return null;
}

function getDankOptionMeta(scope, optionValue) {
  const row =
    global.db.safeQuery(
      `
      SELECT scope, option_value, item_name, description
      FROM dank_stats_option_meta
      WHERE scope = ? AND option_value = ?
      LIMIT 1
      `,
      [scope, optionValue],
    )?.[0] || {
      scope,
      option_value: optionValue,
      item_name: null,
      description: null,
    };

  const item = row.item_name
    ? global.db.safeQuery(
        `
        SELECT name, application_emoji
        FROM dank_items
        WHERE LOWER(name) = LOWER(?)
        LIMIT 1
        `,
        [row.item_name],
      )?.[0]
    : null;

  return {
    ...row,
    item_name: item?.name || row.item_name || null,
    item_emoji: item?.application_emoji || null,
  };
}

function normalizeStatType(statType) {
  const text = String(statType || "").trim();
  if (!text) return { main: "Other", sub: "General" };

  const splitAt = text.indexOf("_");
  if (splitAt === -1) return { main: text, sub: "General" };

  return {
    main: text.slice(0, splitAt).trim() || "Other",
    sub: text.slice(splitAt + 1).trim() || "General",
  };
}

function buildDankOptionTree() {
  const rows = global.db.safeQuery(`SELECT DISTINCT stat_type FROM dank_stats`);
  const tree = new Map();

  for (const row of rows) {
    const { main, sub } = normalizeStatType(row?.stat_type);
    if (!tree.has(main)) tree.set(main, new Set());
    tree.get(main).add(sub);
  }

  return tree;
}

function listMainOptions(tree) {
  return [...tree.keys()].sort((a, b) => a.localeCompare(b));
}

function listSubOptions(tree, main) {
  return [...(tree.get(main) || [])].sort((a, b) => a.localeCompare(b));
}

function hasMeaningfulSubcategories(subCategories) {
  if (!subCategories.length) return false;
  if (subCategories.length === 1 && subCategories[0] === "General") return false;
  return true;
}

function findDankItemByLooseName(query) {
  const raw = String(query || "").trim();
  if (!raw) return null;
  const compact = raw.toLowerCase().replace(/\s+/g, "");

  return (
    global.db.safeQuery(
      `
      SELECT name, application_emoji
      FROM dank_items
      WHERE REPLACE(LOWER(name), ' ', '') = ?
      LIMIT 1
      `,
      [compact],
    )?.[0] ||
    global.db.safeQuery(
      `
      SELECT name, application_emoji
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

function resolveCurrentDankOptionSelection(state) {
  const tree = buildDankOptionTree();
  const mains = listMainOptions(tree);
  const safeMain = mains.includes(state.main) ? state.main : mains[0];
  const subCategories = listSubOptions(tree, safeMain);
  const showSubcategory = hasMeaningfulSubcategories(subCategories);
  const safeSub =
    showSubcategory && (state.sub === "__all__" || subCategories.includes(state.sub))
      ? state.sub
      : "__all__";

  return {
    scope: showSubcategory ? `sub:${safeMain}` : "main",
    optionValue: showSubcategory ? safeSub : safeMain,
  };
}

function build7w7ItemEditorPanel(selectedItem = null) {
  const container = new ContainerBuilder().addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("## Edit 7w7 Item DB"),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(EDIT_ITEM_BUTTON_ID)
          .setLabel("Edit Item")
          .setStyle(ButtonStyle.Primary),
      ),
  );

  if (selectedItem) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`### Selected: ${selectedItem.name}`),
          )
          .setButtonAccessory(
            new ButtonBuilder()
              .setCustomId(`${CHANGE_DESC_BUTTON_PREFIX}:${selectedItem.id}`)
              .setLabel("Change Description")
              .setStyle(ButtonStyle.Secondary),
          ),
      );
  }

  return {
    content: "",
    components: [container],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  };
}

function find7w7ItemByLookup(query) {
  const normalized = String(query || "").trim();
  if (!normalized) return null;

  if (/^\d+$/.test(normalized)) {
    const byId = global.db.safeQuery(
      `
      SELECT id, name, description
      FROM sws_items
      WHERE id = ?
      LIMIT 1
      `,
      [Number.parseInt(normalized, 10)],
    )?.[0];

    if (byId) return byId;
  }

  const byName =
    global.db.safeQuery(
      `
      SELECT id, name, description
      FROM sws_items
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
      [normalized],
    )?.[0] ||
    global.db.safeQuery(
      `
      SELECT id, name, description
      FROM sws_items
      WHERE LOWER(name) LIKE LOWER(?)
      ORDER BY
        CASE
          WHEN LOWER(name) LIKE LOWER(?) THEN 0
          ELSE 1
        END,
        name ASC
      LIMIT 1
      `,
      [`%${normalized}%`, `${normalized}%`],
    )?.[0];

  return byName || null;
}

function get7w7ItemById(id) {
  const itemId = Number.parseInt(String(id || ""), 10);
  if (!Number.isFinite(itemId)) return null;

  return (
    global.db.safeQuery(
      `
      SELECT id, name, description
      FROM sws_items
      WHERE id = ?
      LIMIT 1
      `,
      [itemId],
    )?.[0] || null
  );
}

function buildDankOptionEditorPayload(viewState) {
  const tree = buildDankOptionTree();
  const mains = listMainOptions(tree);

  if (!mains.length) {
    return {
      content: "No dank stat categories found yet.",
      flags: MessageFlags.Ephemeral,
    };
  }

  const safeMain = mains.includes(viewState.main) ? viewState.main : mains[0];
  const subCategories = listSubOptions(tree, safeMain);
  const showSubcategory = hasMeaningfulSubcategories(subCategories);
  const safeSub =
    showSubcategory && (viewState.sub === "__all__" || subCategories.includes(viewState.sub))
      ? viewState.sub
      : "__all__";

  const targetScope = showSubcategory ? `sub:${safeMain}` : "main";
  const targetValue = showSubcategory ? safeSub : safeMain;
  const selectedMeta = getDankOptionMeta(targetScope, targetValue);

  const mainSelectOptions = mains.slice(0, 25).map((main) => {
    const meta = getDankOptionMeta("main", main);
    const option = {
      label: main.slice(0, 100),
      value: main,
      default: main === safeMain,
      description: (meta?.description || `Edit ${main}`).slice(0, 100),
    };
    const emoji = parseEmojiValue(meta?.item_emoji);
    if (emoji) option.emoji = emoji;
    return option;
  });

  const container1 = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Edit Dank Stats Options\n### Selected: ${targetScope} / ${targetValue}`,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### Emoji: ${selectedMeta.item_emoji || "None"}`,
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`${DANK_OPTION_EDIT_EMOJI_BUTTON_PREFIX}:${viewState.token}`)
            .setLabel("Edit Emoji")
            .setStyle(ButtonStyle.Primary),
        ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### Select Menu Description: ${selectedMeta.description || "None"}`,
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`${DANK_OPTION_EDIT_DESCRIPTION_BUTTON_PREFIX}:${viewState.token}`)
            .setLabel("Edit Description")
            .setStyle(ButtonStyle.Secondary),
        ),
    );

  const container2 = new ContainerBuilder();

  if (showSubcategory) {
    const allMeta = getDankOptionMeta(`sub:${safeMain}`, "__all__");
    const allEmoji = parseEmojiValue(allMeta?.item_emoji);

    const subOptions = [
      {
        label: `All ${safeMain}`.slice(0, 100),
        value: "__all__",
        default: safeSub === "__all__",
        description: (allMeta?.description || `Edit All ${safeMain}`).slice(0, 100),
        ...(allEmoji ? { emoji: allEmoji } : {}),
      },
      ...subCategories.slice(0, 24).map((sub) => {
        const meta = getDankOptionMeta(`sub:${safeMain}`, sub);
        const option = {
          label: sub.slice(0, 100),
          value: sub,
          default: sub === safeSub,
          description: (meta?.description || `Edit ${sub}`).slice(0, 100),
        };
        const emoji = parseEmojiValue(meta?.item_emoji);
        if (emoji) option.emoji = emoji;
        return option;
      }),
    ];

    container2
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("### Select Subcategory"),
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${DANK_OPTION_SUB_SELECT_PREFIX}:${viewState.token}`)
            .setPlaceholder("Select Subcategory")
            .addOptions(subOptions),
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
          .setCustomId(`${DANK_OPTION_MAIN_SELECT_PREFIX}:${viewState.token}`)
          .setPlaceholder("Select Main Category")
          .addOptions(mainSelectOptions),
      ),
    );

  return {
    content: "",
    components: [container1, container2],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    state: {
      ...viewState,
      main: safeMain,
      sub: safeSub,
    },
  };
}

function listDankMultiplierTypes() {
  return ["xp", "coins", "luck"];
}

function listDankMultipliersByType(type) {
  return global.db.safeQuery(
    `
    SELECT name, MAX(amount) AS amount, MAX(emoji) AS emoji, MIN(description) AS description
    FROM dank_multipliers
    WHERE type = ?
    GROUP BY name
    ORDER BY LOWER(name) ASC
    `,
    [type],
  );
}

function getDankMultiplierMeta(type, name) {
  return (
    global.db.safeQuery(
      `
      SELECT name, MAX(amount) AS amount, MAX(emoji) AS emoji, MIN(description) AS description, type
      FROM dank_multipliers
      WHERE type = ? AND LOWER(name) = LOWER(?)
      GROUP BY name, type
      LIMIT 1
      `,
      [type, name],
    )?.[0] || null
  );
}

function buildDankMultiplierEditorPayload(viewState) {
  const validTypes = listDankMultiplierTypes();
  const safeType = validTypes.includes(viewState.type) ? viewState.type : "xp";
  const multiplierRows = listDankMultipliersByType(safeType);

  if (!multiplierRows.length) {
    return {
      content: `No multipliers found for type: ${safeType}`,
      flags: MessageFlags.Ephemeral,
      state: {
        ...viewState,
        type: safeType,
        name: null,
      },
    };
  }

  const names = multiplierRows.map((row) => String(row.name));
  const safeName = names.includes(viewState.name) ? viewState.name : names[0];
  const selected = multiplierRows.find((row) => String(row.name) === String(safeName));
  const typeLabel = safeType.toUpperCase();
  const selectedLabel = `${selected.name} [${selected.amount}]`;

  const typeOptions = validTypes.map((type) => ({
    label: type.toUpperCase(),
    value: type,
    default: type === safeType,
  }));

  const nameOptions = multiplierRows.slice(0, 25).map((row) => {
    const option = {
      label: `${row.name} [${row.amount}]`.slice(0, 100),
      value: row.name,
      default: row.name === safeName,
    };
    const emoji = parseEmojiValue(row.emoji);
    if (emoji) option.emoji = emoji;
    const desc = String(row.description || "").trim();
    if (desc) option.description = desc.slice(0, 100);
    return option;
  });

  const container1 = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Edit Dank Multipliers\n### Selected: ${typeLabel} / ${selectedLabel}`,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### Emoji: ${selected.emoji || "None"}`,
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`${DANK_MULTIPLIER_EDIT_EMOJI_BUTTON_PREFIX}:${viewState.token}`)
            .setLabel("Edit Emoji")
            .setStyle(ButtonStyle.Primary),
        ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### Select Menu Description: ${selected.description || "None"}`,
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`${DANK_MULTIPLIER_EDIT_DESCRIPTION_BUTTON_PREFIX}:${viewState.token}`)
            .setLabel("Edit Description")
            .setStyle(ButtonStyle.Secondary),
        ),
    );

  const container2 = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Select Type"),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${DANK_MULTIPLIER_TYPE_SELECT_PREFIX}:${viewState.token}`)
          .setPlaceholder("Select Type")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(typeOptions),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Select Multiplier"),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${DANK_MULTIPLIER_NAME_SELECT_PREFIX}:${viewState.token}`)
          .setPlaceholder("Select Multiplier")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(nameOptions),
      ),
    );

  return {
    content: "",
    components: [container1, container2],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    state: {
      ...viewState,
      type: safeType,
      name: safeName,
    },
  };
}

async function handleDevButton(interaction) {
  if (!isDevAllowed(interaction.user.id)) {
    await interaction.reply({
      content: "This command is owner-only.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const customId = String(interaction.customId || "");

  if (customId === EDIT_ITEM_BUTTON_ID) {
    const modal = new ModalBuilder()
      .setCustomId(ITEM_LOOKUP_MODAL_ID)
      .setTitle("Edit 7w7 Item")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(ITEM_LOOKUP_INPUT_ID)
            .setLabel("Item ID or Name")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder("74 or Item Name"),
        ),
      );

    await interaction.showModal(modal);
    return;
  }

  if (customId.startsWith(`${CHANGE_DESC_BUTTON_PREFIX}:`)) {
    const itemId = customId.split(":").pop();
    const item = get7w7ItemById(itemId);

    if (!item) {
      await interaction.reply({
        content: "Item no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`${CHANGE_DESC_MODAL_PREFIX}:${item.id}`)
      .setTitle(`Description: ${item.name}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(CHANGE_DESC_INPUT_ID)
            .setLabel("New Description")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000)
            .setValue(String(item.description || "")),
        ),
      );

    await interaction.showModal(modal);
    return;
  }

  if (customId.startsWith(`${DANK_OPTION_EDIT_EMOJI_BUTTON_PREFIX}:`)) {
    const token = customId.split(":").pop();
    const state = loadDankOptionView(token);
    if (!state || state.userId !== interaction.user.id) {
      await interaction.reply({
        content: "This panel expired. Use `/dev edit dank-options` again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const tree = buildDankOptionTree();
    const mains = listMainOptions(tree);
    const safeMain = mains.includes(state.main) ? state.main : mains[0];
    const subCategories = listSubOptions(tree, safeMain);
    const showSubcategory = hasMeaningfulSubcategories(subCategories);
    const safeSub =
      showSubcategory && (state.sub === "__all__" || subCategories.includes(state.sub))
        ? state.sub
        : "__all__";

    const scope = showSubcategory ? `sub:${safeMain}` : "main";
    const optionValue = showSubcategory ? safeSub : safeMain;
    const selectedMeta = getDankOptionMeta(scope, optionValue);

    const modal = new ModalBuilder()
      .setCustomId(
        `${DANK_OPTION_EDIT_EMOJI_MODAL_PREFIX}:${token}`,
      )
      .setTitle(`Emoji: ${scope} / ${optionValue}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(DANK_OPTION_ITEM_INPUT_ID)
            .setLabel("Item Name (blank to clear)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(String(selectedMeta.item_name || "")),
        ),
      );

    await interaction.showModal(modal);
    return;
  }

  if (customId.startsWith(`${DANK_OPTION_EDIT_DESCRIPTION_BUTTON_PREFIX}:`)) {
    const token = customId.split(":").pop();
    const state = loadDankOptionView(token);
    if (!state || state.userId !== interaction.user.id) {
      await interaction.reply({
        content: "This panel expired. Use `/dev edit dank-options` again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const tree = buildDankOptionTree();
    const mains = listMainOptions(tree);
    const safeMain = mains.includes(state.main) ? state.main : mains[0];
    const subCategories = listSubOptions(tree, safeMain);
    const showSubcategory = hasMeaningfulSubcategories(subCategories);
    const safeSub =
      showSubcategory && (state.sub === "__all__" || subCategories.includes(state.sub))
        ? state.sub
        : "__all__";

    const scope = showSubcategory ? `sub:${safeMain}` : "main";
    const optionValue = showSubcategory ? safeSub : safeMain;
    const selectedMeta = getDankOptionMeta(scope, optionValue);

    const modal = new ModalBuilder()
      .setCustomId(
        `${DANK_OPTION_EDIT_DESCRIPTION_MODAL_PREFIX}:${token}`,
      )
      .setTitle(`Description: ${scope} / ${optionValue}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(DANK_OPTION_DESCRIPTION_INPUT_ID)
            .setLabel("Description (blank to clear)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(String(selectedMeta.description || "")),
        ),
      );

    await interaction.showModal(modal);
    return;
  }

  if (customId.startsWith(`${DANK_MULTIPLIER_EDIT_EMOJI_BUTTON_PREFIX}:`)) {
    const token = customId.split(":").pop();
    const state = loadDankMultiplierView(token);
    if (!state || state.userId !== interaction.user.id) {
      await interaction.reply({
        content: "This panel expired. Use `/dev edit multiplier` again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const selected = getDankMultiplierMeta(state.type, state.name);
    if (!selected) {
      await interaction.reply({
        content: "Selected multiplier no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`${DANK_MULTIPLIER_EDIT_EMOJI_MODAL_PREFIX}:${token}`)
      .setTitle(`Emoji: ${state.type} / ${selected.name}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(DANK_MULTIPLIER_EMOJI_INPUT_ID)
            .setLabel("Emoji markdown/unicode/name (blank to clear)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(String(selected.emoji || "")),
        ),
      );

    await interaction.showModal(modal);
    return;
  }

  if (customId.startsWith(`${DANK_MULTIPLIER_EDIT_DESCRIPTION_BUTTON_PREFIX}:`)) {
    const token = customId.split(":").pop();
    const state = loadDankMultiplierView(token);
    if (!state || state.userId !== interaction.user.id) {
      await interaction.reply({
        content: "This panel expired. Use `/dev edit multiplier` again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const selected = getDankMultiplierMeta(state.type, state.name);
    if (!selected) {
      await interaction.reply({
        content: "Selected multiplier no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`${DANK_MULTIPLIER_EDIT_DESCRIPTION_MODAL_PREFIX}:${token}`)
      .setTitle(`Description: ${state.type} / ${selected.name}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(DANK_MULTIPLIER_DESCRIPTION_INPUT_ID)
            .setLabel("Dropdown Description (blank to clear)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(String(selected.description || "")),
        ),
      );

    await interaction.showModal(modal);
  }
}

async function handleDevSelect(interaction) {
  if (!isDevAllowed(interaction.user.id)) {
    await interaction.reply({
      content: "This command is owner-only.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const customId = String(interaction.customId || "");

  if (
    customId.startsWith(`${DANK_OPTION_MAIN_SELECT_PREFIX}:`) ||
    customId.startsWith(`${DANK_OPTION_SUB_SELECT_PREFIX}:`)
  ) {
    const token = customId.split(":")[3];
    if (!token) return;

    const state = loadDankOptionView(token);
    if (!state || state.userId !== interaction.user.id) {
      await interaction.reply({
        content: "This panel expired. Use `/dev edit dank-options` again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const selected = interaction.values?.[0];
    if (!selected) return;

    if (customId.startsWith(`${DANK_OPTION_MAIN_SELECT_PREFIX}:`)) {
      state.main = selected;
      state.sub = "__all__";
    } else if (customId.startsWith(`${DANK_OPTION_SUB_SELECT_PREFIX}:`)) {
      state.sub = selected;
    }

    const payload = buildDankOptionEditorPayload(state);
    if (payload?.state) {
      saveDankOptionView(token, payload.state);
      delete payload.state;
    }

    await interaction.update(payload);
    return;
  }

  if (
    customId.startsWith(`${DANK_MULTIPLIER_TYPE_SELECT_PREFIX}:`) ||
    customId.startsWith(`${DANK_MULTIPLIER_NAME_SELECT_PREFIX}:`)
  ) {
    const token = customId.split(":")[3];
    if (!token) return;

    const state = loadDankMultiplierView(token);
    if (!state || state.userId !== interaction.user.id) {
      await interaction.reply({
        content: "This panel expired. Use `/dev edit multiplier` again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const selected = interaction.values?.[0];
    if (!selected) return;

    if (customId.startsWith(`${DANK_MULTIPLIER_TYPE_SELECT_PREFIX}:`)) {
      state.type = selected;
      state.name = null;
    } else if (customId.startsWith(`${DANK_MULTIPLIER_NAME_SELECT_PREFIX}:`)) {
      state.name = selected;
    }

    const payload = buildDankMultiplierEditorPayload(state);
    if (payload?.state) {
      saveDankMultiplierView(token, payload.state);
      delete payload.state;
    }

    await interaction.update(payload);
  }
}

async function handleDevModal(interaction) {
  if (!isDevAllowed(interaction.user.id)) {
    await interaction.reply({
      content: "This command is owner-only.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const customId = String(interaction.customId || "");

  if (customId === ITEM_LOOKUP_MODAL_ID) {
    const query = interaction.fields.getTextInputValue(ITEM_LOOKUP_INPUT_ID);
    const item = find7w7ItemByLookup(query);

    if (!item) {
      await interaction.reply({
        content: `No 7w7 item found for: ${query}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply(build7w7ItemEditorPanel(item));
    return;
  }

  if (customId.startsWith(`${CHANGE_DESC_MODAL_PREFIX}:`)) {
    const itemId = customId.split(":").pop();
    const newDescription = interaction.fields
      .getTextInputValue(CHANGE_DESC_INPUT_ID)
      .trim();

    const item = get7w7ItemById(itemId);
    if (!item) {
      await interaction.reply({
        content: "Item no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    global.db.safeQuery(`UPDATE sws_items SET description = ? WHERE id = ?`, [
      newDescription || "None added yet",
      item.id,
    ]);

    const updated = get7w7ItemById(item.id) || item;
    await interaction.reply(build7w7ItemEditorPanel(updated));
    return;
  }

  if (customId.startsWith(`${DANK_OPTION_EDIT_EMOJI_MODAL_PREFIX}:`)) {
    const [, , , token] = customId.split(":");
    const state = loadDankOptionView(token);
    if (!state || state.userId !== interaction.user.id) {
      await interaction.reply({
        content: "This panel expired. Use `/dev edit dank-options` again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { scope, optionValue } = resolveCurrentDankOptionSelection(state);
    const itemInput = interaction.fields
      .getTextInputValue(DANK_OPTION_ITEM_INPUT_ID)
      .trim();
    const current = getDankOptionMeta(scope, optionValue);

    const matchedItem = itemInput ? findDankItemByLooseName(itemInput) : null;
    if (itemInput && !matchedItem) {
      await interaction.reply({
        content: `No dank item found for: ${itemInput}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    global.db.safeQuery(
      `
      INSERT INTO dank_stats_option_meta (scope, option_value, item_name, description)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scope, option_value) DO UPDATE SET
        item_name = excluded.item_name,
        description = excluded.description
      `,
      [scope, optionValue, matchedItem?.name || null, current.description || null],
    );

    const payload = buildDankOptionEditorPayload(state);
    if (payload?.state) {
      saveDankOptionView(token, payload.state);
      delete payload.state;
    }

    await interaction.reply(payload);
    return;
  }

  if (customId.startsWith(`${DANK_OPTION_EDIT_DESCRIPTION_MODAL_PREFIX}:`)) {
    const [, , , token] = customId.split(":");
    const state = loadDankOptionView(token);
    if (!state || state.userId !== interaction.user.id) {
      await interaction.reply({
        content: "This panel expired. Use `/dev edit dank-options` again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { scope, optionValue } = resolveCurrentDankOptionSelection(state);
    const description = interaction.fields
      .getTextInputValue(DANK_OPTION_DESCRIPTION_INPUT_ID)
      .trim();
    const current = getDankOptionMeta(scope, optionValue);

    global.db.safeQuery(
      `
      INSERT INTO dank_stats_option_meta (scope, option_value, item_name, description)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scope, option_value) DO UPDATE SET
        item_name = excluded.item_name,
        description = excluded.description
      `,
      [scope, optionValue, current.item_name || null, description || null],
    );

    const payload = buildDankOptionEditorPayload(state);
    if (payload?.state) {
      saveDankOptionView(token, payload.state);
      delete payload.state;
    }

    await interaction.reply(payload);
    return;
  }

  if (customId.startsWith(`${DANK_MULTIPLIER_EDIT_EMOJI_MODAL_PREFIX}:`)) {
    const token = customId.split(":")[3];
    const state = loadDankMultiplierView(token);
    if (!state || state.userId !== interaction.user.id) {
      await interaction.reply({
        content: "This panel expired. Use `/dev edit multiplier` again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const emojiInput = interaction.fields
      .getTextInputValue(DANK_MULTIPLIER_EMOJI_INPUT_ID)
      .trim();
    const emojiValue = emojiInput
      ? resolveNamedEmojiMarkdown(emojiInput) || emojiInput
      : null;
    const selected = getDankMultiplierMeta(state.type, state.name);
    if (!selected) {
      await interaction.reply({
        content: "Selected multiplier no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    global.db.safeQuery(
      `
      UPDATE dank_multipliers
      SET emoji = ?
      WHERE type = ? AND LOWER(name) = LOWER(?)
      `,
      [emojiValue || null, state.type, state.name],
    );

    const payload = buildDankMultiplierEditorPayload(state);
    if (payload?.state) {
      saveDankMultiplierView(token, payload.state);
      delete payload.state;
    }

    await interaction.reply(payload);
    return;
  }

  if (customId.startsWith(`${DANK_MULTIPLIER_EDIT_DESCRIPTION_MODAL_PREFIX}:`)) {
    const token = customId.split(":")[3];
    const state = loadDankMultiplierView(token);
    if (!state || state.userId !== interaction.user.id) {
      await interaction.reply({
        content: "This panel expired. Use `/dev edit multiplier` again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const descriptionValue = interaction.fields
      .getTextInputValue(DANK_MULTIPLIER_DESCRIPTION_INPUT_ID)
      .trim();
    const selected = getDankMultiplierMeta(state.type, state.name);
    if (!selected) {
      await interaction.reply({
        content: "Selected multiplier no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    global.db.safeQuery(
      `
      UPDATE dank_multipliers
      SET description = ?
      WHERE type = ? AND LOWER(name) = LOWER(?)
      `,
      [descriptionValue || null, state.type, state.name],
    );

    const payload = buildDankMultiplierEditorPayload(state);
    if (payload?.state) {
      saveDankMultiplierView(token, payload.state);
      delete payload.state;
    }

    await interaction.reply(payload);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dev")
    .setContexts("PrivateChannel", "Guild", "BotDM")
    .setDescription("Developer commands")
    .addSubcommand((subcommand) =>
      subcommand.setName("eval").setDescription("Evaluate code"),
    )
    .addSubcommandGroup((subcommandGroup) =>
      subcommandGroup
        .setName("edit")
        .setDescription("Edit bot values")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("multiplier")
            .setDescription(
              "Panel to manually edit dankmemer multipliers (e.g. for adding emoji/description)",
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("randomevents")
            .setDescription(
              "Panel to edit dankmemer random events list (e.g. for changing lb order)",
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("7w7-items")
            .setDescription("Panel to edit 7w7 item descriptions"),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("dank-options")
            .setDescription("Panel to edit dank stats select option meta"),
        ),
    )
    .addSubcommandGroup((subcommandGroup) =>
      subcommandGroup
        .setName("karuta")
        .setDescription("Karuta developer controls")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("changerecog")
            .setDescription("Change Karuta recognition handler")
            .addStringOption((option) =>
              option
                .setName("recognition")
                .setDescription("Recognition mode")
                .setRequired(true)
                .addChoices(
                  { name: "Off", value: "off" },
                  { name: "Tesseract", value: "tesseract" },
                  { name: "Gemma3", value: "gemma3" },
                ),
            ),
        ),
    ),
  async execute(interaction) {
    if (!interaction?.isChatInputCommand?.()) return;

    if (!isDevAllowed(interaction.user.id)) {
      await interaction.reply({
        content: "This command is owner-only.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(false);

    if (group === "edit" && subcommand === "7w7-items") {
      await interaction.reply(build7w7ItemEditorPanel());
      return;
    }

    if (group === "edit" && subcommand === "dank-options") {
      const token = createViewToken(interaction.user.id);
      const state = {
        token,
        userId: interaction.user.id,
        main: "Adventure",
        sub: "__all__",
      };
      saveDankOptionView(token, state);

      const payload = buildDankOptionEditorPayload(state);
      if (payload?.state) {
        saveDankOptionView(token, payload.state);
        delete payload.state;
      }

      await interaction.reply(payload);
      return;
    }

    if (group === "edit" && subcommand === "multiplier") {
      const token = createViewToken(interaction.user.id);
      const state = {
        token,
        userId: interaction.user.id,
        type: "xp",
        name: null,
      };
      saveDankMultiplierView(token, state);

      const payload = buildDankMultiplierEditorPayload(state);
      if (payload?.state) {
        saveDankMultiplierView(token, payload.state);
        delete payload.state;
      }

      await interaction.reply(payload);
      return;
    }

    if (group === "karuta" && subcommand === "changerecog") {
      const mode = String(interaction.options.getString("recognition", true) || "")
        .trim()
        .toLowerCase();
      const validModes = new Set(["off", "tesseract", "gemma3"]);
      if (!validModes.has(mode)) {
        await interaction.reply({
          content: "Invalid recognition mode.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      global.db.upsertState(
        KARUTA_RECOG_STATE_TYPE,
        JSON.stringify({ mode }),
        "global",
        true,
      );

      await interaction.reply({
        content: `Karuta recognition mode set to: \`${mode}\``,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: "This dev subcommand is not implemented yet.",
      flags: MessageFlags.Ephemeral,
    });
  },
};

if (!buttonHandlers.has(CUSTOM_ID_PREFIX)) {
  buttonHandlers.set(CUSTOM_ID_PREFIX, handleDevButton);
}

if (!selectMenuHandlers.has(CUSTOM_ID_PREFIX)) {
  selectMenuHandlers.set(CUSTOM_ID_PREFIX, handleDevSelect);
}

if (!modalHandlers.has(CUSTOM_ID_PREFIX)) {
  modalHandlers.set(CUSTOM_ID_PREFIX, handleDevModal);
}
