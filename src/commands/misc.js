"use strict";

const { PermissionsBitField } = require("discord.js");
const db = require("../db");
const { embed, errEmbed, okEmbed, coin, fmt } = require("../utils");
const { COLORS } = require("../config");

const cat = "misc";

const notifications = {
  name: "notifications",
  category: cat,
  description: "Toggle DM/server alerts on or off.",
  usage: ",notifications <on|off>",
  async run({ message, args }) {
    const v = (args[0] || "").toLowerCase();
    if (!["on", "off"].includes(v)) return message.reply({ embeds: [errEmbed("Usage: `,notifications on|off`")] });
    db.setUserField(message.author.id, "notifications", v === "on" ? 1 : 0);
    return message.reply({ embeds: [okEmbed(`Notifications turned **${v}**.`)] });
  },
};

// Admin force-spawn for testing the robber drop event.
const robber = {
  name: "robber",
  category: cat,
  description: "Admin: spawn a robber drop in this channel for testing.",
  usage: ",robber",
  async run({ message }) {
    if (!message.guild) return message.reply({ embeds: [errEmbed("Server only.")] });
    // Use optional chaining on member.permissions in case discord.js hasn't
    // populated message.member yet (rare race after a fresh restart with the
    // GuildMembers intent still warming up).
    if (!message.member?.permissions?.has?.(PermissionsBitField.Flags.Administrator)) {
      return message.reply({ embeds: [errEmbed("Admin only.")] });
    }
    // Lazy-require to avoid circular load at boot.
    const main = require("../../index.js");
    if (typeof main.spawnRobber !== "function") {
      return message.reply({ embeds: [errEmbed("Robber system not initialized.")] });
    }
    try {
      await main.spawnRobber(message.channel);
    } catch (e) {
      return message.reply({ embeds: [errEmbed(`Failed to spawn: ${e.message}`)] });
    }
  },
};

// Show current server inflation status.
const economy = {
  name: "economy",
  aliases: ["inflation"],
  category: cat,
  description: "View the current server inflation rate and total wealth.",
  usage: ",economy",
  async run({ message }) {
    const wealth = db.getServerWealth();
    const pct = db.getInflationPct();
    const nextTier = Math.floor(wealth / 1_000_000) + 1;
    const toNext = nextTier * 1_000_000 - wealth;
    const status =
      pct === 0  ? "\uD83D\uDFE2 **Stable** \u2014 prices at base rate" :
      pct < 4    ? "\uD83D\uDFE2 **Low inflation** \u2014 prices barely raised" :
      pct < 8    ? "\uD83D\uDFE1 **Mild inflation** \u2014 prices slightly raised" :
      pct < 12   ? "\uD83D\uDFE0 **High inflation** \u2014 prices noticeably raised" :
                   "\uD83D\uDD34 **Severe inflation** \u2014 maximum price increase reached";
    const example100k = db.inflatedPrice(100000);
    const e = embed({
      color: pct === 0 ? COLORS.success : pct < 8 ? COLORS.money : COLORS.error,
      title: "\uD83C\uDF0D Server Economy",
      description: [
        status,
        "",
        `**Current inflation:** +${pct}%`,
        `**Total server wealth:** ${coin(wealth)}`,
        pct < 15 ? `**Next tier (+1%):** ${coin(toNext)} more wealth needed` : "**At maximum** (+15% cap)",
        "",
        `_Example: a base ${coin(100000)} item costs ${coin(example100k)} right now._`,
      ].join("\n"),
      footer: "Inflation rises +1% per 1M of total wealth (capped at +15%).",
    });
    return message.reply({ embeds: [e] });
  },
};

module.exports = { commands: [notifications, robber, economy] };
