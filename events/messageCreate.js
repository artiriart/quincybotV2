const handleMessage = require("../functions/handleMessage");

module.exports = {
  name: "messageCreate",
  async execute(message) {
    await handleMessage(message).catch((error) => {
      console.error("messageCreate handler failed:", error);
    });
  },
};
