"use strict";

const db = require("../db");
const { embed, errEmbed, okEmbed, moneyEmbed, coin, fmt, fmtDuration, rand, pick } = require("../utils");
const { COLORS, CD, DAILY_AMOUNT, BOOSTER_MULTIPLIER } = require("../config");

const cat = "earning";

function applyEarnMultipliers(userId, baseAmount, kind = "work") {
  let mult = 1;
  if (db.hasActiveBoost(userId, "money_boost")) mult *= 2.0;
  const u = db.getUser(userId);
  if (u.booster) mult *= BOOSTER_MULTIPLIER;
  if (u.curse_until > Date.now()) mult *= 0.7; // -30%
  return Math.floor(baseAmount * mult);
}

const daily = {
  name: "daily",
  category: cat,
  description: "Claim your 24-hour daily reward.",
  usage: ",daily",
  async run({ message }) {
    const left = db.getCooldown(message.author.id, "daily");
    if (left > 0) return message.reply({ embeds: [errEmbed(`Come back in **${fmtDuration(left)}**.`, "Daily on cooldown")] });
    const u = db.getUser(message.author.id);
    let amt = DAILY_AMOUNT;
    if (u.booster) amt = Math.floor(amt * BOOSTER_MULTIPLIER);
    db.addWallet(message.author.id, amt);
    db.setCooldown(message.author.id, "daily", CD.daily);
    return message.reply({ embeds: [moneyEmbed(`You claimed your daily of ${coin(amt)}!${u.booster ? " (Booster 1.5x)" : ""}`, "Daily Reward")] });
  },
};

const WORK_LINES = [
  "You worked as a barista and earned",
  "You programmed a website and earned",
  "You delivered pizzas and earned",
  "You walked dogs and earned",
  "You streamed on Twitch and earned",
  "You sold lemonade and earned",
];

const work = {
  name: "work",
  category: cat,
  description: "Work for 50 to 1,500 coins. 1 hour CD.",
  usage: ",work",
  async run({ message }) {
    const left = db.getCooldown(message.author.id, "work");
    if (left > 0) return message.reply({ embeds: [errEmbed(`You're tired. Try again in **${fmtDuration(left)}**.`)] });
    const base = rand(50, 1500);
    const amt = applyEarnMultipliers(message.author.id, base, "work");
    db.addWallet(message.author.id, amt);
    db.setCooldown(message.author.id, "work", CD.work);
    const done = db.incQuestProgress(message.author.id, "work", 1);
    await message.reply({ embeds: [moneyEmbed(`${pick(WORK_LINES)} ${coin(amt)}.`, "Work")] });
    return announceQuestsComplete(message, done);
  },
};

// Send a small follow-up embed for any quests that JUST completed during the
// current action, so the user sees their bonus credit immediately.
async function announceQuestsComplete(message, completed) {
  if (!completed || !completed.length) return;
  for (const q of completed) {
    await message.channel.send({ embeds: [moneyEmbed(
      `Quest Complete: **${q.name}** \u2014 +${coin(q.reward)} credited to wallet!`,
      "Daily Quest",
    )] }).catch(() => {});
  }
}

const CRIME_LINES = [
  "You knocked over a corner store",
  "You hacked into a vending machine",
  "You ran a counterfeit ring",
  "You pulled off a heist movie scheme",
];

const crime = {
  name: "crime",
  category: cat,
  description: "Risky crime. Earn 500-15,000 or get fined. 4 hour CD.",
  usage: ",crime",
  async run({ message }) {
    const left = db.getCooldown(message.author.id, "crime");
    if (left > 0) return message.reply({ embeds: [errEmbed(`The cops are still looking. Try again in **${fmtDuration(left)}**.`)] });
    db.setCooldown(message.author.id, "crime", CD.crime);
    if (Math.random() < 0.30) {
      // caught
      const u = db.getUser(message.author.id);
      const fine = Math.min(u.wallet, rand(500, 5000));
      db.addWallet(message.author.id, -fine);
      return message.reply({ embeds: [errEmbed(`You got caught! Lost ${coin(fine)}.`, "Crime gone wrong")] });
    }
    const base = rand(500, 15000);
    const amt = applyEarnMultipliers(message.author.id, base, "crime");
    db.addWallet(message.author.id, amt);
    return message.reply({ embeds: [moneyEmbed(`${pick(CRIME_LINES)} and got away with ${coin(amt)}!`, "Crime")] });
  },
};

// ===== ,slut =====
// Picks a RANDOM other member of the guild as the "partner" each time and
// builds a flavor sentence around them. Format matches the competitor bot:
//   "<user> <verb> <Partner> <suffix> all night and got paid 💸 <amt> 🎉"
// Pink/magenta embed, title "💋 Getting It In", footer shows the cooldown.
const SLUT_PINK = 0xE91E63;

const SLUT_VERBS = [
  "rode",
  "spent the night with",
  "had a wild night with",
  "fooled around with",
  "kept",
  "snuck off with",
  "made out with",
  "danced all night with",
  "cuddled up to",
  "got cozy with",
];

const SLUT_SUFFIXES = [
  "(no shit Sherlock)",
  "(certified menace)",
  "(don't tell anyone)",
  "(again)",
  "(at the back of the club)",
  "(what a night)",
  "(big spender)",
  "(huge mistake)",
  "(legend)",
  "(your ex)",
  "(the bartender)",
  "(again, somehow)",
  "(no regrets)",
  "(in the bathroom)",
  "", // sometimes no suffix
  "",
];

const SLUT_FAIL_LINES = [
  "got stood up by **{target}** and walked home empty-handed",
  "got rejected by **{target}** \u2014 ouch",
  "tried to flirt with **{target}** and got slapped",
  "thought it was on with **{target}** but they bailed",
  "bought drinks for **{target}** all night and they ghosted",
];

async function pickRandomPartner(message) {
  const guild = message.guild;
  if (!guild) return null;
  let members = guild.members.cache;
  // Cache might be sparse on big servers; try a fetch but don't block forever.
  if (members.size < 5) {
    try { await guild.members.fetch({ time: 3000, limit: 1000 }); } catch {}
    members = guild.members.cache;
  }
  const pool = members.filter((m) => !m.user.bot && m.id !== message.author.id);
  if (pool.size === 0) return null;
  const arr = [...pool.values()];
  return arr[Math.floor(Math.random() * arr.length)];
}

const slut = {
  name: "slut",
  category: cat,
  description: "Get paid by a random server member. 1h 30m CD.",
  usage: ",slut",
  async run({ message }) {
    const left = db.getCooldown(message.author.id, "slut");
    if (left > 0) {
      return message.reply({ embeds: [errEmbed(`Try again in **${fmtDuration(left)}**.`)] });
    }
    // Reserve the cooldown IMMEDIATELY (before any await) so a user spamming
    // ,slut can't squeeze multiple payouts through the `await pickRandomPartner`
    // microtask boundary. Without this reservation, three rapid ,slut messages
    // would all see getCooldown=0, all await pickRandomPartner, and all credit
    // wallet before any of them set the cooldown. We restore the cooldown to 0
    // on the "no partner" branch so the user isn't punished for an empty server.
    db.setCooldown(message.author.id, "slut", CD.slut);
    const partner = await pickRandomPartner(message);
    if (!partner) {
      db.setCooldown(message.author.id, "slut", 0);
      return message.reply({
        embeds: [errEmbed("There's nobody else around here. Try again when more people are in the server.")],
      });
    }

    const partnerName = partner.displayName || partner.user.username;
    const suffix = pick(SLUT_SUFFIXES);
    const partnerLabel = suffix ? `${partnerName} ${suffix}` : partnerName;
    const userName = (message.member?.displayName) || message.author.username;
    const cdMin = Math.round(CD.slut / 60000);
    const cdLabel = cdMin >= 60
      ? `${Math.floor(cdMin / 60)}h ${cdMin % 60}m 0s`
      : `${cdMin}m 0s`;

    // Bad-night branch (~20%): no payout, small loss, themed around the partner.
    if (Math.random() < 0.20) {
      const lossBase = rand(200, 1500);
      const u = db.getUser(message.author.id);
      const lost = Math.min(u.wallet, lossBase);
      if (lost > 0) db.addWallet(message.author.id, -lost);
      const failLine = pick(SLUT_FAIL_LINES).replace("{target}", partnerName);
      return message.reply({
        embeds: [embed({
          color: COLORS.error,
          title: "\uD83D\uDC94 Bad Night",
          description: `**${userName}** ${failLine}.${lost > 0 ? ` Lost ${coin(lost)}.` : ""}`,
          footer: `Cooldown: ${cdLabel}`,
        })],
      });
    }

    const base = rand(800, 2800);
    const amt = applyEarnMultipliers(message.author.id, base, "slut");
    db.addWallet(message.author.id, amt);

    const verb = pick(SLUT_VERBS);
    const desc = `**${userName}** ${verb} **${partnerLabel}** all night and got paid ${coin(amt)} \uD83C\uDF89`;

    return message.reply({
      embeds: [embed({
        color: SLUT_PINK,
        title: "\uD83D\uDC8B Getting It In",
        description: desc,
        footer: `Cooldown: ${cdLabel}`,
      })],
    });
  },
};

const quests = {
  name: "quests",
  category: cat,
  description: "View your daily bonus quests.",
  usage: ",quests",
  async run({ message }) {
    // db.getOrCreateTodayQuests handles the row creation + random pick.
    const data = db.getOrCreateTodayQuests(message.author.id);
    const lines = [];
    for (const id of Object.keys(data)) {
      const def = db.QUEST_POOL.find((q) => q.id === id);
      if (!def) continue;
      const p = data[id];
      const status = p.claimed ? "\u2705 claimed" : `${p.progress}/${def.target}`;
      lines.push(`**${def.name}** \u2014 ${coin(def.reward)} \u2014 ${status}`);
    }
    return message.reply({ embeds: [embed({
      color: COLORS.info,
      title: "Daily Quests",
      description: lines.join("\n") || "No quests today.",
      footer: "Resets daily at midnight UTC. Rewards auto-credited on completion.",
    })] });
  },
};

// ---- Money Guide (paginated, matches screenshots) ----
const GUIDE_PAGES = [
  {
    title: "\uD83D\uDCD6 Money Guide \u2014 Everything You Need to Know",
    body: [
      "\uD83C\uDFC1 **Free Earning**",
      "**Chat** \u2014 Earn 30\u201350 coins per message",
      "`,daily` \u2014 \uD83D\uDCB5 **1,500** every 24hrs (Boost/Nitro role: 1.5x)",
      "`,work` \u2014 50\u20131,500 coins per hour (1hr CD)",
      "`,crime` \u2014 Risk/reward (4hr CD)",
      "`,slut` \u2014 Quick money (1hr CD)",
      "`,grab` \u2014 Grab coin drops in active channels",
      "\u00A0\u00A0\u21B3 Rare drops: \uD83C\uDFAB Lottery, \uD83E\uDE93 Wooden Shovel/Basic Rod (3%)",
      "\u00A0\u00A0\u21B3 Rarer: \u26CF\uFE0F Iron Shovel (2.3%), \uD83C\uDFA3 Lucky Rod (1.5%)",
      "\u00A0\u00A0\u21B3 Very rare: \u26CF\uFE0F Gold Pickaxe (1%), \uD83D\uDC8E Diamond Pickaxe/Rod (0.2\u20130.5%)",
      "`,quests` \u2014 Daily quests with completion bonus",
      "",
      "\uD83C\uDFE6 **Bank & Vault**",
      "`,deposit/dep <amount|all>` \u2014 Wallet \u2192 bank (**no daily cap!**)",
      "`,withdraw/with <amount|all>` \u2014 Bank \u2192 wallet",
      "`,vault` \u2014 View your vault tier & upgrade cost",
      "\u26A0\uFE0F Bank is safe from robbers \u2014 only wallet can be stolen!",
      "\uD83D\uDCC8 Upgrade your vault with coins to increase bank capacity",
      "",
      "\u26CF\uFE0F **Digging & \uD83C\uDFA3 Fishing**",
      "No tool? `,dig` / `,fish` still work \u2014 **bare-hands mode** drops mostly junk on an 8min CD.",
      "Buy tools from `,shop items` for way better drops:",
      "\uD83E\uDE93 Wooden 5min \u2192 \u26CF\uFE0F Iron 3min \u2192 \u26CF\uFE0F Gold 2min \u2192 \uD83D\uDC8E Diamond **no CD**",
      "\uD83D\uDC8E Diamond Pickaxe/Rod = no cooldown, multi-dig/cast (up to 2 at once)",
      "`,sell all` \u2014 sell all finds | `,shopsell` \u2014 full price list",
      "\u2620\uFE0F Cursed Artifact = -40% luck/-30% earnings for 24hrs \u2192 `,payoff` to lift early",
      "",
      "\uD83D\uDCE6 **Mystery Boxes**",
      "\uD83D\uDCE6 **Mystery Box** (2,500) \u2014 Common items: shovels, rods, pet supplies, boosts",
      "\uD83D\uDFE3 **Rare Box** (6,000) \u2014 Better items: iron/gold tools, 7d boosts, vault drills",
      "\uD83D\uDFE1 **Legendary Box** (7,000) \u2014 Best items: diamond tools, 7d boosts, charms",
      "All boxes can also drop dig finds! Open with `,open`",
      "\uD83D\uDCB0 Coins are rare in boxes \u2014 items are the main reward",
      "",
      "\uD83D\uDC3E **Pets** (\u26AB Common / \uD83D\uDD35 Rare +15% / \uD83C\uDF1F Legendary +30%)",
      "`,pet <n>` \u2014 Interact (earn + XP) | `,pets` \u2014 view all stats",
      "\uD83D\uDC39 Hamster auto-earns every hour regardless of edition",
      "**Level 10** = auto-income for all pets",
      "\u26A0\uFE0F ALL pets die without food/water in 2 days!",
    ].join("\n"),
    footer: "Page 1/3 \u2022 Use \u25C0 \u25B6 to navigate \u2022 ,currency for full command list",
  },
  {
    title: "\uD83D\uDCD6 Money Guide \u2014 Everything You Need to Know",
    body: [
      "\uD83C\uDFB2 **Gambling**",
      "**Coinflip** \u2014 win = **2x** (profit = bet). max \uD83D\uDCB5 **5,500**, 10s CD",
      "**Slots** \u2014 win = **1.2x\u20132.5x** (symbol rarity). Two-of-a-kind = 1.1\u20131.3x. max \uD83D\uDCB5 **15,000**, 8min CD",
      "**Blackjack** \u2014 win = **1.5x\u20132x** (random bonus). Double = up to \uD83D\uDCB5 **16,000**. Natural BJ = 2x. 4min CD",
      "**Cockfight** \u2014 win = **1.5x\u20132x**; lose = bet + chicken gone",
      "\uD83C\uDFAB Buy Lottery Ticket \u2192 auto-entered! View with `,lottery`",
      "\uD83C\uDF40 Luck Boost = better win **chance** only (not payout)",
      "\uD83D\uDCB5 Money Boost = better earnings on work/crime/chat (not gambling)",
      "",
      "\u2728 **Boosters** (stack up to 4x)",
      "**Money Boost** \uD83D\uDCB5 \u2014 up to 3x earnings on work/crime/chat",
      "**Luck Boost** \uD83C\uDF40 \u2014 up to 2.5x win chance on gambling & better dig/fish",
      "**Rob Booster** \u26A1 \u2014 1.5x/2x/2.5x loot; 2x+ can break protection!",
      "\u26A0\uFE0F Boosts are random up to their max \u2014 stack more for higher potential",
      "",
      "\uD83C\uDFAD **Shop Roles & Colors**",
      "`,shop roles` / `,shop colors` \u2014 browse buyable roles",
      "Regular roles auto-apply on purchase. Color roles: `,use <item>` to apply",
      "\u00A0\u00A0\u21B3 Applying a new color removes ALL old colors and returns them to inventory",
      "`,rrole remove <@role or roleId>` \u2014 remove a shop role \u2192 item returned to inventory",
      "`,rrole item @RoleName` \u2014 convert a worn role back into an inventory item",
      "`,rrole unregister` \u2014 remove role from custom role system (keeps Discord role)",
      "",
      "\uD83C\uDFA8 **Custom Roles**",
      "`,rrole create` \u2014 create your own role (wizard, costs coins)",
      "`,rrole @user` \u2014 invite someone to wear your role (any channel)",
      "`,rrole remove @user` \u2014 remove a member from your role (any channel)",
      "`,rrole ping <msg>` \u2014 ping your role (2hr CD, any channel)",
      "`,rrole renew` \u2014 extend 7 days | `,rrole delete` \u2014 delete role",
      "`,rroles` \u2014 list all custom roles and owners",
      "**Trading roles:** `,trade @user @RoleName for ...`",
      "\u00A0\u00A0\u21B3 Role removed from sender, shop item given to receiver",
      "\u00A0\u00A0\u21B3 Use `@RoleName` or `@roleId` \u2014 must be a shop role",
      "",
      "\uD83D\uDDE1\uFE0F **Robbing & Protection**",
      "`,rob @user` \u2014 steal 5\u201325% wallet | `,heist @user` \u2014 rob bank (needs Vault Drill)",
      "`,rob inv @user` \u2014 steal items from inventory | `,hibernate` \u2014 full protection (max 5d)",
      "\u26A1 Rob Boosters 2x+ can BREAK through protection!",
      "\uD83D\uDD12 Wallet Lock, \uD83D\uDEE1\uFE0F Guard, \uD83D\uDCB0 Guard with Gun, \uD83D\uDCE6 Inv Protection all stack",
      "",
      "\uD83C\uDF0D **Server Economy / Inflation**",
      "Prices rise based on **total server wealth**. Every \uD83D\uDCB5 1,000,000 across all members = **+1% inflation** (capped at +15%).",
      "All shop prices, vault upgrades, hibernate, and custom roles scale with this rate.",
      "Errors show \uD83C\uDF0D **Economy: +X% active** so you know inflation is in effect.",
      "`,economy` \u2014 view current rate + wealth needed for next tier",
      "",
      "\uD83D\uDCB8 **Bill Collector**",
      "Every now and then a flat \uD83D\uDCB5 25 \"Digital loitering fine\" is deducted from active users.",
      "Bank your money to stay safe \u2014 only your wallet is fined.",
      "Disable DM alerts with `,notifications off` (the bills still happen, just no DM).",
      "",
      "\uD83D\uDCA1 **Pro Tips**",
      "\u2022 **No deposit limit** \u2014 bank everything!",
      "\u2022 `,lbhide [days]` \u2014 hide from leaderboard (2,000/day, max 5d) | `,lbshow` to unhide",
      "\u2022 `,profile` \u2014 see your exact luck multiplier",
      "\u2022 `,lottery` \u2014 check jackpot + ticket holders",
      "\u2022 `,open` \u2014 open mystery boxes (\uD83D\uDCE6 \uD83D\uDFE3 \uD83D\uDFE1)",
      "\u2022 `,notifications off/on` \u2014 toggle DM alerts",
      "\u2022 `,currency` \u2014 full command list",
    ].join("\n"),
    footer: "Page 2/3 \u2022 Next: Trading & Transfers \u2022 ,currency for full command reference",
  },
  {
    title: "\uD83D\uDCD6 Money Guide \u2014 Trading & Transfers",
    body: [
      "\uD83E\uDD1D **Trading** (no tax \u2014 best way to swap with friends)",
      "`,trade @user <offer> for <ask>` \u2014 they reply `accept` within 60s to confirm",
      "Both sides can be **coins**, **items**, **shop roles**, or any combo (up to 5 per side, joined with `+`).",
      "",
      "**Items \u2194 coins:**",
      "\u00A0\u00A0`,trade @user Iron Shovel for 5000`",
      "\u00A0\u00A0`,trade @user 20000 for Diamond Pickaxe`",
      "",
      "**Multi-item bundles (use `+`):**",
      "\u00A0\u00A0`,trade @user 5000 + Iron Shovel for Diamond Pickaxe`",
      "\u00A0\u00A0`,trade @user 3 Pet Treat + 1000 for Lottery Ticket`",
      "\u00A0\u00A0`,trade @user 10000 for 2 Mystery Box + Pet Rock`",
      "",
      "**Shop roles** (must own / be a shop role):",
      "\u00A0\u00A0`,trade @user @VIP for 15000`",
      "\u00A0\u00A0`,trade @user 8000 for @Active Member`",
      "\u00A0\u00A0\u21B3 Role auto-removed from sender, given to receiver",
      "",
      "**Number shortcuts:** `5k` = 5,000 \u00B7 `1.5m` = 1,500,000 \u00B7 `2b` = 2,000,000,000",
      "",
      "\uD83D\uDCB8 **Giving** (one-way, **5% tax** on coins, no tax on items)",
      "`,give @user <amount|all>` \u2014 send coins (5% tax)",
      "`,give @user <item>` \u2014 send 1 item (no tax)",
      "`,give @user 3 Pet Treat` \u2014 send multiple of an item",
      "\u26A0\uFE0F Use `,trade` instead whenever possible \u2014 it's tax-free!",
      "",
      "\uD83C\uDFB2 **Betting** (gambling against a friend)",
      "`,bet @user <stake> for <stake>` \u2014 same syntax as `,trade`, but result is **50/50 random**",
      "Winner takes the loser's stake. **10% fee on coin payouts.**",
      "\u00A0\u00A0`,bet @user 5000 for 5000`",
      "\u00A0\u00A0`,bet @user Iron Shovel for 1000`",
      "",
      "\uD83D\uDCB0 **Quick reference**",
      "\u2022 `,trade` = tax-free swap, both sides put up something",
      "\u2022 `,give` = one-way, 5% tax on coins",
      "\u2022 `,bet` = 50/50 gamble, 10% fee on coin winnings",
      "\u2022 All trades expire in **60 seconds** if not accepted",
      "\u2022 Both parties must have what they're offering at accept-time, or trade fails",
      "\u2022 Can't trade equipped/active items (e.g. active Pet Luck Charm)",
    ].join("\n"),
    footer: "Page 3/3 \u2022 ,currency for full command reference",
  },
];

function buildGuideEmbed(idx) {
  const p = GUIDE_PAGES[idx];
  return embed({
    color: COLORS.info,
    title: p.title,
    description: p.body,
    footer: p.footer,
  });
}

function buildGuideRow(idx, userId) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
  const prev = new ButtonBuilder()
    .setCustomId(`guide:prev:${userId}`)
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("\u25C0\uFE0F")
    .setDisabled(idx === 0);
  const next = new ButtonBuilder()
    .setCustomId(`guide:next:${userId}`)
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("\u25B6\uFE0F")
    .setDisabled(idx === GUIDE_PAGES.length - 1);
  const close = new ButtonBuilder()
    .setCustomId(`guide:close:${userId}`)
    .setLabel("Close")
    .setStyle(ButtonStyle.Danger);
  return new ActionRowBuilder().addComponents(prev, next, close);
}

const guide = {
  name: "guide",
  aliases: ["moneyguide"],
  category: cat,
  description: "Full money-making guide (sent via DM).",
  usage: ",guide",
  async run({ message }) {
    const { ComponentType } = require("discord.js");
    let idx = 0;
    const userId = message.author.id;

    // The guide is long and clutters channels, so we send it as a DM.
    // If the user has DMs disabled, fall back with a polite hint in
    // the channel instead of throwing.
    let msg;
    try {
      msg = await message.author.send({
        embeds: [buildGuideEmbed(idx)],
        components: [buildGuideRow(idx, userId)],
      });
    } catch {
      return message.reply({ embeds: [errEmbed(
        "I couldn't DM you the guide. Enable **Direct Messages from server members** in your privacy settings, then run `,guide` again."
      )] });
    }
    // Acknowledge in the original channel (only if it wasn't already a DM).
    if (message.guild) {
      message.reply({ embeds: [okEmbed("Sent the money guide to your DMs.", "Money Guide")] }).catch(() => {});
    }

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 5 * 60 * 1000,
    });
    collector.on("collect", async (interaction) => {
      const [, action, oid] = interaction.customId.split(":");
      if (interaction.user.id !== oid) {
        return interaction.reply({
          content: "This guide isn't yours. Run `,guide` yourself.",
          ephemeral: true,
        });
      }
      if (action === "prev") idx = Math.max(0, idx - 1);
      else if (action === "next") idx = Math.min(GUIDE_PAGES.length - 1, idx + 1);
      else if (action === "close") {
        collector.stop("closed");
        return interaction.update({ components: [] });
      }
      await interaction.update({
        embeds: [buildGuideEmbed(idx)],
        components: [buildGuideRow(idx, userId)],
      });
    });
    collector.on("end", async () => {
      try { await msg.edit({ components: [] }); } catch {}
    });
  },
};

module.exports = { commands: [daily, work, crime, slut, quests, guide], applyEarnMultipliers, announceQuestsComplete };
