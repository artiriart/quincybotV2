const {
  EmbedBuilder,
  ContainerBuilder,
  SectionBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { createV2Message } = require("../utils/componentsV2");
const { MessageFlags } = require("discord.js-selfbot-v13");
// todo: add to /settings that you can toggle then it uses the currently unused user_ids to check if user disabled the setting or not

const anigame_emoji_map = {
  "<:common:1068421015509684224>": "Common",
  "<:not:1068421022606426182><:common:1068421020739981312>": "Uncommon",
  "<:rare:1068421016893800469>": "Rare",
  "<:super:1068421019645247550><:rare:1068421018374377535>": "Super Rare",
  "<a:ultra:1068416715890892861><a:rare:1068416713592414268>": "Ultra Rare",
};

const dank_adventure_ticket_map = {
  "Pepe goes out West": 2,
  "Pepe goes to Space!": 2,
  "Pepe goes Trick or Treating": 4,
  "Pepe's Winter Wonderland!": 2,
  "Pepe goes to the Museum!": 2,
  "Pepe goes on Vacation!": 2,
  "Pepe goes fishing with friends": 3,
  "Pepe goes down under": 2,
  "Pepe goes to Brazil!": 3,
  // Half & round down during Saturdays
};

async function resolveDankUser(message) {
  let user = null;

  if (message?.interaction?.user) {
    user = message.interaction.user;
  } else if (message?.reference?.messageId) {
    const refMsg = await message.channel.messages.fetch(
      message.reference.messageId,
    );
    user = refMsg.author;
  }

  return user;
}

async function handleMessage(message, oldMessage = false) {
  // ======= PARSE BOTS =======
  if (!message.author.bot) return;

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
        const partner = message?.embeds[0]?.title?.includes(
          "with your partner",
        );
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

        const gemId = global.db.safeQuery(
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

        const raidUsers = [];
        for (const button of message?.components[0]?.components) {
          if (button?.label?.includes("Ready")) {
            const user = global.bot.users.cache.get(
              button.customId.split(";=;")[1],
            );
            const user_id = user.id;
            if (user) raidUsers.push(user);
          }
        }

        const embed = new EmbedBuilder()
          .setColor("Red")
          .setAuthor({
            name: "Raid ready",
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
          `INSERT INTO card_claims (user_id, bot_name, rarity, amount) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, bot_name, rarity) DO UPDATE SET amount = amount + 1`,
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
        const user_id = message.components[0].components[0].customId.split(
          ":",
        )[1];
        const refMsg = await message.channel.messages
          .fetch(message.reference.messageId)
          .catch(() => {});

        if (refMsg) {
          await refMsg.delete().catch(() => {});
        }
      } else if (message?.embeds[0]?.author?.name === "Adventure Summary") {
        const user = resolveDankUser(message);
        const adv = message?.embeds[0]?.fields.find((f) => f.name === "Name")
          .value;

        for (let reward of message?.embeds[0]?.fields
          .find((f) => f.name === "Rewards")
          ?.value?.split("\n") || []) {
          reward = reward.split("-")[1].trim();
          if (
            !reward.includes("Multiplier") &&
            !reward.includes("Title") &&
            !reward.includes("Pet")
          ) {
            let [amount, item] = [null, null];
            if (reward.includes("⏣")) {
              amount = reward.split("⏣")[1].replaceAll(",", "").trim();
              item = "DMC";
            } else {
              amount = reward.split("<")[0].trim();
              item = reward.split(">")[-1].trim();
            }

            amount = parseInt(amount);
            global.db.safeQuery(
              `INSERT INTO dank_stats (user_id, item_name, item_amount, stat_type) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_name, stat_type) DO UPDATE SET item_amount = item_amount + excluded.item_amount`,
              [user.id, item, amount, `Adventure_${adv}`],
            );
          }
        }

        const adv_tickets = dank_adventure_ticket_map[adv] * -1;
        global.db.safeQuery(
          `INSERT INTO dank_stats (user_id, item_name, item_amount, stat_type) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_name, stat_type) DO UPDATE SET item_amount = item_amount + excluded.item_amount`,
          [user.id, "Adventure Ticket", adv_tickets, `Adventure_${adv}`],
        );
      } else if (
        message?.embeds[0]?.title &&
        message?.embeds[0]?.description?.startsWith("> ") &&
        message?.embeds[0]?.fields?.[0]?.name?.endsWith("recieved:")
      ) {
        let user = resolveDankUser(message);
        if (!user) {
          const username = message?.embeds[0]?.fields?.[0]?.name
            ?.split("recieved:")[0]
            .trim();
          user = global.bot.users.cache.find((u) => u.username === username);
        }

        if (!user) return;

        const event_type = message?.embeds[0]?.title?.replace("-", " ").trim();
        const rewards = message?.embeds[0]?.fields?.[0]?.value
          ?.split("\n")
          .map((r) => r.split("-")[1].trim());

        for (const reward of rewards) {
          if (
            !reward.includes("Multiplier") &&
            !reward.includes("Title") &&
            !reward.includes("Pet")
          ) {
            let [amount, item] = [null, null];
            if (reward.includes("⏣")) {
              amount = reward.split("⏣")[1].replaceAll(",", "").trim();
              item = "DMC";
            } else {
              amount = reward.split("<")[0].trim();
              item = reward.split(">")[-1].trim();
            }

            amount = parseInt(amount);
            global.db.safeQuery(
              `INSERT INTO dank_stats (user_id, item_name, item_amount, stat_type) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_name, stat_type) DO UPDATE SET item_amount = item_amount + excluded.item_amount`,
              [user.id, item, amount, `Random Event_${event_type}`],
            );
          }
        }
      } else if (
        message?.embeds[0]?.title === "Boss Battle" &&
        message?.embeds[0]?.fields?.[0]?.name === "Rewards:"
      ) {
        const rewards = message?.embeds[0]?.fields?.[0]?.value
          ?.split("\n")
          .map((r) => r.split("-")[1].trim());

        for (let reward of rewards) {
          if (!reward.includes("Multiplier") && !reward.includes("Title")) {
            const user = extractUserFromMention(reward);
            if (!user) return;

            reward = reward.split("for")[0].trim();
            reward_lines = reward.split("and").map((r) => r.trim());

            for (let reward_line of reward_lines) {
              let [amount, item] = [null, null];
              if (reward_line.includes("⏣")) {
                amount = reward_line.split("⏣")[1].replaceAll(",", "").trim();
                item = "DMC";
              } else {
                amount = reward_line.split("<")[0].trim();
                item = reward_line.split(">")[-1].trim();
              }

              amount = parseInt(amount);
              global.db.safeQuery(
                `INSERT INTO dank_stats (user_id, item_name, item_amount, stat_type) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_name, stat_type) DO UPDATE SET item_amount = item_amount + excluded.item_amount`,
                [user.id, item, amount, `Boss Battle_${event_type}`],
              );
            }
          }
        }
      } else if (
        message?.components?.[-1]?.components?.some(
          (c) => c?.type === 10 && c?.content?.includes("You caught something!"),
        )
      ) {
        const user = resolveDankUser(message);
        if (!user) return;

        const fishing_item = message?.components?.[-1]?.components
          ?.find(
            (c) => c?.type === 10 && c?.content?.includes("You caught something!"),
          )
          ?.content?.split("\n")
          [-1]?.split("- ")[1]
          ?.trim();

        let [amount, item] = [null, null];
        if (fishing_item.includes("⏣")) {
          amount = fishing_item.split("⏣")[1].replaceAll(",", "").trim();
          item = "DMC";
        } else {
          amount = fishing_item.split("<")[0].trim();
          item = fishing_item.split(">")[-1].trim();
        }

        amount = parseInt(amount);
        global.db.safeQuery(
          `INSERT INTO dank_stats (user_id, item_name, item_amount, stat_type) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_name, stat_type) DO UPDATE SET item_amount = item_amount + excluded.item_amount`,
          [user.id, item, amount, "Fishing"],
        );
      } else if (
        message?.components?.[0]?.components?.some(
          (c) => c?.type === 10 && c?.content?.includes("Coin Nuke**"),
        )
      ) {
        const componentText = message?.components?.[0]?.components?.find(
          (c) => c?.type === 10 && c?.content?.includes("Coin Nuke**"),
        )?.content;
        const host = componentText?.split("'s")[0]?.trim();
        if (!host) return;

        let total_payout = 0;
        const nuke_payouts = [];

        for (const nukePayouts of componentText
          ?.split("\n")
          .filter((l) => l.startsWith("-") && l.includes("⏣"))) {
          const joined = nukePayouts.split(" ")[1].trim();
          const user_payout = joined.split("⏣")[1].replaceAll(",", "").trim();
          total_payout += parseInt(user_payout);
          nuke_payouts.push({
            user: joined,
            amount: user_payout,
          });
        }

        const container = new ContainerBuilder().addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents((td) => {
              td.setContent(
                `### ${host}'s Coin Nuke dropped\n# ⏣ ${total_payout.toLocaleString()}`,
              );
            })
            .setButtonAccessory(
              new ButtonBuilder()
                .setLabel("Add to tracker")
                .setStyle(ButtonStyle.Primary)
                .setCustomId(`dank:nukeclaim:${host}`),
            ),
        );

        const { id } = await message.reply({
          components: [container],
          flags: MessageFlags.isComponentV2,
        });
        global.db.upsertState("nuke_payout", nuke_payouts, id, false);
      } else if (
        message?.components?.[0]?.components?.some(
          (c) => c?.type === 10 && c?.content?.includes("Level Rewards"),
        )
      ) {
        const levelComponents = message?.components?.[0]?.components?.filter(
          (c) => c?.type === 10 && /Level \d+/.test(c?.content),
        );

        for (const levelComponent of levelComponents) {
          const level = parseInt(levelComponent?.content?.match(/Level (\d+)/)[1]);
          const rewards = levelComponent?.content
            ?.split("\n")
            .filter((l) => !l.startsWith("<:Reply:"));

          for (let reward of rewards) {
            reward = reward.split(">")[1].trim();
            if (reward.includes("Multiplier")) continue;

            let [amount, item, title] = [null, null, false];
            if (reward.includes("⏣")) {
              amount = reward.split("⏣")[1].replaceAll(",", "").trim();
              item = "DMC";
            } else if (reward.includes("Title")) {
              title = true;
              amount = 1;
              item = reward.split("'")[1].trim();
            } else {
              amount = reward.split("<")[0].trim();
              item = reward.split(">")[-1].trim();
            }

            amount = parseInt(amount);
            global.db.safeQuery(
              `INSERT OR IGNORE INTO dank_level_rewards (level, name, amount, title) VALUES (?, ?, ?, ?)`,
              [level, item, amount, title],
            );
          }
        }
      }
      // todo: multi / premium logger (!After multi calculator!, to Populate multi DB, and if user enabled, log multis to user)
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

        const user_id = extractUserFromMention(message?.embeds[0]?.description);
        if (reminder_length) {
          global.db.createReminder(
            user_id,
            message.channel,
            reminder_length * 60,
            "Karuta Visit",
            {
              command: `kvi ${message?.embeds[0]?.description?.split("`")[1]}`,
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
          `INSERT INTO card_claims (user_id, bot_name, rarity, amount) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, bot_name, rarity) DO UPDATE SET amount = amount + 1`,
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
          `INSERT INTO card_claims (user_id, bot_name, rarity, amount) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, bot_name, rarity) DO UPDATE SET amount = amount + 1`,
          [claimed_user_id, "Izzi", card_rarity, 1],
        );
      }
    }
  }
}

module.exports = handleMessage;
