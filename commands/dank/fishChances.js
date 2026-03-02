const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { buttonHandlers } = require("../../functions/interactions/button");
const { modalHandlers } = require("../../functions/interactions/modal");

const ROUTE_PREFIX = "dankfishchance";
const SIM_MODAL_ID = `${ROUTE_PREFIX}:simulate_modal`;
const SIM_INPUT_ID = "catch_count";
const GET_SIMULATOR_URL = "https://dankmemer.lol/api/bot/fish/simulator";
const POST_SIMULATOR_URL = "https://dankmemer.lol/api/bot/fish/simulator";
const CACHE_TTL_MS = 15_000;
const chancesCache = new Map();

function withEmojiSpacing(markdown) {
  return markdown ? `${markdown} ` : "";
}

async function getEntityEmojiMap() {
  const rows = await global.db.safeQuery(
    `SELECT entity_type, entity_id, application_emoji
     FROM dank_fish_entities`,
    [],
    [],
  );
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.entity_type}:${row.entity_id}`, row.application_emoji || "");
  }
  return map;
}

async function getItemByIdMap() {
  const itemRows = await global.db.safeQuery(
    `SELECT dank_id, name, application_emoji
     FROM dank_items
     WHERE dank_id IS NOT NULL`,
    [],
    [],
  );
  return new Map(
    itemRows
      .map((row) => [
        Number(row.dank_id),
        { name: row.name, emoji: row.application_emoji },
      ])
      .filter(([id]) => Number.isFinite(id)),
  );
}

function resolveEntityById(list, id) {
  const rows = Array.isArray(list) ? list : [];
  return rows.find((row) => String(row?.id || "") === String(id || "")) || null;
}

function toSettingsText(settings, getData, entityEmojiMap) {
  const locationId = settings?.location || "N/A";
  const toolId = settings?.tool || "N/A";
  const baits = Array.isArray(settings?.baits) ? settings.baits : [];
  const locationEntity = resolveEntityById(getData?.locations, locationId);
  const toolEntity = resolveEntityById(getData?.tools, toolId);
  const locationName = locationEntity?.name || locationId;
  const toolName = toolEntity?.name || toolId;
  const locationEmoji =
    withEmojiSpacing(entityEmojiMap.get(`location:${locationId}`)) || "📍 ";
  const toolEmoji = withEmojiSpacing(entityEmojiMap.get(`tool:${toolId}`)) || "🛠️ ";
  const baitLabel = baits.length
    ? baits
        .map((baitId) => {
          const baitEntity = resolveEntityById(getData?.baits, baitId);
          const baitName = baitEntity?.name || baitId;
          const baitEmoji =
            withEmojiSpacing(entityEmojiMap.get(`bait:${baitId}`)) || "🎣 ";
          return `${baitEmoji}${baitName}`;
        })
        .join(", ")
    : "none";
  const bosses = settings?.bosses ? "true" : "false";
  const skillCount = Object.keys(settings?.skills || {}).length;
  return `### Current User Settings\n- Location: ${locationEmoji}\`${locationName}\`\n- Tool: ${toolEmoji}\`${toolName}\`\n- Baits: ${baitLabel}\n- Bosses: \`${bosses}\`\n- Skills: \`${skillCount}\``;
}

function summarizeValue(entry, fishMap, emojiMap, itemById) {
  const value = entry?.value || {};
  const type = String(value?.type || "");
  if (type === "fish-creature" || type === "boss-creature") {
    const id = String(value.creatureID || "");
    const fish = fishMap?.[id] || {};
    const fishName = fish?.name || id || "Unknown Fish";
    const emoji = withEmojiSpacing(emojiMap.get(`creature:${id}`)) || "🐟 ";
    return `${emoji}**${fishName}**`;
  }
  if (type === "loot") {
    const itemId = value?.reward?.item ?? "unknown";
    const qty = Number(value?.reward?.quantity || 1);
    const item = itemById.get(Number(itemId));
    if (item) {
      const emoji = withEmojiSpacing(item.emoji) || "🎁 ";
      return `${emoji}${item.name} x${qty}`;
    }
    return `🎁 Loot Item #${itemId} x${qty}`;
  }
  if (type === "npc") return "🧑 NPC Encounter";
  return `❔ ${type || "unknown"}`;
}

function buildChanceTableText(postData, fishMap, emojiMap, itemById) {
  const rows = Array.isArray(postData?.table) ? postData.table : [];
  if (!rows.length) return "No possibilities returned by simulator.";

  const sorted = [...rows].sort(
    (a, b) => Number(b?.chance || 0) - Number(a?.chance || 0),
  );
  const lines = sorted.slice(0, 40).map((entry) => {
    const label = summarizeValue(entry, fishMap, emojiMap, itemById);
    return `- ${label}: **${Number(entry?.chance || 0).toFixed(2)}%**`;
  });

  return [
    `Fail chance: **${Number(postData?.failChance || 0).toFixed(2)}%**`,
    `NPC chance: **${Number(postData?.npcChance || 0).toFixed(2)}%**`,
    "",
    ...lines,
  ].join("\n");
}

function buildPostPayload(settings) {
  const now = new Date();
  return {
    skills:
      settings?.skills && typeof settings.skills === "object"
        ? settings.skills
        : {},
    bosses: !!settings?.bosses,
    locationID: String(settings?.location || "river"),
    toolID: String(settings?.tool || "fishing-rod"),
    baitsIDs: Array.isArray(settings?.baits) ? settings.baits : [],
    time: Date.now(),
    events: [],
    locationWinner: false,
    bonusBossMultiplier: 1,
    bonusMythicalMultiplier: 1,
    forceTrash: false,
    mythicalFishID: null,
    discoveredCreatures: null,
    anglerTuesday: now.getUTCDay() === 2,
    invasion: null,
  };
}

async function fetchSimulatorData(userId, force = false) {
  const key = String(userId);
  const cached = chancesCache.get(key);
  if (
    !force &&
    cached &&
    Date.now() - Number(cached.fetchedAt || 0) < CACHE_TTL_MS
  ) {
    return cached;
  }

  const getResponse = await fetch(
    `${GET_SIMULATOR_URL}?id=${encodeURIComponent(userId)}`,
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!getResponse.ok) {
    throw new Error(`GET simulator failed (${getResponse.status})`);
  }
  const getJson = await getResponse.json();
  const settings = getJson?.settings || {};
  const payload = buildPostPayload(settings);

  const postResponse = await fetch(POST_SIMULATOR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!postResponse.ok) {
    throw new Error(`POST simulator failed (${postResponse.status})`);
  }
  const postJson = await postResponse.json();

  const merged = {
    fetchedAt: Date.now(),
    settings,
    getData: getJson?.data || {},
    postData: postJson || {},
  };
  chancesCache.set(key, merged);
  return merged;
}

function buildSimulationPool(postData) {
  const rows = Array.isArray(postData?.table) ? postData.table : [];
  const failChance = Number(postData?.failChance || 0);
  const pool = [];
  let total = 0;

  if (failChance > 0) {
    total += failChance;
    pool.push({ type: "fail", cumulative: total });
  }

  for (const row of rows) {
    const chance = Number(row?.chance || 0);
    if (chance <= 0) continue;
    total += chance;
    pool.push({ type: "table", row, cumulative: total });
  }
  return { pool, total };
}

function pickFromPool(pool, total) {
  if (!pool.length || total <= 0) return { type: "fail" };
  const roll = Math.random() * total;
  for (const entry of pool) {
    if (roll <= entry.cumulative) return entry;
  }
  return pool[pool.length - 1];
}

function resolveSimulationOutcome(entry, fishMap, emojiMap, itemById, failEmoji) {
  if (entry?.type === "fail") {
    return { key: "fail", group: 3, label: `${failEmoji} Fail` };
  }
  const value = entry?.row?.value || {};
  const type = String(value?.type || "");
  if (type === "fish-creature" || type === "boss-creature") {
    const id = String(value.creatureID || "");
    const fish = fishMap?.[id] || {};
    const fishName = fish?.name || id || "Unknown Fish";
    const fishEmoji = emojiMap.get(`creature:${id}`) || fish?.emoji || "🐟";
    return {
      key: `fish:${id}`,
      group: 1,
      label: `${fishEmoji} ${fishName}`,
    };
  }
  if (type === "loot") {
    const itemId = Number(value?.reward?.item);
    const item = itemById.get(itemId);
    return {
      key: `item:${Number.isFinite(itemId) ? itemId : "unknown"}`,
      group: 2,
      label: item?.emoji ? `${item.emoji} ${item.name}` : "🎁 Loot",
    };
  }
  if (type === "npc") return { key: "npc", group: 4, label: "🧑 NPC" };
  return { key: "other", group: 5, label: "❔ Other" };
}

function chunkSimulationLines(lines, maxLen = 1900) {
  const chunks = [];
  let current = "";
  for (const line of lines) {
    const piece = current ? `\n${line}` : line;
    if ((current + piece).length > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current += piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function buildChancesContainer(userId, showSettings = true, force = false) {
  const sim = await fetchSimulatorData(userId, force);
  const fishMap =
    sim?.getData?.fish && typeof sim.getData.fish === "object"
      ? sim.getData.fish
      : {};
  const emojiMap = await getEntityEmojiMap();
  const itemById = await getItemByIdMap();

  const tableText = buildChanceTableText(sim.postData, fishMap, emojiMap, itemById);
  const settingsText = toSettingsText(sim.settings, sim.getData, emojiMap);

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Current Fishing chances"),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(tableText.slice(0, 3800)),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            showSettings ? settingsText : "### Current User Settings\n- Hidden",
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`${ROUTE_PREFIX}:toggle:${showSettings ? "0" : "1"}`)
            .setLabel(showSettings ? "Hide" : "Show")
            .setStyle(ButtonStyle.Secondary),
        ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${ROUTE_PREFIX}:refresh`)
          .setLabel("Refresh")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${ROUTE_PREFIX}:simulate`)
          .setLabel("Simulate x Catches")
          .setStyle(ButtonStyle.Secondary),
      ),
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

async function runDankFishChances(interaction) {
  const payload = await buildChancesContainer(interaction.user.id, true, true);
  await interaction.reply(payload);
}

async function handleDankFishChanceButton(interaction) {
  const [, action, arg] = String(interaction.customId || "").split(":");

  if (action === "simulate") {
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(SIM_MODAL_ID)
        .setTitle("Simulate Catches")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(SIM_INPUT_ID)
              .setLabel("How many catches?")
              .setPlaceholder("e.g. 100")
              .setRequired(true)
              .setStyle(TextInputStyle.Short),
          ),
        ),
    );
    return;
  }

  if (action === "toggle") {
    const show = arg === "1";
    const payload = await buildChancesContainer(interaction.user.id, show, false);
    await interaction.update(payload);
    return;
  }

  if (action === "refresh") {
    const payload = await buildChancesContainer(interaction.user.id, true, true);
    await interaction.update(payload);
  }
}

async function handleDankFishChanceModal(interaction) {
  if (String(interaction.customId || "") !== SIM_MODAL_ID) return;

  const parsed = Number.parseInt(
    String(interaction.fields.getTextInputValue(SIM_INPUT_ID) || "").trim(),
    10,
  );
  const count = Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 10000)) : 100;

  const sim = await fetchSimulatorData(interaction.user.id, false);
  const fishMap =
    sim?.getData?.fish && typeof sim.getData.fish === "object"
      ? sim.getData.fish
      : {};
  const emojiMap = await getEntityEmojiMap();
  const itemById = await getItemByIdMap();
  const failEmoji = global.db.getFeatherEmojiMarkdown?.("x") || "❌";

  const { pool, total } = buildSimulationPool(sim.postData);
  const counts = new Map();
  for (let i = 0; i < count; i += 1) {
    const pick = pickFromPool(pool, total);
    const outcome = resolveSimulationOutcome(
      pick,
      fishMap,
      emojiMap,
      itemById,
      failEmoji,
    );
    const prev = counts.get(outcome.key);
    if (!prev) {
      counts.set(outcome.key, {
        group: outcome.group,
        label: outcome.label,
        qty: 1,
      });
    } else {
      prev.qty += 1;
    }
  }
  const lines = [...counts.values()]
    .sort(
      (a, b) =>
        a.group - b.group || b.qty - a.qty || a.label.localeCompare(b.label),
    )
    .map((entry) => `* ${entry.qty} ${entry.label}`);
  const chunks = chunkSimulationLines(lines, 1900);
  const MAX_DISPLAYABLE = 3900;
  const pages = [];
  let page = [];
  let pageSize = 0;

  for (const chunk of chunks) {
    const chunkSize = chunk.length;
    if (page.length && pageSize + chunkSize > MAX_DISPLAYABLE) {
      pages.push(page);
      page = [chunk];
      pageSize = chunkSize;
    } else {
      page.push(chunk);
      pageSize += chunkSize;
    }
  }
  if (page.length) pages.push(page);
  if (!pages.length) pages.push(["No results."]);

  const buildContainerForPage = (pageChunks, pageIndex) => {
    const title =
      pageIndex === 0
        ? `### Simulated ${count} Catches`
        : `### Simulated ${count} Catches (continued ${pageIndex + 1}/${pages.length})`;

    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(title))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    for (const text of pageChunks) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    }
    return container;
  };

  await interaction.reply({
    components: [buildContainerForPage(pages[0], 0)],
    flags: MessageFlags.IsComponentsV2,
  });

  for (let i = 1; i < pages.length; i += 1) {
    await interaction.followUp({
      components: [buildContainerForPage(pages[i], i)],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

if (!buttonHandlers.has(ROUTE_PREFIX)) {
  buttonHandlers.set(ROUTE_PREFIX, handleDankFishChanceButton);
}

if (!modalHandlers.has(ROUTE_PREFIX)) {
  modalHandlers.set(ROUTE_PREFIX, handleDankFishChanceModal);
}

module.exports = {
  runDankFishChances,
};
