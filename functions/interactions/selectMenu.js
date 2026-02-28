const selectMenuHandlers = new Map();

async function handleSelectMenuInteraction(interaction) {
  const customId = String(interaction.customId || "");
  const routeKey = customId.split(":")[0];
  const handler = selectMenuHandlers.get(routeKey);
  if (!handler) return;

  await handler(interaction);
}

module.exports = {
  handleSelectMenuInteraction,
  selectMenuHandlers,
};
