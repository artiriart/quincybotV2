const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const colors = require("colors");

const dbPath = path.join(__dirname, "database.sqlite");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// ---- SCHEMA ----
const schema = {
  feather_emojis: {
    name: "TEXT NOT NULL",
    markdown: "TEXT NOT NULL",
    _constraint: "PRIMARY KEY (name)",
  },
  // ===== DANK BOT DATA =====
  dank_items: {
    name: "TEXT NOT NULL",
    market: "INTEGER DEFAULT 0",
    value: "INTEGER DEFAULT 0",
    application_emoji: "TEXT DEFAULT NULL",
    fishing: "BOOLEAN DEFAULT 0",
    _constraint: "PRIMARY KEY (name)",
  },
  dank_multipliers: {
    name: "TEXT NOT NULL",
    amount: "REAL DEFAULT 1",
    description: "TEXT DEFAULT NULL",
    type: "TEXT NOT NULL",
    _constraint: "PRIMARY KEY (name, type)",
  },
  dank_randomevent_lootpool: {
    item_name: "TEXT NOT NULL",
    event_name: "TEXT NOT NULL",
    _constraint: "PRIMARY KEY (item_name, event_name)",
  },
  dank_level_rewards: {
    level: "INTEGER NOT NULL",
    name: "TEXT DEFAULT NULL",
    amount: "INTEGER DEFAULT 1",
    title: "BOOLEAN DEFAULT 0",
    _constraint: "PRIMARY KEY (level)",
  },
  dank_level_xp: {
    level: "INTEGER NOT NULL",
    xp: "INTEGER DEFAULT 0",
    _constraint: "PRIMARY KEY (level)",
  },
  // ===== 7W7 BOT DATA =====
  sws_faq: {
    topic: "TEXT NOT NULL",
    answer: "TEXT DEFAULT NULL",
    _constraint: "PRIMARY KEY (topic)",
  },
  // ===== ANIME BOTS DATA =====
  card_claims: {
    user_id: "TEXT NOT NULL",
    bot_name: "TEXT NOT NULL",
    rarity: "TEXT NOT NULL",
    amount: "INTEGER DEFAULT 1",
    _constraint: "PRIMARY KEY (user_id, bot_name, rarity)",
  },
  izzi_cards: {
    name: "TEXT NOT NULL",
    ability: "TEXT DEFAULT NULL",
    element: "TEXT DEFAULT NULL",
    event: "BOOLEAN DEFAULT 0",
    base_stats:
      'TEXT DEFAULT \'{"ATK": "80", "HP": "80", "DEF": "80", "SPD": "80", "ARM": "80"}\'',
    darkzone: "BOOLEAN DEFAULT 0",
    _constraint: "PRIMARY KEY (name)",
  },
  izzi_market_prices: {
    name: "TEXT NOT NULL",
    market_average: "INTEGER DEFAULT 0",
    rarity: "TEXT DEFAULT NULL",
    _constraint: "PRIMARY KEY (name)",
  },
  izzi_talents: {
    name: "TEXT NOT NULL",
    description: "TEXT DEFAULT NULL",
    application_emoji: "TEXT DEFAULT NULL",
    _constraint: "PRIMARY KEY (name)",
  },
  izzi_items: {
    name: "TEXT NOT NULL",
    category: "TEXT DEFAULT '[]'",
    description: "TEXT DEFAULT NULL",
    price: "INTEGER DEFAULT 0",
    stats: "TEXT DEFAULT '{}'",
    _constraint: "PRIMARY KEY (name)",
  },
  anigame_cards: {
    name: "TEXT PRIMARY KEY",
    talent: "TEXT DEFAULT NULL",
    element: "TEXT DEFAULT NULL",
    base_stats:
      'TEXT DEFAULT \'{"ATK": "80", "HP": "80", "DEF": "80", "SPD": "80"}\'',
  },
  anigame_market_prices: {
    name: "TEXT PRIMARY KEY",
    market_average: "INTEGER DEFAULT 0",
    rarity: "TEXT DEFAULT NULL",
  },
  anigame_reminders: {
    user_id: "TEXT NOT NULL",
    card_name: "TEXT NOT NULL",
    type: "TEXT NOT NULL",
    rarity: "TEXT DEFAULT NULL",
    _constraint: "PRIMARY KEY (user_id, card_name, type, rarity)",
  },
  // ===== USER DATA =====
  states: {
    id: "TEXT NOT NULL", // user_id or global
    type: "TEXT NOT NULL",
    state: "TEXT DEFAULT \'{}\'",
    isPermanent: "BOOLEAN DEFAULT 1",
    _constraint: "PRIMARY KEY (id, type)",
  },
  reminders: {
    type: "TEXT NOT NULL",
    user_id: "TEXT NOT NULL",
    guild_id: "TEXT NOT NULL",
    channel_id: "TEXT NOT NULL",
    information:
      'TEXT NOT NULL DEFAULT \'{"command":"","information":"Custom Reminder"}\'',
    end: "INTEGER DEFAULT 0",
    dm: "BOOLEAN DEFAULT 0",
    _constraint: "PRIMARY KEY (type, user_id)",
  },
  dank_stats: {
    user_id: "TEXT NOT NULL",
    item_name: "TEXT NOT NULL",
    item_amount: "INTEGER DEFAULT 0",
    stat_type: "TEXT NOT NULL",
    _constraint: "PRIMARY KEY (user_id, item_name, stat_type)",
  },
  dank_selected_multipliers: {
    user_id: "TEXT NOT NULL",
    name: "TEXT NOT NULL",
    type: "TEXT NOT NULL",
    _constraint: "PRIMARY KEY (user_id, name, type)",
  },
  dank_nuke_stats: {
    user_id: "TEXT NOT NULL",
    total_nukes: "INTEGER DEFAULT 0",
    session_nukes: "INTEGER DEFAULT 0",
    total_revenue: "INTEGER DEFAULT 0",
    session_revenue: "INTEGER DEFAULT 0",
    total_livesavers: "INTEGER DEFAULT 0",
    session_livesavers: "INTEGER DEFAULT 0",
    _constraint: "PRIMARY KEY (user_id)",
  },
  dank_nuke_session: {
    host_user_id: "TEXT NOT NULL",
    joined_usernames: "TEXT DEFAULT NULL",
    revenue: "INTEGER DEFAULT 0",
    _constraint: "PRIMARY KEY (host_user_id)",
  },
  sws_items: {
    name: "TEXT PRIMARY KEY",
    id: "INTEGER DEFAULT 1",
    market: "TEXT DEFAULT 0",
    url: "TEXT DEFAULT NULL",
    description: "TEXT DEFAULT NULL",
  },
  sws_presets: {
    user_id: "TEXT NOT NULL",
    name: "TEXT NOT NULL",
    equipment: "TEXT DEFAULT NULL",
    description: "TEXT DEFAULT NULL",
    _constraint: "PRIMARY KEY (user_id, name)",
  },
  sws_autodelete: {
    guild_id: "TEXT NOT NULL",
    hex_color: "TEXT NOT NULL",
    _constraint: "PRIMARY KEY (guild_id, hex_color)",
  },
  user_settings_toggles: {
    user_id: "TEXT NOT NULL",
    type: "TEXT NOT NULL",
    toggle: "BOOLEAN DEFAULT 1",
    _constraint: "PRIMARY KEY (user_id, type)",
  },
  lab_user_elements: {
    user_id: "TEXT NOT NULL",
    unlocked_element: "TEXT DEFAULT NULL",
    _constraint: "PRIMARY KEY (user_id)",
  },
  // ===== MINIGAME DATA =====
  lab_elements: {
    name: "TEXT PRIMARY KEY",
    combination: "TEXT DEFAULT NULL",
    discoverer_id: "TEXT DEFAULT NULL",
  },
};

// ---------------- SCHEMA SYNC ----------------

/**
 * Check whether a table exists in the current SQLite database.
 *
 * @param {string} table
 * @returns {boolean}
 */
function tableExists(table) {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table);
  return !!row;
}

/**
 * Get all columns for a table using SQLite `PRAGMA table_info`.
 *
 * @param {string} table
 * @returns {Array<{ cid: number, name: string, type: string, notnull: number, dflt_value: any, pk: number }>}
 */
function getTableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

/**
 * Create a table from a schema definition object.
 *
 * @param {string} table
 * @param {Record<string, string>} definition
 * @returns {void}
 */
function createTable(table, definition) {
  const cols = [];
  for (const [col, def] of Object.entries(definition)) {
    if (col === "_constraint") continue;
    cols.push(`${col} ${def}`);
  }
  if (definition._constraint) cols.push(definition._constraint);

  const sql = `CREATE TABLE ${table} (${cols.join(", ")})`;
  db.prepare(sql).run();
}

/**
 * Sync an existing table with the configured schema definition.
 * Adds missing columns and rebuilds the table if the layout mismatches.
 *
 * @param {string} table
 * @param {Record<string, string>} definition
 * @returns {void}
 */
function syncTable(table, definition) {
  if (!tableExists(table)) {
    createTable(table, definition);
    return;
  }

  const existingCols = getTableColumns(table).map((c) => c.name);
  const definedCols = Object.keys(definition).filter(
    (c) => c !== "_constraint",
  );

  // Add missing columns
  for (const col of definedCols) {
    if (!existingCols.includes(col)) {
      db.prepare(
        `ALTER TABLE ${table} ADD COLUMN ${col} ${definition[col]}`,
      ).run();
    }
  }

  // If columns mismatch (removed/changed), rebuild table
  const mismatch =
    existingCols.some((c) => !definedCols.includes(c)) ||
    definedCols.length !== existingCols.length;

  if (mismatch) {
    const temp = `${table}_backup_${Date.now()}`;
    db.prepare(`ALTER TABLE ${table} RENAME TO ${temp}`).run();
    createTable(table, definition);

    const common = definedCols.filter((c) => existingCols.includes(c));
    if (common.length) {
      db.prepare(
        `INSERT INTO ${table} (${common.join(",")})
         SELECT ${common.join(",")} FROM ${temp}`,
      ).run();
    }

    db.prepare(`DROP TABLE ${temp}`).run();
  }
}

/**
 * Sync all schema tables and remove non-schema tables.
 *
 * @returns {void}
 */
function syncTables() {
  for (const [table, definition] of Object.entries(schema)) {
    syncTable(table, definition);
  }

  // Drop tables not in schema
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
    .all()
    .map((t) => t.name);

  for (const table of tables) {
    if (!schema[table]) {
      db.prepare(`DROP TABLE ${table}`).run();
    }
  }
}

// ---------------- FUNCTIONS ----------------

/**
 * Insert or update a state row.
 *
 * @param {string} type
 * @param {string} state
 * @param {string | null} [user_id=null]
 * @param {boolean} [isPermanent=true]
 * @returns {void}
 */
function upsertState(type, state, user_id = null, isPermanent = true) {
  if (user_id) {
    db.prepare(
      `
      INSERT INTO states (id, type, state, isPermanent)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id, type)
      DO UPDATE SET state=excluded.state
    `,
    ).run(user_id, type, state, isPermanent);
  } else {
    db.prepare(
      `
      INSERT INTO states (id, type, state, isPermanent)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id, type)
      DO UPDATE SET state=excluded.state
    `,
    ).run("global", type, state, isPermanent);
  }
}

/**
 * Read a state row by type and owner.
 *
 * @param {string} type
 * @param {string | null} [user_id=null]
 * @returns {string | null}
 */
function getState(type, user_id = null) {
  if (user_id) {
    const row = db
      .prepare(`SELECT state FROM states WHERE type=? AND id=?`)
      .get(type, user_id);
    return row ? row.state : null;
  } else {
    const row = db
      .prepare(`SELECT state FROM states WHERE type=? AND id='global'`)
      .get(type);
    return row ? row.state : null;
  }
}

/**
 * Execute a database query safely.
 * `SELECT` statements return all rows; non-`SELECT` statements return run metadata.
 *
 * @param {string} sql
 * @param {any[]} [params=[]]
 * @param {any} [fallback=[]]
 * @returns {any}
 */
function safeQuery(sql, params = [], fallback = []) {
  try {
    const stmt = db.prepare(sql);
    if (sql.trim().toLowerCase().startsWith("select")) {
      return stmt.all(...params);
    } else {
      return stmt.run(...params);
    }
  } catch (err) {
    console.error("safeQuery failed:", err.message);
    return fallback;
  }
}

/**
 * Resolve the configured application emoji markdown for a Dank item name.
 *
 * @param {string} itemName
 * @returns {string | null}
 */
function getDankItemEmojiMarkdown(itemName) {
  const name = String(itemName || "").trim();
  if (!name) return null;

  const row = db
    .prepare(
      `
      SELECT application_emoji
      FROM dank_items
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
    )
    .get(name);

  return row?.application_emoji || null;
}

/**
 * Resolve a Feather icon markdown by icon name.
 *
 * @param {string} iconName
 * @returns {string | null}
 */
function getFeatherEmojiMarkdown(iconName) {
  const name = String(iconName || "").trim();
  if (!name) return null;

  const row = db
    .prepare(
      `
      SELECT markdown
      FROM feather_emojis
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
    )
    .get(name);

  return row?.markdown || null;
}

/**
 * Create a new reminder entry in the database.
 *
 * @param {string} user_id - Discord user ID of the reminder owner.
 * @param {import("discord.js").TextBasedChannel} channel - Channel where the reminder was created.
 * @param {number} minutes - Duration in minutes until the reminder ends.
 * @param {string} type - Reminder type identifier (e.g. "custom", "command", etc).
 * @param {{ command?: string, information?: string }} [information]
 *        Optional extra data stored as JSON.
 *        Default: { command: "", information: "Custom Reminder" }
 * @param {boolean} [dm=false]
 *        Whether the reminder should be sent via DM (true) or in the channel (false).
 *
 * @example
 * createReminder(
 *   "734844583778975845",
 *   message.channel,
 *   30,
 *   "custom",
 *   { command: "pls daily", information: "Claim daily" },
 *   true
 * );
 */
function createReminder(
  user_id,
  channel,
  minutes,
  type,
  information = { command: "", information: "Custom Reminder" },
  dm = false,
) {
  safeQuery(
    `
    INSERT INTO reminders (
      user_id,
      guild_id,
      channel_id,
      type,
      information,
      end,
      dm
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      user_id,
      channel.guild?.id ?? null,
      channel.id,
      type,
      JSON.stringify(information),
      Date.now() + minutes * 60000,
      dm ? 1 : 0,
    ],
  );
}

/**
 * Initialize and synchronize database schema tables.
 *
 * @returns {void}
 */
function initDatabase() {
  syncTables();
  console.log("Database schema is ready.".rainbow);
}

// ---------------- EXPORTS ----------------

module.exports = {
  db,
  schema,
  initDatabase,
  upsertState,
  getState,
  safeQuery,
  getDankItemEmojiMarkdown,
  getFeatherEmojiMarkdown,
  createReminder,
};
