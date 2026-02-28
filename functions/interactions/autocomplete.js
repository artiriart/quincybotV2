async function handleAutocompleteInteraction(interaction, client) {
  const command = client?.commands?.slash?.commands?.get(interaction.commandName);
  if (!command || typeof command.autocomplete !== "function") return;
  await command.autocomplete(interaction, client);
}

module.exports = {
  handleAutocompleteInteraction,
};
