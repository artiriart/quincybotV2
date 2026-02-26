const fs = require("node:fs");
const path = require("node:path");
const {
  Client,
  Collection,
  GatewayIntentBits,
  Options,
  Partials,
} = require("discord.js");
const dotenv = require("dotenv");
const database = require("./database.js");

dotenv.config();

database.initDatabase();

global.db = database;
global.botIds = {
  dank: "270904126974590976",
  sws: "705910242285715546",
  izzi: "784851074472345633",
  anigame: "571027211407196161",
};
global.ownerIds = process.env.OWNERS.split("|") || [];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 0,
    GuildMemberManager: 0,
    PresenceManager: 0,
    ThreadManager: 0,
    ThreadMemberManager: 0,
    GuildBanManager: 0,
    GuildEmojiManager: 0,
    GuildStickerManager: 0,
    ReactionManager: 0,
    VoiceStateManager: 0,
    StageInstanceManager: 0,
    GuildInviteManager: 0,
    DMMessageManager: 0,
    UserManager: 25,
  }),
  sweepers: {
    messages: {
      interval: 60,
      lifetime: 120,
    },
    users: {
      interval: 300,
      filter: () => (user) => user.bot,
    },
  },
});

client.commands = new Collection();
client.db = database;

function loadCommands() {
  const commandsDir = path.join(__dirname, "commands");
  if (!fs.existsSync(commandsDir)) return;

  for (const file of fs.readdirSync(commandsDir)) {
    const filePath = path.join(commandsDir, file);
    if (!fs.statSync(filePath).isFile()) continue;

    const command = require(filePath);
    if (!command || !command.data) continue;

    const commandData = Array.isArray(command.data) ? command.data : [command.data];

    for (const data of commandData) {
      const json = typeof data.toJSON === "function" ? data.toJSON() : data;
      if (!json || typeof json.name !== "string") continue;
      client.commands.set(json.name, command);
    }
  }
}

function loadEvents() {
  const eventsDir = path.join(__dirname, "events");
  if (!fs.existsSync(eventsDir)) return;

  for (const file of fs.readdirSync(eventsDir)) {
    const filePath = path.join(eventsDir, file);
    if (!fs.statSync(filePath).isFile()) continue;

    const event = require(filePath);
    if (!event) continue;

    if (typeof event === "function") {
      client.on(file, (...args) => event(...args, client));
      continue;
    }

    if (typeof event.execute === "function" && typeof event.name === "string") {
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
      } else {
        client.on(event.name, (...args) => event.execute(...args, client));
      }
    }
  }
}

loadCommands();
loadEvents();

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Missing BOT_TOKEN in environment.");
  process.exit(1);
}

client.login(token);
