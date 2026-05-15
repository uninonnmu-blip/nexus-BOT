"use strict";

const { EmbedBuilder } = require("discord.js");
const { COLORS, EMOJI } = require("./config");

function fmt(n) {
  return Math.floor(Number(n) || 0).toLocaleString("en-US");
}

function coin(n) {
  return `${EMOJI.coin} ${fmt(n)}`;
}

function parseAmount(input, max) {
  if (input == null) return null;
  const s = String(input).toLowerCase().trim().replace(/,/g, "");
  if (s === "all" || s === "max") return max;
  if (s === "half") return Math.floor(max / 2);
  let mult = 1;
  let body = s;
  if (s.endsWith("k")) { mult = 1_000; body = s.slice(0, -1); }
  else if (s.endsWith("m")) { mult = 1_000_000; body = s.slice(0, -1); }
  else if (s.endsWith("b")) { mult = 1_000_000_000; body = s.slice(0, -1); }
  const n = Math.floor(parseFloat(body) * mult);
  if (!isFinite(n) || isNaN(n) || n <= 0) return null;
  return n;
}

function fmtDuration(ms) {
  if (ms < 0) ms = 0;
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function chance(p) {
  return Math.random() < p;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick(table) {
  // table: [{ item, weight }]
  const total = table.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const e of table) {
    if ((r -= e.weight) <= 0) return e.item;
  }
  return table[table.length - 1].item;
}

function embed(opts = {}) {
  const e = new EmbedBuilder().setColor(opts.color ?? COLORS.primary);
  if (opts.title) e.setTitle(opts.title);
  if (opts.description) e.setDescription(opts.description);
  if (opts.fields) e.addFields(opts.fields);
  if (opts.footer) e.setFooter({ text: opts.footer });
  if (opts.thumbnail) e.setThumbnail(opts.thumbnail);
  if (opts.author) e.setAuthor(opts.author);
  return e;
}

function errEmbed(desc, title = "Error") {
  return embed({ color: COLORS.error, title, description: desc });
}

function okEmbed(desc, title) {
  return embed({ color: COLORS.success, title, description: desc });
}

function moneyEmbed(desc, title) {
  return embed({ color: COLORS.money, title, description: desc });
}

// Insufficient-funds error embed that automatically appends the current
// server inflation rate (matches the design from the competitor bot).
// Lazy-requires db to avoid a circular import at module load time.
function notEnoughEmbed(need, have, extra = "") {
  let inflationLine = "";
  try {
    const db = require("./db");
    if (typeof db.getInflationPct === "function") {
      const pct = db.getInflationPct();
      if (pct > 0) {
        inflationLine = `\n\uD83C\uDF0D **Economy:** +${pct}% active`;
      }
    }
  } catch {}
  const baseLine = `Need ${coin(need)} but have ${coin(have)}.`;
  const extraLine = extra ? `\n${extra}` : "";
  return embed({
    color: COLORS.error,
    title: "Error",
    description: `${baseLine}${extraLine}${inflationLine}`,
  });
}

function parseUserMention(arg, message) {
  if (!arg) return null;
  const m = arg.match(/^<@!?(\d{17,20})>$/) || arg.match(/^(\d{17,20})$/);
  if (!m) return null;
  return message.client.users.fetch(m[1]).catch(() => null);
}

async function resolveMember(arg, message) {
  if (!arg) return null;
  const m = arg.match(/^<@!?(\d{17,20})>$/) || arg.match(/^(\d{17,20})$/);
  if (m && message.guild) {
    return message.guild.members.fetch(m[1]).catch(() => null);
  }
  if (message.guild) {
    const lower = arg.toLowerCase();
    const found = message.guild.members.cache.find(
      (mem) => mem.user.username.toLowerCase() === lower || (mem.nickname && mem.nickname.toLowerCase() === lower)
    );
    return found || null;
  }
  return null;
}

function bar(current, max, width = 10) {
  const pct = Math.max(0, Math.min(1, current / max));
  const filled = Math.round(pct * width);
  return "[" + "\u2588".repeat(filled) + "\u2591".repeat(width - filled) + "]";
}

module.exports = {
  fmt,
  coin,
  parseAmount,
  fmtDuration,
  rand,
  chance,
  pick,
  weightedPick,
  embed,
  errEmbed,
  okEmbed,
  moneyEmbed,
  notEnoughEmbed,
  parseUserMention,
  resolveMember,
  bar,
};
