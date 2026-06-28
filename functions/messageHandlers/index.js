const { handleSwsMessage } = require("./sws");
const { handleAnigameMessage } = require("./anigame");
const { handleDankMessage } = require("./dank");
const { handleKarutaMessage } = require("./karuta");
const { handleIzziMessage } = require("./izzi");

async function routeMessageByBot(message, oldMessage, settings) {
  switch (message.author.id) {
    case global.botIds.sws:
      await handleSwsMessage(message, oldMessage, settings);
      break;

    case "1505648977482219642":
      if (message.channelId === "1484594972027125860") {
        const { handleAnigameWebhook } = require("./anigame");
        await handleAnigameWebhook(message, settings);
      }
      break;

    case "1520148782799651109":
      if (message.channelId === "1484594972027125860") {
        const { handleBreachWebhook } = require("./anigame");
        await handleBreachWebhook(message, settings);
      }
      break;

    case global.botIds.anigame:
      await handleAnigameMessage(message, oldMessage, settings);
      break;

    case global.botIds.dank:
      await handleDankMessage(message, oldMessage, settings);
      break;

    case global.botIds.karuta:
    case global.botIds.karutaLeg:
      await handleKarutaMessage(message, settings);
      break;

    case global.botIds.izzi:
      await handleIzziMessage(message, settings);
      break;

    default:
      break;
  }
}

module.exports = {
  routeMessageByBot,
};
