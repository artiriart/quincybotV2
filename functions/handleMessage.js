const { EmbedBuilder } = require("discord.js");
const { createV2Message } = require("../utils/componentsV2");
// todo: add to /settings that you can toggle then it uses the currently unused user_ids to check if user disabled the setting or not

const anigame_emoji_map = {
  "<:common:1068421015509684224>": "Common",
  "<:not:1068421022606426182><:common:1068421020739981312>": "Uncommon",
  "<:rare:1068421016893800469>": "Rare",
  "<:super:1068421019645247550><:rare:1068421018374377535>": "Super Rare",
  "<a:ultra:1068416715890892861><a:rare:1068416713592414268>": "Ultra Rare",
};

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
            partner ? "7w7 Partner" : "7w7 Wife",
            partner
              ? {
                  command: "+p i",
                  information: "You can meet your partner again",
                }
              : {
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
        // todo: (low priority) bulk sell ID extractor
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
        } else if (
          message?.embeds[0]?.title === "Calendar Fragment Shop" &&
          !oldMessage
        ) {
          // todo: check if already notified today (utc reset)
          // todo: get all users who have this card subscribed
          // todo: send them a notification
          const card_name = message?.embeds[0]?.description?.split("**")[-2];
        } else if (
          message?.components[0]?.components?.find(
            (c) => c?.type === 10 && c?.content?.includes("Clan Shop"),
          ) &&
          !oldMessage
        ) {
          const card_sections = message?.components[0]?.components?.filter(
            (c) => c?.type === 10 && c?.content?.includes("Shop ID:"),
          );
          for (const section of card_sections) {
            const card_name = section?.content?.split("**")[1];
            const card_rarity = section?.content?.split("__")[1];
            const card_price = section?.content?.split("**")[3] + " Rubies";
            // todo: check if already notified today (utc reset)
            // todo: get all users who have this card + rarity subscribed
            // todo: send them a notification
          }
        } else if (message?.embeds[0]?.title?.includes("claimed by")) {
          const claimed_username = message?.embeds[0]?.title?.split("__")[1];
          const claimed_user = global.bot.users.cache.find(
            (u) => u.username === claimed_username,
          );
          const claimed_user_id = claimed_user?.id;
          const rarity_emoji = message?.embeds[0]?.description?.split("**")[0];
          const card_rarity = anigame_emoji_map[rarity_emoji];
          global.db.safeQuery(
            `INSERT INTO card_claims (user_id, bot_name, rarity, amount) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + 1`,
            [claimed_user_id, "Anigame", card_rarity, 1],
          );
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
        if (message?.embeds[0]?.title === "Visit Character") {
          let reminder_length = null;
          if (
            message?.embeds[0]?.description?.includes(
              "you were recently rejected.",
            )
          ) {
            reminder_length = 24;
          } else if (
            message?.embeds[0]?.description?.includes("date was successful!")
          ) {
            reminder_length = 10;
          }
          const user_id = extractUserFromMention(
            message?.embeds[0]?.description,
          );
          if (reminder_length) {
            global.db.createReminder(
              user_id,
              message.channel,
              reminder_length * 60,
              "Karuta Visit",
              {
                command: `kvi ${message?.embeds[0]?.description?.split("\`")[1]}`,
                information: "You can visit your partner again",
              },
              true,
            );
          }
          const claimed_username = message?.embeds[0]?.title?.split("__")[1];
          const claimed_user = global.bot.users.cache.find(
            (u) => u.username === claimed_username,
          );
          const claimed_user_id = claimed_user?.id;
          const rarity_emoji = message?.embeds[0]?.description?.split("**")[0];
          const card_rarity = karuta_emoji_map[rarity_emoji];
          global.db.safeQuery(
            `INSERT INTO card_claims (user_id, bot_name, rarity, amount) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + 1`,
            [claimed_user_id, "Karuta", card_rarity, 1],
          );
        }
      }
      case global.botIds.izzi: {
        // todo: market tracker for bestraids
        // todo: (low priority) crate extractor
        // todo: (ultra low priority) Reminder system
        if (message?.content?.includes("has been added to")) {
          const claimed_username = message?.content
            ?.split("**")[1]
            ?.split("'s**")[0];
          const claimed_user = global.bot.users.cache.find(
            (u) => u.username === claimed_username,
          );
          const claimed_user_id = claimed_user?.id;
          const card_rarity = message?.content?.split("__")[1];
          global.db.safeQuery(
            `INSERT INTO card_claims (user_id, bot_name, rarity, amount) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + 1`,
            [claimed_user_id, "Izzi", card_rarity, 1],
          );
        }
      }
    }
  }
}

module.exports(handleMessage);
