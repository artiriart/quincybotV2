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
const { loadPresetDraft, parseEmojiValue } = require("../functions/swsPresetUtils");

const ROUTE_PREFIX = "sws";
const VIEW_STATE_TYPE = "sws_preset_view";
const PRESET_DESCRIPTION_INPUT_ID = "preset_description";
const MAX_PRESETS_IN_PANEL = 5;

function createViewToken(userId) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${String(userId || "").slice(-6)}${Date.now().toString(36)}${rand}`.slice(0, 45);
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

function parseEquipment(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
      const cleanKey = String(key || "").trim();
      const cleanValue = String(value || "").trim();
      if (!cleanKey || !cleanValue) continue;
      out[cleanKey] = cleanValue;
    }
    return out;
  } catch {
    return {};
  }
}

function listPresets(userId) {
  const rows = global.db.safeQuery(
    `
    SELECT name, equipment, description
    FROM sws_presets
    WHERE user_id = ?
    ORDER BY LOWER(name) ASC
    `,
    [userId],
    [],
  );

  return rows.map((row) => ({
    name: String(row?.name || "Unknown").trim() || "Unknown",
    description: String(row?.description || "").trim(),
    equipment: parseEquipment(row?.equipment),
  }));
}

function getButtonEmoji(name, fallback) {
  const parsed = parseEmojiValue(global.db.getFeatherEmojiMarkdown(name) || "");
  if (parsed) return parsed;
  return { name: fallback };
}

function buildPresetPanelPayload(viewState, notice = "") {
  const presets = Array.isArray(viewState?.presets) ? viewState.presets : [];
  const visiblePresets = presets.slice(0, MAX_PRESETS_IN_PANEL);
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Manage your 7w7 presets"),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const safeNotice = String(notice || "").trim();
  if (safeNotice) {
    container
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${safeNotice}`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  }

  if (!presets.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "No presets saved yet. React with the edit-3 icon on waifu extra info to create one.",
      ),
    );

    return {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    };
  }

  const deleteEmoji = getButtonEmoji("trash", "🗑️");
  const outputEmoji = getButtonEmoji("terminal", "📤");

  for (let index = 0; index < visiblePresets.length; index += 1) {
    const preset = visiblePresets[index];
    const description = preset.description || "No description";
    const eqKeys = Object.keys(preset.equipment || {});

    container
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `### ${preset.name}\n-# ${description}\nSlots: ${eqKeys.join(", ") || "None"}`,
        ),
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${ROUTE_PREFIX}:presets:output:${viewState.token}:${index}`)
            .setStyle(ButtonStyle.Primary)
            .setLabel("Output IDs")
            .setEmoji(outputEmoji),
          new ButtonBuilder()
            .setCustomId(`${ROUTE_PREFIX}:presets:delete:${viewState.token}:${index}`)
            .setStyle(ButtonStyle.Secondary)
            .setLabel("Delete preset")
            .setEmoji(deleteEmoji),
        ),
      );

    if (index < visiblePresets.length - 1) {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    }
  }

  if (presets.length > MAX_PRESETS_IN_PANEL) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# Showing first ${MAX_PRESETS_IN_PANEL}/${presets.length} presets. Use /7w7 presets jump:<name> to move one to the top.`,
        ),
      );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function buildEquipCommandOutput(preset) {
  const equipment = preset?.equipment || {};
  const itemId = String(equipment.Item || "").trim();
  const character = String(preset?.name || "").trim();
  const description = String(preset?.description || "").trim() || "No description";
  const charToken = character.toLowerCase().replace(/\s+/g, "");

  const equipmentLines = Object.entries(equipment)
    .filter(([slot]) => String(slot || "").toLowerCase() !== "item")
    .map(([, id]) => String(id || "").trim())
    .filter(Boolean)
    .map((id) => `\`+w ${charToken} ${id}\``);

  return [
    `### Commands for equiping ${character}`,
    `-# ${description}`,
    "---",
    "**Item:**",
    itemId ? `\`+item ${itemId}\`` : "`No Item ID saved`",
    "**Equipment:**",
    equipmentLines.length ? equipmentLines.join("\n") : "`No equipment IDs saved`",
  ].join("\n");
}

function buildEquipCommandOutputPayload(preset) {
  const equipment = preset?.equipment || {};
  const itemId = String(equipment.Item || "").trim();
  const character = String(preset?.name || "").trim();
  const description = String(preset?.description || "").trim() || "No description";
  const charToken = character.toLowerCase().replace(/\s+/g, "");

  const equipmentLines = Object.entries(equipment)
    .filter(([slot]) => String(slot || "").toLowerCase() !== "item")
    .map(([, id]) => String(id || "").trim())
    .filter(Boolean)
    .map((id) => `\`+w ${charToken} ${id}\``);

  const topBlock = [`### Commands for equiping ${character}`, `-# ${description}`].join("\n");
  const commandBlock = [
    "**Item:**",
    itemId ? `\`+item ${itemId}\`` : "`No Item ID saved`",
    "**Equipment:**",
    equipmentLines.length ? equipmentLines.join("\n") : "`No equipment IDs saved`",
  ].join("\n");

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(topBlock))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(commandBlock));

  return {
    content: "",
    components: [container],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  };
}

async function handlePresetButtons(interaction) {
  const customId = String(interaction.customId || "");
  const [, scope, action, token, indexRaw] = customId.split(":");
  if (scope !== "presets" || !action || !token) return;

  const viewState = loadViewState(token);
  if (!viewState) {
    await interaction.reply({
      content: "This presets panel expired. Run `/7w7 presets` again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (String(viewState.userId || "") !== String(interaction.user.id || "")) {
    await interaction.reply({
      content: "Only the panel owner can use these controls.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const index = Number.parseInt(String(indexRaw || ""), 10);
  const selected = Number.isFinite(index) ? viewState.presets?.[index] : null;
  if (!selected) {
    await interaction.reply({
      content: "That preset no longer exists in this panel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "output") {
    await interaction.reply(buildEquipCommandOutputPayload(selected));
    return;
  }

  if (action !== "delete") return;

  global.db.safeQuery(
    `DELETE FROM sws_presets WHERE user_id = ? AND LOWER(name) = LOWER(?)`,
    [interaction.user.id, selected.name],
  );

  const refreshed = listPresets(interaction.user.id);
  const updatedViewState = {
    token,
    userId: interaction.user.id,
    presets: refreshed,
    createdAt: Date.now(),
  };
  saveViewState(token, updatedViewState);

  await interaction.update(
    buildPresetPanelPayload(updatedViewState, `Deleted preset: ${selected.name}`),
  );
}

async function handleSavePresetButton(interaction) {
  const customId = String(interaction.customId || "");
  const [, action, token] = customId.split(":");
  if (action !== "savepreset" || !token) return;

  const draft = loadPresetDraft(token);
  if (!draft) {
    await interaction.reply({
      content: "This preset draft expired. React with edit-3 again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (String(draft.ownerId || "") !== String(interaction.user.id || "")) {
    await interaction.reply({
      content: "Only the original user can save this preset.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${ROUTE_PREFIX}:savemodal:${token}`)
    .setTitle(`Save preset: ${String(draft.allyName || "Unknown").slice(0, 35)}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(PRESET_DESCRIPTION_INPUT_ID)
          .setLabel("Give your preset a description (optional)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(250),
      ),
    );

  await interaction.showModal(modal);
}

async function handleSwsButton(interaction) {
  const customId = String(interaction.customId || "");
  if (customId.startsWith(`${ROUTE_PREFIX}:savepreset:`)) {
    await handleSavePresetButton(interaction);
    return;
  }

  if (customId.startsWith(`${ROUTE_PREFIX}:presets:`)) {
    await handlePresetButtons(interaction);
  }
}

async function handleSwsModal(interaction) {
  const customId = String(interaction.customId || "");
  const [, action, token] = customId.split(":");
  if (action !== "savemodal" || !token) return;

  const draft = loadPresetDraft(token);
  if (!draft) {
    await interaction.reply({
      content: "This preset draft expired. React with edit-3 again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (String(draft.ownerId || "") !== String(interaction.user.id || "")) {
    await interaction.reply({
      content: "Only the original user can save this preset.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const description = String(
    interaction.fields.getTextInputValue(PRESET_DESCRIPTION_INPUT_ID) || "",
  ).trim();

  const equipmentJson = JSON.stringify(draft.equipment || {});
  global.db.safeQuery(
    `
    INSERT INTO sws_presets (user_id, name, equipment, description)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, name)
    DO UPDATE SET equipment = excluded.equipment, description = excluded.description
    `,
    [
      interaction.user.id,
      String(draft.allyName || "Unknown"),
      equipmentJson,
      description || null,
    ],
  );

  await interaction.reply({
    content: `Saved preset **${draft.allyName}**. Use \`/7w7 presets\` to browse it.`,
    flags: MessageFlags.Ephemeral,
  });
}

if (!buttonHandlers.has(ROUTE_PREFIX)) {
  buttonHandlers.set(ROUTE_PREFIX, handleSwsButton);
}

if (!modalHandlers.has(ROUTE_PREFIX)) {
  modalHandlers.set(ROUTE_PREFIX, handleSwsModal);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("7w7")
    .setContexts("PrivateChannel", "Guild", "BotDM")
    .setDescription("7w7 commands")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("item")
        .setDescription("Gives you info about an item")
        .addStringOption((option) =>
          option
            .setName("item")
            .setDescription("The item to get info about")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("presets")
        .setDescription("Shows your presets & equip commands")
        .addStringOption((option) =>
          option
            .setName("jump")
            .setDescription("Jump to a preset")
            .setRequired(false)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("clearitems")
        .setDescription("Clears all indexed 7w7 items"),
    ),
  async autocomplete(interaction) {
    const subcommand = interaction.options.getSubcommand(false);
    const focused = interaction.options.getFocused(true);

    if (subcommand === "item" && focused?.name === "item") {
      const query = String(focused.value || "").trim();
      const rows = query
        ? global.db.safeQuery(
            `
            SELECT id, name
            FROM sws_items
            WHERE LOWER(name) LIKE LOWER(?)
            ORDER BY
              CASE
                WHEN LOWER(name) = LOWER(?) THEN 0
                WHEN LOWER(name) LIKE LOWER(?) THEN 1
                ELSE 2
              END,
              name ASC
            LIMIT 25
            `,
            [`%${query}%`, query, `${query}%`],
          )
        : global.db.safeQuery(
            `
            SELECT id, name
            FROM sws_items
            ORDER BY name ASC
            LIMIT 25
            `,
          );

      const choices = rows.map((row) => {
        const id = row?.id ?? "?";
        const name = String(row?.name || "Unknown");
        const label = `[${id}] ${name}`.slice(0, 100);
        return { name: label, value: name.slice(0, 100) };
      });

      await interaction.respond(choices);
      return;
    }

    if (subcommand === "presets" && focused?.name === "jump") {
      const query = String(focused.value || "").trim();
      const rows = query
        ? global.db.safeQuery(
            `
            SELECT name
            FROM sws_presets
            WHERE user_id = ? AND LOWER(name) LIKE LOWER(?)
            ORDER BY
              CASE
                WHEN LOWER(name) = LOWER(?) THEN 0
                WHEN LOWER(name) LIKE LOWER(?) THEN 1
                ELSE 2
              END,
              name ASC
            LIMIT 25
            `,
            [interaction.user.id, `%${query}%`, query, `${query}%`],
          )
        : global.db.safeQuery(
            `
            SELECT name
            FROM sws_presets
            WHERE user_id = ?
            ORDER BY name ASC
            LIMIT 25
            `,
            [interaction.user.id],
          );

      await interaction.respond(
        rows.map((row) => {
          const name = String(row?.name || "Unknown");
          return { name: name.slice(0, 100), value: name.slice(0, 100) };
        }),
      );
      return;
    }

    await interaction.respond([]);
  },
  async execute(interaction) {
    if (!interaction?.isChatInputCommand?.()) return;

    const subcommand = interaction.options.getSubcommand(false);

    if (subcommand === "item") {
      const itemName = interaction.options.getString("item", true);
      const item = global.db.safeQuery(
        `
        SELECT id, name, market, emoji_id, description
        FROM sws_items
        WHERE LOWER(name) = LOWER(?)
        LIMIT 1
        `,
        [itemName],
      )?.[0];

      if (!item) {
        await interaction.reply({
          content: `Item not found: ${itemName}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const container = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${item.name}`),
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`-# ${item.description || "None added yet"}`),
        );

      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**Item ID**\n${item.id ?? "Unknown"}\n**Bazaar**\n${item.market || "Unknown"}`,
        ),
      );
      section.setThumbnailAccessory((thumb) => {
        thumb.setURL(
          item.emoji_id
            ? `https://cdn.discordapp.com/emojis/${item.emoji_id}.webp`
            : "https://cdn.discordapp.com/embed/avatars/0.png",
        );
        return thumb;
      });

      await interaction.reply({
        components: [container.addSectionComponents(section)],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    if (subcommand !== "presets") {
      if (subcommand === "clearitems") {
        const isOwner = Array.isArray(global.ownerIds)
          ? global.ownerIds.includes(interaction.user.id)
          : false;
        if (!isOwner) {
          await interaction.reply({
            content: "Only bot owners can run this command.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const result = global.db.safeQuery(`DELETE FROM sws_items`, [], null);
        const cleared = Number(result?.changes || 0);
        await interaction.reply({
          content: `Cleared \`${cleared}\` rows from \`sws_items\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        content: "This subcommand is not implemented yet.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const jump = String(interaction.options.getString("jump", false) || "").trim();
    let presets = listPresets(interaction.user.id);

    if (jump) {
      const targetIndex = presets.findIndex(
        (preset) => String(preset.name || "").toLowerCase() === jump.toLowerCase(),
      );
      if (targetIndex > 0) {
        const [target] = presets.splice(targetIndex, 1);
        presets = [target, ...presets];
      }
    }

    const token = createViewToken(interaction.user.id);
    const viewState = {
      token,
      userId: interaction.user.id,
      presets,
      createdAt: Date.now(),
    };
    saveViewState(token, viewState);

    await interaction.reply(buildPresetPanelPayload(viewState));
  },
};
