"use strict";

const db = require("../db");
const { embed, errEmbed, okEmbed, moneyEmbed, coin, fmt, fmtDuration, rand, chance, bar } = require("../utils");
const { COLORS } = require("../config");
const { PET_TYPES, PET_RARITY_MULT } = require("../items");

const cat = "pets";

const pets = {
  name: "pets",
  category: cat,
  description: "View all your pets with status bars.",
  usage: ",pets",
  async run({ message }) {
    const list = db.listPets(message.author.id);
    if (!list.length) return message.reply({ embeds: [embed({ color: COLORS.info, title: "Your Pets", description: "You don't own any pets. Buy from `,shop pets`." })] });
    const lines = list.map((p, i) => {
      const def = PET_TYPES[p.pet_type];
      const rarity = p.rarity[0].toUpperCase() + p.rarity.slice(1);
      return [
        `**${i + 1}. ${def?.emoji || ""} ${p.name}** (${rarity} ${def?.name || p.pet_type}) — Lv ${p.level}`,
        `Hunger ${bar(p.hunger, 100)} ${p.hunger}/100`,
        `Thirst ${bar(p.thirst, 100)} ${p.thirst}/100`,
        `XP: ${fmt(p.xp)}/${fmt(p.level * 100)}`,
      ].join("\n");
    });
    return message.reply({ embeds: [embed({
      color: COLORS.primary,
      author: { name: `${message.author.username}'s Pets`, iconURL: message.author.displayAvatarURL() },
      description: lines.join("\n\n"),
      footer: "Pets die after 2 days without food or water.",
    })] });
  },
};

const pet = {
  name: "pet",
  category: cat,
  description: "Interact with pet #N (earn coins + XP).",
  usage: ",pet <n>",
  async run({ message, args }) {
    // Default to pet #1 if input is missing or non-numeric (avoids ugly "No pet #NaN").
    const parsed = parseInt(args[0] || "1", 10);
    const n = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    const p = db.getPetByIndex(message.author.id, n);
    if (!p) return message.reply({ embeds: [errEmbed(`No pet #${n}. Use \`,pets\` to list.`)] });
    if (p.hunger <= 0 || p.thirst <= 0) return message.reply({ embeds: [errEmbed(`${p.name} is too weak. Feed/water first.`)] });

    const def = PET_TYPES[p.pet_type];
    const cdKey = `pet:${p.id}`;
    const cdMs = def?.cdMs || 60 * 60 * 1000;
    const left = db.getCooldown(message.author.id, cdKey);
    if (left > 0) return message.reply({ embeds: [errEmbed(`${p.name} needs to rest. Try again in **${fmtDuration(left)}**.`)] });

    const perks = db.getUserPerks(message.author.id);
    const luckCharm = db.hasActiveBoost(message.author.id, "pet_luck_charm");
    const xpBoost = db.hasActiveBoost(message.author.id, "pet_xp_boost");

    // Earnings: per-pet range \u00D7 rarity \u00D7 level \u00D7 strength perk \u00D7 luck charm.
    const [lo, hi] = def?.earn || [50, 200];
    const baseCoins = rand(lo, hi);
    const rarityMult = PET_RARITY_MULT[p.rarity] || 1;
    const strengthMult = perks.strength ? 1.20 : 1;
    const charmMult = luckCharm ? 1.5 : 1;
    let coins = Math.floor(baseCoins * rarityMult * strengthMult * charmMult * (1 + p.level * 0.05));

    // Pet Luck Upgrade: +10% chance for a bonus payout (2x).
    let bonus = false;
    if (perks.petLuck && chance(0.10)) {
      bonus = true;
      coins *= 2;
    }

    const xpGain = rand(8, 20) * (xpBoost ? 2 : 1);
    db.addWallet(message.author.id, coins);
    let newXp = p.xp + xpGain;
    let newLevel = p.level;
    if (newXp >= p.level * 100) { newXp -= p.level * 100; newLevel++; }
    db.updatePet(p.id, {
      xp: newXp,
      level: newLevel,
      hunger: Math.max(0, p.hunger - 5),
      thirst: Math.max(0, p.thirst - 5),
    });
    db.setCooldown(message.author.id, cdKey, cdMs);

    const lines = [
      `You played with **${p.name}** ${def?.emoji || ""} and earned ${coin(coins)} (+${xpGain} XP)${xpBoost ? " *(2x XP boost)*" : ""}.`,
    ];
    if (bonus) lines.push(`**Lucky payout!** Pet Luck Upgrade triggered (2x).`);
    if (charmMult > 1) lines.push(`*Pet Luck Charm active: 1.5x payouts*`);
    if (newLevel > p.level) lines.push(`**${p.name}** leveled up to **${newLevel}**!`);
    return message.reply({ embeds: [moneyEmbed(lines.join("\n"), "Pet Interaction")] });
  },
};

const { PET_SUPPLIES } = require("../items");

function useSupply(message, args, kind) {
  const parsed = parseInt(args[0] || "1", 10);
  const n = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const p = db.getPetByIndex(message.author.id, n);
  if (!p) return message.reply({ embeds: [errEmbed(`No pet #${n}. Use \`,pets\` to list.`)] });

  // Find best matching supply in inventory
  const owned = db.listInventory(message.author.id);
  const candidates = owned
    .map((r) => ({ row: r, def: PET_SUPPLIES[r.item_id] }))
    .filter((x) => x.def && x.def.type === kind && x.row.qty > 0);
  if (!candidates.length) {
    return message.reply({ embeds: [errEmbed(`You don't have any ${kind === "food" ? "pet food" : "pet water"}. Buy some from \`,shop pets\`.`)] });
  }
  // Prefer highest restore amount
  candidates.sort((a, b) => (b.def.restore || 0) - (a.def.restore || 0));
  const chosen = candidates[0];
  db.removeItem(message.author.id, chosen.row.item_id, 1);

  const restore = chosen.def.restore || 50;
  const xpBonus = chosen.def.xpBonus || 0;
  const updates = {};
  const now = Date.now();
  if (kind === "food") {
    updates.hunger = Math.min(100, p.hunger + restore);
    updates.last_fed = now;
  } else {
    updates.thirst = Math.min(100, p.thirst + restore);
    updates.last_watered = now;
  }
  if (xpBonus) updates.xp = p.xp + xpBonus;
  db.updatePet(p.id, updates);

  const stat = kind === "food" ? `Hunger: **${updates.hunger}/100**` : `Thirst: **${updates.thirst}/100**`;
  const xpLine = xpBonus ? ` (+${xpBonus} XP)` : "";
  return message.reply({ embeds: [okEmbed(`Used **${chosen.def.name}** ${chosen.def.emoji || ""} on **${p.name}**.\n${stat}${xpLine}`, kind === "food" ? "Pet Fed" : "Pet Watered")] });
}

const feed = {
  name: "feed",
  category: cat,
  description: "Feed pet #N. Uses best food in your inventory.",
  usage: ",feed <n>",
  async run({ message, args }) { return useSupply(message, args, "food"); },
};

const water = {
  name: "water",
  category: cat,
  description: "Water pet #N. Uses best water in your inventory.",
  usage: ",water <n>",
  async run({ message, args }) { return useSupply(message, args, "water"); },
};

const treat = {
  name: "treat",
  category: cat,
  description: "Use a Pet Treat on pet #N for instant XP.",
  usage: ",treat <n>",
  async run({ message, args }) {
    const parsed = parseInt(args[0] || "1", 10);
    const n = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    const p = db.getPetByIndex(message.author.id, n);
    if (!p) return message.reply({ embeds: [errEmbed(`No pet #${n}.`)] });
    if (db.getItem(message.author.id, "pet_treat") <= 0) return message.reply({ embeds: [errEmbed("You don't own any Pet Treats.")] });
    db.removeItem(message.author.id, "pet_treat", 1);
    let newXp = p.xp + 50;
    let newLevel = p.level;
    if (newXp >= p.level * 100) { newXp -= p.level * 100; newLevel++; }
    db.updatePet(p.id, { xp: newXp, level: newLevel });
    return message.reply({ embeds: [okEmbed(`**${p.name}** loved the treat! +50 XP${newLevel > p.level ? ` \u2014 leveled up to **${newLevel}**!` : ""}`, "Pet Treat")] });
  },
};

module.exports = { commands: [pets, pet, feed, water, treat] };
