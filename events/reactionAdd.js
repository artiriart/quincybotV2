const {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
} = require("discord.js");
const {
  buildEquipmentSummaryLines,
  createDraftToken,
  parseEmojiValue,
  parseSaveEmoji,
  parseSwsPresetFromEmbed,
  savePresetDraft,
} = require("../functions/swsPresetUtils");

const PROMPT_STATE_TYPE = "sws_preset_prompt";

function isExpectedEditEmoji(reaction) {
  const expected = parseEmojiValue(global.db.getFeatherEmojiMarkdown("edit-3") || "✏️");
  if (!expected) return false;

  if (expected.id) return String(reaction?.emoji?.id || "") === String(expected.id);
  return String(reaction?.emoji?.name || "") === String(expected.name || "");
}

function buildSavePromptPayload(token, preset) {
  const summary = buildEquipmentSummaryLines(preset.equipment)
    .map((line) => `- ${line}`)
    .join("\n");

  const saveEmoji = parseSaveEmoji();

  const container = new ContainerBuilder().addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents((td) =>
        td.setContent(
          [
            "## Do you want to save this Layout",
            `-# ${preset.allyName}`,
            summary,
          ].join("\n"),
        ),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(`sws:savepreset:${token}`)
          .setLabel("Save")
          .setStyle(ButtonStyle.Success)
          .setEmoji(saveEmoji),
      ),
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function loadPromptState(messageId) {
  const raw = global.db.getState(PROMPT_STATE_TYPE, messageId);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePromptState(messageId, state) {
  global.db.upsertState(PROMPT_STATE_TYPE, JSON.stringify(state), messageId, false);
}

module.exports = {
  name: "messageReactionAdd",
  async execute(reaction, user) {
    if (!reaction || !user || user.bot) return;

    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }

    const message = reaction.message;
    if (!message) return;

    if (message.partial) {
      try {
        await message.fetch();
      } catch {
        return;
      }
    }

    if (String(message?.author?.id || "") !== String(global.botIds.sws || "")) return;
    if (!isExpectedEditEmoji(reaction)) return;

    const embed = message.embeds?.[0];
    const parsedPreset = parseSwsPresetFromEmbed(embed);
    if (!parsedPreset) return;

    if (String(parsedPreset.ownerId) !== String(user.id)) return;

    const token = createDraftToken(user.id);
    const draft = {
      ownerId: user.id,
      allyName: parsedPreset.allyName,
      equipment: parsedPreset.equipment,
      sourceMessageId: message.id,
      channelId: message.channel?.id,
      guildId: message.guild?.id || null,
      createdAt: Date.now(),
    };

    savePresetDraft(token, draft);

    const payload = buildSavePromptPayload(token, parsedPreset);
    const promptState = loadPromptState(message.id);

    let outputMessageId = String(promptState?.outputMessageId || "").trim();
    if (outputMessageId) {
      const existing = await message.channel.messages.fetch(outputMessageId).catch(() => null);
      if (existing) {
        await existing.edit(payload).catch(() => {});
      } else {
        const sent = await message.reply(payload).catch(() => null);
        outputMessageId = sent?.id || "";
      }
    } else {
      const sent = await message.reply(payload).catch(() => null);
      outputMessageId = sent?.id || "";
    }

    if (outputMessageId) {
      savePromptState(message.id, {
        outputMessageId,
        ownerId: user.id,
        sourceMessageId: message.id,
        token,
      });
    }

  },
};
