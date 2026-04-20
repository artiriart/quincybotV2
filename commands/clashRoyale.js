const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
} = require("discord.js");
const sharp = require("sharp");
const { buttonHandlers } = require("../functions/interactions/button");

const ROUTE_PREFIX = "betroyale";
const OPEN_BET_MENU_PREFIX = "open_bet_menu";
const TOTAL_ROUNDS = 8;
const ROUND_POOL_SIZE = 5;
const REQUIRED_UNIQUE_CARDS = TOTAL_ROUNDS * ROUND_POOL_SIZE;
const COPY_DECK_LANGUAGE = "Royals";
const COPY_DECK_TT = "159000000";
const STATUS_ACTIVE = "active";
const STATUS_RESOLVING = "resolving";
const STATUS_COMPLETED = "completed";
const ROUND_TYPE_NORMAL = "normal";
const ROUND_TYPE_EVO = "evo";
const ROUND_TYPE_HERO = "hero";
const EVO_HERO_EVENT_CHANCE = 0.08; // 8% per potential event check
const POWER_BUTTON_EMOJIS = {
  1: "1️⃣",
  2: "2️⃣",
  3: "3️⃣",
  4: "4️⃣",
  5: "5️⃣",
  6: "6️⃣",
  7: "7️⃣",
  8: "8️⃣",
};

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

function safeJsonParse(raw, fallback) {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function clampRound(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(TOTAL_ROUNDS, Math.trunc(parsed)));
}

function normalizeCardRow(row) {
  return {
    name: String(row?.name || "Unknown Card").trim() || "Unknown Card",
    card_emoji: String(row?.card_emoji || "").trim() || null,
    rarity: String(row?.rarity || "COMMON").trim().toUpperCase() || "COMMON",
    elixir_cost:
      row?.elixir_cost == null || row?.elixir_cost === ""
        ? null
        : Math.max(0, Number(row.elixir_cost) || 0),
    card_id:
      row?.card_id == null || row?.card_id === ""
        ? null
        : Number.isFinite(Number(row.card_id))
          ? Number(row.card_id)
          : null,
  };
}

function normalizeSpecialCardRow(row, kind) {
  // kind = 'evo' | 'hero'
  const emojiField = kind === ROUND_TYPE_EVO ? "evo_emoji" : "hero_emoji";
  return {
    name: String(row?.name || "Unknown Card").trim() || "Unknown Card",
    // use the evo/hero emoji as card_emoji so the image renders correctly
    card_emoji: String(row?.[emojiField] || row?.card_emoji || "").trim() || null,
    rarity: String(row?.rarity || "COMMON").trim().toUpperCase() || "COMMON",
    elixir_cost:
      row?.elixir_cost == null || row?.elixir_cost === ""
        ? null
        : Math.max(0, Number(row.elixir_cost) || 0),
    card_id:
      row?.card_id == null || row?.card_id === ""
        ? null
        : Number.isFinite(Number(row.card_id))
          ? Number(row.card_id)
          : null,
    // metadata to identify that this is special
    specialKind: kind,
    baseName: String(row?.name || "").trim(),
  };
}

function cloneCard(card) {
  return card ? { ...card } : null;
}

function parseBet(value) {
  if (!value || typeof value !== "object") return null;
  const cardIndex = Math.trunc(Number(value.cardIndex || 0));
  const power = Math.trunc(Number(value.power || 0));
  if (cardIndex < 1 || cardIndex > ROUND_POOL_SIZE) return null;
  if (power < 1 || power > TOTAL_ROUNDS) return null;
  return { cardIndex, power };
}

function parsePowerList(raw) {
  const parsed = safeJsonParse(raw, []);
  if (!Array.isArray(parsed)) return [];
  return Array.from(
    new Set(
      parsed
        .map((value) => Math.trunc(Number(value || 0)))
        .filter((value) => value >= 1 && value <= TOTAL_ROUNDS),
    ),
  );
}

function parseCardIdList(raw) {
  const parsed = safeJsonParse(raw, []);
  if (!Array.isArray(parsed)) return [];
  return Array.from(
    new Set(
      parsed
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  );
}

function getCardId(card) {
  const value = Number(card?.card_id);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function collectSeenCardIds(...collections) {
  const seen = new Set();

  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      const numericId = Number(item);
      if (Number.isFinite(numericId) && numericId > 0) {
        seen.add(numericId);
        continue;
      }

      const rawCard = item;
      const card = normalizeCardRow(rawCard);
      const cardId = getCardId(card);
      if (cardId != null) {
        seen.add(cardId);
      }
    }
  }

  return [...seen];
}

function parseDeck(raw) {
  const parsed = safeJsonParse(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((card) => normalizeCardRow(card));
}

function parseSpecialsList(raw) {
  const parsed = safeJsonParse(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed;
}

function parseGameRow(row) {
  if (!row) return null;
  const pool = parseDeck(row.pool_json);
  const p1Deck = parseDeck(row.p1_deck_json);
  const p2Deck = parseDeck(row.p2_deck_json);
  const seenCardIds = parseCardIdList(row.seen_cards_json);
  return {
    gameId: String(row.game_id || ""),
    channelId: String(row.channel_id || ""),
    messageId: row.message_id == null ? null : String(row.message_id),
    player1Id: String(row.player1_id || ""),
    player2Id: String(row.player2_id || ""),
    round: clampRound(row.round),
    roundType: String(row.round_type || ROUND_TYPE_NORMAL),
    specialEventKind: row.special_event_kind ? String(row.special_event_kind) : null,
    evoHeroEventsEnabled: Boolean(row.evo_hero_events_enabled),
    pool,
    seenCardIds: seenCardIds.length
      ? seenCardIds
      : collectSeenCardIds(pool, p1Deck, p2Deck),
    p1Deck,
    p2Deck,
    p1Specials: parseSpecialsList(row.p1_specials_json),
    p2Specials: parseSpecialsList(row.p2_specials_json),
    p1UsedPowers: parsePowerList(row.p1_used_powers_json),
    p2UsedPowers: parsePowerList(row.p2_used_powers_json),
    bonusOneTokens: Number(row.bonus_one_tokens || 0),
    p1BonusOnesUsed: Number(row.p1_bonus_ones_used || 0),
    p2BonusOnesUsed: Number(row.p2_bonus_ones_used || 0),
    p1Bet: parseBet(safeJsonParse(row.p1_bet_json, null)),
    p2Bet: parseBet(safeJsonParse(row.p2_bet_json, null)),
    status: String(row.status || STATUS_ACTIVE),
    createdAt: row.created_at || null,
  };
}

function loadGame(gameId) {
  const row = global.db.safeQuery(
    `SELECT * FROM betroyale_games WHERE game_id = ? LIMIT 1`,
    [gameId],
    [],
  )?.[0];
  return parseGameRow(row);
}

function loadActiveGameInChannel(channelId) {
  const row = global.db.safeQuery(
    `
    SELECT *
    FROM betroyale_games
    WHERE channel_id = ? AND status IN (?, ?)
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [channelId, STATUS_ACTIVE, STATUS_RESOLVING],
    [],
  )?.[0];
  return parseGameRow(row);
}

function getPlayerSide(game, userId) {
  if (!game || !userId) return null;
  if (String(game.player1Id) === String(userId)) return "p1";
  if (String(game.player2Id) === String(userId)) return "p2";
  return null;
}

function getSideDeck(game, side) {
  return side === "p1" ? game.p1Deck : game.p2Deck;
}

function getSideUsedPowers(game, side) {
  return side === "p1" ? game.p1UsedPowers : game.p2UsedPowers;
}

function getSideBet(game, side) {
  return side === "p1" ? game.p1Bet : game.p2Bet;
}

function getReadyLabel(game, side) {
  if (game.status === STATUS_RESOLVING) return "🔄 Resolving";
  return getSideBet(game, side) ? "✅ Locked" : "⏳ Waiting";
}

function getPlayerMention(userId) {
  return `<@${userId}>`;
}

function escapeSvg(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getEmojiImageUrl(raw) {
  const parsed = parseEmojiValue(raw);
  if (!parsed?.id) return null;
  return `https://cdn.discordapp.com/emojis/${parsed.id}.png?size=256&quality=lossless`;
}

async function fetchImageBuffer(url, label) {
  if (!url) return null;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: "image/*",
    },
  }).catch((error) => {
    console.error(`${label} fetch failed:`, error?.message || error);
    return null;
  });

  if (!response?.ok) {
    return null;
  }

  const arrayBuffer = await response.arrayBuffer().catch(() => null);
  return arrayBuffer ? Buffer.from(arrayBuffer) : null;
}

function rarityColors(rarity) {
  const key = String(rarity || "").toUpperCase();
  if (key === "RARE") {
    return { start: "#f39c12", end: "#d35400", accent: "#fde3a7" };
  }
  if (key === "EPIC") {
    return { start: "#8e44ad", end: "#5e3370", accent: "#e8d6ff" };
  }
  if (key === "LEGENDARY") {
    return { start: "#f1c40f", end: "#d35400", accent: "#fff3bf" };
  }
  if (key === "CHAMPION") {
    return { start: "#3498db", end: "#1f4f7a", accent: "#d6ecff" };
  }
  return { start: "#95a5a6", end: "#566573", accent: "#f5f7fa" };
}

async function renderRoundPoolImage(pool, round) {
  const width = 1600;
  const height = 430;
  const tileWidth = 284;
  const tileHeight = 360;
  const startX = 32;
  const gap = 24;
  const topY = 34;

  const defs = [];
  const tileBlocks = [];

  for (let i = 0; i < pool.length; i += 1) {
    const card = normalizeCardRow(pool[i]);
    const x = startX + i * (tileWidth + gap);
    const gradientId = `tileGrad${i}`;
    const colors = rarityColors(card.rarity);
    const titleText = `${card.name} - ${card.elixir_cost == null ? "?" : card.elixir_cost}`;
    const titleFontSize =
      titleText.length > 24 ? 18 : titleText.length > 19 ? 20 : 23;

    defs.push(`
      <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${colors.start}" />
        <stop offset="100%" stop-color="${colors.end}" />
      </linearGradient>
    `);

    tileBlocks.push(`
      <g>
        <rect x="${x}" y="${topY}" width="${tileWidth}" height="${tileHeight}" rx="28" fill="url(#${gradientId})" />
        <rect x="${x + 10}" y="${topY + 10}" width="${tileWidth - 20}" height="${tileHeight - 20}" rx="22" fill="rgba(9, 15, 27, 0.18)" stroke="rgba(255,255,255,0.22)" stroke-width="2" />
        <rect x="${x + 18}" y="${topY + 18}" width="${tileWidth - 36}" height="56" rx="20" fill="rgba(9, 15, 27, 0.42)" stroke="rgba(255,255,255,0.12)" stroke-width="2" />
        <text x="${x + tileWidth / 2}" y="${topY + 53}" text-anchor="middle" font-size="${titleFontSize}" font-weight="800" fill="#ffffff">${escapeSvg(titleText)}</text>
        <rect x="${x + 18}" y="${topY + 90}" width="${tileWidth - 36}" height="${tileHeight - 110}" rx="22" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.14)" stroke-width="2" />
      </g>
    `);
  }

  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#08111f" />
          <stop offset="50%" stop-color="#102846" />
          <stop offset="100%" stop-color="#1c3458" />
        </linearGradient>
        ${defs.join("\n")}
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bgGrad)" />
      ${tileBlocks.join("\n")}
    </svg>
  `;

  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  const overlays = (
    await Promise.all(
      pool.map(async (rawCard, index) => {
        const card = normalizeCardRow(rawCard);
        const emojiUrl = getEmojiImageUrl(card.card_emoji);
        const source = await fetchImageBuffer(
          emojiUrl,
          `BetRoyale card image ${card.name}`,
        );

        if (!source) return null;

        const rendered = await sharp(source, { animated: true })
          .resize(236, 236, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toBuffer()
          .catch(() => null);

        if (!rendered) return null;

        const x = startX + index * (tileWidth + gap);
        return {
          input: rendered,
          left: Math.round(x + (tileWidth - 236) / 2),
          top: topY + 108,
        };
      }),
    )
  ).filter(Boolean);

  if (!overlays.length) {
    return base;
  }

  return sharp(base).composite(overlays).png().toBuffer();
}

function renderCardEmoji(card) {
  return String(card?.card_emoji || "").trim() || "▫️";
}

function buildDeckPreviewText(deck, title = "Your Deck") {
  const drafted = Array.isArray(deck) ? deck : [];
  const elixirValues = drafted
    .map((card) => Number(card?.elixir_cost))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const avgElixir = elixirValues.length
    ? (elixirValues.reduce((sum, value) => sum + value, 0) / elixirValues.length).toFixed(1)
    : "-";
  const slots = drafted
    .slice(0, TOTAL_ROUNDS)
    .map((card) => renderCardEmoji(card));

  while (slots.length < TOTAL_ROUNDS) {
    slots.push("▫️");
  }

  const draftedNames = drafted.length
    ? drafted.map((card) => `\`${card.name}\``).join(" • ")
    : "-# No cards drafted yet.";

  return `### ${title} (${drafted.length}/${TOTAL_ROUNDS}) • Avg. Elixir: ${avgElixir}\n# ${slots.join(" ")}\n${draftedNames}`;
}

function buildDeckSummaryLines(deck) {
  return deck
    .slice(0, TOTAL_ROUNDS)
    .map((card, index) => {
      const emoji = renderCardEmoji(card);
      const elixir = card?.elixir_cost == null ? "?" : String(card.elixir_cost);
      return `${index + 1}. ${emoji} **${card.name}** (${elixir} elixir)`;
    })
    .join("\n");
}

function buildReadinessText(game) {
  const p1Last = game.p1Deck.length
    ? `${renderCardEmoji(game.p1Deck[game.p1Deck.length - 1])} ${game.p1Deck[game.p1Deck.length - 1].name}`
    : "None yet";
  const p2Last = game.p2Deck.length
    ? `${renderCardEmoji(game.p2Deck[game.p2Deck.length - 1])} ${game.p2Deck[game.p2Deck.length - 1].name}`
    : "None yet";
  return [
    "### Status:",
    `${getPlayerMention(game.player1Id)}: ${getReadyLabel(game, "p1")} (${game.p1Deck.length}/${TOTAL_ROUNDS}) | Last: ${p1Last}`,
    `${getPlayerMention(game.player2Id)}: ${getReadyLabel(game, "p2")} (${game.p2Deck.length}/${TOTAL_ROUNDS}) | Last: ${p2Last}`,
  ].join("\n");
}

function buildCopyDeckLink(deck) {
  const ids = deck
    .slice(0, TOTAL_ROUNDS)
    .map((card) => Number(card?.card_id))
    .filter((value) => Number.isFinite(value));

  if (ids.length !== TOTAL_ROUNDS) {
    return null;
  }

  return `https://link.clashroyale.com/en/?clashroyale://copyDeck?deck=${encodeURIComponent(ids.join(";"))}&l=${encodeURIComponent(COPY_DECK_LANGUAGE)}&tt=${COPY_DECK_TT}`;
}

function createPrimaryEditEmoji() {
  return (
    parseEmojiValue(global.db.getFeatherEmojiMarkdown("edit-3")) ||
    parseEmojiValue(global.db.getFeatherEmojiMarkdown("edit")) || {
      name: "✏️",
    }
  );
}

function getSpecialEventLabel(roundType) {
  if (roundType === ROUND_TYPE_EVO) return "⚡ Evolution Event";
  if (roundType === ROUND_TYPE_HERO) return "🦸 Hero Event";
  return null;
}

function buildSpecialEventNotice(game) {
  const label = getSpecialEventLabel(game.roundType);
  if (!label) return null;
  const desc =
    game.roundType === ROUND_TYPE_EVO
      ? "Pick an Evolution for a card you already own! This grants a bonus +1 card slot. If outbid, you'll receive a random Evo."
      : "Pick a Hero version of a card you already own! This grants a bonus +1 card slot. If outbid, you'll receive a random Hero.";
  return `### ${label}\n-# ${desc}`;
}

async function buildActiveGameMessage(game) {
  const attachmentName = `betroyale-${game.gameId}-round-${game.round}.png`;
  const buffer = await renderRoundPoolImage(game.pool, game.round);
  const attachment = new AttachmentBuilder(buffer, { name: attachmentName });

  const isSpecial = game.roundType === ROUND_TYPE_EVO || game.roundType === ROUND_TYPE_HERO;
  const accentColor = game.roundType === ROUND_TYPE_EVO
    ? 0x9b59b6
    : game.roundType === ROUND_TYPE_HERO
      ? 0xe74c3c
      : 0xf1c40f;

  const roundLabel = isSpecial
    ? `## BetRoyale\n-# ${getSpecialEventLabel(game.roundType)} • Bonus Round`
    : `## BetRoyale\n-# Round ${game.round}/${TOTAL_ROUNDS}`;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(roundLabel),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`${OPEN_BET_MENU_PREFIX}:${game.gameId}`)
            .setLabel("Submit Bet")
            .setStyle(ButtonStyle.Primary)
            .setEmoji(createPrimaryEditEmoji()),
        ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  if (isSpecial) {
    const notice = buildSpecialEventNotice(game);
    if (notice) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(notice),
      );
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    }
  }

  container
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${attachmentName}`),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(buildReadinessText(game)),
    );

  return {
    components: [container],
    files: [attachment],
  };
}

function createDeckLinkButton(url) {
  if (!url) {
    return new ButtonBuilder()
      .setCustomId(`${ROUTE_PREFIX}:disabled`)
      .setLabel("Link Unavailable")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);
  }

  return new ButtonBuilder()
    .setLabel("Deck Copy Link")
    .setStyle(ButtonStyle.Link)
    .setURL(url);
}

function buildCompletedGameMessage(game) {
  const p1Link = buildCopyDeckLink(game.p1Deck);
  const p2Link = buildCopyDeckLink(game.p2Deck);

  const container = new ContainerBuilder()
    .setAccentColor(0x2ecc71)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## BetRoyale Complete"),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## ${getPlayerMention(game.player1Id)}\n${buildDeckSummaryLines(game.p1Deck)}`,
          ),
        )
        .setButtonAccessory(createDeckLinkButton(p1Link)),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## ${getPlayerMention(game.player2Id)}\n${buildDeckSummaryLines(game.p2Deck)}`,
          ),
        )
        .setButtonAccessory(createDeckLinkButton(p2Link)),
    );

  return {
    components: [container],
  };
}

async function buildGameMessage(game) {
  if (game.status === STATUS_COMPLETED) {
    return buildCompletedGameMessage(game);
  }
  return buildActiveGameMessage(game);
}

function buildBetMenuCustomId(action, gameId, round, selectedCard, selectedPower, value = 0) {
  return [
    ROUTE_PREFIX,
    action,
    gameId,
    String(round),
    String(selectedCard || 0),
    String(selectedPower || 0),
    String(value || 0),
  ].join(":");
}

function parseBetMenuCustomId(customId) {
  const [route, action, gameId, roundRaw, cardRaw, powerRaw, valueRaw] = String(
    customId || "",
  ).split(":");
  if (route !== ROUTE_PREFIX || !action || !gameId) return null;

  return {
    action,
    gameId,
    round: Math.max(0, Math.trunc(Number(roundRaw || 0))),
    selectedCard: Math.max(0, Math.trunc(Number(cardRaw || 0))),
    selectedPower: Math.max(0, Math.trunc(Number(powerRaw || 0))),
    value: Math.max(0, Math.trunc(Number(valueRaw || 0))),
  };
}

function buildBetLockedMessage(game, side) {
  const bet = getSideBet(game, side);
  const deck = getSideDeck(game, side);
  const selectedCard = bet ? game.pool[bet.cardIndex - 1] : null;
  const isSpecial = game.roundType === ROUND_TYPE_EVO || game.roundType === ROUND_TYPE_HERO;
  const specialNote = isSpecial
    ? `\n-# This is a ${getSpecialEventLabel(game.roundType)} — your pick counts as a bonus card!`
    : "";

  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(0x95a5a6)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## Submit Your Bet\nRound ${game.round}/${TOTAL_ROUNDS}\nYour bet is locked: ${selectedCard ? selectedCard.name : `Card ${bet?.cardIndex || "?"}`} with Power ${bet?.power || "?"}.${specialNote}`,
          ),
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(buildDeckPreviewText(deck)),
        ),
    ],
  };
}

function buildExpiredMenuMessage(reason) {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(0xe74c3c)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## Submit Your Bet\n${reason}`),
        ),
    ],
  };
}

// For special rounds, determine which pool cards this player is eligible to pick
// (i.e. they own the base card). Returns Set of pool indices (0-based) they can pick.
function getEligiblePoolIndices(game, side) {
  if (game.roundType !== ROUND_TYPE_EVO && game.roundType !== ROUND_TYPE_HERO) {
    // Normal round: all pool cards eligible
    return new Set(game.pool.map((_, i) => i));
  }

  const deck = getSideDeck(game, side);
  const deckNames = new Set(deck.map((c) => String(c?.name || "").toLowerCase()));

  const eligible = new Set();
  for (let i = 0; i < game.pool.length; i++) {
    const card = game.pool[i];
    // baseName is the original card name (same as the base card name)
    const base = String(card?.baseName || card?.name || "").toLowerCase();
    if (deckNames.has(base)) {
      eligible.add(i);
    }
  }
  return eligible;
}

function buildBetMenuMessage(game, userId, selectedCard = 0, selectedPower = 0) {
  const side = getPlayerSide(game, userId);
  if (!side) {
    return buildExpiredMenuMessage("Only the two active players can use this menu.");
  }

  const lockedBet = getSideBet(game, side);
  if (lockedBet) {
    return buildBetLockedMessage(game, side);
  }

  const usedPowers = getSideUsedPowers(game, side);
  const deck = getSideDeck(game, side);
  const isSpecial = game.roundType === ROUND_TYPE_EVO || game.roundType === ROUND_TYPE_HERO;
  const eligibleIndices = isSpecial ? getEligiblePoolIndices(game, side) : null;

  const canLock =
    selectedCard >= 1 &&
    selectedCard <= ROUND_POOL_SIZE &&
    selectedPower >= 1 &&
    selectedPower <= TOTAL_ROUNDS &&
    !usedPowers.includes(selectedPower);

  const cardButtons = [];
  for (let i = 1; i <= game.pool.length; i += 1) {
    const card = game.pool[i - 1];
    const cardEmoji = parseEmojiValue(card?.card_emoji || "");
    const isEligible = !isSpecial || eligibleIndices?.has(i - 1);
    const button = new ButtonBuilder()
      .setCustomId(
        buildBetMenuCustomId(
          "card",
          game.gameId,
          game.round,
          selectedCard,
          selectedPower,
          i,
        ),
      )
      .setLabel(String(card?.name || `Card ${i}`).slice(0, 80))
      .setStyle(selectedCard === i ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!isEligible);

    if (cardEmoji) {
      button.setEmoji(cardEmoji);
    }

    cardButtons.push(button);
  }

  const powerRows = [];
  for (let rowIndex = 0; rowIndex < 2; rowIndex += 1) {
    const row = new ActionRowBuilder();
    const start = rowIndex === 0 ? 1 : 5;
    const end = rowIndex === 0 ? 4 : 8;
    for (let power = start; power <= end; power += 1) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(
            buildBetMenuCustomId(
              "power",
              game.gameId,
              game.round,
              selectedCard,
              selectedPower,
              power,
            ),
          )
          .setEmoji({ name: POWER_BUTTON_EMOJIS[power] || String(power) })
          .setStyle(selectedPower === power ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(usedPowers.includes(power)),
      );
    }
    powerRows.push(row);
  }

  const specialBanner = isSpecial
    ? `\n> ${getSpecialEventLabel(game.roundType)}: Pick a card you own the base of. Winning earns a bonus card!`
    : "";

  const container = new ContainerBuilder()
    .setAccentColor(isSpecial ? (game.roundType === ROUND_TYPE_EVO ? 0x9b59b6 : 0xe74c3c) : 0x5865f2)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## Submit Your Bet${specialBanner}`),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(
              buildBetMenuCustomId(
                "lock",
                game.gameId,
                game.round,
                selectedCard,
                selectedPower,
              ),
            )
            .setLabel("Lock Bet")
            .setStyle(ButtonStyle.Success)
            .setDisabled(!canLock),
        ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Select Card"),
    )
    .addActionRowComponents(new ActionRowBuilder().addComponents(...cardButtons))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Select Power Level"),
    )
    .addActionRowComponents(...powerRows)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(buildDeckPreviewText(deck)),
    )
    ;

  return {
    components: [container],
  };
}

function sampleWithoutReplacement(items, count) {
  const pool = Array.isArray(items) ? [...items] : [];
  const picks = [];

  while (pool.length && picks.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(index, 1)[0]);
  }

  return picks;
}

function drawRoundPool(excludedCardIds = []) {
  const rows = global.db.safeQuery(
    `
    SELECT name, card_emoji, rarity, elixir_cost, card_id
    FROM clash_royale_cards
    WHERE is_event_only = 0 AND card_id IS NOT NULL
    `,
    [],
    [],
  );
  const seen = new Set(
    excludedCardIds
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0),
  );
  const uniqueCards = [];
  const usedIds = new Set();

  for (const row of rows) {
    const card = normalizeCardRow(row);
    const cardId = getCardId(card);
    if (cardId == null || seen.has(cardId) || usedIds.has(cardId)) {
      continue;
    }
    usedIds.add(cardId);
    uniqueCards.push(card);
  }

  return sampleWithoutReplacement(uniqueCards, ROUND_POOL_SIZE);
}

/**
 * Draw a pool of evo or hero cards for a special event round.
 * Picks up to ROUND_POOL_SIZE cards that have an evo/hero emoji.
 * Cards where either player owns the base card are preferred/included.
 * If the combined eligible pool < ROUND_POOL_SIZE, fills remainder from
 * any available evo/hero cards.
 *
 * @param {"evo"|"hero"} kind
 * @param {string[]} p1DeckNames - normalized base card names player 1 owns
 * @param {string[]} p2DeckNames - normalized base card names player 2 owns
 * @returns {object[]} pool of special card rows (with specialKind, baseName, card_emoji=evo/hero emoji)
 */
function drawSpecialEventPool(kind, p1DeckNames, p2DeckNames) {
  const emojiField = kind === ROUND_TYPE_EVO ? "evo_emoji" : "hero_emoji";
  const rows = global.db.safeQuery(
    `
    SELECT name, card_emoji, ${emojiField} AS special_emoji, rarity, elixir_cost, card_id
    FROM clash_royale_cards
    WHERE is_event_only = 0
      AND card_id IS NOT NULL
      AND ${emojiField} IS NOT NULL
      AND ${emojiField} != ''
    `,
    [],
    [],
  );

  if (!rows || rows.length === 0) return [];

  const p1Set = new Set(p1DeckNames.map((n) => n.toLowerCase()));
  const p2Set = new Set(p2DeckNames.map((n) => n.toLowerCase()));

  const eligible = [];
  const others = [];

  for (const row of rows) {
    const name = String(row?.name || "").toLowerCase();
    // Build a normalized card row with the special emoji overriding card_emoji
    const card = normalizeSpecialCardRow({ ...row, [emojiField]: row.special_emoji }, kind);
    if (p1Set.has(name) || p2Set.has(name)) {
      eligible.push(card);
    } else {
      others.push(card);
    }
  }

  // Shuffle eligible, pick up to ROUND_POOL_SIZE; fill remainder with others
  const picks = sampleWithoutReplacement(eligible, ROUND_POOL_SIZE);
  if (picks.length < ROUND_POOL_SIZE) {
    const filler = sampleWithoutReplacement(others, ROUND_POOL_SIZE - picks.length);
    picks.push(...filler);
  }

  return picks;
}

function resolveRoundAwards(game) {
  const p1Bet = game.p1Bet;
  const p2Bet = game.p2Bet;
  const p1Target = cloneCard(game.pool[p1Bet.cardIndex - 1]);
  const p2Target = cloneCard(game.pool[p2Bet.cardIndex - 1]);

  let p1Award = null;
  let p2Award = null;

  const isSpecial = game.roundType === ROUND_TYPE_EVO || game.roundType === ROUND_TYPE_HERO;

  if (p1Bet.cardIndex === p2Bet.cardIndex && p1Bet.power === p2Bet.power) {
    // Both tied: each gets a random card from the remaining pool
    const remaining = game.pool.filter((_, index) => index !== p1Bet.cardIndex - 1);
    const [firstRandom, secondRandom] = sampleWithoutReplacement(remaining, 2);
    p1Award = cloneCard(firstRandom);
    p2Award = cloneCard(secondRandom);
  } else if (p1Bet.power === p2Bet.power) {
    // Same power, different cards: both get their target
    p1Award = p1Target;
    p2Award = p2Target;
  } else if (p1Bet.power > p2Bet.power) {
    // P1 wins: gets target; P2 gets random from remaining
    p1Award = p1Target;
    const remaining = game.pool.filter((_, index) => index !== p1Bet.cardIndex - 1);
    p2Award = cloneCard(sampleWithoutReplacement(remaining, 1)[0]);
  } else {
    // P2 wins: gets target; P1 gets random from remaining
    p2Award = p2Target;
    const remaining = game.pool.filter((_, index) => index !== p2Bet.cardIndex - 1);
    p1Award = cloneCard(sampleWithoutReplacement(remaining, 1)[0]);
  }

  // For special rounds: a player who gets "outbid" (random card) and that card's
  // baseName isn't in their deck gains nothing — the special card just doesn't get added.
  // (The caller handles this via specialKind + baseName fields on the card.)
  if (isSpecial) {
    p1Award = p1Award ? { ...p1Award, _specialRound: game.roundType } : null;
    p2Award = p2Award ? { ...p2Award, _specialRound: game.roundType } : null;
  }

  return {
    p1Award,
    p2Award,
  };
}

function persistRoundState(gameId, payload) {
  global.db.safeQuery(
    `
    UPDATE betroyale_games
    SET
      round = ?,
      round_type = ?,
      special_event_kind = ?,
      pool_json = ?,
      seen_cards_json = ?,
      p1_deck_json = ?,
      p2_deck_json = ?,
      p1_specials_json = ?,
      p2_specials_json = ?,
      p1_used_powers_json = ?,
      p2_used_powers_json = ?,
      bonus_one_tokens = ?,
      p1_bonus_ones_used = ?,
      p2_bonus_ones_used = ?,
      p1_bet_json = ?,
      p2_bet_json = ?,
      status = ?
    WHERE game_id = ?
    `,
    [
      payload.round,
      payload.roundType || ROUND_TYPE_NORMAL,
      payload.specialEventKind || null,
      JSON.stringify(payload.pool),
      JSON.stringify(payload.seenCardIds || []),
      JSON.stringify(payload.p1Deck),
      JSON.stringify(payload.p2Deck),
      JSON.stringify(payload.p1Specials || []),
      JSON.stringify(payload.p2Specials || []),
      JSON.stringify(payload.p1UsedPowers),
      JSON.stringify(payload.p2UsedPowers),
      payload.bonusOneTokens || 0,
      payload.p1BonusOnesUsed || 0,
      payload.p2BonusOnesUsed || 0,
      payload.p1Bet == null ? null : JSON.stringify(payload.p1Bet),
      payload.p2Bet == null ? null : JSON.stringify(payload.p2Bet),
      payload.status,
      gameId,
    ],
  );
}

/**
 * Record that a special event of the given kind happened in this game.
 * Uses an in-memory table approach (we re-use the betroyale_games special_event_kind
 * field per-round, but since we overwrite, we store the count differently).
 *
 * We track this by storing cumulative counts directly in a JSON field on the game row.
 * Since DB schema adds `bonus_one_tokens` as an int that increments per special round,
 * we can store evo/hero counts in `p1_last_award_json` temporarily, or better:
 * we store them in a dedicated fashion.
 *
 * Simpler approach: count special rounds in `bonus_one_tokens` and track kind
 * in `special_event_kind` (which records the LAST special kind). To distinguish
 * evo from hero across the full draft, we store a JSON array in `p1_specials_json`.
 * But this is already used for collected specials.
 *
 * ACTUAL SOLUTION: Add a lightweight betroyale_events table to track per-game events.
 * The schema already has this conceptually; we'll use game-level bitmask stored in
 * bonus_one_tokens: bit 0 = evo event happened, bit 1 = hero event happened.
 */
function recordSpecialEvent(gameId, kind) {
  const bit = kind === ROUND_TYPE_EVO ? 1 : 2;
  global.db.safeQuery(
    `UPDATE betroyale_games SET bonus_one_tokens = bonus_one_tokens | ? WHERE game_id = ?`,
    [bit, gameId],
  );
}

function hasSpecialEventOccurred(game, kind) {
  const bit = kind === ROUND_TYPE_EVO ? 1 : 2;
  return (game.bonusOneTokens & bit) !== 0;
}

/**
 * Resolve the current round awards and advance to the next round.
 * Returns the freshly-loaded next game state.
 */
function resolveCurrentRound(game) {
  const awards = resolveRoundAwards(game);

  const nextP1Deck = [...game.p1Deck];
  const nextP2Deck = [...game.p2Deck];

  // For special rounds: replace the base card in the deck with its special version.
  if (game.roundType === ROUND_TYPE_EVO || game.roundType === ROUND_TYPE_HERO) {
    const p1DeckNames = new Set(game.p1Deck.map((c) => String(c?.name || "").toLowerCase()));
    const p2DeckNames = new Set(game.p2Deck.map((c) => String(c?.name || "").toLowerCase()));

    if (awards.p1Award) {
      const base = String(awards.p1Award.baseName || awards.p1Award.name || "").toLowerCase();
      const index = nextP1Deck.findIndex(c => String(c.name).toLowerCase() === base);
      if (index !== -1) {
        const { _specialRound, baseName, specialKind, ...cleanCard } = awards.p1Award;
        nextP1Deck[index] = cleanCard;
      }
    }
    if (awards.p2Award) {
      const base = String(awards.p2Award.baseName || awards.p2Award.name || "").toLowerCase();
      const index = nextP2Deck.findIndex(c => String(c.name).toLowerCase() === base);
      if (index !== -1) {
        const { _specialRound, baseName, specialKind, ...cleanCard } = awards.p2Award;
        nextP2Deck[index] = cleanCard;
      }
    }
  } else {
    // Normal round awards add a new card to the deck.
    if (awards.p1Award) nextP1Deck.push(awards.p1Award);
    if (awards.p2Award) nextP2Deck.push(awards.p2Award);
  }

  const nextP1Used = Array.from(new Set([...game.p1UsedPowers, game.p1Bet.power]));
  const nextP2Used = Array.from(new Set([...game.p2UsedPowers, game.p2Bet.power]));

  // Record that this special event kind happened
  if (game.roundType !== ROUND_TYPE_NORMAL) {
    recordSpecialEvent(game.gameId, game.roundType);
  }

  // Roll for potential special events in the next round.
  let nextRoundType = ROUND_TYPE_NORMAL;
  let nextSpecialEventKind = null;
  let nextPool = null;

  if (game.evoHeroEventsEnabled) {
    const evoAlreadyHappened = hasSpecialEventOccurred(game, ROUND_TYPE_EVO);
    const heroAlreadyHappened = hasSpecialEventOccurred(game, ROUND_TYPE_HERO);

    const rollEvo = !evoAlreadyHappened && Math.random() < EVO_HERO_EVENT_CHANCE;
    const rollHero = !heroAlreadyHappened && !rollEvo && Math.random() < EVO_HERO_EVENT_CHANCE;

    if (rollEvo) {
      nextRoundType = ROUND_TYPE_EVO;
      nextSpecialEventKind = ROUND_TYPE_EVO;
      const p1Names = nextP1Deck.map((c) => String(c?.name || ""));
      const p2Names = nextP2Deck.map((c) => String(c?.name || ""));
      nextPool = drawSpecialEventPool(ROUND_TYPE_EVO, p1Names, p2Names);
    } else if (rollHero) {
      nextRoundType = ROUND_TYPE_HERO;
      nextSpecialEventKind = ROUND_TYPE_HERO;
      const p1Names = nextP1Deck.map((c) => String(c?.name || ""));
      const p2Names = nextP2Deck.map((c) => String(c?.name || ""));
      nextPool = drawSpecialEventPool(ROUND_TYPE_HERO, p1Names, p2Names);
    }
  }

  // Determine game progression.
  const draftFinished = nextP1Deck.length >= TOTAL_ROUNDS;

  if (nextPool) {
    persistRoundState(game.gameId, {
      round: game.round + 1,
      roundType: nextRoundType,
      specialEventKind: nextSpecialEventKind,
      pool: nextPool,
      seenCardIds: game.seenCardIds, // special rounds don't consume main pool
      p1Deck: nextP1Deck,
      p2Deck: nextP2Deck,
      p1Specials: game.p1Specials,
      p2Specials: game.p2Specials,
      p1UsedPowers: nextP1Used,
      p2UsedPowers: nextP2Used,
      bonusOneTokens: game.bonusOneTokens,
      p1BonusOnesUsed: game.p1BonusOnesUsed,
      p2BonusOnesUsed: game.p2BonusOnesUsed,
      p1Bet: null,
      p2Bet: null,
      status: STATUS_ACTIVE,
    });
    return loadGame(game.gameId);
  }

  if (draftFinished) {
    persistRoundState(game.gameId, {
      round: game.round, 
      roundType: ROUND_TYPE_NORMAL,
      specialEventKind: null,
      pool: [],
      seenCardIds: game.seenCardIds,
      p1Deck: nextP1Deck,
      p2Deck: nextP2Deck,
      p1Specials: game.p1Specials,
      p2Specials: game.p2Specials,
      p1UsedPowers: nextP1Used,
      p2UsedPowers: nextP2Used,
      bonusOneTokens: game.bonusOneTokens,
      p1BonusOnesUsed: game.p1BonusOnesUsed,
      p2BonusOnesUsed: game.p2BonusOnesUsed,
      p1Bet: null,
      p2Bet: null,
      status: STATUS_COMPLETED,
    });
    return loadGame(game.gameId);
  }

  // Otherwise, must be a normal round next
  nextPool = drawRoundPool(game.seenCardIds);
  persistRoundState(game.gameId, {
    round: game.round + 1,
    roundType: ROUND_TYPE_NORMAL,
    specialEventKind: null,
    pool: nextPool,
    seenCardIds: collectSeenCardIds(game.seenCardIds, nextPool),
    p1Deck: nextP1Deck,
    p2Deck: nextP2Deck,
    p1Specials: game.p1Specials,
    p2Specials: game.p2Specials,
    p1UsedPowers: nextP1Used,
    p2UsedPowers: nextP2Used,
    bonusOneTokens: game.bonusOneTokens,
    p1BonusOnesUsed: game.p1BonusOnesUsed,
    p2BonusOnesUsed: game.p2BonusOnesUsed,
    p1Bet: null,
    p2Bet: null,
    status: STATUS_ACTIVE,
  });

  return loadGame(game.gameId);
}

async function fetchGameMessage(game) {
  if (!game?.channelId || !game?.messageId) return null;
  const channel =
    global.bot.channels.cache.get(game.channelId) ||
    (await global.bot.channels.fetch(game.channelId).catch(() => null));

  if (!channel?.messages?.fetch) return null;
  return channel.messages.fetch(game.messageId).catch(() => null);
}

/**
 * Edit the game's main message to reflect the current state.
 *
 * Bugfix: To prevent a race where a mid-round "readiness update" edit (sent by
 * the first player who locks) arrives AFTER the final "game complete" edit
 * (sent by the second player who locks), we re-load the game from the database
 * immediately before building and sending the edit. If the game has advanced
 * beyond what we were asked to display, we use the freshest state instead.
 *
 * @param {object} game - The game state at the time of the call (may be stale).
 */
async function refreshGameMessage(game) {
  // Re-read the latest game state from DB to avoid stale edits winning the race.
  const freshGame = loadGame(game.gameId) || game;

  const message = await fetchGameMessage(freshGame);
  if (!message) return;

  const payload = await buildGameMessage(freshGame);
  const editPayload = {
    content: payload.content || "",
    components: payload.components || [],
    attachments: [],
  };

  if (payload.files?.length) {
    editPayload.files = payload.files;
  }

  await message.edit(editPayload).catch((error) => {
    console.error("BetRoyale message update failed:", error?.message || error);
  });
}

function createGameId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function canStartGame() {
  const eligible = global.db.safeQuery(
    `
    SELECT COUNT(DISTINCT card_id) AS count
    FROM clash_royale_cards
    WHERE is_event_only = 0 AND card_id IS NOT NULL
    `,
    [],
    [],
  )?.[0];
  return {
    eligibleCount: Number(eligible?.count || 0),
  };
}

async function runBetRoyaleCommand(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "BetRoyale can only be started in a server channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const opponent = interaction.options.getUser("user", true);
  if (!opponent || opponent.bot) {
    await interaction.reply({
      content: "Pick a non-bot user for BetRoyale.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (opponent.id === interaction.user.id) {
    await interaction.reply({
      content: "You need a different user for BetRoyale.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  console.log(`[BetRoyale] Starting command for user ${interaction.user.id} in channel ${interaction.channelId} (Interaction: ${interaction.id})`);
  const existingGame = loadActiveGameInChannel(interaction.channelId);
  if (existingGame) {
    console.log(`[BetRoyale] Found existing game ${existingGame.gameId} with status ${existingGame.status}`);
    const container = new ContainerBuilder()
      .setAccentColor(0xe74c3c)
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("## Info: There is already an active game in this channel"),
          )
          .setButtonAccessory(
            new ButtonBuilder()
              .setCustomId(buildBetMenuCustomId("terminate", existingGame.gameId, existingGame.round, 0, 0, 0))
              .setLabel("Terminate match")
              .setStyle(ButtonStyle.Danger),
          ),
      );

    await interaction.reply({
      components: [container],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
    return;
  }
  console.log(`[BetRoyale] No existing game found. Proceeding with creation.`);

  const counts = canStartGame();
  if (counts.eligibleCount < REQUIRED_UNIQUE_CARDS) {
    await interaction.reply({
      content:
        `Not enough unique Clash Royale cards are available for BetRoyale. ${REQUIRED_UNIQUE_CARDS} unique non-event cards with synced numeric ids are required.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const evoHeroEventsEnabled = interaction.options.getBoolean("evo-hero-events") ?? false;

  const gameId = createGameId();
  const openingPool = drawRoundPool();
  global.db.safeQuery(
    `
    INSERT INTO betroyale_games (
      game_id,
      channel_id,
      player1_id,
      player2_id,
      round,
      round_type,
      special_event_kind,
      evo_hero_events_enabled,
      pool_json,
      seen_cards_json,
      p1_deck_json,
      p2_deck_json,
      p1_specials_json,
      p2_specials_json,
      p1_used_powers_json,
      p2_used_powers_json,
      bonus_one_tokens,
      p1_bonus_ones_used,
      p2_bonus_ones_used,
      p1_bet_json,
      p2_bet_json,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', '[]', '[]', '[]', '[]', 0, 0, 0, NULL, NULL, ?)
    `,
    [
      gameId,
      interaction.channelId,
      interaction.user.id,
      opponent.id,
      1,
      ROUND_TYPE_NORMAL,
      null,
      evoHeroEventsEnabled ? 1 : 0,
      JSON.stringify(openingPool),
      JSON.stringify(collectSeenCardIds(openingPool)),
      STATUS_ACTIVE,
    ],
  );

  const game = loadGame(gameId);
  const payload = await buildGameMessage(game);

  console.log(`[BetRoyale] Replying with new match message (Interaction: ${interaction.id})`);
  await interaction.reply({
    ...payload,
    flags: MessageFlags.IsComponentsV2,
  });

  const reply = await interaction.fetchReply().catch(() => null);
  if (reply?.id) {
    global.db.safeQuery(
      `UPDATE betroyale_games SET message_id = ? WHERE game_id = ?`,
      [reply.id, gameId],
    );
  }
}

async function handleOpenBetMenu(interaction) {
  const [, gameId] = String(interaction.customId || "").split(":");
  const game = loadGame(gameId);

  if (!game) {
    const container = new ContainerBuilder()
      .setAccentColor(0xe74c3c)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("## Error\nThis BetRoyale game no longer exists."),
      );

    await interaction.reply({
      components: [container],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
    return;
  }

  if (!getPlayerSide(game, interaction.user.id)) {
    const container = new ContainerBuilder()
      .setAccentColor(0xe74c3c)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("## Error\nOnly the two active players can submit bets in this game."),
      );

    await interaction.reply({
      components: [container],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
    return;
  }

  if (game.status === STATUS_COMPLETED) {
    const container = new ContainerBuilder()
      .setAccentColor(0xe74c3c)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("## Error\nThis BetRoyale game is already complete."),
      );

    await interaction.reply({
      components: [container],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
    return;
  }

  if (game.status === STATUS_RESOLVING) {
    const container = new ContainerBuilder()
      .setAccentColor(0xe74c3c)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("## Error\nThis BetRoyale round is resolving right now. Reopen the menu in a moment."),
      );

    await interaction.reply({
      components: [container],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
    return;
  }

  await interaction.reply({
    ...buildBetMenuMessage(game, interaction.user.id),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}

async function handleBetRoyaleButton(interaction) {
  const parsed = parseBetMenuCustomId(interaction.customId);
  if (!parsed || parsed.action === "disabled") return;

  const game = loadGame(parsed.gameId);
  if (!game) {
    await interaction.update(
      buildExpiredMenuMessage("This BetRoyale game no longer exists."),
    );
    return;
  }

  if (parsed.action === "terminate") {
    // Delete ALL active/resolving games in this channel to ensure a clean slate.
    global.db.safeQuery(
      `DELETE FROM betroyale_games WHERE channel_id = ? AND status != ?`,
      [game.channelId, STATUS_COMPLETED],
    );
    const container = new ContainerBuilder()
      .setAccentColor(0x2ecc71)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("## All Channel Matches Terminated\nAny active or resolving games in this channel have been deleted. You can now start a new draft."),
      );

    await interaction.update({
      components: [container],
    });
    return;
  }

  if (!getPlayerSide(game, interaction.user.id)) {
    const container = new ContainerBuilder()
      .setAccentColor(0xe74c3c)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("## Error\nOnly the two active players can use this menu."),
      );

    await interaction.reply({
      components: [container],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
    return;
  }

  if (game.status !== STATUS_ACTIVE) {
    await interaction.update(
      buildExpiredMenuMessage(
        game.status === STATUS_COMPLETED
          ? "This BetRoyale game is already complete."
          : "This round is already resolving. Reopen the menu after the update.",
      ),
    );
    return;
  }

  if (parsed.round !== game.round) {
    await interaction.update(
      buildExpiredMenuMessage(
        "This betting panel expired because the round changed. Use Submit Bet again.",
      ),
    );
    return;
  }

  const side = getPlayerSide(game, interaction.user.id);
  
  if (getSideBet(game, side)) {
    await interaction.update(buildBetLockedMessage(game, side));
    return;
  }

  if (parsed.action === "card") {
    await interaction.update(
      buildBetMenuMessage(game, interaction.user.id, parsed.value, parsed.selectedPower),
    );
    return;
  }

  if (parsed.action === "power") {
    await interaction.update(
      buildBetMenuMessage(game, interaction.user.id, parsed.selectedCard, parsed.value),
    );
    return;
  }

  if (parsed.action !== "lock") {
    return;
  }

  const cardIndex = parsed.selectedCard;
  const power = parsed.selectedPower;
  if (
    cardIndex < 1 ||
    cardIndex > game.pool.length ||
    power < 1 ||
    power > TOTAL_ROUNDS ||
    getSideUsedPowers(game, side).includes(power)
  ) {
    await interaction.update(
      buildExpiredMenuMessage("Your selection is invalid. Use Submit Bet again."),
    );
    return;
  }

  const betJson = JSON.stringify({ cardIndex, power });
  const lockResult = global.db.safeQuery(
    `
    UPDATE betroyale_games
    SET ${side === "p1" ? "p1_bet_json" : "p2_bet_json"} = ?
    WHERE game_id = ? AND status = ? AND ${side === "p1" ? "p1_bet_json" : "p2_bet_json"} IS NULL
    `,
    [betJson, game.gameId, STATUS_ACTIVE],
    null,
  );

  if (!Number(lockResult?.changes || 0)) {
    const refreshed = loadGame(game.gameId);
    await interaction.update(
      refreshed && getPlayerSide(refreshed, interaction.user.id)
        ? buildBetLockedMessage(refreshed, side)
        : buildExpiredMenuMessage("This round already moved forward."),
    );
    return;
  }

  const latestGame = loadGame(game.gameId);
  await interaction.deferUpdate().catch(() => {});
  await interaction.deleteReply().catch(async () => {
    await interaction.message?.delete?.().catch(() => {});
  });

  if (!latestGame?.p1Bet || !latestGame?.p2Bet) {
    // Only one player has locked — update the readiness display.
    // Bugfix: use setImmediate so that if the second player's resolution
    // arrives and edits the message first, this stale "active" edit
    // doesn't overwrite it. refreshGameMessage re-reads state from DB
    // right before editing, so it will get the latest game state.
    if (latestGame?.status === STATUS_ACTIVE) {
      await refreshGameMessage(latestGame);
    }
    return;
  }

  const resolveLock = global.db.safeQuery(
    `
    UPDATE betroyale_games
    SET status = ?
    WHERE game_id = ? AND status = ? AND p1_bet_json IS NOT NULL AND p2_bet_json IS NOT NULL
    `,
    [STATUS_RESOLVING, latestGame.gameId, STATUS_ACTIVE],
    null,
  );

  if (!Number(resolveLock?.changes || 0)) {
    return;
  }

  const resolvingGame = loadGame(latestGame.gameId);
  if (!resolvingGame) {
    return;
  }
  const nextGame = resolveCurrentRound(resolvingGame);
  if (nextGame) {
    await refreshGameMessage(nextGame);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clash-royale")
    .setDescription("Clash Royale commands")
    .addSubcommandGroup((group) =>
      group
        .setName("game")
        .setDescription("Clash Royale games")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("betroyale")
            .setDescription("Start an 8-round BetRoyale draft against another user")
            .addUserOption((option) =>
              option
                .setName("user")
                .setDescription("The opponent to challenge")
                .setRequired(true),
            )
            .addBooleanOption((option) =>
              option
                .setName("evo-hero-events")
                .setDescription(
                  "Enable special Evo/Hero bonus rounds (5% chance per round, max 1 evo + 1 hero per draft)",
                )
                .setRequired(false),
            ),
        ),
    ),
  async execute(interaction) {
    if (!interaction?.isChatInputCommand?.()) return;

    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(false);

    if (group === "game" && subcommand === "betroyale") {
      await runBetRoyaleCommand(interaction);
      return;
    }

    await interaction.reply({
      content: "This Clash Royale subcommand is not implemented yet.",
      flags: MessageFlags.Ephemeral,
    });
  },
};

if (!buttonHandlers.has(OPEN_BET_MENU_PREFIX)) {
  buttonHandlers.set(OPEN_BET_MENU_PREFIX, handleOpenBetMenu);
}

if (!buttonHandlers.has(ROUTE_PREFIX)) {
  buttonHandlers.set(ROUTE_PREFIX, handleBetRoyaleButton);
}
