const { EmbedBuilder } = require("discord.js");

async function createReminders(message, oldMessage = false) {
  switch (message.author.id) {
    case global.botIds.sws: {
      if (
        message?.embeds[0]?.title?.includes("with your partner") ||
        message?.embeds[0]?.title?.includes("hanging out with")
      ) {
        const cd_buff = Number(global.db.getState("swsCdPerk")) || 1;
        const total_cd = 300 * cd_buff;
        const partner =
          message?.embeds[0]?.title?.includes("with your partner");
        const refMsg = await message.channel.messages.fetch(
          message.reference.messageId,
        );
        global.db.createReminder(
          refMsg.author.id,
          message.channel,
          total_cd,
          partner
            ? {
                type: "7w7 Partner",
                command: "+p i",
                information: "You can meet your partner again",
              }
            : {
                type: "7w7 Wife",
                command: "+wife i",
                information: "You can interact with your wife again",
              },
        );
      } else if (message?.content?.includes("Gem broke")) {
        let user = global.getUserIdFromMention(message.content);
        user = global.bot.users.cache.get(user) || message.author;
        const gem = message.content.split(">")[1].split("broke")[0].trim();
        let gemId = global.db.safeQuery(
          `SELECT id FROM sws_items WHERE name = ? LIMIT 1`,
          [gem],
        )?.[0]?.id;
        const embed = new EmbedBuilder()
          .setColor("Red")
          .setAuthor({ name: `${gem} broke`, iconURL: user.avatarURL() })
          .setDescription(`+use ${gemId}`);
        message.reply({
          embeds: [embed],
          content: `-# Gem Reminder <@${user.id}>`,
        });
      } else if (
        message?.embeds[0]?.title === "Getting ready" &&
        !message?.content?.includes("Auto-setup raid") &&
        oldMessage
      ) {
        if (oldMessage?.embeds[0]?.title === "Getting ready") return;
        let raidUsers = [];
        for (let button of message?.components[0]?.components) {
          if (button?.label?.includes("Ready")) {
            let user = global.bot.users.cache.get(
              button.customId.split(";=;")[1],
            );
            if (user) raidUsers.push(user);
          }
        }
        const embed = new EmbedBuilder()
          .setColor("Red")
          .setAuthor({
            name: `Raid ready`,
            iconURL: message?.embeds[0]?.author?.iconURL,
          })
          .setDescription(`+use ${gemId}`);
        message.reply({
          embeds: [embed],
          content: `-# Raid Reminder ${raidUsers.map((user) => `<@${user.id}>`).join(", ")}`,
        });
      }
    }
  }
}

module.exports(createReminders);
