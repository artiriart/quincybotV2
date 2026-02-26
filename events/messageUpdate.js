module.exports = {
  name: "messageUpdate",
  async execute(oldMessage, newMessage) {
    if (newMessage.partial) {
      try {
        await newMessage.fetch();
      } catch {
        return;
      }
    }
    if (oldMessage?.editedTimestamp === newMessage?.editedTimestamp) return;

  },
};
