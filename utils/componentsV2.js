const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require("discord.js");

function createV2Message(content, rows = [], accentColor = 0x5865f2) {
  const container = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(String(content ?? "")),
    );

  if (rows?.length) {
    container.addSeparatorComponents(true).addActionRowComponents(...rows);
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function createEphemeralV2Message(content, rows = [], accentColor = 0x5865f2) {
  return {
    ...createV2Message(content, rows, accentColor),
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  };
}

module.exports = {
  createV2Message,
  createEphemeralV2Message,
};
