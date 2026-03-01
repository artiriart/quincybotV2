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
const { recognizeKarutaCardsFromUrl } = require("../functions/karutaOcr");
const { recognizeKarutaCardsWithGemmaFromUrl } = require("../functions/karutaGemma");

const ROUTE_PREFIX = "karutawish";
const VIEW_STATE_TYPE = "karuta_wishlist_view";
const KARUTA_RECOG_STATE_TYPE = "karuta_recognition_settings";
const ITEMS_PER_PAGE = 5;
const CHARACTER_INPUT_ID = "character_name";
const MIN_WISHLIST_INPUT_ID = "wishlist_min";
const IMAGE_FALLBACK_URL =
  "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExOGJtMGdrcmhzMG42dGZ5eHJsbGpwdnM1cHYwYnptbm0ydmV2bjBsNSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/gJvBd0pdXTNqjIh75A/giphy.gif";

function getKarutaRecognitionMode() {
  const raw = global.db.getState(KARUTA_RECOG_STATE_TYPE, "global");
  if (!raw) return "tesseract";
  try {
    const parsed = JSON.parse(raw);
    const mode = String(parsed?.mode || "").trim().toLowerCase();
    if (["off", "tesseract", "gemma3"].includes(mode)) return mode;
  } catch {}
  return "tesseract";
}

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

function normalizeKarutaKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
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

function resolveKarutaSeriesByLooseQuery(query) {
  const raw = String(query || "").trim();
  const normalized = normalizeKarutaKey(raw);
  if (!raw || !normalized) return null;

  return (
    global.db.safeQuery(
      `
      SELECT
        series,
        COALESCE(display_series, series) AS display_series,
        SUM(COALESCE(wishlist, 0)) AS wishlist,
        COALESCE(
          (
            SELECT c2.card_url
            FROM karuta_cards c2
            WHERE c2.series = karuta_cards.series
              AND COALESCE(c2.card_url, '') <> ''
            ORDER BY RANDOM()
            LIMIT 1
          ),
          ''
        ) AS card_url
      FROM karuta_cards
      WHERE series = ?
         OR LOWER(COALESCE(display_series, '')) = LOWER(?)
         OR name = ?
         OR LOWER(COALESCE(display_name, '')) = LOWER(?)
      GROUP BY series, COALESCE(display_series, series)
      ORDER BY wishlist DESC, LENGTH(COALESCE(display_series, series)) ASC
      LIMIT 1
      `,
      [normalized, raw, normalized, raw],
    )?.[0] ||
    global.db.safeQuery(
      `
      SELECT
        series,
        COALESCE(display_series, series) AS display_series,
        SUM(COALESCE(wishlist, 0)) AS wishlist,
        COALESCE(
          (
            SELECT c2.card_url
            FROM karuta_cards c2
            WHERE c2.series = karuta_cards.series
              AND COALESCE(c2.card_url, '') <> ''
            ORDER BY RANDOM()
            LIMIT 1
          ),
          ''
        ) AS card_url
      FROM karuta_cards
      WHERE series LIKE ?
         OR LOWER(COALESCE(display_series, '')) LIKE LOWER(?)
         OR name LIKE ?
         OR LOWER(COALESCE(display_name, '')) LIKE LOWER(?)
      GROUP BY series, COALESCE(display_series, series)
      ORDER BY
        CASE
          WHEN series LIKE ? THEN 0
          ELSE 1
        END,
        wishlist DESC,
        LENGTH(COALESCE(display_series, series)) ASC
      LIMIT 1
      `,
      [`%${normalized}%`, `%${raw}%`, `%${normalized}%`, `%${raw}%`, `${normalized}%`],
    )?.[0] ||
    null
  );
}

function listWishlistRows(userId, guildId) {
  const safeUserId = String(userId || "").trim();
  const safeGuildId = String(guildId || "global").trim() || "global";
  return global.db.safeQuery(
    `
    SELECT
      w.series,
      COALESCE(w.wishlist_min, 0) AS wishlist_min,
      COALESCE(
        (
          SELECT c0.display_series
          FROM karuta_cards c0
          WHERE c0.series = w.series
            AND COALESCE(c0.display_series, '') <> ''
          ORDER BY c0.wishlist DESC
          LIMIT 1
        ),
        w.series
      ) AS display_series,
      COALESCE(
        (
          SELECT SUM(COALESCE(c1.wishlist, 0))
          FROM karuta_cards c1
          WHERE c1.series = w.series
        ),
        0
      ) AS wishlist,
      COALESCE(
        (
          SELECT c2.card_url
          FROM karuta_cards c2
          WHERE c2.series = w.series
            AND COALESCE(c2.card_url, '') <> ''
          ORDER BY RANDOM()
          LIMIT 1
        ),
        ''
      ) AS series_card_url
    FROM karuta_wishlists w
    WHERE w.user_id = ? AND w.guild_id = ?
    ORDER BY wishlist DESC, display_series ASC
    `,
    [safeUserId, safeGuildId],
    [],
  );
}

function dedupeWishlistRows(rows) {
  const seen = new Set();
  const unique = [];
  for (const row of rows || []) {
    const key = String(row?.series || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

function buildWishlistPanelPayload(viewState, ephemeral = false, notice = "") {
  const rows = dedupeWishlistRows(
    listWishlistRows(viewState.userId, viewState.guildId),
  );
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
  const sepEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("more-horizontal")) || {
    name: "⋯",
  };
  const addEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("plus-circle")) || {
    name: "➕",
  };
  const trashEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("trash")) || {
    name: "🗑️",
  };

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Manage your Karuta wishlists"),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const noticeText = String(notice || "").trim();
  if (noticeText) {
    container
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${noticeText}`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  }

  if (!paged.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# No wishlist entries added yet."),
    );
  } else {
    for (let i = 0; i < paged.length; i += 1) {
      const row = paged[i];
      const displaySeries = String(row?.display_series || row?.series || "unknown");
      const wishlist = Number.parseInt(String(row?.wishlist || 0), 10);
      const wishlistMin = Math.max(0, Number.parseInt(String(row?.wishlist_min || 0), 10) || 0);
      const seriesCardUrl = String(row?.series_card_url || "").trim();
      const thumb = /^https?:\/\//i.test(seriesCardUrl)
        ? seriesCardUrl
        : IMAGE_FALLBACK_URL;

      const section = new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**${displaySeries}**\n-# Wishlist: ${Number.isFinite(wishlist) ? wishlist : 0}\n-# Min Wishlist: ${wishlistMin}`,
          ),
        )
        .setThumbnailAccessory((thumbnail) => {
          thumbnail.setURL(thumb);
          return thumbnail;
        });

      container.addSectionComponents(section);
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          applyButtonEmoji(
            new ButtonBuilder()
              .setCustomId(
                `${ROUTE_PREFIX}:editmin:${viewState.token}:${page * ITEMS_PER_PAGE + i}`,
              )
              .setStyle(ButtonStyle.Secondary)
              .setLabel("Edit Min Wishlist"),
            parseEmojiValue(global.db.getFeatherEmojiMarkdown("edit-3")) || {
              name: "✏️",
            },
          ),
          applyButtonEmoji(
            new ButtonBuilder()
              .setCustomId(
                `${ROUTE_PREFIX}:remove:${viewState.token}:${page * ITEMS_PER_PAGE + i}`,
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
          .setEmoji(sepEmoji)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`${ROUTE_PREFIX}:add:${viewState.token}`)
          .setStyle(ButtonStyle.Primary)
          .setLabel("Add Reminder")
          .setEmoji(addEmoji),
      ),
    );

  return {
    content: "",
    components: [container],
    flags: (ephemeral ? MessageFlags.Ephemeral : 0) | MessageFlags.IsComponentsV2,
    state: {
      ...viewState,
      page,
    },
  };
}

async function runWishlistList(interaction) {
  const token = createViewToken(interaction.user.id);
  const state = {
    token,
    userId: interaction.user.id,
    guildId: interaction.guildId || "global",
    page: 0,
  };
  saveViewState(token, state);

  const payload = buildWishlistPanelPayload(state, true);
  if (payload?.state) {
    saveViewState(token, payload.state);
    delete payload.state;
  }

  await interaction.reply(payload);
}

async function handleWishlistButton(interaction) {
  const customId = String(interaction.customId || "");
  const [, action, token, extra] = customId.split(":");
  if (!token) return;

  const state = loadViewState(token);
  if (!state || state.userId !== interaction.user.id) {
    await interaction.reply({
      content: "This wishlist panel expired. Run `/karuta wishlist` again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "prev") {
    state.page = Math.max(0, Number(state.page || 0) - 1);
  } else if (action === "next") {
    state.page = Number(state.page || 0) + 1;
  } else if (action === "add") {
    const modal = new ModalBuilder()
      .setCustomId(`${ROUTE_PREFIX}:add_modal:${token}`)
      .setTitle("Add Karuta Wishlist")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(CHARACTER_INPUT_ID)
            .setLabel("Character or series (substring search)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder("ex: the shorekeeper / wuthering waves"),
        ),
      );

    await interaction.showModal(modal);
    return;
  } else if (action === "editmin") {
    const allRows = dedupeWishlistRows(
      listWishlistRows(state.userId, state.guildId),
    );
    const rowIndex = Number(extra);
    const target = Number.isInteger(rowIndex) && rowIndex >= 0 ? allRows[rowIndex] : null;

    if (!target?.series) {
      const payload = buildWishlistPanelPayload(state, false, "That entry no longer exists.");
      if (payload?.state) {
        saveViewState(token, payload.state);
        delete payload.state;
      }
      await interaction.update(payload);
      return;
    }

    const currentMin = Math.max(
      0,
      Number.parseInt(String(target?.wishlist_min || 0), 10) || 0,
    );
    const modal = new ModalBuilder()
      .setCustomId(`${ROUTE_PREFIX}:edit_min_modal:${token}:${rowIndex}`)
      .setTitle("Edit Min Wishlist")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(MIN_WISHLIST_INPUT_ID)
            .setLabel("Min wishlist")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder("ex: 300")
            .setValue(String(currentMin)),
        ),
      );

    await interaction.showModal(modal);
    return;
  } else if (action === "remove") {
    const allRows = dedupeWishlistRows(
      listWishlistRows(state.userId, state.guildId),
    );
    const rowIndex = Number(extra);
    const target = Number.isInteger(rowIndex) && rowIndex >= 0 ? allRows[rowIndex] : null;

    if (!target?.series) {
      const payload = buildWishlistPanelPayload(state, false, "That entry no longer exists.");
      if (payload?.state) {
        saveViewState(token, payload.state);
        delete payload.state;
      }
      await interaction.update(payload);
      return;
    }

    global.db.safeQuery(
      `
      DELETE FROM karuta_wishlists
      WHERE user_id = ? AND guild_id = ? AND series = ?
      `,
      [state.userId, state.guildId || "global", target.series],
    );

    const labelName = String(target?.display_series || target?.series || "unknown");
    const payload = buildWishlistPanelPayload(
      state,
      false,
      `Removed reminder: ${labelName}.`,
    );
    if (payload?.state) {
      saveViewState(token, payload.state);
      delete payload.state;
    }
    await interaction.update(payload);
    return;
  } else {
    return;
  }

  const payload = buildWishlistPanelPayload(state);
  if (payload?.state) {
    saveViewState(token, payload.state);
    delete payload.state;
  }
  await interaction.update(payload);
}

async function handleWishlistModal(interaction) {
  const customId = String(interaction.customId || "");
  const [, action, token, extra] = customId.split(":");
  if (!token) return;

  const state = loadViewState(token);
  if (!state || state.userId !== interaction.user.id) {
    await interaction.reply({
      content: "This wishlist panel expired. Run `/karuta wishlist` again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "edit_min_modal") {
    const allRows = dedupeWishlistRows(
      listWishlistRows(state.userId, state.guildId),
    );
    const rowIndex = Number(extra);
    const target = Number.isInteger(rowIndex) && rowIndex >= 0 ? allRows[rowIndex] : null;
    if (!target?.series) {
      const payload = buildWishlistPanelPayload(
        state,
        true,
        "That entry no longer exists.",
      );
      if (payload?.state) {
        saveViewState(token, payload.state);
        delete payload.state;
      }
      await interaction.reply(payload);
      return;
    }

    const rawMin = String(
      interaction.fields.getTextInputValue(MIN_WISHLIST_INPUT_ID) || "",
    ).trim();
    const parsedMin = Number.parseInt(rawMin.replaceAll(",", ""), 10);
    if (!Number.isInteger(parsedMin) || parsedMin < 0) {
      await interaction.reply({
        content: "Invalid min wishlist value. Use a whole number >= 0.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    global.db.safeQuery(
      `
      UPDATE karuta_wishlists
      SET wishlist_min = ?
      WHERE user_id = ? AND guild_id = ? AND series = ?
      `,
      [parsedMin, state.userId, state.guildId || "global", target.series],
    );

    const label = String(target?.display_series || target?.series || "unknown");
    const payload = buildWishlistPanelPayload(
      state,
      true,
      `Updated min wishlist: ${label} -> ${parsedMin}.`,
    );
    if (payload?.state) {
      saveViewState(token, payload.state);
      delete payload.state;
    }
    await interaction.reply(payload);
    return;
  }

  if (action !== "add_modal") return;

  const query = interaction.fields.getTextInputValue(CHARACTER_INPUT_ID)?.trim();
  if (!query) {
    await interaction.reply({
      content: "Character or series cannot be empty.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const series = resolveKarutaSeriesByLooseQuery(query);
  if (!series?.series) {
    await interaction.reply({
      content: `No Karuta character or series found for: ${query}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = global.db.safeQuery(
    `
    INSERT INTO karuta_wishlists (user_id, guild_id, series)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, guild_id, series) DO NOTHING
    `,
    [state.userId, state.guildId || "global", series.series],
    null,
  );
  const added = Number(result?.changes || 0) > 0;

  const displayName = String(
    series?.display_series || series?.series || query || "unknown",
  ).trim();
  state.page = 0;
  const payload = buildWishlistPanelPayload(
    state,
    true,
    added ? `Added reminder: ${displayName}.` : `Reminder already exists: ${displayName}.`,
  );
  if (payload?.state) {
    saveViewState(token, payload.state);
    delete payload.state;
  }

  await interaction.reply(payload);
}

if (!buttonHandlers.has(ROUTE_PREFIX)) {
  buttonHandlers.set(ROUTE_PREFIX, handleWishlistButton);
}

if (!modalHandlers.has(ROUTE_PREFIX)) {
  modalHandlers.set(ROUTE_PREFIX, handleWishlistModal);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setContexts("PrivateChannel", "Guild", "BotDM")
    .setName("karuta")
    .setDescription("Karuta utilities")
    .addSubcommand((subcommand) =>
      subcommand.setName("wishlist").setDescription("Manage your Karuta wishlists"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("test-recog")
        .setDescription("Test Karuta OCR recognition from an image URL")
        .addStringOption((option) =>
          option
            .setName("link")
            .setDescription("Direct image URL")
            .setRequired(true),
        ),
    ),
  async execute(interaction) {
    if (!interaction?.isChatInputCommand?.()) return;
    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand === "wishlist") {
      await runWishlistList(interaction);
      return;
    }
    if (subcommand === "test-recog") {
      const link = String(interaction.options.getString("link", true) || "").trim();
      if (!/^https?:\/\//i.test(link)) {
        await interaction.reply({
          content: "Invalid link. Please provide a direct `http(s)` image URL.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const mode = getKarutaRecognitionMode();
        if (mode === "off") {
          await interaction.editReply({
            content:
              "Recognition is currently disabled (`off`). Use `/dev karuta changerecog` first.",
          });
          return;
        }

        const result =
          mode === "gemma3"
            ? await recognizeKarutaCardsWithGemmaFromUrl(link)
            : await recognizeKarutaCardsFromUrl(link);
        const lines = result.cards.map((card, idx) => {
          const name = card?.name || "(empty)";
          const series = card?.series || "(empty)";
          return `${idx + 1}. Name: ${name} | Series: ${series}`;
        });

        await interaction.editReply({
          content: [
            "### Karuta OCR Result",
            `-# Recognition mode: ${mode}`,
            ...lines,
            `-# Load: ${result.load_time_sec}s | Mem delta: ${result.memory_usage_mb} MB`,
          ].join("\n"),
        });
      } catch (error) {
        await interaction.editReply({
          content: `OCR failed: ${String(error?.message || error || "unknown error")}`,
        });
      }
      return;
    }
  },
};
