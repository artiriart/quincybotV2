const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { buttonHandlers } = require("../button");
const { selectMenuHandlers } = require("../selectMenu");
const { modalHandlers } = require("../modal");

const SETTINGS_CATEGORY_OPTIONS = [
  { label: "General Settings", value: "general" },
  { label: "Izzi Settings", value: "izzi" },
  { label: "Dank Settings", value: "dank" },
  { label: "Karuta Settings", value: "karuta" },
  { label: "Anigame Settings", value: "anigame" },
  { label: "7w7 Settings", value: "7w7" },
];

const SWS_REMINDER_TOGGLES = [
  { key: "sws_wife_reminder", label: "Wife Reminder" },
  { key: "sws_partner_reminder", label: "Partner Reminder" },
  { key: "sws_gem_reminder", label: "Gem Reminder" },
  {
    key: "sws_no_patreon_raid_reminder",
    label: "No-Patreon Raid Reminder",
  },
];

const DANK_TOGGLES = [
  { key: "dank_cheese_autodelete", label: "Cheese Autodelete" },
  {
    key: "dank_optout_all_stat_tracking",
    label: "Opt-out of all stat tracking",
    defaultOn: false,
  },
];

const KARUTA_TOGGLES = [
  { key: "karuta_visit_reminders", label: "Visit Reminders" },
];

const ANIGAME_TOGGLES = [
  { key: "anigame_card_stat_tracking", label: "Card Stat tracking", defaultOn: true },
];

const MODAL_SETTINGS = {
  anigame_raid_input_autodelete: {
    category: "anigame",
    title: "Raid Input auto-delete",
    prompt: "Number or false/disable/n/no/stop/0",
    defaultValue: 500,
  },
  izzi_event_shard_notifier: {
    category: "izzi",
    title: "Event Shard notifier",
    prompt: "Number or false/disable/n/no/stop/0",
    defaultValue: 0,
  },
};

// Keep these values in sync with sws_emoji_map from functions/handleMessage.js.
const SWS_EMOJI_MAP = {
  common: "Common",
  epic: "Epic",
  mythical: "Mythical",
  legendary: "Legendary",
  special: "Special",
  hidden: "Hidden",
  queen: "Queen",
  goddess: "Goddess",
  void: "Void",
  patreon: "Patreon",
};

const FALSY_INPUTS = new Set(["false", "disable", "disabled", "n", "no", "stop", "0"]);

function isEnabled(value) {
  return value === 1 || value === true;
}

function getUserToggle(userId, type, defaultValue = true) {
  const row = global.db.safeQuery(
    `SELECT toggle FROM user_settings_toggles WHERE user_id = ? AND type = ? LIMIT 1`,
    [userId, type],
  )?.[0];
  return row ? isEnabled(row.toggle) : defaultValue;
}

function upsertUserToggle(userId, type, toggle) {
  global.db.safeQuery(
    `INSERT INTO user_settings_toggles (user_id, type, toggle) VALUES (?, ?, ?) ON CONFLICT (user_id, type) DO UPDATE SET toggle = excluded.toggle`,
    [userId, type, toggle ? 1 : 0],
  );
}

function getUserNumberSetting(userId, type, defaultValue) {
  const raw = global.db.getState(type, userId);
  if (raw == null) return defaultValue;

  const direct = Number(raw);
  if (Number.isFinite(direct) && direct >= 0) {
    return Math.trunc(direct);
  }

  try {
    const parsed = JSON.parse(raw);
    const n = Number(parsed);
    if (Number.isFinite(n) && n >= 0) {
      return Math.trunc(n);
    }
  } catch {}

  return defaultValue;
}

function setUserNumberSetting(userId, type, value) {
  global.db.upsertState(type, String(Math.max(0, Math.trunc(value))), userId, true);
}

function getToggleDefinition(type) {
  const allToggles = [
    ...SWS_REMINDER_TOGGLES,
    ...DANK_TOGGLES,
    ...KARUTA_TOGGLES,
    ...ANIGAME_TOGGLES,
  ];
  return allToggles.find((toggle) => toggle.key === type) || null;
}

function parseNumberishInput(input) {
  const text = String(input || "").trim();
  if (!text) return null;

  const lowered = text.toLowerCase();
  if (FALSY_INPUTS.has(lowered)) {
    return 0;
  }

  const normalized = text.replace(/,/g, "");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.trunc(value);
}

function getGuildAutodelete(guildId) {
  if (!guildId) return [];
  return global.db
    .safeQuery(
      `SELECT rarity FROM sws_autodelete WHERE guild_id = ? ORDER BY rarity ASC`,
      [guildId],
    )
    .map((row) => row.rarity)
    .filter(Boolean);
}

function setGuildAutodelete(guildId, selectedRarities) {
  if (!guildId) return;
  global.db.safeQuery(`DELETE FROM sws_autodelete WHERE guild_id = ?`, [guildId]);
  for (const rarity of selectedRarities) {
    global.db.safeQuery(
      `INSERT INTO sws_autodelete (guild_id, rarity) VALUES (?, ?) ON CONFLICT (guild_id, rarity) DO NOTHING`,
      [guildId, rarity],
    );
  }
}

function getToggleEmoji(enabled) {
  const emoji = global.db.getFeatherEmojiMarkdown(
    enabled ? "toggle-right" : "toggle-left",
  );
  return emoji || (enabled ? "▶" : "◀");
}

function buildCategoryContainer(selected = null) {
  const categoryMenu = new StringSelectMenuBuilder()
    .setCustomId("settings:category")
    .setPlaceholder("Select Category")
    .addOptions(
      SETTINGS_CATEGORY_OPTIONS.map((option) => ({
        label: option.label,
        value: option.value,
        default: selected === option.value,
      })),
    );

  return new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# Select Category"),
    )
    .addActionRowComponents(new ActionRowBuilder().addComponents(categoryMenu));
}

function addToggleSections(container, interaction, category, toggles) {
  for (const [index, toggleConfig] of toggles.entries()) {
    const enabled = getUserToggle(
      interaction.user.id,
      toggleConfig.key,
      toggleConfig.defaultOn ?? true,
    );

    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### Toggle ${toggleConfig.label}\n-# Currently: ${getToggleEmoji(enabled)} ${enabled ? "On" : "Off"}`,
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`settings:toggle:${category}:${toggleConfig.key}`)
            .setLabel("Toggle")
            .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        ),
    );

    if (index < toggles.length - 1) {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    }
  }
}

function addNumberSettingSection(container, interaction, settingKey) {
  const definition = MODAL_SETTINGS[settingKey];
  const current = getUserNumberSetting(
    interaction.user.id,
    settingKey,
    definition.defaultValue,
  );

  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `### ${definition.title}\n-# Currently: ${current > 0 ? String(current) : "Disabled"}`,
        ),
      )
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(`settings:openmodal:${definition.category}:${settingKey}`)
          .setLabel("Set Value")
          .setStyle(ButtonStyle.Primary),
      ),
  );
}

function build7w7Container(interaction) {
  const guildId = interaction.guildId;
  const isAdmin = Boolean(
    interaction.guildId &&
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
  );

  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## 7w7 Settings"),
  );

  addToggleSections(container, interaction, "7w7", SWS_REMINDER_TOGGLES);

  if (isAdmin) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const selectedRarities = getGuildAutodelete(guildId);
    const autodeleteMenu = new StringSelectMenuBuilder()
      .setCustomId("settings:autodelete")
      .setPlaceholder("Autodelete drops")
      .setMinValues(0)
      .setMaxValues(Object.keys(SWS_EMOJI_MAP).length)
      .addOptions(
        Object.values(SWS_EMOJI_MAP).map((rarityName) => ({
          label: rarityName,
          value: rarityName,
          default: selectedRarities.includes(rarityName),
        })),
      );

    container
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# Autodelete Drops\n-# Currently: ${selectedRarities.length ? selectedRarities.join(", ") : "None"}`,
        ),
      )
      .addActionRowComponents(new ActionRowBuilder().addComponents(autodeleteMenu));
  }

  return container;
}

function buildDankContainer(interaction) {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Dank Settings"),
  );

  addToggleSections(container, interaction, "dank", DANK_TOGGLES);
  return container;
}

function buildKarutaContainer(interaction) {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Karuta Settings"),
  );

  addToggleSections(container, interaction, "karuta", KARUTA_TOGGLES);
  return container;
}

function buildAnigameContainer(interaction) {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Anigame Settings"),
  );

  addNumberSettingSection(container, interaction, "anigame_raid_input_autodelete");
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  addToggleSections(container, interaction, "anigame", ANIGAME_TOGGLES);

  return container;
}

function buildIzziContainer(interaction) {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Izzi Settings"),
  );

  addNumberSettingSection(container, interaction, "izzi_event_shard_notifier");
  return container;
}

function buildPlaceholderContainer(title) {
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${title}\n-# Coming soon`),
  );
}

function buildSettingsPayload(interaction, category = null, includeFlags = false) {
  const components = [];

  if (!category) {
    components.push(buildCategoryContainer());
  } else if (category === "7w7") {
    components.push(build7w7Container(interaction));
    components.push(buildCategoryContainer("7w7"));
  } else if (category === "dank") {
    components.push(buildDankContainer(interaction));
    components.push(buildCategoryContainer("dank"));
  } else if (category === "karuta") {
    components.push(buildKarutaContainer(interaction));
    components.push(buildCategoryContainer("karuta"));
  } else if (category === "anigame") {
    components.push(buildAnigameContainer(interaction));
    components.push(buildCategoryContainer("anigame"));
  } else if (category === "izzi") {
    components.push(buildIzziContainer(interaction));
    components.push(buildCategoryContainer("izzi"));
  } else if (category === "general") {
    components.push(buildPlaceholderContainer("General Settings"));
    components.push(buildCategoryContainer("general"));
  } else {
    components.push(buildCategoryContainer());
  }

  const payload = {
    content: "",
    components,
  };

  if (includeFlags) {
    payload.flags = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
  }

  return payload;
}

function buildSettingModal(interaction, category, settingKey) {
  const definition = MODAL_SETTINGS[settingKey];
  if (!definition || definition.category !== category) {
    return null;
  }

  const current = getUserNumberSetting(
    interaction.user.id,
    settingKey,
    definition.defaultValue,
  );

  return new ModalBuilder()
    .setCustomId(`settings:submit:${category}:${settingKey}`)
    .setTitle(definition.title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel(definition.prompt)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(current))
          .setPlaceholder("500 or disable"),
      ),
    );
}

async function handleSettingsButton(interaction) {
  const customId = String(interaction.customId || "");
  const [, action, category, key] = customId.split(":");

  if (action === "toggle" && category && key) {
    const defaultOn = getToggleDefinition(key)?.defaultOn ?? true;
    const current = getUserToggle(interaction.user.id, key, defaultOn);
    upsertUserToggle(interaction.user.id, key, !current);
    await interaction.update(buildSettingsPayload(interaction, category));
    return;
  }

  if (action === "openmodal" && category && key) {
    const modal = buildSettingModal(interaction, category, key);
    if (!modal) {
      await interaction.reply({
        content: "Invalid setting modal request.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(modal);
  }
}

async function handleSettingsSelect(interaction) {
  const customId = String(interaction.customId || "");
  const [, action] = customId.split(":");

  if (action === "category") {
    const category = interaction.values?.[0] || null;
    await interaction.update(buildSettingsPayload(interaction, category));
    return;
  }

  if (action === "autodelete") {
    const isAdmin = Boolean(
      interaction.guildId &&
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
    );
    if (!isAdmin) {
      await interaction.reply({
        content: "Only administrators can edit autodelete settings.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const selected = (interaction.values || []).filter((value) =>
      Object.values(SWS_EMOJI_MAP).includes(value),
    );

    setGuildAutodelete(interaction.guildId, selected);
    await interaction.update(buildSettingsPayload(interaction, "7w7"));
  }
}

async function handleSettingsModal(interaction) {
  const customId = String(interaction.customId || "");
  const [, action, category, settingKey] = customId.split(":");
  if (action !== "submit" || !category || !settingKey) return;

  const definition = MODAL_SETTINGS[settingKey];
  if (!definition || definition.category !== category) {
    await interaction.reply({
      content: "Unknown setting.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const value = interaction.fields.getTextInputValue("value");
  const parsed = parseNumberishInput(value);
  if (parsed == null) {
    await interaction.reply({
      content:
        "Invalid value. Use a non-negative number or false/disable/n/no/stop/0.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  setUserNumberSetting(interaction.user.id, settingKey, parsed);
  await interaction.reply(buildSettingsPayload(interaction, category, true));
}

async function runPing(interaction) {
  const ws = interaction.client.ws.ping;
  await interaction.reply({
    content: `Pong! API latency: ${ws}ms`,
    flags: MessageFlags.Ephemeral,
  });
}

async function runHelp(interaction) {
  const specialHelpUsers = new Set([
    "172571295077105664",
    "804065926025838642",
    "1357140733022175398",
  ]);

  if (specialHelpUsers.has(interaction.user.id)) {
    await interaction.reply({
      content: "",
      components: [
        new ContainerBuilder()
          .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
              new MediaGalleryItemBuilder().setURL(
                "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExMWhseGIwM3puMmtmaWx0dm9iazBmamJndGp2bDlna3BpcWM1NWZsZSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/D63HGAzG15LQrjBPRE/giphy.gif",
              ),
            ),
          )
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## Dear Melmsie,

It has come to my attention that you executed the sacred /help command on my bot.

As a Dank bot developer, this action has automatically triggered the Ultra Developer Surveillance System™. Congratulations. You are now being respectfully observed.

The penguins have been notified.
The toaster is buffering.
Protocol 7 has been replaced with a slightly annoyed raccoon.
If the moon starts lagging, that was not me. Probably.
The spaghetti committee voted 3-2 in your favor.

If you would like to discuss anything, suggest improvements, roast the code, or demand I refactor something at 3am, please DM <@734844583778975845>. Feedback, chaos, and constructive criticism are all welcome.

If this was accidental, simply blink twice at your monitor. The system understands.

Kind regards,
artiriart
Chief Executive Button Listener

-# P.S: can i have melmsie banana (the item of course)`),
          ),
      ],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
    return;
  }

  await interaction.reply({
    content: "Use `/calculator prompt:<equation>` to evaluate expressions.",
    flags: MessageFlags.Ephemeral,
  });
}

async function runInvite(interaction) {
  const appId = interaction.client?.application?.id || interaction.client?.user?.id;
  if (!appId) {
    await interaction.reply({
      content: "Application ID unavailable right now.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const url =
    `https://discord.com/oauth2/authorize?client_id=${appId}` +
    `&scope=bot%20applications.commands&permissions=8`;
  await interaction.reply({
    content: url,
    flags: MessageFlags.Ephemeral,
  });
}

async function runDice(interaction) {
  const range = Math.max(2, interaction.options.getInteger("range") || 6);
  const amount = Math.max(1, Math.min(20, interaction.options.getInteger("amount") || 1));
  const unique = interaction.options.getBoolean("unique");
  const uniqueMode = unique == null ? true : unique;

  if (uniqueMode && amount > range) {
    await interaction.reply({
      content: "Unique rolls cannot exceed range.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const values = [];
  while (values.length < amount) {
    const roll = Math.floor(Math.random() * range) + 1;
    if (uniqueMode && values.includes(roll)) continue;
    values.push(roll);
  }

  await interaction.reply({
    content: `Rolled: ${values.join(", ")}`,
  });
}

async function runSettings(interaction) {
  await interaction.reply(buildSettingsPayload(interaction, null, true));
}

if (!buttonHandlers.has("settings")) {
  buttonHandlers.set("settings", handleSettingsButton);
}

if (!selectMenuHandlers.has("settings")) {
  selectMenuHandlers.set("settings", handleSettingsSelect);
}

if (!modalHandlers.has("settings")) {
  modalHandlers.set("settings", handleSettingsModal);
}

module.exports = {
  runPing,
  runHelp,
  runInvite,
  runDice,
  runSettings,
};
