"use strict";

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Database location.
// - Local dev: `<project>/data.db` (default).
// - Production (e.g. Railway): set DB_PATH to a path inside a persistent
//   volume so the data survives redeploys, e.g. DB_PATH=/app/data/data.db
//   with a volume mounted at /app/data. Without a volume the bot will
//   still run, but every redeploy wipes the entire economy.
const DB_FILE = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "..", "data.db");

// Make sure the parent directory exists. Railway volumes are pre-created
// at the mount point, but if a user picks a deeper path like
// /app/data/economy/data.db this prevents a confusing SQLITE_CANTOPEN.
try {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
} catch (_) {}

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  wallet INTEGER NOT NULL DEFAULT 0,
  bank INTEGER NOT NULL DEFAULT 0,
  vault INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  notifications INTEGER NOT NULL DEFAULT 1,
  hibernate_until INTEGER NOT NULL DEFAULT 0,
  lbhide_until INTEGER NOT NULL DEFAULT 0,
  curse_until INTEGER NOT NULL DEFAULT 0,
  booster INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
);

CREATE TABLE IF NOT EXISTS inventory (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS cooldowns (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS active_items (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  expires_at INTEGER,
  uses_left INTEGER,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS pets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  pet_type TEXT NOT NULL,
  name TEXT,
  rarity TEXT NOT NULL DEFAULT 'common',
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  hunger INTEGER NOT NULL DEFAULT 100,
  thirst INTEGER NOT NULL DEFAULT 100,
  last_fed INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000),
  last_watered INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000),
  last_income INTEGER NOT NULL DEFAULT 0,
  alive INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
);

CREATE TABLE IF NOT EXISTS custom_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  role_id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  permanent INTEGER NOT NULL DEFAULT 0,
  members TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
);

CREATE TABLE IF NOT EXISTS lottery (
  guild_id TEXT PRIMARY KEY,
  jackpot INTEGER NOT NULL DEFAULT 0,
  ends_at INTEGER NOT NULL DEFAULT 0,
  entries TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS shop_demand (
  item_id TEXT PRIMARY KEY,
  demand REAL NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS quests (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS shop_entries (
  code TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  category TEXT NOT NULL,            -- 'roles' | 'colors'
  name TEXT NOT NULL,
  emoji TEXT,
  price INTEGER NOT NULL,
  description TEXT,
  rarity TEXT,
  color_hex TEXT,
  role_id TEXT,
  stock INTEGER NOT NULL DEFAULT -1, -- -1 = unlimited
  hidden INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)
);
CREATE INDEX IF NOT EXISTS idx_shop_cat
  ON shop_entries (guild_id, category, hidden);

-- Per-guild bot configuration. command_channels is a JSON array of channel
-- ids the bot is allowed to respond in. An empty array (the default) means
-- "no restriction" — the bot replies in every channel.
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  command_channels TEXT NOT NULL DEFAULT '[]'
);

-- Persistent ownership of shop-purchased roles (and colors). Buying a shop
-- role inserts a row here and auto-equips it; the row STAYS even after the
-- user runs ,unequip, so they can re-equip later without paying again.
-- equipped is 0/1 -- when 0, the user owns the role but isn't currently
-- wearing the Discord role. Re-purchasing an already-owned role is rejected.
CREATE TABLE IF NOT EXISTS owned_shop_roles (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  code TEXT NOT NULL,
  role_id TEXT NOT NULL,
  category TEXT NOT NULL,
  equipped INTEGER NOT NULL DEFAULT 1,
  purchased_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000),
  PRIMARY KEY (user_id, guild_id, code)
);
CREATE INDEX IF NOT EXISTS idx_owned_user
  ON owned_shop_roles (user_id, guild_id);
`);

// Idempotent migration: add pet_perks JSON column to users if missing.
try {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  if (!cols.some((c) => c.name === "pet_perks")) {
    db.exec("ALTER TABLE users ADD COLUMN pet_perks TEXT NOT NULL DEFAULT '{}'");
  }
} catch (e) {
  console.error("[db migration]", e);
}

// ----- User helpers -----
const getUserStmt = db.prepare("SELECT * FROM users WHERE id = ?");
const insertUserStmt = db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)");

function ensureUser(userId) {
  insertUserStmt.run(userId);
  return getUserStmt.get(userId);
}

function getUser(userId) {
  ensureUser(userId);
  return getUserStmt.get(userId);
}

const updWallet = db.prepare("UPDATE users SET wallet = wallet + ? WHERE id = ?");
const updBank = db.prepare("UPDATE users SET bank = bank + ? WHERE id = ?");
const updVault = db.prepare("UPDATE users SET vault = vault + ? WHERE id = ?");
const setWallet = db.prepare("UPDATE users SET wallet = ? WHERE id = ?");
const setBank = db.prepare("UPDATE users SET bank = ? WHERE id = ?");
const setVault = db.prepare("UPDATE users SET vault = ? WHERE id = ?");

function addWallet(userId, amount) {
  ensureUser(userId);
  updWallet.run(amount, userId);
}
function addBank(userId, amount) {
  ensureUser(userId);
  updBank.run(amount, userId);
}
function addVault(userId, amount) {
  ensureUser(userId);
  updVault.run(amount, userId);
}

function setUserField(userId, field, value) {
  ensureUser(userId);
  const allowed = ["wallet", "bank", "vault", "xp", "level", "notifications", "hibernate_until", "lbhide_until", "curse_until", "booster"];
  if (!allowed.includes(field)) throw new Error("bad field");
  db.prepare(`UPDATE users SET ${field} = ? WHERE id = ?`).run(value, userId);
}

// ----- Inventory -----
const getItemStmt = db.prepare("SELECT qty FROM inventory WHERE user_id = ? AND item_id = ?");
const upsertItemStmt = db.prepare(`
  INSERT INTO inventory (user_id, item_id, qty) VALUES (?, ?, ?)
  ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + excluded.qty
`);
const setItemStmt = db.prepare(`
  INSERT INTO inventory (user_id, item_id, qty) VALUES (?, ?, ?)
  ON CONFLICT(user_id, item_id) DO UPDATE SET qty = excluded.qty
`);
const delItemStmt = db.prepare("DELETE FROM inventory WHERE user_id = ? AND item_id = ?");
const listInvStmt = db.prepare("SELECT item_id, qty FROM inventory WHERE user_id = ? AND qty > 0 ORDER BY item_id");

function getItem(userId, itemId) {
  const r = getItemStmt.get(userId, itemId);
  return r ? r.qty : 0;
}
function addItem(userId, itemId, qty = 1) {
  ensureUser(userId);
  upsertItemStmt.run(userId, itemId, qty);
}
function removeItem(userId, itemId, qty = 1) {
  const have = getItem(userId, itemId);
  const left = Math.max(0, have - qty);
  if (left === 0) delItemStmt.run(userId, itemId);
  else setItemStmt.run(userId, itemId, left);
  return Math.min(have, qty);
}
function listInventory(userId) {
  return listInvStmt.all(userId);
}

// ----- Cooldowns -----
const getCDStmt = db.prepare("SELECT expires_at FROM cooldowns WHERE user_id = ? AND key = ?");
const setCDStmt = db.prepare(`
  INSERT INTO cooldowns (user_id, key, expires_at) VALUES (?, ?, ?)
  ON CONFLICT(user_id, key) DO UPDATE SET expires_at = excluded.expires_at
`);

function getCooldown(userId, key) {
  const r = getCDStmt.get(userId, key);
  if (!r) return 0;
  const now = Date.now();
  if (r.expires_at <= now) return 0;
  return r.expires_at - now;
}
function setCooldown(userId, key, ms) {
  setCDStmt.run(userId, key, Date.now() + ms);
}

// ----- Active items (boosters) -----
const getActiveStmt = db.prepare("SELECT * FROM active_items WHERE user_id = ? AND item_id = ?");
const setActiveStmt = db.prepare(`
  INSERT INTO active_items (user_id, item_id, expires_at, uses_left) VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id, item_id) DO UPDATE SET expires_at = excluded.expires_at, uses_left = excluded.uses_left
`);
const delActiveStmt = db.prepare("DELETE FROM active_items WHERE user_id = ? AND item_id = ?");

function getActive(userId, itemId) {
  const r = getActiveStmt.get(userId, itemId);
  if (!r) return null;
  if (r.expires_at && r.expires_at < Date.now()) {
    delActiveStmt.run(userId, itemId);
    return null;
  }
  return r;
}
function setActive(userId, itemId, expiresAt = null, usesLeft = null) {
  setActiveStmt.run(userId, itemId, expiresAt, usesLeft);
}
function clearActive(userId, itemId) {
  delActiveStmt.run(userId, itemId);
}

// Returns true if user has ANY active item whose id starts with `prefix`
// (e.g., "luck_boost" matches "luck_boost_1d" and "luck_boost_7d").
function hasActiveBoost(userId, prefix) {
  const rows = db.prepare(
    "SELECT item_id, expires_at FROM active_items WHERE user_id = ? AND item_id LIKE ?"
  ).all(userId, prefix + "%");
  const now = Date.now();
  for (const r of rows) {
    if (!r.expires_at || r.expires_at > now) return true;
  }
  return false;
}

// ----- Pet perks (permanent upgrades stored as JSON on user) -----
function getUserPerks(userId) {
  ensureUser(userId);
  const row = db.prepare("SELECT pet_perks FROM users WHERE id = ?").get(userId);
  try { return JSON.parse(row?.pet_perks || "{}"); } catch { return {}; }
}
function hasPerk(userId, perkKey) {
  return !!getUserPerks(userId)[perkKey];
}
function setPerk(userId, perkKey, value = true) {
  const perks = getUserPerks(userId);
  perks[perkKey] = value;
  db.prepare("UPDATE users SET pet_perks = ? WHERE id = ?").run(JSON.stringify(perks), userId);
}

// ----- Pets -----
function listPets(userId) {
  return db.prepare("SELECT * FROM pets WHERE user_id = ? AND alive = 1 ORDER BY id").all(userId);
}
function getPetByIndex(userId, idx) {
  const all = listPets(userId);
  return all[idx - 1];
}
function addPet(userId, petType, rarity = "common", name = null) {
  return db.prepare(
    "INSERT INTO pets (user_id, pet_type, rarity, name) VALUES (?, ?, ?, ?)"
  ).run(userId, petType, rarity, name || petType);
}
function updatePet(petId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sql = `UPDATE pets SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => fields[k]), petId);
}
function killPet(petId) {
  db.prepare("UPDATE pets SET alive = 0 WHERE id = ?").run(petId);
}

// ----- Custom roles -----
function createCustomRole(row) {
  const stmt = db.prepare(`
    INSERT INTO custom_roles (guild_id, role_id, owner_id, name, color, expires_at, permanent, members)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(row.guild_id, row.role_id, row.owner_id, row.name, row.color || 0, row.expires_at || null, row.permanent ? 1 : 0, row.members || "[]");
}
function getCustomRoleByOwner(guildId, ownerId) {
  return db.prepare("SELECT * FROM custom_roles WHERE guild_id = ? AND owner_id = ?").get(guildId, ownerId);
}
function getCustomRoleById(roleId) {
  return db.prepare("SELECT * FROM custom_roles WHERE role_id = ?").get(roleId);
}
function listCustomRoles(guildId) {
  return db.prepare("SELECT * FROM custom_roles WHERE guild_id = ? ORDER BY created_at DESC").all(guildId);
}
function updateCustomRole(roleId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE custom_roles SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE role_id = ?`)
    .run(...keys.map((k) => fields[k]), roleId);
}
function deleteCustomRole(roleId) {
  db.prepare("DELETE FROM custom_roles WHERE role_id = ?").run(roleId);
}

// ----- Lottery -----
function getLottery(guildId) {
  let row = db.prepare("SELECT * FROM lottery WHERE guild_id = ?").get(guildId);
  if (!row) {
    db.prepare("INSERT INTO lottery (guild_id, ends_at) VALUES (?, ?)").run(guildId, Date.now() + 7 * 24 * 60 * 60 * 1000);
    row = db.prepare("SELECT * FROM lottery WHERE guild_id = ?").get(guildId);
  }
  return row;
}
function updateLottery(guildId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE lottery SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE guild_id = ?`)
    .run(...keys.map((k) => fields[k]), guildId);
}

// ----- Shop entries (guild-specific roles/colors) -----
function genShopCode() {
  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"; // no I/O for clarity
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = "";
    for (let i = 0; i < 6; i++) code += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    const exists = db.prepare("SELECT 1 FROM shop_entries WHERE code = ?").get(code);
    if (!exists) return code;
  }
  // fallback
  return "X" + Date.now().toString(36).toUpperCase().slice(-5);
}

function addShopEntry(row) {
  const code = row.code || genShopCode();
  db.prepare(`
    INSERT INTO shop_entries
      (code, guild_id, category, name, emoji, price, description, rarity, color_hex, role_id, stock)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    code,
    row.guild_id,
    row.category,
    row.name,
    row.emoji || null,
    row.price | 0,
    row.description || null,
    row.rarity || null,
    row.color_hex || null,
    row.role_id || null,
    row.stock == null ? -1 : row.stock | 0,
  );
  return code;
}

function listShopEntries(guildId, category) {
  return db.prepare(`
    SELECT * FROM shop_entries
    WHERE guild_id = ? AND category = ? AND hidden = 0
    ORDER BY price ASC, added_at ASC
  `).all(guildId, category);
}

function getShopEntryByCode(code) {
  if (!code) return null;
  return db.prepare("SELECT * FROM shop_entries WHERE code = ?").get(code.toUpperCase());
}

function updateShopEntry(code, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE shop_entries SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE code = ?`)
    .run(...keys.map((k) => fields[k]), code.toUpperCase());
}

function removeShopEntry(code) {
  db.prepare("DELETE FROM shop_entries WHERE code = ?").run(code.toUpperCase());
}

function decrementShopStock(code) {
  const e = getShopEntryByCode(code);
  if (!e) return false;
  if (e.stock < 0) return true; // unlimited
  if (e.stock <= 0) return false;
  db.prepare("UPDATE shop_entries SET stock = stock - 1 WHERE code = ?").run(code.toUpperCase());
  return true;
}

// ----- Inflation -----
// Total server wealth = sum of all users' (wallet + bank + vault).
// Inflation tiers: every 1M of total wealth adds +1% (capped at +15%).
// Realistic small/medium server values:
//   1M wealth  -> +1%
//   4M wealth  -> +4% (typical, matches the screenshot)
//   10M wealth -> +10%
//   15M+       -> +15% (cap)
// Lower numbers feel more natural and don't double prices on busy servers.
function getServerWealth() {
  const r = db.prepare("SELECT COALESCE(SUM(wallet) + SUM(bank) + SUM(vault), 0) AS total FROM users").get();
  return r.total || 0;
}

function getInflationPct() {
  const wealth = getServerWealth();
  const tiers = Math.floor(wealth / 1_000_000);
  return Math.min(15, tiers); // tiers * 1
}

function inflatedPrice(basePrice) {
  const pct = getInflationPct();
  return Math.floor(basePrice * (1 + pct / 100));
}

// ----- Daily quests -----
// Each quest has:
//   id     — stable unique id stored inside the user's row
//   type   — what action increments it (see incQuestProgress callers)
//   name   — display string shown by ,quests
//   reward — coins auto-credited to wallet on completion
//   target — progress required to complete
const QUEST_POOL = [
  { id: "chat25",  type: "messages",    name: "Send 25 messages", reward: 1500, target: 25 },
  { id: "work2",   type: "work",        name: "Work 2 times",     reward: 1200, target: 2  },
  { id: "dig3",    type: "dig",         name: "Dig 3 times",      reward: 1800, target: 3  },
  { id: "fish3",   type: "fish",        name: "Fish 3 times",     reward: 1800, target: 3  },
  { id: "gamble1", type: "gamble_win",  name: "Win a gamble",     reward: 2000, target: 1  },
];

function _todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Loads today's row for this user. If missing, rolls 3 random quests from the
// pool and inserts them so the user starts tracking progress immediately
// (no need to run `,quests` first to "activate" the day).
function getOrCreateTodayQuests(userId) {
  const today = _todayKey();
  const row = db.prepare("SELECT data FROM quests WHERE user_id = ? AND date = ?").get(userId, today);
  if (row) {
    try { return JSON.parse(row.data || "{}"); } catch { return {}; }
  }
  const picks = [...QUEST_POOL].sort(() => Math.random() - 0.5).slice(0, 3);
  const data = {};
  for (const q of picks) data[q.id] = { progress: 0, claimed: false };
  db.prepare("INSERT INTO quests (user_id, date, data) VALUES (?, ?, ?)").run(userId, today, JSON.stringify(data));
  return data;
}

function saveTodayQuests(userId, data) {
  const today = _todayKey();
  db.prepare(
    "INSERT INTO quests (user_id, date, data) VALUES (?, ?, ?) " +
    "ON CONFLICT(user_id, date) DO UPDATE SET data = excluded.data"
  ).run(userId, today, JSON.stringify(data));
}

// Increments any active quests of `questType` and returns an array of quests
// that JUST completed in this call (so callers can announce the bonus).
// Reward coins are auto-credited to the wallet here.
function incQuestProgress(userId, questType, amount = 1) {
  if (!userId || !questType || !amount) return [];
  const data = getOrCreateTodayQuests(userId);
  const completed = [];
  let dirty = false;
  for (const q of QUEST_POOL) {
    if (q.type !== questType) continue;
    const entry = data[q.id];
    if (!entry || entry.claimed) continue;
    if (entry.progress >= q.target) continue;
    entry.progress = Math.min(q.target, entry.progress + amount);
    dirty = true;
    if (entry.progress >= q.target && !entry.claimed) {
      entry.claimed = true;
      addWallet(userId, q.reward);
      completed.push({ id: q.id, name: q.name, reward: q.reward });
    }
  }
  if (dirty) saveTodayQuests(userId, data);
  return completed;
}

// ----- Guild settings (channel restriction) -----
const getGuildSettingsStmt = db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?");
const upsertGuildSettingsStmt = db.prepare(
  "INSERT INTO guild_settings (guild_id, command_channels) VALUES (?, ?) " +
  "ON CONFLICT(guild_id) DO UPDATE SET command_channels = excluded.command_channels"
);

function getGuildSettings(guildId) {
  const row = getGuildSettingsStmt.get(guildId);
  if (!row) return { guild_id: guildId, command_channels: [] };
  let channels = [];
  try { channels = JSON.parse(row.command_channels || "[]"); } catch {}
  return { guild_id: guildId, command_channels: Array.isArray(channels) ? channels : [] };
}

function getCommandChannels(guildId) {
  return getGuildSettings(guildId).command_channels;
}

// Empty allow-list = unrestricted (bot works everywhere). Non-empty = only
// those channels are valid bot channels.
function isCommandChannelAllowed(guildId, channelId) {
  const allowed = getCommandChannels(guildId);
  if (!allowed.length) return true;
  return allowed.includes(channelId);
}

function addCommandChannel(guildId, channelId) {
  const allowed = getCommandChannels(guildId);
  if (allowed.includes(channelId)) return allowed;
  allowed.push(channelId);
  upsertGuildSettingsStmt.run(guildId, JSON.stringify(allowed));
  return allowed;
}

function removeCommandChannel(guildId, channelId) {
  const allowed = getCommandChannels(guildId).filter((id) => id !== channelId);
  upsertGuildSettingsStmt.run(guildId, JSON.stringify(allowed));
  return allowed;
}

function clearCommandChannels(guildId) {
  upsertGuildSettingsStmt.run(guildId, "[]");
  return [];
}

// ----- Leaderboard -----
function topUsers(limit = 10) {
  return db.prepare(`
    SELECT id, wallet + bank + vault AS net
    FROM users
    WHERE lbhide_until < ?
    ORDER BY net DESC
    LIMIT ?
  `).all(Date.now(), limit);
}

module.exports = {
  db,
  getUser,
  ensureUser,
  addWallet,
  addBank,
  addVault,
  setUserField,
  getItem,
  addItem,
  removeItem,
  listInventory,
  getCooldown,
  setCooldown,
  getActive,
  setActive,
  clearActive,
  hasActiveBoost,
  getUserPerks,
  hasPerk,
  setPerk,
  listPets,
  getPetByIndex,
  addPet,
  updatePet,
  killPet,
  createCustomRole,
  getCustomRoleByOwner,
  getCustomRoleById,
  listCustomRoles,
  updateCustomRole,
  deleteCustomRole,
  getLottery,
  updateLottery,
  topUsers,
  addShopEntry,
  listShopEntries,
  getShopEntryByCode,
  updateShopEntry,
  removeShopEntry,
  decrementShopStock,
  genShopCode,
  getServerWealth,
  getInflationPct,
  inflatedPrice,
  getGuildSettings,
  getCommandChannels,
  isCommandChannelAllowed,
  addCommandChannel,
  removeCommandChannel,
  clearCommandChannels,
  QUEST_POOL,
  getOrCreateTodayQuests,
  incQuestProgress,
  // Owned-shop-role persistence
  addOwnedShopRole,
  getOwnedShopRole,
  listOwnedShopRoles,
  setOwnedShopRoleEquipped,
  removeOwnedShopRole,
  unequipAllColorsForUser,
};

// ----- Owned shop roles -----
const insertOwnedRoleStmt = db.prepare(`
  INSERT INTO owned_shop_roles (user_id, guild_id, code, role_id, category, equipped)
  VALUES (?, ?, ?, ?, ?, 1)
  ON CONFLICT(user_id, guild_id, code) DO UPDATE SET equipped = 1, role_id = excluded.role_id
`);
const getOwnedRoleStmt = db.prepare(
  "SELECT * FROM owned_shop_roles WHERE user_id = ? AND guild_id = ? AND code = ?"
);
const listOwnedRolesStmt = db.prepare(
  "SELECT * FROM owned_shop_roles WHERE user_id = ? AND guild_id = ? ORDER BY purchased_at ASC"
);
const setOwnedRoleEquippedStmt = db.prepare(
  "UPDATE owned_shop_roles SET equipped = ? WHERE user_id = ? AND guild_id = ? AND code = ?"
);
const removeOwnedRoleStmt = db.prepare(
  "DELETE FROM owned_shop_roles WHERE user_id = ? AND guild_id = ? AND code = ?"
);
const unequipAllColorsStmt = db.prepare(
  "UPDATE owned_shop_roles SET equipped = 0 WHERE user_id = ? AND guild_id = ? AND category = 'colors'"
);

function addOwnedShopRole(userId, guildId, code, roleId, category) {
  insertOwnedRoleStmt.run(userId, guildId, code, roleId, category);
}
function getOwnedShopRole(userId, guildId, code) {
  return getOwnedRoleStmt.get(userId, guildId, code);
}
function listOwnedShopRoles(userId, guildId) {
  return listOwnedRolesStmt.all(userId, guildId);
}
function setOwnedShopRoleEquipped(userId, guildId, code, equipped) {
  setOwnedRoleEquippedStmt.run(equipped ? 1 : 0, userId, guildId, code);
}
function removeOwnedShopRole(userId, guildId, code) {
  removeOwnedRoleStmt.run(userId, guildId, code);
}
function unequipAllColorsForUser(userId, guildId) {
  unequipAllColorsStmt.run(userId, guildId);
}
