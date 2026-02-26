const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const colors = require("colors");

const dbPath = path.join(__dirname, "database.sqlite");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// ---- SCHEMA ----
const schema = {
  // ===== DANK BOT DATA =====
  dank_items: {
    name: "TEXT NOT NULL",
    market: "INTEGER DEFAULT 0",
    value: "INTEGER DEFAULT 0",
    application_emoji: "TEXT DEFAULT NULL",
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
    fishing: "BOOLEAN DEFAULT 0",
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
  card_claimes: {
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
  reminders: {
    id: "INTEGER PRIMARY KEY AUTOINCREMENT",
    user_id: "TEXT NOT NULL",
    guild_id: "TEXT NOT NULL",
    channel_id: "TEXT NOT NULL",
    information:
      'TEXT NOT NULL DEFAULT \'{"command":"","information":"Custom Reminder"}\'',
    end: "TEXT DEFAULT NULL",
  },
  dank_stats: {
    user_id: "TEXT NOT NULL",
    item_name: "TEXT NOT NULL",
    item_amount: "INTEGER DEFAULT 0",
    stat_type: "TEXT NOT NULL",
    _constraint: "PRIMARY KEY (user_id, stat_type)",
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

function tableExists(table) {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table);
  return !!row;
}

function getTableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

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

function upsertState(type, state, user_id = null) {
  if (user_id) {
    db.prepare(
      `
      INSERT INTO user_states (type, state, user_id)
      VALUES (?, ?, ?)
      ON CONFLICT(type, user_id)
      DO UPDATE SET state=excluded.state
    `,
    ).run(type, state, user_id);
  } else {
    db.prepare(
      `
      INSERT INTO global_states (type, state)
      VALUES (?, ?)
      ON CONFLICT(type)
      DO UPDATE SET state=excluded.state
    `,
    ).run(type, state);
  }
}

function getState(type, user_id = null) {
  if (user_id) {
    const row = db
      .prepare(`SELECT state FROM user_states WHERE type=? AND user_id=?`)
      .get(type, user_id);
    return row ? row.state : null;
  } else {
    const row = db
      .prepare(`SELECT state FROM global_states WHERE type=?`)
      .get(type);
    return row ? row.state : null;
  }
}

function safeQuery(sql, params = [], fallback = []) {
  try {
    const stmt = db.prepare(sql);
    if (sql.trim().toLowerCase().startsWith("select")) {
      return stmt.all(params);
    } else {
      return stmt.run(params);
    }
  } catch (err) {
    console.error("safeQuery failed:", err.message);
    return fallback;
  }
}

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
};
