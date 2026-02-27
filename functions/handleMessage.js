const { EmbedBuilder } = require("discord.js");
const { createV2Message } = require("../utils/componentsV2");

async function handleMessage(message, oldMessage = false) {
  // ======= PARSE BOTS =======
  if (message.author.bot) {
    switch (message.author.id) {
      case global.botIds.sws: {
        // todo: raid tickets refill reminder
        // todo: preset saver / raid guide start parser
        // todo: equipment ID parser
        // todo: cd skill tracker
        // todo: market & item tracker
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
          const user_id = refMsg.author.id;
          global.db.createReminder(
            user_id,
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
          const user_id = user.id;
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
              const user_id = user.id;
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
        } else if (
          message.embeds[0].title?.includes("waifu appeared!") &&
          !oldMessage
        ) {
          const embed_color = message.embeds[0].color;
          const autodelete = global.db.safeQuery(
            `SELECT hex_color FROM sws_autodelete WHERE hex_color = ? AND guild_id = ? LIMIT 1`,
            [embed_color, message.guild.id],
          )?.[0]?.hex_color;
          if (autodelete) {
            await message.delete().catch(() => {});
            await message.channel.send(
              createV2Message(
                `Deleted **${message?.embeds[0]?.author?.name || "Waifu"}** drop, since *Autodelete* was enabled!\n` +
                  `-# Use \`/settings\` -> 7w7 -> Dropdown to edit`,
              ),
            );
          }
        }
      }
      case global.botIds.anigame: {
        // todo: bulk sell ID extractor
        // todo: clan/fshop reminders
        // todo: claim card stats tracker
        // todo: market tracker for bestraids
        if (message?.embeds[0]?.title === "Raid Lobbies" && !oldMessage) {
          const refMsg = await message.channel.messages.fetch(
            message.reference.messageId,
          );
          const user_id = refMsg.author.id;
          if (refMsg?.content.length > 500) {
            await message.delete().catch(() => {});
            await message.channel.send(
              createV2Message(
                "-# Deleted **.rd lobbies** message to keep the chat clean!",
              ),
            );
          }
        }
      }
      case global.botIds.dank: {
        if (
          message?.embeds[0]?.description?.includes(
            "your lactose intolerance is acting up",
          ) ||
          message?.embeds[0]?.description?.includes("three o'clock in the")
        ) {
          const user_id =
            message.components[0].components[0].customId.split(":")[1];
          const refMsg = await message.channel.messages
            .fetch(message.reference.messageId)
            .catch(() => {});
          if (refMsg) {
            await refMsg.delete().catch(() => {});
          }
        }
        // todo: Adventure / Random Event / Fishing Item logger
        // todo: Nuke / trade logger
        // todo: multi / premium logger
        // todo: parse level rewards
      }
      case global.botIds.karuta: {
        // todo: drop / burn recognition
        // todo: visit reminders
      }
      case global.botIds.izzi: {
        // todo: market tracker for bestraids
        // todo: crate extractor
        // todo: visit reminders
        // todo: card claim stat tracker
        // todo: Reminder system (if got nothing else to do)
      }
    }
  }
}

module.exports(handleMessage);
