const {
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const { buttonHandlers } = require("../interactions/button");

const REMINDER_SNOOZE_STATE_TYPE = "reminder_snooze_payload";

let reminderPollerStarted = false;
let reminderPollTimer = null;
let reminderPollInFlight = false;

function scheduleReminderPoll(ms = 30_000) {
  if (reminderPollTimer) clearTimeout(reminderPollTimer);
  const delay = Math.max(1_000, Number(ms) || 30_000);
  reminderPollTimer = setTimeout(() => {
    runReminderPoll().catch((error) => {
      console.error("[reminders] poll failed:", error);
      scheduleReminderPoll(30_000);
    });
  }, delay);
}

function createReminderSnoozeToken(userId) {
  const rand = Math.random().toString(36).slice(2, 7);
  return `${String(userId || "").slice(-6)}${Date.now().toString(36)}${rand}`.slice(
    0,
    40,
  );
}

function parseReminderInformation(raw) {
  if (!raw) return { command: "", information: "Custom Reminder" };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      command: String(parsed?.command || "").trim(),
      information: String(parsed?.information || "Custom Reminder").trim(),
    };
  } catch {
    return { command: "", information: "Custom Reminder" };
  }
}

async function sendDueReminder(row) {
  const userId = String(row?.user_id || "").trim();
  const type = String(row?.type || "").trim();
  const channelId = String(row?.channel_id || "").trim();
  if (!userId || !type) return true;

  const info = parseReminderInformation(row?.information);
  const dm = Boolean(Number(row?.dm) || row?.dm === true);

  const snoozeToken = createReminderSnoozeToken(userId);
  global.db.upsertState(
    REMINDER_SNOOZE_STATE_TYPE,
    JSON.stringify({
      user_id: userId,
      type,
      guild_id: String(row?.guild_id || ""),
      channel_id: channelId,
      information: info,
      dm: dm ? 1 : 0,
    }),
    snoozeToken,
    false,
  );

  const remindedUser =
    global.bot.users.cache.get(userId) ||
    (await global.bot.users.fetch(userId).catch(() => null));
  const avatarUrl =
    remindedUser?.displayAvatarURL?.({ extension: "png", size: 128 }) || null;

  const payload = {
    content: `-# ${type} <@${userId}>`,
    allowedMentions: { users: [userId], parse: [] },
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({
          name: `🔔 ${type} Reminder`,
          iconURL: avatarUrl || undefined,
        })
        .addFields({
          name: `> ${info.information || "Custom Reminder"}`,
          value: info.command || "-",
        }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`utility:delete:${userId}`)
          .setStyle(ButtonStyle.Danger)
          .setLabel("🗑️"),
        new ButtonBuilder()
          .setCustomId(`reminder:snooze:${snoozeToken}:${userId}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel("5. Min")
          .setEmoji("💤"),
      ),
    ],
  };

  try {
    if (dm) {
      if (!remindedUser) throw new Error("user-not-found");
      await remindedUser.send(payload);
    } else {
      const channel =
        global.bot.channels.cache.get(channelId) ||
        (await global.bot.channels.fetch(channelId).catch(() => null));
      if (!channel || typeof channel.send !== "function") {
        throw new Error("channel-not-found");
      }
      await channel.send(payload);
    }
  } catch (error) {
    const reason = String(error?.message || error || "").toLowerCase();
    if (reason.includes("cannot send messages to this user")) {
      console.warn(`[reminders] DM failed for ${userId}, keeping reminder queued`);
    } else {
      console.warn(`[reminders] delivery failed for ${type}/${userId}:`, error);
    }
    return false;
  }

  global.db.safeQuery(`DELETE FROM reminders WHERE type = ? AND user_id = ?`, [
    type,
    userId,
  ]);
  return true;
}

async function runReminderPoll() {
  if (reminderPollInFlight) return;
  reminderPollInFlight = true;
  try {
    const now = Date.now();
    const dueRows = global.db.safeQuery(
      `
      SELECT type, user_id, guild_id, channel_id, information, end, dm
      FROM reminders
      WHERE end <= ?
      ORDER BY end ASC
      LIMIT 20
      `,
      [now],
      [],
    );

    if (dueRows.length) {
      let successCount = 0;
      for (const row of dueRows) {
        const sent = await sendDueReminder(row);
        if (sent) successCount += 1;
        if (!sent) {
          global.db.safeQuery(
            `UPDATE reminders SET end = ? WHERE type = ? AND user_id = ?`,
            [Date.now() + 60_000, row.type, row.user_id],
          );
        }
      }

      scheduleReminderPoll(successCount === dueRows.length ? 1_500 : 5_000);
      return;
    }

    const nextRow = global.db.safeQuery(
      `
      SELECT end
      FROM reminders
      ORDER BY end ASC
      LIMIT 1
      `,
      [],
      [],
    )?.[0];

    if (!nextRow?.end) {
      scheduleReminderPoll(60_000);
      return;
    }

    const untilNext = Number(nextRow.end) - Date.now();
    scheduleReminderPoll(Math.max(2_000, Math.min(300_000, untilNext)));
  } finally {
    reminderPollInFlight = false;
  }
}

async function handleReminderButton(interaction) {
  const customId = String(interaction.customId || "");
  const [, action, token, ownerId] = customId.split(":");
  if (action !== "snooze") return;

  const restrictedOwner = String(ownerId || "").trim();
  if (restrictedOwner && interaction.user?.id !== restrictedOwner) {
    await interaction
      .reply({
        content: "Only the reminder owner can snooze this.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  const stateRaw = global.db.getState(REMINDER_SNOOZE_STATE_TYPE, token);
  if (!stateRaw) {
    await interaction
      .reply({
        content: "This reminder can no longer be snoozed.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  let state = null;
  try {
    state = JSON.parse(stateRaw);
  } catch {
    state = null;
  }
  if (!state?.type || !state?.user_id) {
    await interaction
      .reply({
        content: "This reminder payload is invalid.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  global.db.safeQuery(
    `
    INSERT INTO reminders (
      type,
      user_id,
      guild_id,
      channel_id,
      information,
      end,
      dm
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(type, user_id) DO UPDATE SET
      guild_id = excluded.guild_id,
      channel_id = excluded.channel_id,
      information = excluded.information,
      end = excluded.end,
      dm = excluded.dm
    `,
    [
      String(state.type),
      String(state.user_id),
      String(state.guild_id || ""),
      String(state.channel_id || ""),
      JSON.stringify(
        state.information || { command: "", information: "Custom Reminder" },
      ),
      Date.now() + 5 * 60_000,
      Number(state.dm) ? 1 : 0,
    ],
  );

  scheduleReminderPoll(1_000);
  await interaction
    .reply({
      content: "Reminder snoozed for 5 minutes.",
      flags: MessageFlags.Ephemeral,
    })
    .catch(() => {});
}

if (!buttonHandlers.has("reminder")) {
  buttonHandlers.set("reminder", handleReminderButton);
}

function startReminderPolling() {
  if (reminderPollerStarted) return;
  reminderPollerStarted = true;
  scheduleReminderPoll(5_000);
}

module.exports = {
  startReminderPolling,
};
