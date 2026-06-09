const { createSettingsReader } = require("./handleMessageHelpers");
const { routeMessageByBot } = require("./messageHandlers");
const { handleUserMathMessage } = require("./messageHandlers/userMath");
const { startReminderPolling } = require("./messageHandlers/reminders");

async function handleMessage(message, oldMessage = false) {
  if (!message?.author?.bot) {
    const isPinged = message.content?.includes(`<@${global.bot.user.id}>`) || message.content?.includes(`<@!${global.bot.user.id}>`);
    
    if (isPinged && message.reference) {
      const referencedMessage = await message.channel.messages.fetch(message.reference.messageId).catch((err) => {
        return null;
      });
      
      if (referencedMessage && referencedMessage.author.id === global.botIds.anigame) {
        const { handleAnigameMentionReply } = require("./messageHandlers/anigame");
        if (handleAnigameMentionReply) {
          await handleAnigameMentionReply(message, referencedMessage);
        }
      }
    }
    await handleUserMathMessage(message);
    return;
  }

  const settings = createSettingsReader();
  await routeMessageByBot(message, oldMessage, settings);
}

module.exports = handleMessage;
module.exports.startReminderPolling = startReminderPolling;
