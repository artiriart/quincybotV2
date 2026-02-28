const { runCalculator } = require("./slashHandlers/calculator");
const {
  runPing,
  runHelp,
  runInvite,
  runDice,
  runSettings,
} = require("./slashHandlers/misc");

const slashRoutes = new Map([
  ["calculator", runCalculator],
  ["ping", runPing],
  ["help", runHelp],
  ["invite", runInvite],
  ["dice", runDice],
  ["settings", runSettings],
]);

async function routeSlashCommand(interaction, client) {
  const handler = slashRoutes.get(interaction.commandName);
  if (!handler) return;
  await handler(interaction, client);
}

module.exports = {
  routeSlashCommand,
  slashRoutes,
};
