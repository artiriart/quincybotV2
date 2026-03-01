const {
  ContainerBuilder,
  SectionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} = require("discord.js");
const { extractUserFromMention } = require("../handleMessageHelpers");
const { recognizeKarutaCardsFromUrl } = require("../karutaOcr");
const { recognizeKarutaCardsWithGemmaFromUrl } = require("../karutaGemma");

const KARUTA_RECOG_STATE_TYPE = "karuta_recognition_settings";
const KARUTA_GUILD_DROP_CALC_STATE_TYPE = "karuta_drop_calculation_enabled";

function getKarutaRecognitionMode() {
  const raw = global.db.getState(KARUTA_RECOG_STATE_TYPE, "global");
  if (!raw) return "tesseract";
  try {
    const parsed = JSON.parse(raw);
    const mode = String(parsed?.mode || "")
      .trim()
      .toLowerCase();
    if (["off", "tesseract", "gemma3"].includes(mode)) return mode;
  } catch {}
  return "tesseract";
}

function normalizeKarutaLookup(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function getKarutaDropImageUrl(message) {
  const fromAttachment = (
    message?.attachments?.find((a) =>
      String(a?.contentType || "")
        .toLowerCase()
        .startsWith("image/"),
    ) || message?.attachments?.first?.()
  )?.url;
  if (fromAttachment) return String(fromAttachment);

  const embed = message?.embeds?.[0];
  const fromEmbed = embed?.image?.url || embed?.thumbnail?.url || null;
  return fromEmbed ? String(fromEmbed) : null;
}

async function handleKarutaDropRecognition(message, settings) {
  if (!message?.guildId) return;
  const content = String(message?.content || "");
  if (!/\bis dropping\s+(3|4)\s+cards!/i.test(content)) return;

  const guildEnabled = settings.getGuildToggle(
    message.guildId,
    KARUTA_GUILD_DROP_CALC_STATE_TYPE,
    true,
  );
  if (!guildEnabled) return;

  const mode = getKarutaRecognitionMode();
  if (mode === "off") return;

  const imageUrl = getKarutaDropImageUrl(message);
  if (!imageUrl) return;

  let cards = [];
  let loadTimeSec = null;
  try {
    const result =
      mode === "gemma3"
        ? await recognizeKarutaCardsWithGemmaFromUrl(imageUrl)
        : await recognizeKarutaCardsFromUrl(imageUrl);
    cards = Array.isArray(result?.cards) ? result.cards.slice(0, 4) : [];
    loadTimeSec = Number(result?.load_time_sec);
  } catch (error) {
    console.error("[karuta-drop] recognition failed:", error?.message || error);
    return;
  }

  if (!cards.length) return;
  const dbEmoji = global.db.getFeatherEmojiMarkdown("database") || "";
  const clockEmoji = global.db.getFeatherEmojiMarkdown("clock") || "⏱️";
  const expireEmoji = global.db.getFeatherEmojiMarkdown("x-circle") || "❌";
  const numberEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];
  const lines = [];
  const pingUsers = new Set();

  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i] || {};
    const displayName = String(card?.name || "").trim() || "Unknown";
    const displaySeries = String(card?.series || "").trim() || "Unknown";
    const nameKey = normalizeKarutaLookup(displayName);
    const seriesKey = normalizeKarutaLookup(displaySeries);

    const knownCard = global.db.safeQuery(
      `
      SELECT 1
      FROM karuta_cards
      WHERE name = ? AND series = ?
      LIMIT 1
      `,
      [nameKey, seriesKey],
    )?.[0];

    const wishRows = global.db.safeQuery(
      `
      SELECT user_id
      FROM karuta_wishlists
      WHERE guild_id = ? AND series = ?
      ORDER BY user_id ASC
      `,
      [message.guildId, seriesKey],
      [],
    );
    const mentions = wishRows.map((row) => `<@${row.user_id}>`).filter(Boolean);
    for (const row of wishRows) {
      if (row?.user_id) pingUsers.add(String(row.user_id));
    }
    const mentionText = mentions.length ? mentions.join(", ") : "None";

    lines.push(
      `${numberEmojis[i] || `${i + 1}.`} **${displayName}** (${displaySeries})${knownCard ? "" : ` ${dbEmoji}`}`.trim(),
    );
    lines.push(`-# Series Wishlist: ${mentionText}`);
  }

  const expiresAtUnix = Math.floor(
    (Number(message?.createdTimestamp || Date.now()) + 60_000) / 1000,
  );
  const footerLine = `-# ${clockEmoji} ${Number.isFinite(loadTimeSec) ? `${loadTimeSec.toFixed(2)}s` : "?"} | ${expireEmoji} <t:${expiresAtUnix}:R>`;

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Karuta Drop"),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines.join("\n")),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLine));

  await message.channel
    .send({
      content: "",
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: [...pingUsers], parse: [] },
    })
    .catch(() => {});
}

async function handleKarutaMessage(message, settings) {
  await handleKarutaDropRecognition(message, settings);

  const embed = message?.embeds?.[0];
  const title = String(embed?.title || "");
  const description = String(embed?.description || "");

  const normalizeKarutaKey = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");

  const upsertKarutaCard = (input) => {
    const displayName = String(input?.displayName || "").trim();
    const displaySeries = String(input?.displaySeries || "").trim();
    const wishlistValue = Number.parseInt(
      String(input?.wishlist || "0").replaceAll(",", ""),
      10,
    );
    const wishlist = Number.isFinite(wishlistValue) ? wishlistValue : 0;
    const cardUrl = String(input?.cardUrl || "").trim();
    const name = normalizeKarutaKey(displayName);
    const series = normalizeKarutaKey(displaySeries);
    if (!name || !series) return;

    global.db.safeQuery(
      `
      INSERT INTO karuta_cards (name, series, display_name, display_series, wishlist, card_url)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name, series) DO UPDATE SET
        wishlist = excluded.wishlist,
        display_name = CASE
          WHEN COALESCE(excluded.display_name, '') <> '' THEN excluded.display_name
          ELSE karuta_cards.display_name
        END,
        display_series = CASE
          WHEN COALESCE(excluded.display_series, '') <> '' THEN excluded.display_series
          ELSE karuta_cards.display_series
        END,
        card_url = CASE
          WHEN COALESCE(karuta_cards.card_url, '') = '' AND COALESCE(excluded.card_url, '') <> ''
            THEN excluded.card_url
          ELSE karuta_cards.card_url
        END
      `,
      [name, series, displayName, displaySeries, wishlist, cardUrl],
    );
  };

  if (title === "Character Lookup") {
    const name = description.match(/Character\s*·\s*\*\*(.+?)\*\*/i)?.[1];
    const series = description.match(/Series\s*·\s*\*\*(.+?)\*\*/i)?.[1];
    const wishlist = description.match(
      /Wishlisted\s*·\s*\*\*(\d[\d,]*)\*\*/i,
    )?.[1];
    const cardUrl = String(embed?.thumbnail?.url || "").trim();

    if (name && series && wishlist) {
      upsertKarutaCard({
        displayName: name,
        displaySeries: series,
        wishlist,
        cardUrl,
      });
    }
    return;
  }

  if (title === "Character Results") {
    const lines = String(embed?.fields?.[0]?.value || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const match = line.match(
        /`(?:\d+)`\.\s*`♡([\d,]+)`\s*·\s*(.+?)\s*·\s*\*\*(.+?)\*\*/i,
      );
      if (!match) continue;
      const [, wishlist, series, name] = match;
      upsertKarutaCard({
        displayName: name,
        displaySeries: series,
        wishlist,
        cardUrl: "",
      });
    }
    return;
  }

  if (title !== "Visit Character") return;

  let reminderHours = null;
  if (description.includes("you were recently rejected.")) {
    reminderHours = 24;
  } else if (description.includes("date was successful!")) {
    reminderHours = 10;
  }

  const user = extractUserFromMention(description);
  const userId = user?.id;
  if (!userId || !reminderHours) return;

  const enabled = settings.getUserToggle(
    userId,
    "karuta_visit_reminders",
    true,
  );
  if (!enabled) return;

  global.db.createReminder(
    userId,
    message.channel,
    reminderHours * 60,
    "Karuta Visit",
    {
      command: `kvi ${description.split("`")?.[1] || ""}`,
      information: "You can visit your partner again",
    },
    true,
  );
}

module.exports = {
  handleKarutaMessage,
};
