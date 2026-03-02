const HARDCODED_SKILLS = {
  zoologist: 5,
  "mythical-hunter": 1,
};

const DEFAULT_LOCATIONS = [
  "shallow-ocean",
  "river",
  "deep-ocean",
  "lake",
  "pond",
  "scurvy-waters",
];

const DEFAULT_TOOLS = [
  "fishing-rod",
  "harpoon",
  "net",
  "dynamite",
  "bare-hand",
  "fishing-bow",
  "magnet-fishing-rope",
  "idle-fishing-machine",
];

function toTitleFromId(value) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function withEmojiSpacing(markdown) {
  return markdown ? `${markdown} ` : "";
}

function parseEmojiMarkdown(markdown) {
  const text = String(markdown || "").trim();
  const match = text.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
  if (!match) return null;
  return {
    id: match[3],
    name: match[2],
    animated: match[1] === "a",
  };
}

function parseFlags(row) {
  return {
    is_hunting: Number(row?.is_hunting || 0) === 1,
    lucky_bait_enabled: Number(row?.lucky_bait_enabled || 0) === 1,
  };
}

async function getOrCreateFishSettings(userId) {
  const [row] = await global.db.safeQuery(
    `SELECT * FROM dank_fish_settings WHERE user_id = ? LIMIT 1`,
    [userId],
    [],
  );
  if (row) return { ...row, ...parseFlags(row) };

  await global.db.safeQuery(
    `INSERT INTO dank_fish_settings (user_id) VALUES (?)`,
    [userId],
  );
  const [created] = await global.db.safeQuery(
    `SELECT * FROM dank_fish_settings WHERE user_id = ? LIMIT 1`,
    [userId],
    [],
  );
  return { ...created, ...parseFlags(created) };
}

async function updateFishSettings(userId, patch = {}) {
  const current = await getOrCreateFishSettings(userId);
  const next = {
    target_type:
      patch.target_type === undefined ? current.target_type : patch.target_type,
    target_id: patch.target_id === undefined ? current.target_id : patch.target_id,
    is_hunting:
      patch.is_hunting === undefined
        ? current.is_hunting
          ? 1
          : 0
        : patch.is_hunting
          ? 1
          : 0,
    lucky_bait_enabled:
      patch.lucky_bait_enabled === undefined
        ? current.lucky_bait_enabled
          ? 1
          : 0
        : patch.lucky_bait_enabled
          ? 1
          : 0,
  };

  await global.db.safeQuery(
    `UPDATE dank_fish_settings
     SET target_type = ?, target_id = ?, is_hunting = ?, lucky_bait_enabled = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`,
    [
      next.target_type,
      next.target_id,
      next.is_hunting,
      next.lucky_bait_enabled,
      userId,
    ],
  );

  return getOrCreateFishSettings(userId);
}

async function listMythicalTargets() {
  return global.db.safeQuery(
    `SELECT entity_id AS target_id, name AS target_name, 'creature' AS target_type, entity_id AS creature_id, application_emoji
     FROM dank_fish_entities
     WHERE entity_type = 'creature' AND is_mythical = 1
     ORDER BY name ASC`,
    [],
    [],
  );
}

async function getTargetRow(targetId) {
  const [row] = await global.db.safeQuery(
    `SELECT entity_id AS target_id, name AS target_name, 'creature' AS target_type, entity_id AS creature_id, application_emoji
     FROM dank_fish_entities
     WHERE entity_type = 'creature' AND is_mythical = 1 AND entity_id = ?
     LIMIT 1`,
    [targetId],
    [],
  );
  return row || null;
}

async function getTargetCreatureIds(targetId) {
  const row = await getTargetRow(targetId);
  if (!row?.creature_id) return [];
  return [String(row.creature_id)];
}

async function getEntityMap() {
  const rows = await global.db.safeQuery(
    `SELECT entity_type, entity_id, name, application_emoji
     FROM dank_fish_entities`,
    [],
    [],
  );
  const entityMap = new Map();
  for (const row of rows) {
    entityMap.set(`${row.entity_type}:${row.entity_id}`, {
      name: row.name,
      emoji: row.application_emoji,
    });
  }
  return entityMap;
}

async function getLocationsAndTools() {
  const [locationRows, toolRows] = await Promise.all([
    global.db.safeQuery(
      `SELECT entity_id FROM dank_fish_entities WHERE entity_type = 'location' ORDER BY entity_id ASC`,
      [],
      [],
    ),
    global.db.safeQuery(
      `SELECT entity_id FROM dank_fish_entities WHERE entity_type = 'tool' ORDER BY entity_id ASC`,
      [],
      [],
    ),
  ]);

  const locations = locationRows.map((r) => String(r.entity_id)).filter(Boolean);
  const tools = toolRows.map((r) => String(r.entity_id)).filter(Boolean);

  return {
    locations: locations.length ? locations : DEFAULT_LOCATIONS,
    tools: tools.length ? tools : DEFAULT_TOOLS,
  };
}

async function queryTargetChanceRows({
  creatureIds,
  currentHour,
  isTuesday,
  baitId,
}) {
  if (!creatureIds.length) return [];
  const placeholders = creatureIds.map(() => "?").join(",");
  return global.db.safeQuery(
    `SELECT *
     FROM dank_fish_mythical_chances
     WHERE creature_id IN (${placeholders})
       AND hour_utc = ?
       AND is_tuesday = ?
       AND (bait_id = ? OR (tool_id IN ('bare-hand', 'dynamite') AND bait_id = 'none'))
     ORDER BY chance DESC`,
    [...creatureIds, currentHour, isTuesday, baitId],
    [],
  );
}

async function getMissingCreaturesForCache({
  creatureIds,
  currentHour,
  isTuesday,
  baitId,
}) {
  if (!creatureIds.length) return [];
  const placeholders = creatureIds.map(() => "?").join(",");
  const cachedRows = await global.db.safeQuery(
    `SELECT DISTINCT creature_id
     FROM dank_fish_mythical_chances
     WHERE creature_id IN (${placeholders})
       AND hour_utc = ?
       AND is_tuesday = ?
       AND (bait_id = ? OR bait_id = 'none')`,
    [...creatureIds, currentHour, isTuesday, baitId],
    [],
  );
  const cachedSet = new Set(cachedRows.map((r) => String(r.creature_id)));
  return creatureIds.filter((id) => !cachedSet.has(String(id)));
}

async function fetchAndCacheChances({
  creatureIds,
  luckyBaitEnabled,
  isTuesday,
  currentHour,
  onProgress,
}) {
  const ids = creatureIds.map((id) => String(id));
  if (!ids.length) return;

  const { locations, tools } = await getLocationsAndTools();
  const upsert = `INSERT INTO dank_fish_mythical_chances (
      creature_id, location_id, tool_id, bait_id, chance, fail_chance, npc_chance, hour_utc, is_tuesday
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(creature_id, location_id, tool_id, bait_id, hour_utc, is_tuesday)
    DO UPDATE SET
      chance = excluded.chance,
      fail_chance = excluded.fail_chance,
      npc_chance = excluded.npc_chance`;

  const targetSet = new Set(ids);
  const totalSteps = ids.length * locations.length * tools.length;
  let completed = 0;

  for (const mythicalId of ids) {
    for (const locationId of locations) {
      for (const toolId of tools) {
        try {
          const useNoBait = toolId === "bare-hand" || toolId === "dynamite";
          const baitId = useNoBait
            ? "none"
            : luckyBaitEnabled
              ? "lucky-bait"
              : "none";
          const baitsIDs = useNoBait
            ? []
            : luckyBaitEnabled
              ? ["lucky-bait"]
              : [];

          const payload = {
            skills: HARDCODED_SKILLS,
            bosses: true,
            locationID: locationId,
            toolID: toolId,
            baitsIDs,
            time: Date.now(),
            events: [],
            locationWinner: false,
            bonusBossMultiplier: 1,
            bonusMythicalMultiplier: 1,
            forceTrash: false,
            mythicalFishID: mythicalId,
            discoveredCreatures: null,
            anglerTuesday: !!isTuesday,
            invasion: null,
          };

          const response = await fetch(
            "https://dankmemer.lol/api/bot/fish/simulator",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(30_000),
            },
          );
          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          const data = await response.json();
          const table = Array.isArray(data?.table) ? data.table : [];
          const failChance = Number(data?.failChance || 0);
          const npcChance = Number(data?.npcChance || 0);

          for (const entry of table) {
            const type = String(entry?.value?.type || "");
            if (type !== "fish-creature" && type !== "boss-creature") continue;
            const creatureId = String(entry?.value?.creatureID || "");
            const isBoss = type === "boss-creature";
            if (!creatureId) continue;
            if (!isBoss && !targetSet.has(creatureId)) continue;

            await global.db.safeQuery(upsert, [
              creatureId,
              locationId,
              toolId,
              baitId,
              Number(entry?.chance || 0),
              failChance,
              npcChance,
              currentHour,
              isTuesday ? 1 : 0,
            ]);
          }
        } catch (error) {
          console.error(
            `[FishSimulator] Failed target=${mythicalId} location=${locationId} tool=${toolId}:`,
            error?.message || error,
          );
        } finally {
          completed += 1;
          if (onProgress) {
            onProgress({
              fishId: mythicalId,
              locationId,
              toolId,
              completed,
              total: totalSteps,
              percent: totalSteps
                ? Number(((completed / totalSteps) * 100).toFixed(1))
                : 0,
            });
          }
        }
      }
    }
  }
}

async function getBestChanceRowsForUser(userId, { force = false, onProgress } = {}) {
  const settings = await getOrCreateFishSettings(userId);
  if (!settings?.target_id) {
    return { settings, target: null, rows: [], refreshed: false };
  }
  const target = await getTargetRow(settings.target_id);
  if (!target) {
    return { settings, target: null, rows: [], refreshed: false };
  }

  const creatureIds = await getTargetCreatureIds(settings.target_id);
  const now = new Date();
  const currentHour = now.getUTCHours();
  const isTuesday = now.getUTCDay() === 2 ? 1 : 0;
  const baitId = settings.lucky_bait_enabled ? "lucky-bait" : "none";

  const missing = force
    ? creatureIds
    : await getMissingCreaturesForCache({
        creatureIds,
        currentHour,
        isTuesday,
        baitId,
      });

  let refreshed = false;
  if (missing.length) {
    await fetchAndCacheChances({
      creatureIds: missing,
      luckyBaitEnabled: settings.lucky_bait_enabled,
      isTuesday,
      currentHour,
      onProgress,
    });
    refreshed = true;
  }

  const rows = await queryTargetChanceRows({
    creatureIds,
    currentHour,
    isTuesday,
    baitId,
  });
  return { settings, target, rows, refreshed, currentHour, isTuesday };
}

function buildBestChanceLinesByTool(rows, entityMap, limit = 12) {
  const bestByTool = new Map();
  for (const row of rows) {
    const key = String(row.tool_id);
    const prev = bestByTool.get(key);
    if (!prev || Number(row.chance || 0) > Number(prev.chance || 0)) {
      bestByTool.set(key, row);
    }
  }

  return [...bestByTool.values()]
    .sort((a, b) => Number(b.chance || 0) - Number(a.chance || 0))
    .slice(0, limit)
    .map((row) => {
      const creature = entityMap.get(`creature:${row.creature_id}`) || {};
      const location = entityMap.get(`location:${row.location_id}`) || {};
      const tool = entityMap.get(`tool:${row.tool_id}`) || {};
      const creatureName = creature.name || toTitleFromId(row.creature_id);
      const locationName = location.name || toTitleFromId(row.location_id);
      const toolName = tool.name || toTitleFromId(row.tool_id);
      const creatureEmoji = withEmojiSpacing(creature.emoji);
      const locationEmoji = withEmojiSpacing(location.emoji) || "📍 ";
      const toolEmoji = withEmojiSpacing(tool.emoji) || "🛠️ ";
      return `- ${creatureEmoji}${creatureName}: ${locationEmoji}${locationName} · ${toolEmoji}${toolName} · ${Number(row.chance || 0).toFixed(2)}%`;
    });
}

function groupAllPossibilitiesByLocation(rows, entityMap, targetName, targetEmoji) {
  const linesByLocation = new Map();
  for (const row of rows) {
    const location = entityMap.get(`location:${row.location_id}`) || {};
    const tool = entityMap.get(`tool:${row.tool_id}`) || {};
    const bait = entityMap.get(`bait:${row.bait_id}`) || {};
    const locationName = location.name || toTitleFromId(row.location_id);
    const locationEmoji = withEmojiSpacing(location.emoji) || "📍 ";
    const toolName = tool.name || toTitleFromId(row.tool_id);
    const toolEmoji = withEmojiSpacing(tool.emoji) || "🛠️ ";
    const baitLabel =
      row.bait_id === "none"
        ? "No Bait"
        : `${withEmojiSpacing(bait.emoji)}${bait.name || toTitleFromId(row.bait_id)}`.trim();

    const line = `${locationEmoji}${locationName} · ${toolEmoji}${toolName} · ${baitLabel} -> ${Number(row.chance || 0).toFixed(2)}%`;
    if (!linesByLocation.has(row.location_id)) {
      linesByLocation.set(row.location_id, {
        title: `${locationEmoji}${locationName}`,
        lines: [],
      });
    }
    linesByLocation.get(row.location_id).lines.push(line);
  }

  const sortedLocations = [...linesByLocation.entries()].sort((a, b) =>
    a[1].title.localeCompare(b[1].title),
  );

  return {
    header: `### All Possibilities\nTarget: ${targetEmoji}${targetName}`.trim(),
    sections: sortedLocations.map(([, value]) => ({
      title: value.title,
      lines: value.lines,
    })),
  };
}

async function ensureStartupMythicalChancesIndex({ onlyIfMissing = true } = {}) {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const requiredTuesdayStates = [0, 1];
  const requiredBaits = ["none", "lucky-bait"];

  if (onlyIfMissing) {
    const [row] = await global.db.safeQuery(
      `SELECT COUNT(*) AS count
       FROM dank_fish_mythical_chances`,
      [],
      [],
    );
    if (Number(row?.count || 0) > 0) {
      return;
    }
  }

  const mythicals = await global.db.safeQuery(
    `SELECT entity_id AS creature_id
     FROM dank_fish_entities
     WHERE entity_type = 'creature' AND is_mythical = 1`,
    [],
    [],
  );
  const creatureIds = mythicals.map((r) => String(r.creature_id)).filter(Boolean);
  if (!creatureIds.length) return;

  const orderedHours = [];
  for (let h = currentHour; h < 24; h += 1) orderedHours.push(h);
  for (let h = 0; h < currentHour; h += 1) orderedHours.push(h);

  console.log(
    `[FishSimulator] Startup cache bootstrap: ${creatureIds.length} mythicals, ${orderedHours.length} hours, lucky+none baits, Tue true/false.`,
  );

  for (const tuesday of requiredTuesdayStates) {
    for (const baitId of requiredBaits) {
      for (const hour of orderedHours) {
        await fetchAndCacheChances({
          creatureIds,
          luckyBaitEnabled: baitId === "lucky-bait",
          isTuesday: tuesday,
          currentHour: hour,
        });
      }
    }
  }
}

module.exports = {
  getOrCreateFishSettings,
  updateFishSettings,
  listMythicalTargets,
  getTargetRow,
  getTargetCreatureIds,
  getEntityMap,
  getBestChanceRowsForUser,
  buildBestChanceLinesByTool,
  groupAllPossibilitiesByLocation,
  ensureStartupMythicalChancesIndex,
  withEmojiSpacing,
  toTitleFromId,
  parseEmojiMarkdown,
};
