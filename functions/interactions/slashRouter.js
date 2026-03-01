const { runCalculator } = require("./slashHandlers/calculator");
const {
  runPing,
  runHelp,
  runRepo,
  runInvite,
  runDice,
  runReminder,
  runSettings,
} = require("./slashHandlers/misc");

const slashRoutes = new Map([
  ["calculator", runCalculator],
  ["ping", runPing],
  ["help", runHelp],
  ["repo", runRepo],
  ["invite", runInvite],
  ["dice", runDice],
  ["reminder", runReminder],
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
