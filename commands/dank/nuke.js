const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} = require("discord.js");
const { buttonHandlers } = require("../../functions/interactions/button");
const { selectMenuHandlers } = require("../../functions/interactions/selectMenu");

const ROUTE_PREFIX = "danknuke";
const VIEW_STATE_TYPE = "dank_nuke_view";

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

  if (text.length <= 8) return { name: text };
  return null;
}

function applyButtonEmoji(button, emoji) {
  if (emoji) button.setEmoji(emoji);
  return button;
}

function formatCoins(amount) {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  return value.toLocaleString("en-US");
}

function parseSessionEntries(rawJoinedUsernames) {
  const raw = String(rawJoinedUsernames || "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => {
          if (typeof entry === "string") {
            return { username: entry.trim(), amount: 0 };
          }
          const username = String(
            entry?.username || entry?.user || entry?.name || "",
          ).trim();
          const amount = Number.parseInt(
            String(entry?.amount || 0).replaceAll(",", ""),
            10,
          );
          return {
            username,
            amount: Number.isFinite(amount) ? amount : 0,
          };
        })
        .filter((entry) => entry.username);
    }

    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed)
        .map(([username, amount]) => ({
          username: String(username || "").trim(),
          amount: Number.parseInt(String(amount || 0).replaceAll(",", ""), 10) || 0,
        }))
        .filter((entry) => entry.username);
    }
  } catch {}

  return raw
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?)\s*[-|]\s*⏣?\s*([\d,]+)/);
      if (match) {
        return {
          username: String(match[1] || "").trim(),
          amount: Number.parseInt(String(match[2] || "0").replaceAll(",", ""), 10) || 0,
        };
      }
      return { username: line, amount: 0 };
    })
    .filter((entry) => entry.username);
}

function sumSessionEntries(entries) {
  return (entries || []).reduce((sum, entry) => {
    const amount = Number(entry?.amount || 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

function mergeSessionEntries(current, incoming) {
  const merged = new Map();
  for (const entry of [...(current || []), ...(incoming || [])]) {
    const username = String(entry?.username || "").trim();
    if (!username) continue;
    const amount = Number(entry?.amount || 0);
    const prev = merged.get(username) || 0;
    merged.set(username, prev + (Number.isFinite(amount) ? amount : 0));
  }

  return [...merged.entries()]
    .map(([username, amount]) => ({ username, amount }))
    .sort((a, b) => b.amount - a.amount || a.username.localeCompare(b.username));
}

function loadNukeStats(userId) {
  return (
    global.db.safeQuery(
      `
      SELECT
        total_nukes,
        session_nukes,
        total_revenue,
        session_revenue
      FROM dank_nuke_stats
      WHERE user_id = ?
      LIMIT 1
      `,
      [userId],
    )?.[0] || {
      total_nukes: 0,
      session_nukes: 0,
      total_revenue: 0,
      session_revenue: 0,
    }
  );
}

function loadSessionData(userId) {
  const row = global.db.safeQuery(
    `
    SELECT joined_usernames, revenue
    FROM dank_nuke_session
    WHERE host_user_id = ?
    LIMIT 1
    `,
    [userId],
  )?.[0];

  const entries = parseSessionEntries(row?.joined_usernames);
  const revenue = Number.parseInt(String(row?.revenue || 0), 10);
  const fallbackRevenue = sumSessionEntries(entries);
  return {
    entries,
    revenue: Number.isFinite(revenue) ? revenue : fallbackRevenue,
  };
}

function writeSessionData(userId, entries) {
  const revenue = sumSessionEntries(entries);
  global.db.safeQuery(
    `
    INSERT INTO dank_nuke_session (host_user_id, joined_usernames, revenue)
    VALUES (?, ?, ?)
    ON CONFLICT(host_user_id) DO UPDATE SET
      joined_usernames = excluded.joined_usernames,
      revenue = excluded.revenue
    `,
    [userId, JSON.stringify(entries), revenue],
  );
  return revenue;
}

function buildNukePanelPayload(viewState, notice = "") {
  const stats = loadNukeStats(viewState.userId);
  const { entries, revenue } = loadSessionData(viewState.userId);

  const globalEmoji = global.db.getFeatherEmojiMarkdown("globe") || "🌐";
  const mapEmoji = global.db.getFeatherEmojiMarkdown("map") || "🗺️";
  const clipboardEmoji =
    parseEmojiValue(global.db.getFeatherEmojiMarkdown("clipboard")) || { name: "📋" };
  const trash2Emoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("trash-2")) || {
    name: "🧹",
  };
  const trashEmoji = parseEmojiValue(global.db.getFeatherEmojiMarkdown("trash")) || {
    name: "🗑️",
  };
  const coinNukeEmoji = global.db.getDankItemEmojiMarkdown("Coin Nuke") || "💣";

  const allTimeNukes = Number.parseInt(String(stats?.total_nukes || 0), 10) || 0;
  const sessionNukes = Number.parseInt(String(stats?.session_nukes || 0), 10) || 0;
  const allTimeRevenue = Number.parseInt(String(stats?.total_revenue || 0), 10) || 0;
  const sessionTotal = Number.isFinite(Number(revenue))
    ? Number(revenue)
    : sumSessionEntries(entries);

  const listLines = entries.length
    ? entries.map((entry) => `* \`${entry.username}\` - ⏣ ${formatCoins(entry.amount)}`).join("\n")
    : "-# No session takes recorded.";

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("### Nuke Stats"))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${globalEmoji} All-time: ${coinNukeEmoji} ${allTimeNukes}x | ⏣ ${formatCoins(allTimeRevenue)}`,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  if (notice) {
    container
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${notice}`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  }

  container
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(listLines))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ROUTE_PREFIX}:remove:${viewState.token}`)
          .setPlaceholder("Remove users from session records")
          .setMinValues(1)
          .setMaxValues(Math.max(1, Math.min(25, entries.length || 1)))
          .setDisabled(!entries.length)
          .addOptions(
            (entries.length ? entries : [{ username: "No entries", amount: 0 }])
              .slice(0, 25)
              .map((entry) => ({
                label: String(entry.username).slice(0, 100),
                value: String(entry.username).slice(0, 100),
                description: `⏣ ${formatCoins(entry.amount)}`.slice(0, 100),
              })),
          ),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## > ${mapEmoji} Total: ⏣ ${formatCoins(sessionTotal)} | ${coinNukeEmoji}${sessionNukes || entries.length}`,
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        applyButtonEmoji(
          new ButtonBuilder()
            .setCustomId(`${ROUTE_PREFIX}:share:${viewState.token}`)
            .setStyle(ButtonStyle.Secondary)
            .setLabel("Friends share"),
          clipboardEmoji,
        ),
        applyButtonEmoji(
          new ButtonBuilder()
            .setCustomId(`${ROUTE_PREFIX}:donate:${viewState.token}`)
            .setStyle(ButtonStyle.Secondary)
            .setLabel("/serverevents donate"),
          clipboardEmoji,
        ),
        applyButtonEmoji(
          new ButtonBuilder()
            .setCustomId(`${ROUTE_PREFIX}:clear:${viewState.token}`)
            .setStyle(ButtonStyle.Danger)
            .setLabel("Clear"),
          trash2Emoji,
        ),
        applyButtonEmoji(
          new ButtonBuilder()
            .setCustomId(`utility:delete:${viewState.userId}`)
            .setStyle(ButtonStyle.Danger),
          trashEmoji,
        ),
      ),
    );

  return {
    content: "",
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function readClaimEntriesFromState(messageId) {
  const raw = global.db.getState("nuke_payout", messageId);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        const username = String(entry?.user || entry?.username || entry?.name || "")
          .replace(/^<@!?(\d+)>$/, "$1")
          .trim();
        const amount = Number.parseInt(
          String(entry?.amount || 0).replaceAll(",", ""),
          10,
        );
        return { username, amount: Number.isFinite(amount) ? amount : 0 };
      })
      .filter((entry) => entry.username);
  } catch {
    return [];
  }
}

function applyClaimToUser(userId, claimEntries) {
  if (!claimEntries.length) return { addedRevenue: 0, addedNukes: 0 };

  const currentSession = loadSessionData(userId).entries;
  const mergedEntries = mergeSessionEntries(currentSession, claimEntries);
  const revenue = writeSessionData(userId, mergedEntries);
  const addedRevenue = sumSessionEntries(claimEntries);

  global.db.safeQuery(
    `
    INSERT INTO dank_nuke_stats (user_id, total_nukes, session_nukes, total_revenue, session_revenue)
    VALUES (?, 1, 1, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      total_nukes = total_nukes + 1,
      session_nukes = session_nukes + 1,
      total_revenue = total_revenue + excluded.total_revenue,
      session_revenue = ?
    `,
    [userId, addedRevenue, revenue, revenue],
  );

  return { addedRevenue, addedNukes: 1 };
}

async function runDankNuke(interaction) {
  const token = createViewToken(interaction.user.id);
  const state = { token, userId: interaction.user.id };
  saveViewState(token, state);
  await interaction.reply(buildNukePanelPayload(state));
}

async function handleDankNukeButton(interaction) {
  const customId = String(interaction.customId || "");
  const [, action, token] = customId.split(":");

  if (action === "claim") {
    const claimEntries = readClaimEntriesFromState(interaction.message?.id);
    if (!claimEntries.length) {
      await interaction.reply({
        content: "No nuke payout data found on this message.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const applied = applyClaimToUser(interaction.user.id, claimEntries);
    await interaction.reply({
      content: `Added nuke claim: ⏣ ${formatCoins(applied.addedRevenue)}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!token) return;
  const state = loadViewState(token);
  if (!state || state.userId !== interaction.user.id) {
    await interaction.reply({
      content: "This nuke panel expired. Run `/dank nuke` again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "share" || action === "donate") {
    const { revenue } = loadSessionData(state.userId);
    const amount = Number.isFinite(Number(revenue)) ? Number(revenue) : 0;
    if (amount <= 0) {
      await interaction.reply({
        content: "No session amount available.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const command =
      action === "share"
        ? `pls fr share coins <@${state.userId}> ${formatCoins(amount)}`
        : `/serverevents donate quantity:${formatCoins(amount)}`;
    await interaction.reply({
      content: command,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "clear") {
    global.db.safeQuery(`DELETE FROM dank_nuke_session WHERE host_user_id = ?`, [state.userId]);
    global.db.safeQuery(
      `
      UPDATE dank_nuke_stats
      SET session_nukes = 0, session_revenue = 0, session_livesavers = 0
      WHERE user_id = ?
      `,
      [state.userId],
    );

    await interaction.reply({
      content: "Session nuke data cleared.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleDankNukeSelect(interaction) {
  const customId = String(interaction.customId || "");
  const [, action, token] = customId.split(":");
  if (action !== "remove" || !token) return;

  const state = loadViewState(token);
  if (!state || state.userId !== interaction.user.id) {
    await interaction.reply({
      content: "This nuke panel expired. Run `/dank nuke` again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selected = new Set((interaction.values || []).map((v) => String(v || "").trim()));
  if (!selected.size) {
    await interaction.update(buildNukePanelPayload(state));
    return;
  }

  const currentEntries = loadSessionData(state.userId).entries;
  const filtered = currentEntries.filter((entry) => !selected.has(String(entry.username)));
  const newRevenue = writeSessionData(state.userId, filtered);

  global.db.safeQuery(
    `
    UPDATE dank_nuke_stats
    SET session_revenue = ?
    WHERE user_id = ?
    `,
    [newRevenue, state.userId],
  );

  await interaction.update(buildNukePanelPayload(state, "Updated session records."));
}

if (!buttonHandlers.has(ROUTE_PREFIX)) {
  buttonHandlers.set(ROUTE_PREFIX, handleDankNukeButton);
}

if (!selectMenuHandlers.has(ROUTE_PREFIX)) {
  selectMenuHandlers.set(ROUTE_PREFIX, handleDankNukeSelect);
}

module.exports = {
  runDankNuke,
};
