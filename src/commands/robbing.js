"use strict";

const db = require("../db");
const { embed, errEmbed, okEmbed, moneyEmbed, notEnoughEmbed, coin, fmt, fmtDuration, resolveMember, rand, chance } = require("../utils");
const { COLORS, CD, HIBERNATE_MAX_DAYS, HIBERNATE_PRICE_PER_DAY } = require("../config");
const { ITEMS, findItemByName } = require("../items");

const cat = "robbing";

const rob = {
  name: "rob",
  category: cat,
  description: "Steal 5-25% of someone's wallet. ,rob inv @user steals items.",
  usage: ",rob @user | ,rob inv @user",
  async run({ message, args }) {
    if (!args.length) return message.reply({ embeds: [errEmbed("Usage: `,rob @user` or `,rob inv @user`")] });

    const isInv = args[0].toLowerCase() === "inv";
    const memberArg = isInv ? args[1] : args[0];
    if (!memberArg) return message.reply({ embeds: [errEmbed("Usage: `,rob inv @user`")] });
    const target = await resolveMember(memberArg, message);
    if (!target) return message.reply({ embeds: [errEmbed("User not found.")] });
    if (target.user.id === message.author.id) return message.reply({ embeds: [errEmbed("You can't rob yourself.")] });
    if (target.user.bot) return message.reply({ embeds: [errEmbed("You can't rob a bot.")] });

    const tu = db.getUser(target.user.id);
    if (tu.hibernate_until > Date.now()) return message.reply({ embeds: [errEmbed(`${target.user.username} is hibernating.`)] });

    const left = db.getCooldown(message.author.id, "rob");
    if (left > 0) return message.reply({ embeds: [errEmbed(`Rob CD: **${fmtDuration(left)}**.`)] });
    db.setCooldown(message.author.id, "rob", CD.rob);

    // Spike trap defense
    if (db.getActive(target.user.id, "spiked_wallet") && chance(0.5)) {
      const fine = rand(1000, 5000);
      const u = db.getUser(message.author.id);
      const lost = Math.min(fine, u.wallet);
      db.addWallet(message.author.id, -lost);
      db.addWallet(target.user.id, lost);
      return message.reply({ embeds: [errEmbed(`${target.user.username} had a Spike Trap! You took ${coin(lost)} damage paid to them.`, "Counter-Stolen")] });
    }

    // Inv protection blocks 85%
    if (db.getActive(target.user.id, "inv_protection") && chance(0.85)) {
      return message.reply({ embeds: [errEmbed(`${target.user.username}'s Inv Protection blocked you.`)] });
    }

    let baseChance = 0.55;
    if (db.getActive(message.author.id, "inv_robber_luck")) baseChance += 0.15;
    if (!chance(baseChance)) {
      const fine = rand(500, 3000);
      const u = db.getUser(message.author.id);
      const lost = Math.min(fine, u.wallet);
      db.addWallet(message.author.id, -lost);
      return message.reply({ embeds: [errEmbed(`Caught! Fined ${coin(lost)}.`)] });
    }

    if (isInv) {
      const inv = db.listInventory(target.user.id).filter((r) => {
        const def = ITEMS[r.item_id];
        return def && (def.type === "find" || def.type === "consumable" || def.type === "box");
      });
      if (!inv.length) return message.reply({ embeds: [errEmbed("They have nothing worth stealing.")] });
      const row = inv[Math.floor(Math.random() * inv.length)];
      const stealQty = Math.min(row.qty, rand(1, 3));
      db.removeItem(target.user.id, row.item_id, stealQty);
      db.addItem(message.author.id, row.item_id, stealQty);
      const def = ITEMS[row.item_id];
      return message.reply({ embeds: [moneyEmbed(`You stole **${stealQty}× ${def.name}** from ${target.user.username}!`, "Inv Heist")] });
    }

    if (tu.wallet < 100) return message.reply({ embeds: [errEmbed(`${target.user.username}'s wallet is empty.`)] });
    const pct = (rand(5, 25)) / 100;
    const stolen = Math.floor(tu.wallet * pct);
    db.addWallet(target.user.id, -stolen);
    db.addWallet(message.author.id, stolen);
    return message.reply({ embeds: [moneyEmbed(`You stole ${coin(stolen)} from ${target.user.username}!`, "Robbery")] });
  },
};

const heist = {
  name: "heist",
  category: cat,
  description: "Rob someone's BANK. Requires Vault Drill. 6h CD.",
  usage: ",heist @user",
  async run({ message, args }) {
    if (!args[0]) return message.reply({ embeds: [errEmbed("Usage: `,heist @user`")] });
    const target = await resolveMember(args[0], message);
    if (!target || target.user.id === message.author.id) return message.reply({ embeds: [errEmbed("Pick someone else.")] });
    if (target.user.bot) return message.reply({ embeds: [errEmbed("You can't heist a bot.")] });
    if (db.getItem(message.author.id, "vault_drill") <= 0) return message.reply({ embeds: [errEmbed("You need a Vault Drill from the shop.")] });
    const left = db.getCooldown(message.author.id, "heist");
    if (left > 0) return message.reply({ embeds: [errEmbed(`Heist CD: **${fmtDuration(left)}**.`)] });
    const tu = db.getUser(target.user.id);
    if (tu.hibernate_until > Date.now()) return message.reply({ embeds: [errEmbed(`${target.user.username} is hibernating.`)] });
    if (tu.bank < 1000) return message.reply({ embeds: [errEmbed(`Bank too small.`)] });
    db.setCooldown(message.author.id, "heist", CD.heist);
    db.removeItem(message.author.id, "vault_drill", 1);
    if (chance(0.40)) {
      const stolen = Math.floor(tu.bank * (rand(15, 35) / 100));
      db.addBank(target.user.id, -stolen);
      db.addWallet(message.author.id, stolen);
      return message.reply({ embeds: [moneyEmbed(`Heist successful. Drilled the vault and walked off with ${coin(stolen)}.`, "Bank Heist")] });
    }
    const fine = rand(5000, 20000);
    const u = db.getUser(message.author.id);
    db.addWallet(message.author.id, -Math.min(fine, u.wallet));
    return message.reply({ embeds: [errEmbed(`Drill broke! You got pinched and fined ${coin(fine)}.`, "Heist Failed")] });
  },
};

const hibernate = {
  name: "hibernate",
  category: cat,
  description: `Pay to be untouchable for up to ${HIBERNATE_MAX_DAYS} days.`,
  usage: ",hibernate [days]",
  async run({ message, args }) {
    // Parse with NaN guard. Without this, `,hibernate abc` would propagate
    // NaN through cost/until math and corrupt the wallet (NaN gets stored
    // as NULL in SQLite, breaking subsequent arithmetic).
    const parsedDays = parseInt(args[0] || "1", 10);
    if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
      return message.reply({ embeds: [errEmbed(`Usage: \`,hibernate <1-${HIBERNATE_MAX_DAYS}>\``)] });
    }
    const days = Math.max(1, Math.min(HIBERNATE_MAX_DAYS, parsedDays));
    const cost = days * HIBERNATE_PRICE_PER_DAY;
    const u = db.getUser(message.author.id);
    if (u.wallet < cost) return message.reply({ embeds: [notEnoughEmbed(cost, u.wallet, `(${coin(HIBERNATE_PRICE_PER_DAY)}/day for ${days} day${days > 1 ? "s" : ""}.)`)] });
    db.addWallet(message.author.id, -cost);
    const until = Date.now() + days * 24 * 60 * 60 * 1000;
    db.setUserField(message.author.id, "hibernate_until", until);
    return message.reply({ embeds: [okEmbed(`Hibernating for **${days}** day(s). Cost: ${coin(cost)}.`)] });
  },
};

module.exports = { commands: [rob, heist, hibernate] };
