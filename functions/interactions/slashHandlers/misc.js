const { MessageFlags } = require("discord.js");

async function runPing(interaction) {
  const ws = interaction.client.ws.ping;
  await interaction.reply({
    content: `Pong! API latency: ${ws}ms`,
    flags: MessageFlags.Ephemeral,
  });
}

async function runHelp(interaction) {
  await interaction.reply({
    content: "Use `/calculator prompt:<equation>` to evaluate expressions.",
    flags: MessageFlags.Ephemeral,
  });
}

async function runInvite(interaction) {
  const appId = interaction.client?.application?.id || interaction.client?.user?.id;
  if (!appId) {
    await interaction.reply({
      content: "Application ID unavailable right now.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const url =
    `https://discord.com/oauth2/authorize?client_id=${appId}` +
    `&scope=bot%20applications.commands&permissions=8`;
  await interaction.reply({
    content: url,
    flags: MessageFlags.Ephemeral,
  });
}

async function runDice(interaction) {
  const range = Math.max(2, interaction.options.getInteger("range") || 6);
  const amount = Math.max(1, Math.min(20, interaction.options.getInteger("amount") || 1));
  const unique = interaction.options.getBoolean("unique");
  const uniqueMode = unique == null ? true : unique;

  if (uniqueMode && amount > range) {
    await interaction.reply({
      content: "Unique rolls cannot exceed range.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const values = [];
  while (values.length < amount) {
    const roll = Math.floor(Math.random() * range) + 1;
    if (uniqueMode && values.includes(roll)) continue;
    values.push(roll);
  }

  await interaction.reply({
    content: `Rolled: ${values.join(", ")}`,
  });
}

async function runSettings(interaction) {
  await interaction.reply({
    content: "Settings panel not implemented yet.",
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  runPing,
  runHelp,
  runInvite,
  runDice,
  runSettings,
};
