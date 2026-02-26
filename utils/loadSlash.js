const fs = require("node:fs");
const path = require("node:path");

async function loadSlashCommands(client) {
  const commandsDir = path.join(__dirname, "..", "commands");
  if (!fs.existsSync(commandsDir)) return 0;

  client.commands.slash.commands.clear();
  client.commands.slash.subcommands.clear();

  let loadedCount = 0;

  for (const file of fs.readdirSync(commandsDir)) {
    if (!file.endsWith(".js")) continue;

    const filePath = path.join(commandsDir, file);
    if (!fs.statSync(filePath).isFile()) continue;

    let commandModule;
    try {
      commandModule = require(filePath);
    } catch (error) {
      console.error(`Failed to load command file ${file}:`, error);
      continue;
    }

    const rawData = commandModule?.data;
    if (!rawData) continue;

    const builders = Array.isArray(rawData) ? rawData : [rawData];
    for (const builder of builders) {
      const json =
        typeof builder?.toJSON === "function" ? builder.toJSON() : builder;
      if (!json?.name) continue;

      client.commands.slash.commands.set(json.name, {
        ...commandModule,
        data: builder,
      });
      loadedCount += 1;
    }
  }
  return loadedCount;
}

async function registerSlashCommands(client) {
  if (!client?.application?.commands) {
    throw new Error("Application commands are unavailable on the client.");
  }

  const payload = [];
  for (const command of client.commands.slash.commands.values()) {
    const data = command?.data;
    if (!data) continue;
    payload.push(typeof data.toJSON === "function" ? data.toJSON() : data);
  }

  await client.application.commands.set(payload);
  return payload.length;
}

async function loadEvents(client) {
  const eventsDir = path.join(__dirname, "..", "events");
  if (!fs.existsSync(eventsDir)) return 0;

  let loadedCount = 0;

  for (const file of fs.readdirSync(eventsDir)) {
    if (!file.endsWith(".js")) continue;

    const filePath = path.join(eventsDir, file);
    if (!fs.statSync(filePath).isFile()) continue;

    let event;
    try {
      event = require(filePath);
    } catch (error) {
      console.error(`Failed to load event file ${file}:`, error);
      continue;
    }

    if (!event?.name || typeof event.execute !== "function") continue;

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client));
    }
    loadedCount += 1;
  }
  return loadedCount;
}

module.exports = {
  loadEvents,
  loadSlashCommands,
  registerSlashCommands,
};
