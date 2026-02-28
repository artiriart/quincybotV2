const handleMessage = require("../functions/handleMessage");

module.exports = {
  name: "messageUpdate",
  async execute(oldMessage, newMessage) {
    if (newMessage?.partial) {
      try {
        await newMessage.fetch();
      } catch {
        return;
      }
    }


    await handleMessage(newMessage, oldMessage).catch((error) => {
      console.error("messageUpdate handler failed:", error);
    });
  },
};
