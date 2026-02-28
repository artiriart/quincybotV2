async function handleSlashInteraction(interaction, client) {
  const command = client?.commands?.slash?.commands?.get(interaction.commandName);
  if (!command || typeof command.execute !== "function") return;

  await command.execute(interaction, client);
}

module.exports = {
  handleSlashInteraction,
};
