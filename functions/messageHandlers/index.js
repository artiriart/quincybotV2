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

    case global.botIds.anigame:
      await handleAnigameMessage(message, oldMessage, settings);
      break;

    case global.botIds.dank:
      await handleDankMessage(message, oldMessage, settings);
      break;

    case global.botIds.karuta:
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
