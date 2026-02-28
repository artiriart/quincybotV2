const buttonHandlers = new Map();

async function handleButtonInteraction(interaction) {
  const customId = String(interaction.customId || "");
  const routeKey = customId.split(":")[0];
  const handler = buttonHandlers.get(routeKey);
  if (!handler) return;

  await handler(interaction);
}

module.exports = {
  handleButtonInteraction,
  buttonHandlers,
};
