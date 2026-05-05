"use strict";

const db = require("../db");
const { embed, errEmbed, okEmbed, notEnoughEmbed, coin, fmt, fmtDuration, resolveMember } = require("../utils");
const { COLORS, CD } = require("../config");
const { PermissionsBitField } = require("discord.js");

const cat = "rroles";

// Sliding price: cost scales with how many custom roles already exist in the
// server. Empty server = cheap to start, mature server = expensive.
// Formula: BASE + (used * PER_ROLE), capped at MAX_CUSTOM_ROLES.
const MAX_CUSTOM_ROLES = 250;
const BASE_ROLE_COST = 3800;
const PER_ROLE_COST = 200;
const ROLE_RENEW_DAYS = 7;
const ROLE_RENEW_MIN_PCT = 0.30;
const ROLE_RENEW_MAX_PCT = 0.65;

function customRoleCost(usedCount) {
  const used = Math.min(usedCount, MAX_CUSTOM_ROLES);
  return BASE_ROLE_COST + used * PER_ROLE_COST;
}

function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.ManageRoles);
}

const rrole = {
  name: "rrole",
  category: cat,
  description: "Custom role system. See ,help rroles for all subcommands.",
  usage: ",rrole <subcommand>",
  async run({ message, args, client, prefix }) {
    if (!message.guild) return message.reply({ embeds: [errEmbed("Server only.")] });
    const sub = (args[0] || "").toLowerCase();
    const rest = args.slice(1);

    if (!sub) {
      return message.reply({ embeds: [embed({
        color: COLORS.info,
        title: "Custom Roles",
        description: [
          `\`${prefix}rrole create\` — make a custom role (price scales with server, 7d duration)`,
          `\`${prefix}rrole @user\` — invite to wear your role`,
          `\`${prefix}rrole remove @user\` — remove a member`,
          `\`${prefix}rrole ping <msg>\` — ping role (2h CD)`,
          `\`${prefix}rrole renew\` — extend 7 days (30-65% of cost)`,
          `\`${prefix}rrole update\` — change name or color`,
          `\`${prefix}rrole duration\` — time left`,
          `\`${prefix}rrole ownership @user\` — transfer ownership`,
          `\`${prefix}rrole delete\` — delete your role`,
          `\`${prefix}rrole leave\` — leave a role you wear`,
          `\`${prefix}rrole item @RoleName\` — convert role into inventory item`,
          `\`${prefix}rrole unregister\` — untrack from system`,
          `\`${prefix}rclaim <name>\` — claim ownerless role`,
          `\`${prefix}rroles\` — list all custom roles`,
        ].join("\n"),
      })] });
    }

    // ---------- create ----------
    if (sub === "create") {
      const existing = db.getCustomRoleByOwner(message.guild.id, message.author.id);
      if (existing) return message.reply({ embeds: [errEmbed("You already own a custom role. Use `,rrole update` or `,rrole delete`.")] });
      const used = db.listCustomRoles(message.guild.id).length;
      if (used >= MAX_CUSTOM_ROLES) {
        return message.reply({ embeds: [errEmbed(`This server has reached the maximum of **${MAX_CUSTOM_ROLES}** custom roles. Wait for some to expire.`)] });
      }
      const cost = customRoleCost(used);
      const u = db.getUser(message.author.id);
      if (u.wallet < cost) {
        return message.reply({ embeds: [notEnoughEmbed(cost, u.wallet, `Custom role costs ${coin(cost)} (${used}/${MAX_CUSTOM_ROLES} roles used).`)] });
      }
      await message.reply({ content: "Reply with the **role name** (max 32 chars). 60s." });
      let name;
      try {
        const c = await message.channel.awaitMessages({ filter: (m) => m.author.id === message.author.id, max: 1, time: 60_000, errors: ["time"] });
        name = c.first().content.slice(0, 32);
      } catch { return message.channel.send({ embeds: [errEmbed("Timed out.")] }); }
      await message.channel.send({ content: `Now reply with a **hex color** (e.g. \`#ff0033\`) or \`random\`. 60s.` });
      let color = 0;
      try {
        const c = await message.channel.awaitMessages({ filter: (m) => m.author.id === message.author.id, max: 1, time: 60_000, errors: ["time"] });
        const t = c.first().content.trim();
        if (t.toLowerCase() === "random") color = Math.floor(Math.random() * 0xffffff);
        else { const m = t.match(/^#?([0-9a-f]{6})$/i); color = m ? parseInt(m[1], 16) : 0xf2c94c; }
      } catch { return message.channel.send({ embeds: [errEmbed("Timed out.")] }); }

      // Re-check wallet AFTER the two 60-second prompts. The original check
      // at the top of this branch is stale by now — the user may have spent
      // / gambled / been robbed of coins during the wizard. Without this
      // re-check, db.addWallet(-cost) would happily push the wallet
      // negative and still create the role for free.
      const liveU = db.getUser(message.author.id);
      if (liveU.wallet < cost) {
        return message.channel.send({ embeds: [notEnoughEmbed(cost, liveU.wallet, "Your wallet dropped during setup.")] });
      }
      try {
        const role = await message.guild.roles.create({ name, color, reason: `Custom role for ${message.author.tag}` });
        await message.member.roles.add(role).catch(() => null);
        db.addWallet(message.author.id, -cost);
        const expires = Date.now() + ROLE_RENEW_DAYS * 24 * 60 * 60 * 1000;
        db.createCustomRole({
          guild_id: message.guild.id,
          role_id: role.id,
          owner_id: message.author.id,
          name,
          color,
          expires_at: expires,
          permanent: 0,
          members: JSON.stringify([message.author.id]),
        });
        return message.channel.send({ embeds: [okEmbed(`Created **${name}** for ${coin(cost)}. ${ROLE_RENEW_DAYS} days until renewal.`, "Custom Role")] });
      } catch (e) {
        return message.channel.send({ embeds: [errEmbed(`Failed: ${e.message}`)] });
      }
    }

    // ---------- delete ----------
    if (sub === "delete") {
      const r = db.getCustomRoleByOwner(message.guild.id, message.author.id);
      if (!r) return message.reply({ embeds: [errEmbed("You don't own a custom role.")] });
      const role = await message.guild.roles.fetch(r.role_id).catch(() => null);
      if (role) await role.delete().catch(() => null);
      db.deleteCustomRole(r.role_id);
      return message.reply({ embeds: [okEmbed("Custom role deleted.")] });
    }

    // ---------- renew ----------
    if (sub === "renew") {
      const r = db.getCustomRoleByOwner(message.guild.id, message.author.id);
      if (!r) return message.reply({ embeds: [errEmbed("No role to renew.")] });
      const used = db.listCustomRoles(message.guild.id).length;
      const baseCost = customRoleCost(used);
      const pct = ROLE_RENEW_MIN_PCT + Math.random() * (ROLE_RENEW_MAX_PCT - ROLE_RENEW_MIN_PCT);
      const cost = Math.floor(baseCost * pct);
      const u = db.getUser(message.author.id);
      if (u.wallet < cost) return message.reply({ embeds: [notEnoughEmbed(cost, u.wallet, `(${Math.round(pct*100)}% of base cost.)`)] });
      db.addWallet(message.author.id, -cost);
      const newExp = Math.max(Date.now(), r.expires_at || 0) + ROLE_RENEW_DAYS * 24 * 60 * 60 * 1000;
      db.updateCustomRole(r.role_id, { expires_at: newExp });
      return message.reply({ embeds: [okEmbed(`Renewed for ${ROLE_RENEW_DAYS} days. Paid ${coin(cost)}.`)] });
    }

    // ---------- duration ----------
    if (sub === "duration") {
      const r = db.getCustomRoleByOwner(message.guild.id, message.author.id);
      if (!r) return message.reply({ embeds: [errEmbed("No custom role.")] });
      if (r.permanent) return message.reply({ embeds: [embed({ color: COLORS.info, description: "Your role is **permanent**." })] });
      const left = (r.expires_at || 0) - Date.now();
      return message.reply({ embeds: [embed({ color: COLORS.info, description: left > 0 ? `Time left: **${fmtDuration(left)}**.` : "Expired. Use `,rrole renew`." })] });
    }

    // ---------- update ----------
    if (sub === "update") {
      const r = db.getCustomRoleByOwner(message.guild.id, message.author.id);
      if (!r) return message.reply({ embeds: [errEmbed("No role.")] });
      await message.reply({ content: "Reply with `name <new name>` or `color <#hex|random>`. 60s." });
      try {
        const c = await message.channel.awaitMessages({ filter: (m) => m.author.id === message.author.id, max: 1, time: 60_000, errors: ["time"] });
        const t = c.first().content.trim();
        const role = await message.guild.roles.fetch(r.role_id).catch(() => null);
        if (!role) return message.channel.send({ embeds: [errEmbed("Role missing in Discord.")] });
        if (t.toLowerCase().startsWith("name ")) {
          const newName = t.slice(5).slice(0, 32);
          await role.setName(newName);
          db.updateCustomRole(r.role_id, { name: newName });
          return message.channel.send({ embeds: [okEmbed(`Renamed to **${newName}**.`)] });
        } else if (t.toLowerCase().startsWith("color ")) {
          const v = t.slice(6).trim();
          let color = 0;
          if (v.toLowerCase() === "random") color = Math.floor(Math.random() * 0xffffff);
          else { const m = v.match(/^#?([0-9a-f]{6})$/i); if (!m) return message.channel.send({ embeds: [errEmbed("Bad hex.")] }); color = parseInt(m[1], 16); }
          await role.setColor(color);
          db.updateCustomRole(r.role_id, { color });
          return message.channel.send({ embeds: [okEmbed("Color updated.")] });
        }
        return message.channel.send({ embeds: [errEmbed("Unknown update field.")] });
      } catch { return message.channel.send({ embeds: [errEmbed("Timed out.")] }); }
    }

    // ---------- ownership ----------
    if (sub === "ownership") {
      const r = db.getCustomRoleByOwner(message.guild.id, message.author.id);
      if (!r) return message.reply({ embeds: [errEmbed("No role.")] });
      const target = await resolveMember(rest[0], message);
      if (!target) return message.reply({ embeds: [errEmbed("User not found.")] });
      db.updateCustomRole(r.role_id, { owner_id: target.user.id });
      return message.reply({ embeds: [okEmbed(`Ownership transferred to **${target.user.username}**.`)] });
    }

    // ---------- ping ----------
    if (sub === "ping") {
      const r = db.getCustomRoleByOwner(message.guild.id, message.author.id);
      if (!r) return message.reply({ embeds: [errEmbed("No role.")] });
      const left = db.getCooldown(message.author.id, "rrole_ping");
      if (left > 0) return message.reply({ embeds: [errEmbed(`Ping CD: **${fmtDuration(left)}**.`)] });
      const text = rest.join(" ").slice(0, 500) || "(no message)";
      const role = await message.guild.roles.fetch(r.role_id).catch(() => null);
      if (!role) return message.reply({ embeds: [errEmbed("Role missing.")] });
      db.setCooldown(message.author.id, "rrole_ping", CD.rrolePing);
      return message.channel.send({ content: `${role.toString()} — ${text}`, allowedMentions: { roles: [role.id] } });
    }

    // ---------- leave ----------
    if (sub === "leave") {
      // remove user from any custom role they wear (and from the role members list)
      const all = db.listCustomRoles(message.guild.id);
      let removedAny = false;
      for (const r of all) {
        if (r.owner_id === message.author.id) continue;
        const members = JSON.parse(r.members || "[]");
        if (members.includes(message.author.id)) {
          const role = await message.guild.roles.fetch(r.role_id).catch(() => null);
          if (role) await message.member.roles.remove(role).catch(() => null);
          db.updateCustomRole(r.role_id, { members: JSON.stringify(members.filter((id) => id !== message.author.id)) });
          removedAny = true;
        }
      }
      return message.reply({ embeds: [removedAny ? okEmbed("You left.") : errEmbed("You weren't wearing any rented role.")] });
    }

    // ---------- unregister ----------
    if (sub === "unregister") {
      const r = db.getCustomRoleByOwner(message.guild.id, message.author.id);
      if (!r) return message.reply({ embeds: [errEmbed("No role.")] });
      db.deleteCustomRole(r.role_id);
      return message.reply({ embeds: [okEmbed("Untracked from custom role system. Discord role still exists.")] });
    }

    // ---------- item (convert worn role to inventory item) ----------
    // OWNERSHIP-LOCKED. Without the owner check, ANY user could run
    // `,rrole item @SomeoneElsesRole` and:
    //   1. Pollute their own inventory with `roleitem:<id>` rows that don't
    //      correspond to anything they actually own (storage pollution),
    //   2. Be falsely told they "converted" a role they had no relationship
    //      to (UX confusion / scam vector),
    //   3. Spam unique role IDs to bloat the inventory table indefinitely.
    // The owner check ensures only the actual rrole owner can convert it.
    if (sub === "item") {
      const roleArg = rest[0];
      const m = roleArg && roleArg.match(/^<@&(\d+)>$/);
      if (!m) return message.reply({ embeds: [errEmbed("Mention a role.")] });
      const r = db.getCustomRoleById(m[1]);
      if (!r) return message.reply({ embeds: [errEmbed("Not a tracked role.")] });
      if (r.owner_id !== message.author.id) {
        return message.reply({ embeds: [errEmbed("You can only convert a role you own.")] });
      }
      const role = await message.guild.roles.fetch(m[1]).catch(() => null);
      if (role) await message.member.roles.remove(role).catch(() => null);
      db.addItem(message.author.id, `roleitem:${m[1]}`, 1);
      return message.reply({ embeds: [okEmbed(`Converted ${r.name} back into an inventory item.`)] });
    }

    // ---------- admin: setowner / addexisting / giveextra / permanent / extend ----------
    if (sub === "setowner" || sub === "addexisting" || sub === "giveextra" || sub === "permanent" || sub === "extend") {
      if (!isAdmin(message.member)) return message.reply({ embeds: [errEmbed("Manage Roles required.")] });
      if (sub === "setowner") {
        const roleId = rest[0]?.match(/\d+/)?.[0];
        const target = await resolveMember(rest[1], message);
        if (!roleId || !target) return message.reply({ embeds: [errEmbed("Usage: `,rrole setowner <roleId> @user`")] });
        const r = db.getCustomRoleById(roleId);
        if (!r) return message.reply({ embeds: [errEmbed("Not tracked.")] });
        db.updateCustomRole(roleId, { owner_id: target.user.id });
        return message.reply({ embeds: [okEmbed(`Owner set to ${target.user.username}.`)] });
      }
      if (sub === "addexisting") {
        const roleId = rest[0]?.match(/\d+/)?.[0];
        const target = rest[1] ? await resolveMember(rest[1], message) : message.member;
        if (!roleId) return message.reply({ embeds: [errEmbed("Usage: `,rrole addexisting <roleId> [@user]`")] });
        const role = await message.guild.roles.fetch(roleId).catch(() => null);
        if (!role) return message.reply({ embeds: [errEmbed("Discord role not found.")] });
        const exp = Date.now() + ROLE_RENEW_DAYS * 24 * 60 * 60 * 1000;
        try {
          db.createCustomRole({
            guild_id: message.guild.id, role_id: role.id, owner_id: target.user.id,
            name: role.name, color: role.color, expires_at: exp, permanent: 0,
            members: JSON.stringify([target.user.id]),
          });
        } catch { return message.reply({ embeds: [errEmbed("Already tracked.")] }); }
        return message.reply({ embeds: [okEmbed(`Registered **${role.name}** under ${target.user.username}.`)] });
      }
      if (sub === "giveextra") {
        const target = await resolveMember(rest[0], message);
        const roleId = rest[1]?.match(/\d+/)?.[0];
        if (!target || !roleId) return message.reply({ embeds: [errEmbed("Usage: `,rrole giveextra @user <roleId>`")] });
        const role = await message.guild.roles.fetch(roleId).catch(() => null);
        if (!role) return message.reply({ embeds: [errEmbed("Role not found.")] });
        await target.roles.add(role).catch(() => null);
        return message.reply({ embeds: [okEmbed(`Gave ${target.user.username} the role.`)] });
      }
      if (sub === "permanent") {
        const target = rest[0] ? await resolveMember(rest[0], message) : message.member;
        const r = db.getCustomRoleByOwner(message.guild.id, target.user.id);
        if (!r) return message.reply({ embeds: [errEmbed("Target has no custom role.")] });
        db.updateCustomRole(r.role_id, { permanent: 1, expires_at: null });
        return message.reply({ embeds: [okEmbed(`${target.user.username}'s role is now permanent.`)] });
      }
      if (sub === "extend") {
        const roleId = rest[0]?.match(/\d+/)?.[0];
        const dur = rest[1];
        if (!roleId || !dur) return message.reply({ embeds: [errEmbed("Usage: `,rrole extend <@role|id> <days|infinite>`")] });
        const r = db.getCustomRoleById(roleId);
        if (!r) return message.reply({ embeds: [errEmbed("Not tracked.")] });
        if (dur.toLowerCase() === "infinite") {
          db.updateCustomRole(roleId, { permanent: 1, expires_at: null });
          return message.reply({ embeds: [okEmbed("Made permanent.")] });
        }
        const days = parseInt(dur, 10);
        if (isNaN(days) || days <= 0) return message.reply({ embeds: [errEmbed("Bad days value.")] });
        const newExp = Math.max(Date.now(), r.expires_at || 0) + days * 24 * 60 * 60 * 1000;
        db.updateCustomRole(roleId, { expires_at: newExp });
        return message.reply({ embeds: [okEmbed(`Extended by ${days} day(s).`)] });
      }
    }

    // ---------- @user (invite) / remove @user ----------
    if (sub === "remove") {
      const r = db.getCustomRoleByOwner(message.guild.id, message.author.id);
      if (!r) return message.reply({ embeds: [errEmbed("No role.")] });
      const target = await resolveMember(rest[0], message);
      if (!target) return message.reply({ embeds: [errEmbed("User not found.")] });
      const role = await message.guild.roles.fetch(r.role_id).catch(() => null);
      if (role) await target.roles.remove(role).catch(() => null);
      const members = JSON.parse(r.members || "[]").filter((id) => id !== target.user.id);
      db.updateCustomRole(r.role_id, { members: JSON.stringify(members) });
      return message.reply({ embeds: [okEmbed(`Removed ${target.user.username} from your role.`)] });
    }

    // ,rrole @user — invite someone to wear it
    const target = await resolveMember(args[0], message);
    if (target) {
      const r = db.getCustomRoleByOwner(message.guild.id, message.author.id);
      if (!r) return message.reply({ embeds: [errEmbed("You don't own a custom role.")] });
      const role = await message.guild.roles.fetch(r.role_id).catch(() => null);
      if (!role) return message.reply({ embeds: [errEmbed("Discord role missing.")] });
      await target.roles.add(role).catch(() => null);
      const members = JSON.parse(r.members || "[]");
      if (!members.includes(target.user.id)) members.push(target.user.id);
      db.updateCustomRole(r.role_id, { members: JSON.stringify(members) });
      return message.reply({ embeds: [okEmbed(`Invited ${target.user.username} to wear **${r.name}**.`)] });
    }

    return message.reply({ embeds: [errEmbed(`Unknown subcommand: \`${sub}\``)] });
  },
};

const rclaim = {
  name: "rclaim",
  category: cat,
  description: "Claim an ownerless custom role by name.",
  usage: ",rclaim <name>",
  async run({ message, args }) {
    if (!message.guild) return message.reply({ embeds: [errEmbed("Server only.")] });
    const name = args.join(" ").trim();
    if (!name) return message.reply({ embeds: [errEmbed("Usage: `,rclaim <name>`")] });
    const all = db.listCustomRoles(message.guild.id);
    const match = all.find((r) => r.name.toLowerCase() === name.toLowerCase() && !r.owner_id);
    if (!match) return message.reply({ embeds: [errEmbed("No ownerless role with that name.")] });
    db.updateCustomRole(match.role_id, { owner_id: message.author.id });
    const role = await message.guild.roles.fetch(match.role_id).catch(() => null);
    if (role) await message.member.roles.add(role).catch(() => null);
    return message.reply({ embeds: [okEmbed(`You claimed **${match.name}**.`)] });
  },
};

const rrolesList = {
  name: "rroles",
  aliases: ["rcustomroles"],
  category: cat,
  description: "List all custom roles in this server.",
  usage: ",rroles",
  async run({ message }) {
    if (!message.guild) return message.reply({ embeds: [errEmbed("Server only.")] });
    const all = db.listCustomRoles(message.guild.id);
    if (!all.length) return message.reply({ embeds: [embed({ color: COLORS.info, description: "_no custom roles_" })] });
    const lines = all.map((r) => {
      const left = r.permanent ? "permanent" : (r.expires_at ? fmtDuration(r.expires_at - Date.now()) : "expired");
      return `<@&${r.role_id}> — owner <@${r.owner_id}> — ${left}`;
    });
    return message.reply({ embeds: [embed({
      color: COLORS.info,
      title: "Custom Roles",
      description: lines.join("\n").slice(0, 4000),
      footer: `${all.length} total`,
    })], allowedMentions: { parse: [] } });
  },
};

module.exports = { commands: [rrole, rclaim, rrolesList] };
