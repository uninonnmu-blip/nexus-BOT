"use strict";

const db = require("../db");
const { embed, errEmbed, okEmbed, moneyEmbed, notEnoughEmbed, coin, fmt, fmtDuration, weightedPick, rand, chance } = require("../utils");
const { COLORS, CD } = require("../config");
const { ITEMS } = require("../items");
const { announceQuestsComplete } = require("./earning");

const cat = "digging";

function bestTool(userId, slot) {
  // Returns { id, def } of highest-tier tool the user owns for this slot
  const candidates = Object.values(ITEMS).filter((i) => i.type === "tool" && i.slot === slot);
  candidates.sort((a, b) => (b.tier || 0) - (a.tier || 0));
  for (const c of candidates) {
    if (db.getItem(userId, c.id) > 0) return c;
  }
  return null;
}

// ===== Loot tables =====
// Both tables tuned to ~325-360 EV per drop (verified math in code review).
// Diamond tools multi-roll rand(1,2) instead of rand(1,3) — keeps "best tool"
// feel without enabling 1M+/hour grinding loops.
//
// DIG_TABLE EV: 0.32*5 + 0.27*25 + 0.20*150 + 0.13*400 + 0.06*1500 + 0.02*8000 + 0.01*0
//             = 1.6 + 6.75 + 30 + 52 + 90 + 160 + 0 = 340.35
// Net (after 5% trap fine ~850 avg = -42.5): ~298 per dig
const DIG_TABLE = [
  { item: { id: "dirt", qty: 1 },             weight: 32 }, // sell 5      — junk filler
  { item: { id: "pebble", qty: 1 },           weight: 27 }, // sell 25     — common
  { item: { id: "copper_nugget", qty: 1 },    weight: 20 }, // sell 150    — uncommon
  { item: { id: "iron_nugget", qty: 1 },      weight: 13 }, // sell 400    — mid-tier
  { item: { id: "gold_nugget", qty: 1 },      weight: 6 },  // sell 1500   — good
  { item: { id: "diamond", qty: 1 },          weight: 2 },  // sell 8000   — jackpot (was 3)
  { item: { id: "cursed_artifact", qty: 1 },  weight: 1 },  // sell 0      — penalty (24h debuff)
];

// FISH_TABLE EV: 0.30*5 + 0.35*30 + 0.22*250 + 0.09*800 + 0.03*3500 + 0.01*12000
//              = 1.5 + 10.5 + 55 + 72 + 105 + 120 = 364
// Was 1236 — over 3x dig — so this is a major rebalance. The 12k golden_fish
// is preserved as a rare jackpot (1%) rather than a common drop (5%).
const FISH_TABLE = [
  { item: { id: "old_boot", qty: 1 },         weight: 30 }, // sell 5      — junk filler
  { item: { id: "minnow", qty: 1 },           weight: 35 }, // sell 30     — common
  { item: { id: "bass", qty: 1 },             weight: 22 }, // sell 250    — uncommon
  { item: { id: "tuna", qty: 1 },             weight: 9 },  // sell 800    — mid-tier
  { item: { id: "shark", qty: 1 },            weight: 3 },  // sell 3500   — good (was 12)
  { item: { id: "golden_fish", qty: 1 },      weight: 1 },  // sell 12000  — jackpot (was 5)
];

// ===== Free (no-tool) loot tables =====
// Used when the user runs ,dig or ,fish without owning any tool. Heavily
// weighted toward junk so it's clearly worse than even a wooden shovel /
// basic rod. Cooldown is also longer (8m vs 5m). No diamond / golden_fish
// / cursed_artifact in the free pool to avoid griefing or jackpot-farming.
//
// FREE_DIG_TABLE EV: 0.60*5 + 0.25*25 + 0.10*150 + 0.04*400 + 0.01*1500
//                  = 3 + 6.25 + 15 + 16 + 15 = ~55 per dig (vs 340 with tool)
const FREE_DIG_TABLE = [
  { item: { id: "dirt", qty: 1 },          weight: 60 }, // sell 5
  { item: { id: "pebble", qty: 1 },        weight: 25 }, // sell 25
  { item: { id: "copper_nugget", qty: 1 }, weight: 10 }, // sell 150
  { item: { id: "iron_nugget", qty: 1 },   weight: 4 },  // sell 400
  { item: { id: "gold_nugget", qty: 1 },   weight: 1 },  // sell 1500 — rare
];

// FREE_FISH_TABLE EV: 0.60*5 + 0.30*30 + 0.08*250 + 0.02*800
//                   = 3 + 9 + 20 + 16 = ~48 per cast (vs 364 with rod)
const FREE_FISH_TABLE = [
  { item: { id: "old_boot", qty: 1 },      weight: 60 }, // sell 5
  { item: { id: "minnow", qty: 1 },        weight: 30 }, // sell 30
  { item: { id: "bass", qty: 1 },          weight: 8 },  // sell 250
  { item: { id: "tuna", qty: 1 },          weight: 2 },  // sell 800 — rare
];

function getCdKey(slot, tool) {
  if (slot === "pickaxe") {
    if (!tool) return null;
    if (tool.id.startsWith("diamond")) return null;
    if (tool.id.includes("gold")) return "digGold";
    if (tool.id.includes("iron")) return "digIron";
    return "digWooden";
  } else {
    if (!tool) return null;
    if (tool.id.includes("diamond")) return null;
    if (tool.id.includes("lucky")) return "fishLucky";
    return "fishBasic";
  }
}

const dig = {
  name: "dig",
  aliases: ["mine"],
  category: cat,
  description: "Dig for treasure. Uses best pickaxe/shovel you own.",
  usage: ",dig",
  async run({ message }) {
    const tool = bestTool(message.author.id, "pickaxe");
    // ----- Free (no-tool) dig -----
    if (!tool) {
      const left = db.getCooldown(message.author.id, "dig");
      if (left > 0) return message.reply({ embeds: [errEmbed(`Dig CD: **${fmtDuration(left)}**.`)] });
      const u0 = db.getUser(message.author.id);
      const cursed0 = u0.curse_until > Date.now();
      const adj = adjustTable(FREE_DIG_TABLE, { cursed: cursed0, luckBoost: false });
      const drop = weightedPick(adj);
      db.addItem(message.author.id, drop.id, drop.qty);
      db.setCooldown(message.author.id, "dig", CD.digFree);
      const def = ITEMS[drop.id];
      const doneFree = db.incQuestProgress(message.author.id, "dig", 1);
      await message.reply({ embeds: [moneyEmbed(
        `You dug with your **bare hands** and found ${def.emoji || ""} 1\u00D7 **${def.name}**.\n\n_Buy a shovel from \`,shop items\` for much better drops and a shorter cooldown._`,
        "Free Dig",
      )] });
      return announceQuestsComplete(message, doneFree);
    }
    const cdKey = getCdKey("pickaxe", tool);
    if (cdKey) {
      const left = db.getCooldown(message.author.id, "dig");
      if (left > 0) return message.reply({ embeds: [errEmbed(`Dig CD: **${fmtDuration(left)}**.`)] });
    }
    const u = db.getUser(message.author.id);
    const cursed = u.curse_until > Date.now();
    // Lucky Rabbit pet (alive) provides a passive dig luck boost.
    const hasLuckyRabbit = db.listPets(message.author.id).some((p) => p.pet_type === "pet_lucky_rabbit");
    const luckBoost = db.hasActiveBoost(message.author.id, "luck_boost") || db.hasActiveBoost(message.author.id, "dig_luck_charm") || hasLuckyRabbit;

    // Diamond pickaxe: rand(1,2) multi-roll (avg 1.5 drops). Was rand(1,3) but
    // that combined with 0 CD + 100 uses enabled ~1M/hour grinding. 1.5x avg
    // still feels "best tool" while keeping economy sane.
    const multiCount = tool.id === "diamond_pickaxe" ? rand(1, 2) : 1;
    const drops = [];
    for (let i = 0; i < multiCount; i++) {
      const adj = adjustTable(DIG_TABLE, { cursed, luckBoost });
      const drop = weightedPick(adj);
      drops.push(drop);
      db.addItem(message.author.id, drop.id, drop.qty);
      if (drop.id === "cursed_artifact") {
        db.setUserField(message.author.id, "curse_until", Date.now() + 24 * 60 * 60 * 1000);
      }
    }
    // Trap fine
    if (chance(0.05)) {
      const fine = rand(200, 1500);
      db.addWallet(message.author.id, -Math.min(fine, u.wallet));
    }
    if (cdKey) db.setCooldown(message.author.id, "dig", CD[cdKey]);
    consumeUse(message.author.id, tool);

    const summary = drops.map((d) => `${ITEMS[d.id].emoji || ""} ${d.qty}\u00D7 **${ITEMS[d.id].name}**`).join("\n");
    const doneDig = db.incQuestProgress(message.author.id, "dig", 1);
    await message.reply({ embeds: [moneyEmbed(`Used **${tool.name}** \u00D7${multiCount}\n\n${summary}`, "Dig")] });
    return announceQuestsComplete(message, doneDig);
  },
};

const fish = {
  name: "fish",
  category: cat,
  description: "Go fishing. Uses best rod you own.",
  usage: ",fish",
  async run({ message }) {
    const tool = bestTool(message.author.id, "rod");
    // ----- Free (no-tool) hand-fishing -----
    if (!tool) {
      const left = db.getCooldown(message.author.id, "fish");
      if (left > 0) return message.reply({ embeds: [errEmbed(`Fish CD: **${fmtDuration(left)}**.`)] });
      const u0 = db.getUser(message.author.id);
      const cursed0 = u0.curse_until > Date.now();
      const adj = adjustTable(FREE_FISH_TABLE, { cursed: cursed0, luckBoost: false });
      const drop = weightedPick(adj);
      db.addItem(message.author.id, drop.id, drop.qty);
      db.setCooldown(message.author.id, "fish", CD.fishFree);
      const def = ITEMS[drop.id];
      const doneFreeFish = db.incQuestProgress(message.author.id, "fish", 1);
      await message.reply({ embeds: [moneyEmbed(
        `You waded in and **caught with your hands** \u2014 ${def.emoji || ""} 1\u00D7 **${def.name}**.\n\n_Buy a rod from \`,shop items\` for much better catches and a shorter cooldown._`,
        "Free Fish",
      )] });
      return announceQuestsComplete(message, doneFreeFish);
    }
    const cdKey = getCdKey("rod", tool);
    if (cdKey) {
      const left = db.getCooldown(message.author.id, "fish");
      if (left > 0) return message.reply({ embeds: [errEmbed(`Fish CD: **${fmtDuration(left)}**.`)] });
    }
    const u = db.getUser(message.author.id);
    const luckBoost = db.hasActiveBoost(message.author.id, "luck_boost");
    const cursed = u.curse_until > Date.now();

    // Diamond rod: rand(1,2) multi-roll (matches diamond pickaxe nerf above).
    const multiCount = tool.id === "diamond_rod" ? rand(1, 2) : 1;
    const drops = [];
    for (let i = 0; i < multiCount; i++) {
      const adj = adjustTable(FISH_TABLE, { cursed, luckBoost });
      const drop = weightedPick(adj);
      drops.push(drop);
      db.addItem(message.author.id, drop.id, drop.qty);
    }
    if (cdKey) db.setCooldown(message.author.id, "fish", CD[cdKey]);
    consumeUse(message.author.id, tool);

    const summary = drops.map((d) => `${ITEMS[d.id].emoji || ""} ${d.qty}\u00D7 **${ITEMS[d.id].name}**`).join("\n");
    const doneFish = db.incQuestProgress(message.author.id, "fish", 1);
    await message.reply({ embeds: [moneyEmbed(`Cast **${tool.name}** \u00D7${multiCount}\n\n${summary}`, "Fish")] });
    return announceQuestsComplete(message, doneFish);
  },
};

function adjustTable(table, { cursed, luckBoost }) {
  return table.map((e) => {
    let w = e.weight;
    // boost rare drops
    if (e.item.id === "diamond" || e.item.id === "golden_fish" || e.item.id === "shark") {
      if (luckBoost) w *= 1.5;
      if (cursed) w *= 0.6;
    }
    if (e.item.id === "cursed_artifact" && cursed) w *= 0; // can't double curse
    return { item: e.item, weight: w };
  });
}

function consumeUse(userId, tool) {
  const def = ITEMS[tool.id];
  if (!def?.uses) return;
  // Track via active_items.uses_left
  const cur = db.getActive(userId, `tooluses:${tool.id}`);
  let uses = cur ? cur.uses_left : def.uses;
  uses -= 1;
  if (uses <= 0) {
    db.clearActive(userId, `tooluses:${tool.id}`);
    db.removeItem(userId, tool.id, 1);
  } else {
    db.setActive(userId, `tooluses:${tool.id}`, null, uses);
  }
}

const grab = {
  name: "grab",
  category: cat,
  description: "Grab active drops in this channel.",
  usage: ",grab",
  async run({ message }) {
    // Simple grab: random small reward, 5min cooldown
    const left = db.getCooldown(message.author.id, "grab");
    if (left > 0) return message.reply({ embeds: [errEmbed(`Nothing to grab. Try in **${fmtDuration(left)}**.`)] });
    db.setCooldown(message.author.id, "grab", 5 * 60 * 1000);
    const coins = rand(100, 800);
    db.addWallet(message.author.id, coins);
    let extra = "";
    if (chance(0.10)) {
      const tbl = [
        { item: "lottery_ticket", weight: 50 },
        { item: "wooden_shovel", weight: 15 },
        { item: "basic_rod", weight: 15 },
        { item: "iron_shovel", weight: 12 },
        { item: "lucky_rod", weight: 5 },
        { item: "gold_pickaxe", weight: 2 },
        { item: "diamond_pickaxe", weight: 1 },
      ];
      const total = tbl.reduce((s, e) => s + e.weight, 0);
      let r = Math.random() * total;
      let pick = tbl[0].item;
      for (const e of tbl) { if ((r -= e.weight) <= 0) { pick = e.item; break; } }
      // Lottery tickets are useless as inventory items (no `,use` handler).
      // Auto-enter the user into the lottery so the drop is actually
      // valuable, mirroring the buy path's behavior.
      if (pick === "lottery_ticket" && message.guild) {
        const lot = db.getLottery(message.guild.id);
        const entries = JSON.parse(lot.entries || "[]");
        entries.push(message.author.id);
        db.updateLottery(message.guild.id, { entries: JSON.stringify(entries) });
        extra = `\n+ 1\u00D7 **${ITEMS.lottery_ticket.name}** \u2014 auto-entered into the lottery`;
      } else {
        db.addItem(message.author.id, pick, 1);
        extra = `\n+ 1\u00D7 **${ITEMS[pick].name}**`;
      }
    }
    return message.reply({ embeds: [moneyEmbed(`You grabbed ${coin(coins)}${extra}!`, "Grab Drop")] });
  },
};

const payoff = {
  name: "payoff",
  aliases: ["uncurse"],
  category: cat,
  description: "Pay the Wizard 25,000 coins to lift a curse.",
  usage: ",payoff",
  async run({ message }) {
    const u = db.getUser(message.author.id);
    if (u.curse_until <= Date.now()) return message.reply({ embeds: [errEmbed("You aren't cursed.")] });
    if (u.wallet < 25000) return message.reply({ embeds: [notEnoughEmbed(25000, u.wallet, `The Wizard demands ${coin(25000)} to lift the curse.`)] });
    db.addWallet(message.author.id, -25000);
    db.setUserField(message.author.id, "curse_until", 0);
    return message.reply({ embeds: [okEmbed("The Wizard waves his staff. You feel lighter.", "Curse Lifted")] });
  },
};

module.exports = { commands: [dig, fish, grab, payoff] };
