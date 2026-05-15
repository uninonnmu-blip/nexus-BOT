"use strict";

const db = require("../db");
const { embed, errEmbed, okEmbed, moneyEmbed, notEnoughEmbed, coin, fmt, fmtDuration, parseAmount, rand, chance, pick } = require("../utils");
const { COLORS, CD } = require("../config");
const { announceQuestsComplete } = require("./earning");

const cat = "gambling";

function gambleParse(message, args, max) {
  const u = db.getUser(message.author.id);
  if (!args[0]) return { err: "Specify a bet." };
  const amt = parseAmount(args[0], u.wallet);
  if (!amt || amt <= 0) return { err: "Invalid bet." };
  if (amt > u.wallet) return { errEmbed: notEnoughEmbed(amt, u.wallet) };
  if (amt > max) return { err: `Max bet for this game is ${coin(max)}.` };
  return { amt, u };
}

function withLuck(p) {
  // luck boost flat +5%
  return Math.min(0.95, p);
}

const coinflip = {
  name: "coinflip",
  aliases: ["cf"],
  category: cat,
  description: "2x on win. Max 5,500. ~10s CD.",
  usage: ",coinflip <amount> [h|t]",
  async run({ message, args }) {
    const left = db.getCooldown(message.author.id, "coinflip");
    if (left > 0) return message.reply({ embeds: [errEmbed(`Wait **${fmtDuration(left)}**.`)] });
    const r = gambleParse(message, args, 5500);
    if (r.errEmbed) return message.reply({ embeds: [r.errEmbed] });
    if (r.err) return message.reply({ embeds: [errEmbed(r.err)] });
    const side = (args[1] || "h").toLowerCase().startsWith("t") ? "tails" : "heads";
    const luck = db.hasActiveBoost(message.author.id, "luck_boost");
    const winChance = withLuck(luck ? 0.55 : 0.50);
    const win = Math.random() < winChance;
    const flip = win ? side : (side === "heads" ? "tails" : "heads");
    db.setCooldown(message.author.id, "coinflip", CD.coinflip);
    if (win) {
      db.addWallet(message.author.id, r.amt);
      const done = db.incQuestProgress(message.author.id, "gamble_win", 1);
      await message.reply({ embeds: [moneyEmbed(`Coin landed **${flip}**. You won ${coin(r.amt)}!`, "Coinflip")] });
      return announceQuestsComplete(message, done);
    }
    db.addWallet(message.author.id, -r.amt);
    return message.reply({ embeds: [errEmbed(`Coin landed **${flip}**. You lost ${coin(r.amt)}.`, "Coinflip")] });
  },
};

const SLOT_SYMBOLS = [
  { sym: "\uD83C\uDF52", weight: 30, payout: 1.1 }, // cherry
  { sym: "\uD83C\uDF4B", weight: 25, payout: 1.2 }, // lemon
  { sym: "\uD83C\uDF49", weight: 20, payout: 1.3 }, // melon
  { sym: "\uD83D\uDD14", weight: 15, payout: 1.5 }, // bell
  { sym: "\u2B50", weight: 8, payout: 2.0 }, // star
  { sym: "\uD83D\uDC8E", weight: 2, payout: 2.5 }, // diamond (jackpot)
];
function spin() {
  const total = SLOT_SYMBOLS.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const e of SLOT_SYMBOLS) if ((r -= e.weight) <= 0) return e;
  return SLOT_SYMBOLS[0];
}

const slots = {
  name: "slots",
  category: cat,
  description: "1.2x-2.5x jackpot. Max 15,000. 8min CD.",
  usage: ",slots <amount>",
  async run({ message, args }) {
    const left = db.getCooldown(message.author.id, "slots");
    if (left > 0) return message.reply({ embeds: [errEmbed(`Slots CD: **${fmtDuration(left)}**.`)] });
    const r = gambleParse(message, args, 15000);
    if (r.errEmbed) return message.reply({ embeds: [r.errEmbed] });
    if (r.err) return message.reply({ embeds: [errEmbed(r.err)] });
    const a = spin(), b = spin(), c = spin();
    db.setCooldown(message.author.id, "slots", CD.slots);
    let result = "lose";
    let payout = 0;
    if (a.sym === b.sym && b.sym === c.sym) {
      payout = Math.floor(r.amt * a.payout);
      result = "JACKPOT";
    } else if (a.sym === b.sym || b.sym === c.sym || a.sym === c.sym) {
      const matched = a.sym === b.sym ? a : (b.sym === c.sym ? b : a);
      payout = Math.floor(r.amt * (1.0 + (matched.payout - 1) * 0.3));
      result = "match";
    }
    if (payout > 0) {
      db.addWallet(message.author.id, payout - r.amt);
      const done = db.incQuestProgress(message.author.id, "gamble_win", 1);
      await message.reply({ embeds: [moneyEmbed(`[ ${a.sym} | ${b.sym} | ${c.sym} ]\n\n**${result === "JACKPOT" ? "JACKPOT" : "Match"}!** You won ${coin(payout)}.`, "Slots")] });
      return announceQuestsComplete(message, done);
    }
    db.addWallet(message.author.id, -r.amt);
    return message.reply({ embeds: [errEmbed(`[ ${a.sym} | ${b.sym} | ${c.sym} ]\n\nNo match. Lost ${coin(r.amt)}.`, "Slots")] });
  },
};

const blackjack = {
  name: "blackjack",
  aliases: ["bj"],
  category: cat,
  description: "Hit/stand/double. Max 16,000. 4min CD.",
  usage: ",blackjack <amount>",
  async run({ message, args }) {
    const left = db.getCooldown(message.author.id, "blackjack");
    if (left > 0) return message.reply({ embeds: [errEmbed(`Blackjack CD: **${fmtDuration(left)}**.`)] });
    const r = gambleParse(message, args, 16000);
    if (r.errEmbed) return message.reply({ embeds: [r.errEmbed] });
    if (r.err) return message.reply({ embeds: [errEmbed(r.err)] });

    // Real-deck card model so the embed can render like a real BJ table
    // (rank + suit) instead of just listing numbers. Aces are tracked by
    // rank so sum() can demote them from 11 -> 1 to avoid an unfair bust.
    const SUITS = ["\u2660", "\u2665", "\u2666", "\u2663"]; // spade, heart, diamond, club
    const RANKS = [
      { r: "2", v: 2 }, { r: "3", v: 3 }, { r: "4", v: 4 }, { r: "5", v: 5 },
      { r: "6", v: 6 }, { r: "7", v: 7 }, { r: "8", v: 8 }, { r: "9", v: 9 },
      { r: "10", v: 10 }, { r: "J", v: 10 }, { r: "Q", v: 10 }, { r: "K", v: 10 },
      { r: "A", v: 11 },
    ];
    const drawCard = () => {
      const rk = RANKS[rand(0, RANKS.length - 1)];
      const su = SUITS[rand(0, SUITS.length - 1)];
      return { rank: rk.r, value: rk.v, suit: su };
    };
    const cardStr = (c) => `${c.rank}${c.suit}`;
    const handStr = (h) => h.map(cardStr).join(" ");
    // Face-down card glyph for the dealer's hole card while the player still
    // has decisions to make.
    const HIDDEN = "\uD83C\uDCA0";
    const dealerHiddenStr = (d) => `${cardStr(d[0])} ${HIDDEN}`;

    let player = [drawCard(), drawCard()];
    let dealer = [drawCard(), drawCard()];
    let bet = r.amt;
    let doubled = false;

    function sum(hand) {
      let s = hand.reduce((a, c) => a + c.value, 0);
      let aces = hand.filter((c) => c.rank === "A").length;
      while (s > 21 && aces > 0) { s -= 10; aces--; }
      return s;
    }

    // Renders the live game state as a card-table embed.
    const renderEmbed = ({ revealDealer, footer, color }) => {
      const ps = sum(player);
      const ds = sum(dealer);
      return embed({
        color: color ?? COLORS.info,
        title: "Blackjack",
        description: `Bet: ${coin(bet)}`,
        fields: [
          { name: `Your Hand (${ps})`, value: handStr(player), inline: true },
          {
            name: revealDealer ? `Dealer (${ds})` : "Dealer",
            value: revealDealer ? handStr(dealer) : dealerHiddenStr(dealer),
            inline: true,
          },
        ],
        footer: footer || undefined,
      });
    };

    // Reserve the cooldown IMMEDIATELY so a player can't run multiple
    // concurrent blackjack games during the `awaitMessages` window. Without
    // this, spamming ,bj 16000 with a 50k wallet would escrow three separate
    // 16k bets and run three concurrent collectors that all resolve on the
    // same "hit"/"stand" message — bypassing the 4-minute CD entirely.
    db.setCooldown(message.author.id, "blackjack", CD.blackjack);

    // Escrow the bet upfront. WITHOUT this, a player could ,deposit / ,give /
    // ,trade their wallet to 0 during the awaitMessages window and then bust
    // — db.addWallet(-bet) at the end would push the wallet to a negative
    // value while their bank still held the cash. With escrow, the loss is
    // already taken; we just refund on push/timeout/cancel.
    db.addWallet(message.author.id, -bet);
    const refundEscrow = (reason) => {
      db.addWallet(message.author.id, bet);
      return message.channel.send({ embeds: [errEmbed(reason)] });
    };

    if (sum(player) === 21) {
      // Natural blackjack: refund the escrow + add 1x as winnings (2x effective).
      db.addWallet(message.author.id, bet * 2);
      db.setCooldown(message.author.id, "blackjack", CD.blackjack);
      const done = db.incQuestProgress(message.author.id, "gamble_win", 1);
      await message.reply({ embeds: [renderEmbed({
        revealDealer: true,
        color: COLORS.money,
        footer: `Natural Blackjack! Won ${coin(bet)} (2x).`,
      })] });
      return announceQuestsComplete(message, done);
    }

    await message.reply({ embeds: [renderEmbed({
      revealDealer: false,
      footer: "Reply hit, stand, or double.",
    })] });

    while (true) {
      let action;
      try {
        const collected = await message.channel.awaitMessages({
          filter: (m) => m.author.id === message.author.id && /^(hit|stand|double|h|s|d)$/i.test(m.content),
          max: 1, time: 30_000, errors: ["time"],
        });
        action = collected.first().content.toLowerCase()[0];
      } catch {
        return refundEscrow("Blackjack timed out. Bet refunded.");
      }
      if (action === "h") {
        player.push(drawCard());
        if (sum(player) > 21) {
          // Escrow already deducted — nothing more to take.
          db.setCooldown(message.author.id, "blackjack", CD.blackjack);
          return message.channel.send({ embeds: [renderEmbed({
            revealDealer: true,
            color: COLORS.error,
            footer: `Bust! Lost ${coin(bet)}.`,
          })] });
        }
        await message.channel.send({ embeds: [renderEmbed({
          revealDealer: false,
          footer: "Reply hit, stand, or double.",
        })] });
      } else if (action === "d") {
        if (doubled) { await message.channel.send({ embeds: [errEmbed("Already doubled.")] }); continue; }
        // Re-fetch wallet — the user may have spent/transferred coins after
        // the original gambleParse. Without this re-check, the doubled bet
        // could exceed the live wallet and push it negative.
        const liveU = db.getUser(message.author.id);
        const extra = Math.min(bet, 16000 - bet); // cap doubled bet at 16k total
        if (extra <= 0) { await message.channel.send({ embeds: [errEmbed("Already at max doubled bet.")] }); continue; }
        if (liveU.wallet < extra) { await message.channel.send({ embeds: [errEmbed("Not enough to double.")] }); continue; }
        // Escrow the additional stake.
        db.addWallet(message.author.id, -extra);
        bet += extra;
        doubled = true;
        player.push(drawCard());
        break;
      } else { // stand
        break;
      }
    }
    while (sum(dealer) < 17) dealer.push(drawCard());
    const ps = sum(player), ds = sum(dealer);
    db.setCooldown(message.author.id, "blackjack", CD.blackjack);
    if (ps > 21) {
      // Escrow already taken; nothing more to deduct.
      return message.channel.send({ embeds: [renderEmbed({
        revealDealer: true,
        color: COLORS.error,
        footer: `Bust! Lost ${coin(bet)}.`,
      })] });
    }
    if (ds > 21 || ps > ds) {
      // Refund escrow + add winnings.
      const winnings = doubled ? Math.floor(bet * 1) : Math.floor(bet * 0.75); // 1.5x-2x net
      db.addWallet(message.author.id, bet + winnings);
      const done = db.incQuestProgress(message.author.id, "gamble_win", 1);
      await message.channel.send({ embeds: [renderEmbed({
        revealDealer: true,
        color: COLORS.money,
        footer: `Won ${coin(winnings)}!`,
      })] });
      return announceQuestsComplete(message, done);
    }
    if (ps === ds) {
      // Push: refund escrow.
      db.addWallet(message.author.id, bet);
      return message.channel.send({ embeds: [renderEmbed({
        revealDealer: true,
        color: COLORS.info,
        footer: "Push. Bet returned.",
      })] });
    }
    // Loss — escrow already taken.
    return message.channel.send({ embeds: [renderEmbed({
      revealDealer: true,
      color: COLORS.error,
      footer: `Lost ${coin(bet)}.`,
    })] });
  },
};

const cockfight = {
  name: "cockfight",
  category: cat,
  description: "Need a Fighting Chicken. 1.5x-2x on win; lose = bet + chicken gone. 3min CD.",
  usage: ",cockfight <amount>",
  async run({ message, args }) {
    const left = db.getCooldown(message.author.id, "cockfight");
    if (left > 0) return message.reply({ embeds: [errEmbed(`Cockfight CD: **${fmtDuration(left)}**.`)] });
    if (db.getItem(message.author.id, "fighting_chicken") <= 0) return message.reply({ embeds: [errEmbed("You need a Fighting Chicken from the shop.")] });
    const r = gambleParse(message, args, 20000);
    if (r.errEmbed) return message.reply({ embeds: [r.errEmbed] });
    if (r.err) return message.reply({ embeds: [errEmbed(r.err)] });
    db.setCooldown(message.author.id, "cockfight", CD.cockfight);
    const luck = db.hasActiveBoost(message.author.id, "luck_boost");
    const winChance = withLuck(luck ? 0.50 : 0.45);
    if (Math.random() < winChance) {
      const mult = 1.5 + Math.random() * 0.5;
      const win = Math.floor(r.amt * mult);
      db.addWallet(message.author.id, win - r.amt);
      const done = db.incQuestProgress(message.author.id, "gamble_win", 1);
      await message.reply({ embeds: [moneyEmbed(`Your rooster wins! +${coin(win)} (${mult.toFixed(2)}x)`, "Cockfight")] });
      return announceQuestsComplete(message, done);
    }
    db.addWallet(message.author.id, -r.amt);
    db.removeItem(message.author.id, "fighting_chicken", 1);
    return message.reply({ embeds: [errEmbed(`Your rooster fell. Lost ${coin(r.amt)} and your chicken.`, "Cockfight")] });
  },
};

const lottery = {
  name: "lottery",
  category: cat,
  description: "View this server's lottery jackpot and your tickets.",
  usage: ",lottery",
  async run({ message }) {
    if (!message.guild) return message.reply({ embeds: [errEmbed("Lottery only in servers.")] });
    const lot = db.getLottery(message.guild.id);
    const entries = JSON.parse(lot.entries || "[]");
    const mine = entries.filter((id) => id === message.author.id).length;
    const ends = lot.ends_at ? `<t:${Math.floor(lot.ends_at/1000)}:R>` : "soon";
    return message.reply({ embeds: [embed({
      color: COLORS.money,
      title: "Server Lottery",
      description: `Jackpot: **${coin(lot.jackpot)}**\nTotal tickets: **${entries.length}**\nYour tickets: **${mine}**\nEnds: ${ends}\n\nBuy a Lottery Ticket from \`,shop\` to enter.`,
    })] });
  },
};

module.exports = { commands: [coinflip, slots, blackjack, cockfight, lottery] };
