const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Options,
  Partials,
} = require("discord.js");

process.env.DOTENV_CONFIG_QUIET = "true";
require("dotenv").config();

const database = require("./database.js");
const { runStartupSync } = require("./functions/startupSync");
const handleMessage = require("./functions/handleMessage");
const {
  loadSlashCommands,
  loadEvents,
  registerSlashCommands,
} = require("./utils/loadSlash");

global.db = database;
global.botIds = {
  dank: "270904126974590976",
  sws: "705910242285715546",
  izzi: "784851074472345633",
  anigame: "571027211407196161",
  karuta: "646937666251915264",
};
global.ownerIds = (process.env.OWNERS || "")
  .split("|")
  .map((id) => id.trim())
  .filter(Boolean);

const client = Object.assign(
  new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
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
      UserManager: 5000,
    }),
    sweepers: {
      messages: {
        interval: 60,
        lifetime: 120,
      },
    },
  }),
  {
    commands: {
      slash: { commands: new Collection(), subcommands: new Collection() },
      prefix: { commands: new Collection(), aliases: new Collection() },
    },
    events: new Collection(),
  },
);

global.bot = client;
global.getUserIdFromMention = (text) => {
  const match = text.match(/<@!?(\d+)>/);
  return match ? match[1] : null;
};

const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;
let stateSweeperInterval = null;

function startStateSweeper() {
  if (stateSweeperInterval) return;
  stateSweeperInterval = setInterval(() => {
    try {
      global.db.sweepNonPermanentStates?.();
    } catch (error) {
      console.error("State sweeper failed:", error);
    }
  }, WEEKLY_MS);
}

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

client.once(Events.ClientReady, async (readyClient) => {
  try {
    await registerSlashCommands(readyClient);
    await runStartupSync();
    handleMessage.startReminderPolling?.();
    readyClient.user?.setPresence({
      activities: [{ name: "Quincybot V2!!! better ig..." }],
      status: "online",
    });
    console.log(`Logged in as ${readyClient.user.username}.`.rainbow);
  } catch (error) {
    console.error("Startup initialization failed:", error);
  }
});

async function start() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new Error("BOT_TOKEN is missing. Add it to your .env file.");
  }

  database.initDatabase();
  database.sweepNonPermanentStates?.();
  const events = await loadEvents(client);
  const slashes = await loadSlashCommands(client);
  startStateSweeper();
  await client.login(token);
  console.log(`Loaded ${events} events and ${slashes} slash commands.`.rainbow);
}

start().catch((error) => {
  console.error("client startup failed:", error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});
