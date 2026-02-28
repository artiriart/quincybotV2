const { handleSlashInteraction } = require("../functions/interactions/slash");
const { handleButtonInteraction } = require("../functions/interactions/button");
const { handleModalInteraction } = require("../functions/interactions/modal");

module.exports = {
  name: "interactionCreate",
  async execute(interaction, client) {
    try {
      if (interaction?.isChatInputCommand?.()) {
        await handleSlashInteraction(interaction, client);
        return;
      }

      if (interaction?.isButton?.()) {
        await handleButtonInteraction(interaction, client);
        return;
      }

      if (interaction?.isModalSubmit?.()) {
        await handleModalInteraction(interaction, client);
      }
    } catch (error) {
      const interactionName =
        interaction?.commandName || interaction?.customId || interaction?.type;
      console.error(`Interaction failed (${interactionName}):`, error);
      const payload = {
        content: "Interaction execution failed.",
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ ...payload, ephemeral: true }).catch(
          () => {},
        );
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
      }
    }
  },
};
