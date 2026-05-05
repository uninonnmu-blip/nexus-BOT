"use strict";

const db = require("../db");
const { embed, errEmbed, okEmbed, notEnoughEmbed, coin, fmt, parseAmount, resolveMember } = require("../utils");
const { COLORS, GIVE_TAX, BET_FEE } = require("../config");
const { findItemByName, ITEMS } = require("../items");

const cat = "giving";

const give = {
  name: "give",
  aliases: ["gift", "pay"],
  category: cat,
  description: "Give coins (5% tax) or items to another user.",
  usage: ",give @user <amount> | ,give @user [qty] <item>",
  async run({ message, args }) {
    if (args.length < 2) return message.reply({ embeds: [errEmbed("Usage: `,give @user <amount>` or `,give @user [qty] <item>`")] });
    const member = await resolveMember(args[0], message);
    if (!member) return message.reply({ embeds: [errEmbed("User not found.")] });
    if (member.user.id === message.author.id) return message.reply({ embeds: [errEmbed("You can't give to yourself.")] });
    if (member.user.bot) return message.reply({ embeds: [errEmbed("Bots aren't part of the economy.")] });

    const rest = args.slice(1).join(" ").trim();
    // Detect: pure amount?
    const u = db.getUser(message.author.id);
    const asAmount = parseAmount(rest, u.wallet);
    const isPureNumber = /^[\d,.kmb]+$|^all$|^half$|^max$/i.test(rest);

    if (isPureNumber && asAmount) {
      const amt = asAmount;
      if (amt > u.wallet) return message.reply({ embeds: [notEnoughEmbed(amt, u.wallet)] });
      const tax = Math.ceil(amt * GIVE_TAX);
      const net = amt - tax;
      db.addWallet(message.author.id, -amt);
      db.addWallet(member.user.id, net);
      return message.reply({ embeds: [okEmbed(`You gave **${member.user.username}** ${coin(net)} (after ${coin(tax)} tax).`, "Transfer")] });
    }

    // Try [qty] <item>
    let qty = 1;
    let itemQuery = rest;
    const m = rest.match(/^(\d+)\s+(.+)/);
    if (m) {
      qty = parseInt(m[1], 10);
      itemQuery = m[2];
    }
    // Reject qty <= 0 so a 0-qty give can't be used to spam fake transfers.
    if (qty <= 0) return message.reply({ embeds: [errEmbed("Quantity must be at least 1.")] });
    const item = findItemByName(itemQuery);
    if (!item) return message.reply({ embeds: [errEmbed(`Couldn't find item or amount from \`${rest}\`.`)] });
    const have = db.getItem(message.author.id, item.id);
    if (have < qty) return message.reply({ embeds: [errEmbed(`You only have ${have}× **${item.name}**.`)] });
    db.removeItem(message.author.id, item.id, qty);
    db.addItem(member.user.id, item.id, qty);
    return message.reply({ embeds: [okEmbed(`Gave **${qty}× ${item.name}** to ${member.user.username}.`)] });
  },
};

const trade = {
  name: "trade",
  category: cat,
  description: "Propose a trade: items, coins, and/or roles. Other user types `accept`.",
  usage: ",trade @user <offer> for <offer>",
  async run({ message, args }) {
    if (args.length < 4) return message.reply({ embeds: [errEmbed("Usage: `,trade @user <offer> for <offer>`")] });
    const member = await resolveMember(args[0], message);
    if (!member) return message.reply({ embeds: [errEmbed("User not found.")] });
    if (member.user.id === message.author.id) return message.reply({ embeds: [errEmbed("You can't trade with yourself.")] });
    if (member.user.bot) return message.reply({ embeds: [errEmbed("Bots aren't part of the economy.")] });

    const rest = args.slice(1).join(" ");
    const idx = rest.toLowerCase().indexOf(" for ");
    if (idx === -1) return message.reply({ embeds: [errEmbed("Use the word `for`. Example: `,trade @user 500 for Iron Shovel`")] });
    const giveStr = rest.slice(0, idx).trim();
    const takeStr = rest.slice(idx + 5).trim();
    const giveParts = parseOffer(giveStr, message.author.id);
    const takeParts = parseOffer(takeStr, member.user.id);
    if (!giveParts.ok) return message.reply({ embeds: [errEmbed(`Your offer: ${giveParts.error}`)] });
    if (!takeParts.ok) return message.reply({ embeds: [errEmbed(`Their offer: ${takeParts.error}`)] });

    // Validate the proposer actually has what they're offering BEFORE we
    // start the prompt. Prevents fake-stake bait (proposer pretends to
    // offer items they don't own and hopes the target accepts blindly).
    if (!checkOffer(message.author.id, giveParts)) {
      return message.reply({ embeds: [errEmbed("You don't have everything in your offer.")] });
    }

    const e = embed({
      color: COLORS.info,
      title: "Trade Proposal",
      description: `<@${message.author.id}> offers: ${giveParts.summary}\n<@${member.user.id}> gives: ${takeParts.summary}\n\n${member.user.toString()} type \`accept\` within 60s to confirm, or \`decline\`.`,
    });
    const sent = await message.reply({ embeds: [e] });
    try {
      // Strict regex: only "accept" or "decline" (case-insensitive). The
      // previous version also accepted bare "yes"/"no", which meant a user
      // typing "yes" in unrelated conversation could auto-confirm a trade
      // they didn't notice and lose their items.
      const collected = await message.channel.awaitMessages({
        filter: (m) => m.author.id === member.user.id && /^(accept|decline)$/i.test(m.content),
        max: 1,
        time: 60_000,
        errors: ["time"],
      });
      const reply = collected.first();
      if (/^decline$/i.test(reply.content)) {
        return message.channel.send({ embeds: [errEmbed("Trade declined.")] });
      }
      // Re-check both sides have everything
      if (!checkOffer(message.author.id, giveParts)) return message.channel.send({ embeds: [errEmbed("Trade failed: proposer no longer has the offered items/coins.")] });
      if (!checkOffer(member.user.id, takeParts)) return message.channel.send({ embeds: [errEmbed("Trade failed: receiver no longer has the offered items/coins.")] });
      executeOffer(message.author.id, member.user.id, giveParts);
      executeOffer(member.user.id, message.author.id, takeParts);
      return message.channel.send({ embeds: [okEmbed("Trade complete!")] });
    } catch {
      return message.channel.send({ embeds: [errEmbed("Trade timed out.")] });
    }
  },
};

const bet = {
  name: "bet",
  category: cat,
  description: "Wager against another user. They reply 'win' or 'lose' to settle.",
  usage: ",bet @user <offer> for <offer>",
  async run({ message, args }) {
    if (args.length < 4) return message.reply({ embeds: [errEmbed("Usage: `,bet @user <offer> for <offer>`")] });
    const member = await resolveMember(args[0], message);
    if (!member || member.user.id === message.author.id) return message.reply({ embeds: [errEmbed("Pick another user.")] });
    if (member.user.bot) return message.reply({ embeds: [errEmbed("Bots aren't part of the economy.")] });
    const rest = args.slice(1).join(" ");
    const idx = rest.toLowerCase().indexOf(" for ");
    if (idx === -1) return message.reply({ embeds: [errEmbed("Use `for`. Example: `,bet @user 1000 for 1000`")] });
    const a = parseOffer(rest.slice(0, idx).trim(), message.author.id);
    const b = parseOffer(rest.slice(idx + 5).trim(), member.user.id);
    if (!a.ok) return message.reply({ embeds: [errEmbed(`Your stake: ${a.error}`)] });
    if (!b.ok) return message.reply({ embeds: [errEmbed(`Their stake: ${b.error}`)] });

    // Validate the proposer actually owns what they're staking. Prevents the
    // "fake stake" exploit: stake items you don't have, randomly win, and
    // walk away with the recipient's real stake while paying nothing.
    if (!checkOffer(message.author.id, a)) {
      return message.reply({ embeds: [errEmbed("You don't have everything you're staking.")] });
    }

    await message.reply({ embeds: [embed({
      color: COLORS.warn,
      title: "PvP Wager (10% fee)",
      description: `<@${message.author.id}> stakes ${a.summary}\n<@${member.user.id}> stakes ${b.summary}\n\n${member.user.toString()} reply \`accept\` or \`decline\` (60s).`,
    })] });
    try {
      const collected = await message.channel.awaitMessages({
        filter: (m) => m.author.id === member.user.id && /^(accept|decline)$/i.test(m.content),
        max: 1, time: 60_000, errors: ["time"],
      });
      if (/decline/i.test(collected.first().content)) return message.channel.send({ embeds: [errEmbed("Bet declined.")] });

      // Re-validate BOTH stakes at accept time. Either user could have
      // spent/transferred/lost their stake during the 60s window. Without
      // this, the recipient could accept a bet they can't pay and the
      // proposer would still "win" against air; or vice versa.
      if (!checkOffer(message.author.id, a)) {
        return message.channel.send({ embeds: [errEmbed("Bet cancelled: proposer no longer has their stake.")] });
      }
      if (!checkOffer(member.user.id, b)) {
        return message.channel.send({ embeds: [errEmbed("Bet cancelled: you don't have everything you staked.")] });
      }

      // Random outcome
      const winnerId = Math.random() < 0.5 ? message.author.id : member.user.id;
      const loserId = winnerId === message.author.id ? member.user.id : message.author.id;
      const wOffer = winnerId === message.author.id ? b : a;
      const lOffer = winnerId === message.author.id ? a : b;
      // loser pays out their offer to winner, minus 10% fee on coins
      if (!checkOffer(loserId, lOffer)) return message.channel.send({ embeds: [errEmbed("Bet failed: someone no longer has their stake.")] });
      executeOffer(loserId, winnerId, lOffer, BET_FEE);
      return message.channel.send({ embeds: [okEmbed(`<@${winnerId}> wins! They get ${lOffer.summary} (10% fee on coins).`)] });
    } catch {
      return message.channel.send({ embeds: [errEmbed("Bet timed out.")] });
    }
  },
};

// ----- Helpers for offer parsing -----
function parseOffer(str, ownerId) {
  if (!str) return { ok: false, error: "empty offer" };
  const parts = str.split("+").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 5) return { ok: false, error: "use 1-5 items joined by +" };
  const coins = [];
  const items = []; // {id, qty}
  const roles = []; // role IDs (rejected — see below)
  for (const p of parts) {
    // Role mention. Roles are NOT supported in trades/bets right now: the
    // executeOffer helper has no access to the guild context and would
    // silently skip role transfers, allowing this scam: proposer offers
    // "@SomeRole for 5000 coins", target sends 5000 coins, role never
    // moves, proposer profits 5000. We reject role offers up front.
    const roleMatch = p.match(/^<@&(\d+)>$/);
    if (roleMatch) {
      return { ok: false, error: "role transfers aren't supported in trades/bets yet — use coins or items only" };
    }
    // pure coins
    if (/^[\d,.kmb]+$/i.test(p)) {
      const n = parseAmountSimple(p);
      if (!n || n <= 0) return { ok: false, error: `bad amount: ${p}` };
      coins.push(n);
      continue;
    }
    // [qty] item
    const m = p.match(/^(\d+)\s+(.+)/);
    let qty = 1, q = p;
    if (m) { qty = parseInt(m[1], 10); q = m[2]; }
    if (qty <= 0) return { ok: false, error: `quantity must be at least 1: ${p}` };
    const item = findItemByName(q);
    if (!item) return { ok: false, error: `unknown: ${p}` };
    items.push({ id: item.id, qty });
  }
  const totalCoins = coins.reduce((a, b) => a + b, 0);
  const summary = [
    totalCoins ? coin(totalCoins) : null,
    ...items.map((i) => `${i.qty}× ${ITEMS[i.id]?.name || i.id}`),
    ...roles.map((r) => `<@&${r}>`),
  ].filter(Boolean).join(" + ");
  return { ok: true, coins: totalCoins, items, roles, summary };
}

function parseAmountSimple(s) {
  s = s.toLowerCase().replace(/,/g, "");
  let mult = 1, body = s;
  if (s.endsWith("k")) { mult = 1000; body = s.slice(0, -1); }
  else if (s.endsWith("m")) { mult = 1_000_000; body = s.slice(0, -1); }
  else if (s.endsWith("b")) { mult = 1_000_000_000; body = s.slice(0, -1); }
  const n = Math.floor(parseFloat(body) * mult);
  return isNaN(n) ? null : n;
}

function checkOffer(userId, offer) {
  const u = db.getUser(userId);
  if (offer.coins && u.wallet < offer.coins) return false;
  for (const it of offer.items) if (db.getItem(userId, it.id) < it.qty) return false;
  return true;
}

function executeOffer(fromId, toId, offer, feePct = 0) {
  if (offer.coins) {
    const fee = Math.floor(offer.coins * feePct);
    const net = offer.coins - fee;
    db.addWallet(fromId, -offer.coins);
    db.addWallet(toId, net);
  }
  for (const it of offer.items) {
    db.removeItem(fromId, it.id, it.qty);
    db.addItem(toId, it.id, it.qty);
  }
  // Roles handled at caller level (would need guild context); skipped in basic exec
}

module.exports = { commands: [give, trade, bet] };
