const modalHandlers = new Map();

async function handleModalInteraction(interaction) {
  const customId = String(interaction.customId || "");
  const routeKey = customId.split(":")[0];
  const handler = modalHandlers.get(routeKey);
  if (!handler) return;

  await handler(interaction);
}

module.exports = {
  handleModalInteraction,
  modalHandlers,
};
