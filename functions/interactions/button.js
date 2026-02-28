const { MessageFlags } = require("discord.js");

const buttonHandlers = new Map();

async function handleButtonInteraction(interaction) {
  const customId = String(interaction.customId || "");
  const routeKey = customId.split(":")[0];
  const handler = buttonHandlers.get(routeKey);
  if (!handler) return;

  await handler(interaction);
}

async function handleUtilityButton(interaction) {
  const customId = String(interaction.customId || "");
  const [, action, ownerId] = customId.split(":");
  if (action !== "delete") return;

  const restrictedOwner = ownerId && ownerId !== "null" ? ownerId : null;
  if (restrictedOwner && interaction.user?.id !== restrictedOwner) {
    await interaction.reply({
      content: "Only the owner of this message can delete it.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  await interaction.deferUpdate().catch(() => {});

  try {
    await interaction.message?.delete().catch(() => {});
  } catch {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "Could not delete that message.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  }
}

if (!buttonHandlers.has("utility")) {
  buttonHandlers.set("utility", handleUtilityButton);
}

module.exports = {
  handleButtonInteraction,
  buttonHandlers,
};
