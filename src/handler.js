"use strict";

const fs = require("fs");
const path = require("path");

const commands = new Map(); // name -> { name, aliases, category, description, usage, run }
const categories = new Map(); // category -> [commands]

function register(cmd) {
  if (!cmd || !cmd.name || typeof cmd.run !== "function") return;
  commands.set(cmd.name.toLowerCase(), cmd);
  for (const a of cmd.aliases || []) commands.set(a.toLowerCase(), cmd);
  const cat = cmd.category || "misc";
  if (!categories.has(cat)) categories.set(cat, []);
  if (!categories.get(cat).includes(cmd)) categories.get(cat).push(cmd);
}

function loadAll() {
  const dir = path.join(__dirname, "commands");
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const mod = require(path.join(dir, f));
    if (Array.isArray(mod)) mod.forEach(register);
    else if (mod && mod.commands) mod.commands.forEach(register);
    else if (mod && mod.run) register(mod);
  }
}

function get(name) {
  return commands.get(name.toLowerCase());
}

function listByCategory() {
  return categories;
}

module.exports = { register, loadAll, get, listByCategory, commands };
