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
const {
  buildBestChanceLinesByTool,
  getBestChanceRowsForUser,
  getEntityMap,
  getOrCreateFishSettings,
  getTargetRow,
  groupAllPossibilitiesByLocation,
  listMythicalTargets,
  parseEmojiMarkdown,
  updateFishSettings,
  withEmojiSpacing,
} = require("../../functions/dank/fishSimulator");

const ROUTE_PREFIX = "dankfish";

function emojiFromMarkdown(markdown, fallback = undefined) {
  return parseEmojiMarkdown(markdown) || fallback;
}

function targetOptionDescription(target) {
  void target;
  return " ";
}

function makeTargetOptions(targets, selectedId) {
  const options = targets.slice(0, 25).map((target) => ({
    label: String(target.target_name || "Unknown").slice(0, 100),
    description: targetOptionDescription(target),
    value: String(target.target_id),
    default: selectedId === target.target_id,
    ...(emojiFromMarkdown(target.application_emoji)
      ? { emoji: emojiFromMarkdown(target.application_emoji) }
      : {}),
  }));
  if (options.length) return options;
  return [
    {
      label: "No mythical targets indexed",
      value: "no-targets",
      description: "Run startup sync first",
      default: true,
    },
  ];
}

function getUtcHour() {
  return new Date().getUTCHours();
}

function getButtonEmojiByFeather(name, fallback) {
  const markdown = global.db.getFeatherEmojiMarkdown?.(name);
  return emojiFromMarkdown(markdown, fallback);
}

async function buildMythicalPayload(userId, options = {}) {
  const force = options.force === true;
  const settings = await getOrCreateFishSettings(userId);
  const targets = await listMythicalTargets();
  const target =
    settings.target_id && targets.length
      ? await getTargetRow(settings.target_id)
      : null;

  if (!settings.target_id && targets.length) {
    const first = targets[0];
    await updateFishSettings(userId, {
      target_id: first.target_id,
    });
  }

  const liveTarget = settings.target_id
    ? target
    : targets[0]
      ? await getTargetRow(targets[0].target_id)
      : null;

  const { rows, currentHour } =
    liveTarget && liveTarget.creature_id
      ? await getBestChanceRowsForUser(userId, { force })
      : { rows: [], currentHour: getUtcHour() };

  const entityMap = await getEntityMap();
  const bestLines = buildBestChanceLinesByTool(rows, entityMap, 20);
  const targetName = liveTarget?.target_name || "Select a mythical target";
  const targetEmoji = withEmojiSpacing(liveTarget?.application_emoji || "");
  const utcHour = Number.isFinite(Number(currentHour)) ? currentHour : getUtcHour();
  const luckyEnabled = !!settings.lucky_bait_enabled;

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### Mythical Fish - ${targetEmoji}${targetName}\n-# for Mythical Hunter II skill`,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        bestLines.length
          ? `**Best chances (UTC hour: ${utcHour}):**\n${bestLines.join("\n")}`
          : `**Best chances (UTC hour: ${utcHour}):**\n- No cached chances. Click refresh.`,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ROUTE_PREFIX}:target`)
          .setPlaceholder(`Select Mythical Fish (UTC ${utcHour}:00)`)
          .addOptions(makeTargetOptions(targets, liveTarget?.target_id || null)),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${ROUTE_PREFIX}:viewall`)
          .setLabel("View All Possibilities")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(getButtonEmojiByFeather("database", "🗄️"))
          .setDisabled(!liveTarget),
        new ButtonBuilder()
          .setCustomId(`${ROUTE_PREFIX}:toggle_lucky`)
          .setLabel("Toggle Lucky Bait")
          .setStyle(luckyEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setEmoji(emojiFromMarkdown(entityMap.get("bait:lucky-bait")?.emoji, "🎣")),
      ),
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

async function runDankFishMythicals(interaction) {
  const payload = await buildMythicalPayload(interaction.user.id, { force: false });
  await interaction.reply(payload);
}

async function handleTargetSelect(interaction) {
  const value = interaction.values?.[0];
  if (!value || value === "no-targets") return;
  const target = await getTargetRow(value);
  if (!target) return;
  await updateFishSettings(interaction.user.id, {
    target_id: value,
  });
  const payload = await buildMythicalPayload(interaction.user.id, { force: false });
  await interaction.update(payload);
}

async function handleViewAll(interaction) {
  const settings = await getOrCreateFishSettings(interaction.user.id);
  if (!settings.target_id) {
    await interaction.reply({
      components: [
        new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent("Select a mythical target first."),
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const { rows, target } = await getBestChanceRowsForUser(interaction.user.id, {
    force: false,
  });
  if (!rows.length) {
    await interaction.reply({
      components: [
        new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "No cached chances yet. Use refresh and try again.",
          ),
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const entityMap = await getEntityMap();
  const targetEmoji = withEmojiSpacing(target?.application_emoji || "");
  const grouped = groupAllPossibilitiesByLocation(
    rows,
    entityMap,
    target?.target_name || "Unknown",
    targetEmoji,
  );

  const allContainer = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(grouped.header),
  );

  grouped.sections.forEach((section, index) => {
    allContainer
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(section.lines.join("\n").slice(0, 3800)),
      );
  });

  await interaction.reply({
    components: [allContainer],
    flags: MessageFlags.IsComponentsV2,
  });
}

async function handleDankFishButton(interaction) {
  const [, action] = String(interaction.customId || "").split(":");

  if (action === "toggle_lucky") {
    const settings = await getOrCreateFishSettings(interaction.user.id);
    await updateFishSettings(interaction.user.id, {
      lucky_bait_enabled: !settings.lucky_bait_enabled,
    });
    const payload = await buildMythicalPayload(interaction.user.id, { force: false });
    await interaction.update(payload);
    return;
  }

  if (action === "viewall") {
    await handleViewAll(interaction);
  }
}

async function handleDankFishSelect(interaction) {
  const [, action] = String(interaction.customId || "").split(":");
  if (action === "target") {
    await handleTargetSelect(interaction);
  }
}

if (!buttonHandlers.has(ROUTE_PREFIX)) {
  buttonHandlers.set(ROUTE_PREFIX, handleDankFishButton);
}

if (!selectMenuHandlers.has(ROUTE_PREFIX)) {
  selectMenuHandlers.set(ROUTE_PREFIX, handleDankFishSelect);
}

module.exports = {
  runDankFishMythicals,
};
