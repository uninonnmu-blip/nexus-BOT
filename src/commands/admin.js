"use strict";

const db = require("../db");
const { embed, errEmbed, okEmbed, coin, fmt, parseAmount, resolveMember, fmtDuration } = require("../utils");
const { COLORS, OWNER_IDS } = require("../config");
const { findItemByName, ITEMS, SHOP_TABS } = require("../items");
const { PermissionsBitField } = require("discord.js");

const cat = "admin";

function isOwnerOrAdmin(message) {
  if (OWNER_IDS.includes(message.author.id)) return true;
  return message.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
}

const adminbal = {
  name: "adminbal",
  category: cat,
  description: "Admin: set/add/remove a user's wallet.",
  usage: ",adminbal <set|add|remove> @user <amount>",
  async run({ message, args }) {
    if (!isOwnerOrAdmin(message)) return message.reply({ embeds: [errEmbed("Admin only.")] });
    const op = (args[0] || "").toLowerCase();
    const target = await resolveMember(args[1], message);
    const amt = parseAmount(args[2], Number.MAX_SAFE_INTEGER);
    if (!["set", "add", "remove"].includes(op) || !target || !amt) return message.reply({ embeds: [errEmbed("Usage: `,adminbal set/add/remove @user <amount>`")] });
    const u = db.getUser(target.user.id);
    if (op === "set") db.setUserField(target.user.id, "wallet", amt);
    else if (op === "add") db.addWallet(target.user.id, amt);
    else db.addWallet(target.user.id, -Math.min(amt, u.wallet));
    return message.reply({ embeds: [okEmbed(`Done. ${target.user.username}'s wallet is now ${coin(db.getUser(target.user.id).wallet)}.`)] });
  },
};

const adminitem = {
  name: "adminitem",
  category: cat,
  description: "Admin: add/remove items from a user.",
  usage: ",adminitem <add|remove> @user <item> [qty]",
  async run({ message, args }) {
    if (!isOwnerOrAdmin(message)) return message.reply({ embeds: [errEmbed("Admin only.")] });
    const op = (args[0] || "").toLowerCase();
    const target = await resolveMember(args[1], message);
    const last = args[args.length - 1];
    let qty = 1;
    let q = args.slice(2).join(" ");
    if (/^\d+$/.test(last) && args.length > 3) { qty = parseInt(last, 10); q = args.slice(2, -1).join(" "); }
    const item = findItemByName(q);
    if (!["add", "remove"].includes(op) || !target || !item) return message.reply({ embeds: [errEmbed("Usage: `,adminitem add/remove @user <item> [qty]`")] });
    if (op === "add") db.addItem(target.user.id, item.id, qty);
    else db.removeItem(target.user.id, item.id, qty);
    return message.reply({ embeds: [okEmbed(`${op === "add" ? "Added" : "Removed"} ${qty}× **${item.name}** ${op === "add" ? "to" : "from"} ${target.user.username}.`)] });
  },
};

const admingive = adminitem; // alias

const admingiveCmd = {
  name: "admingive",
  category: cat,
  description: "Admin: give items to a user.",
  usage: ",admingive @user <item> [qty]",
  async run({ message, args }) {
    if (!isOwnerOrAdmin(message)) return message.reply({ embeds: [errEmbed("Admin only.")] });
    const target = await resolveMember(args[0], message);
    const last = args[args.length - 1];
    let qty = 1;
    let q = args.slice(1).join(" ");
    if (/^\d+$/.test(last) && args.length > 2) { qty = parseInt(last, 10); q = args.slice(1, -1).join(" "); }
    const item = findItemByName(q);
    if (!target || !item) return message.reply({ embeds: [errEmbed("Usage: `,admingive @user <item> [qty]`")] });
    db.addItem(target.user.id, item.id, qty);
    return message.reply({ embeds: [okEmbed(`Gave ${qty}× **${item.name}** to ${target.user.username}.`)] });
  },
};

const adminrole = {
  name: "adminrole",
  category: cat,
  description: "Admin: permanent/extend/delete a user's custom role.",
  usage: ",adminrole <permanent|extend|delete> @user [days]",
  async run({ message, args }) {
    if (!isOwnerOrAdmin(message)) return message.reply({ embeds: [errEmbed("Admin only.")] });
    if (!message.guild) return message.reply({ embeds: [errEmbed("Server only.")] });
    const op = (args[0] || "").toLowerCase();
    const target = await resolveMember(args[1], message);
    if (!target || !["permanent", "extend", "delete"].includes(op)) return message.reply({ embeds: [errEmbed("Usage: `,adminrole permanent/extend/delete @user`")] });
    const r = db.getCustomRoleByOwner(message.guild.id, target.user.id);
    if (!r) return message.reply({ embeds: [errEmbed("Target has no custom role.")] });
    if (op === "permanent") {
      db.updateCustomRole(r.role_id, { permanent: 1, expires_at: null });
      return message.reply({ embeds: [okEmbed("Made permanent.")] });
    }
    if (op === "extend") {
      // NaN guard — without it, `,adminrole extend @user abc` would store
      // NaN in expires_at (becomes NULL in SQLite) and silently break the
      // role's expiry tracking.
      const days = parseInt(args[2] || "7", 10);
      if (!Number.isFinite(days) || days <= 0) {
        return message.reply({ embeds: [errEmbed("Bad days value.")] });
      }
      const newExp = Math.max(Date.now(), r.expires_at || 0) + days * 24 * 60 * 60 * 1000;
      db.updateCustomRole(r.role_id, { expires_at: newExp });
      return message.reply({ embeds: [okEmbed(`Extended ${days} days.`)] });
    }
    if (op === "delete") {
      const role = await message.guild.roles.fetch(r.role_id).catch(() => null);
      if (role) await role.delete().catch(() => null);
      db.deleteCustomRole(r.role_id);
      return message.reply({ embeds: [okEmbed("Deleted.")] });
    }
  },
};

const endlottery = {
  name: "endlottery",
  category: cat,
  description: "Admin: force end the server lottery and pick a winner.",
  usage: ",endlottery",
  async run({ message }) {
    if (!isOwnerOrAdmin(message)) return message.reply({ embeds: [errEmbed("Admin only.")] });
    if (!message.guild) return message.reply({ embeds: [errEmbed("Server only.")] });
    const lot = db.getLottery(message.guild.id);
    const entries = JSON.parse(lot.entries || "[]");
    if (!entries.length) return message.reply({ embeds: [errEmbed("No entries.")] });
    const winnerId = entries[Math.floor(Math.random() * entries.length)];
    const jackpot = lot.jackpot;
    db.addWallet(winnerId, jackpot);
    db.updateLottery(message.guild.id, { jackpot: 0, entries: "[]", ends_at: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    return message.channel.send({ embeds: [embed({
      color: COLORS.money,
      title: "Lottery Winner!",
      description: `<@${winnerId}> won **${coin(jackpot)}**! Congrats!`,
    })] });
  },
};

const adminHibernate = {
  name: "adminhibernate",
  category: cat,
  description: "Admin: set or clear hibernation on a user.",
  usage: ",adminhibernate @user <days|remove>",
  async run({ message, args }) {
    if (!isOwnerOrAdmin(message)) return message.reply({ embeds: [errEmbed("Admin only.")] });
    const target = await resolveMember(args[0], message);
    if (!target) return message.reply({ embeds: [errEmbed("User?")] });
    const v = args[1];
    if (v === "remove") {
      db.setUserField(target.user.id, "hibernate_until", 0);
      return message.reply({ embeds: [okEmbed("Hibernation removed.")] });
    }
    const days = parseInt(v, 10);
    if (isNaN(days) || days <= 0) return message.reply({ embeds: [errEmbed("Bad days.")] });
    db.setUserField(target.user.id, "hibernate_until", Date.now() + days * 24 * 60 * 60 * 1000);
    return message.reply({ embeds: [okEmbed(`Set ${days}d hibernation on ${target.user.username}.`)] });
  },
};

const diagnose = {
  name: "diagnose",
  category: cat,
  description: "Admin: check all bot systems.",
  usage: ",diagnose",
  async run({ message, client }) {
    if (!isOwnerOrAdmin(message)) return message.reply({ embeds: [errEmbed("Admin only.")] });
    const userCount = db.db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
    const inv = db.db.prepare("SELECT COUNT(*) AS c FROM inventory").get().c;
    const pets = db.db.prepare("SELECT COUNT(*) AS c FROM pets WHERE alive = 1").get().c;
    const customRoles = db.db.prepare("SELECT COUNT(*) AS c FROM custom_roles").get().c;
    const ping = Math.round(client.ws.ping);
    const uptime = fmtDuration(client.uptime);
    return message.reply({ embeds: [embed({
      color: COLORS.success,
      title: "Bot Diagnostics",
      fields: [
        { name: "WS Ping", value: `${ping}ms`, inline: true },
        { name: "Uptime", value: uptime, inline: true },
        { name: "Guilds", value: `${client.guilds.cache.size}`, inline: true },
        { name: "Tracked Users", value: `${userCount}`, inline: true },
        { name: "Inventory Rows", value: `${inv}`, inline: true },
        { name: "Live Pets", value: `${pets}`, inline: true },
        { name: "Custom Roles", value: `${customRoles}`, inline: true },
      ],
    })] });
  },
};

// ===== Channel restriction =====
// `,setchannel` lets a server admin lock the bot to one or more channels.
// With no allowed channels (default), the bot replies everywhere. Once any
// channel is added, the bot only responds inside the allow-list.
// Admins can still run this command from any channel so they can never
// accidentally lock themselves out (handled by the bypass in index.js).
const SETCHANNEL_ALIASES = ["botchannel", "channellock", "channel"];

function parseChannelArg(message, raw) {
  if (!raw) return null;
  const m = raw.match(/^<#(\d+)>$/) || raw.match(/^(\d{15,21})$/);
  const id = m ? m[1] : null;
  if (!id) return null;
  return message.guild.channels.cache.get(id) || null;
}

const setchannel = {
  name: "setchannel",
  category: cat,
  aliases: SETCHANNEL_ALIASES,
  description: "Restrict the bot to specific channels. Admin only.",
  usage: ",setchannel <add|remove|list|clear> [#channel]",
  async run({ message, args }) {
    if (!isOwnerOrAdmin(message)) {
      return message.reply({ embeds: [errEmbed("Admin only.")] });
    }
    if (!message.guild) {
      return message.reply({ embeds: [errEmbed("Server only.")] });
    }
    const sub = (args[0] || "list").toLowerCase();
    const channels = db.getCommandChannels(message.guild.id);

    if (sub === "list") {
      if (!channels.length) {
        return message.reply({ embeds: [embed({
          color: COLORS.success,
          title: "Bot Channels",
          description: "No restriction set \u2014 the bot replies in **every channel**.\nUse `,setchannel add #channel` to lock it down.",
        })] });
      }
      const lines = channels.map((id) => `\u2022 <#${id}>`).join("\n");
      return message.reply({ embeds: [embed({
        color: COLORS.info,
        title: "Bot Channels",
        description: `The bot only replies in:\n${lines}\n\nManage with \`,setchannel add #channel\` / \`,setchannel remove #channel\` / \`,setchannel clear\`.`,
      })] });
    }

    if (sub === "clear") {
      db.clearCommandChannels(message.guild.id);
      return message.reply({ embeds: [okEmbed("Cleared. The bot now replies in **every channel** again.")] });
    }

    if (sub === "add" || sub === "remove") {
      const channel = parseChannelArg(message, args[1]) || (args[1] ? null : message.channel);
      if (!channel) {
        return message.reply({ embeds: [errEmbed(`Usage: \`,setchannel ${sub} #channel\``)] });
      }
      if (sub === "add") {
        const next = db.addCommandChannel(message.guild.id, channel.id);
        const note = next.length === 1
          ? "\nThe bot will now **only** reply in this channel. Add more or use `,setchannel clear` to undo."
          : "";
        return message.reply({ embeds: [okEmbed(`Added <#${channel.id}> to the bot's allowed channels.${note}`)] });
      }
      const next = db.removeCommandChannel(message.guild.id, channel.id);
      const note = next.length === 0
        ? "\nNo channels left in the list \u2014 the bot replies everywhere again."
        : "";
      return message.reply({ embeds: [okEmbed(`Removed <#${channel.id}> from the bot's allowed channels.${note}`)] });
    }

    return message.reply({ embeds: [errEmbed("Usage: `,setchannel add|remove|list|clear [#channel]`")] });
  },
};

// ===== Manual role grant =====
// `,giverole @user <roleId|@role>` lets an admin hand out a Discord role
// directly. If the role exists as a shop entry, the recipient's ownership
// is also recorded so they can later use `,equip` / `,unequip` on it like
// any normally-purchased shop role. Useful for refunds, giveaways, staff
// rewards, or seeding test data without touching the user's wallet.
const giverole = {
  name: "giverole",
  aliases: ["grantrole"],
  category: cat,
  description: "Admin: assign a Discord role to a member. Tracks shop ownership if it's a shop role.",
  usage: ",giverole @user <roleId|@role>",
  async run({ message, args }) {
    if (!isOwnerOrAdmin(message)) {
      return message.reply({ embeds: [errEmbed("Admin only.")] });
    }
    if (!message.guild) {
      return message.reply({ embeds: [errEmbed("Server only.")] });
    }

    const target = await resolveMember(args[0], message);
    if (!target) {
      return message.reply({ embeds: [errEmbed("User not found. Mention them or pass a user ID.")] });
    }

    const roleArg = args[1];
    if (!roleArg) {
      return message.reply({ embeds: [errEmbed("Usage: `,giverole @user <roleId>`")] });
    }

    // Accept raw ID, <@&id> mention, or a plain digit string.
    const roleId = roleArg.replace(/[<@&>]/g, "").trim();
    if (!/^\d{15,21}$/.test(roleId)) {
      return message.reply({ embeds: [errEmbed("That doesn't look like a valid role ID or mention.")] });
    }

    const role = await message.guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      return message.reply({ embeds: [errEmbed(`Role not found. ID tried: \`${roleId}\``)] });
    }

    // Hierarchy + permission checks so the bot fails loudly instead of
    // silently no-op'ing when it can't actually assign the role.
    const me = message.guild.members.me;
    if (!me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
      return message.reply({ embeds: [errEmbed("I'm missing the **Manage Roles** permission.")] });
    }
    if (role.managed) {
      return message.reply({ embeds: [errEmbed("That role is managed by an integration and can't be assigned manually.")] });
    }
    if (me.roles.highest.comparePositionTo(role) <= 0) {
      return message.reply({ embeds: [errEmbed("That role is above my highest role. Move my role above it and try again.")] });
    }

    if (target.roles.cache.has(role.id)) {
      return message.reply({ embeds: [errEmbed(`${target.user.username} already has the **${role.name}** role.`)] });
    }

    const added = await target.roles.add(role, `giverole by ${message.author.tag}`).catch((e) => e);
    if (added instanceof Error) {
      return message.reply({ embeds: [errEmbed(`Failed to assign role: ${added.message}`)] });
    }

    // If this role is registered in the shop, mirror it into owned_shop_roles
    // so the recipient can `,equip` / `,unequip` like a normal buyer. We look
    // up by role_id within the guild — shop_entries doesn't index on role_id
    // but the table is small enough that a scan is fine.
    let shopNote = "";
    try {
      const entry = db.db
        .prepare("SELECT code, category FROM shop_entries WHERE role_id = ? AND guild_id = ?")
        .get(roleId, message.guild.id);
      if (entry) {
        const existing = db.getOwnedShopRole(target.user.id, message.guild.id, entry.code);
        if (!existing) {
          db.addOwnedShopRole(target.user.id, message.guild.id, entry.code, roleId, entry.category);
          shopNote = "\nLinked to shop ownership — they can `,equip` / `,unequip` it later.";
        } else {
          shopNote = "\nAlready owned in shop records.";
        }
      }
    } catch (_) {
      // Non-fatal: the Discord role was still assigned successfully.
    }

    return message.reply({ embeds: [okEmbed(
      `Gave **${target.user.username}** the **${role.name}** role.${shopNote}`,
      "Role Assigned"
    )] });
  },
};

module.exports = { commands: [adminbal, adminitem, admingiveCmd, adminrole, endlottery, adminHibernate, diagnose, setchannel, giverole] };
