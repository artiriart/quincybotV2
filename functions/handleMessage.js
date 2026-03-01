const { createSettingsReader } = require("./handleMessageHelpers");
const { routeMessageByBot } = require("./messageHandlers");
const { startReminderPolling } = require("./messageHandlers/reminders");

async function handleMessage(message, oldMessage = false) {
  if (!message?.author?.bot) return;

  const settings = createSettingsReader();
  await routeMessageByBot(message, oldMessage, settings);
}

module.exports = handleMessage;
module.exports.startReminderPolling = startReminderPolling;
