"use strict";

// Item registry for the bot.
// Each entry has:
//   id, code (6-char unique), name, emoji, price, sell, type, desc, rarity
// type: 'tool' | 'consumable' | 'boost' | 'box' | 'find' | 'lottery' | 'food' | 'water' | 'pet' | 'special'
// rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' (used for the colored dot in shop)

const RARITY_DOT = {
  common: "\u26AA",      // white circle
  uncommon: "\uD83D\uDFE2", // green
  rare: "\uD83D\uDD35",     // blue
  epic: "\uD83D\uDFE3",     // purple
  legendary: "\uD83D\uDFE1", // yellow
};

const ITEMS = {
  // ===== ITEMS SHOP — sorted by price =====
  wooden_shovel: { id: "wooden_shovel", code: "QMPW4W", name: "Wooden Shovel", emoji: "\uD83E\uDE93", price: 500, sell: 200,
    type: "tool", slot: "pickaxe", tier: 1, uses: 1, cdMs: 5 * 60 * 1000,
    rarity: "common", desc: "Dig finds. 5min CD. 1 use. Common finds." },

  basic_rod: { id: "basic_rod", code: "YBCDV0", name: "Basic Fishing Rod", emoji: "\uD83D\uDC1F", price: 500, sell: 200,
    type: "tool", slot: "rod", tier: 1, uses: 1, cdMs: 5 * 60 * 1000,
    rarity: "common", desc: "Go fishing. 5min CD. 1 use. Common fish." },

  lottery_ticket: { id: "lottery_ticket", code: "ZL0KLA", name: "Lottery Ticket", emoji: "\uD83C\uDFAB", price: 1000, sell: 100,
    type: "lottery", desc: "Weekly jackpot. More tickets = better odds!" },

  bank_note: { id: "bank_note", code: "ZWENL4", name: "Bank Note", emoji: "\uD83D\uDCB5", price: 1000, sell: 1000,
    type: "consumable", buyCdMs: 60 * 60 * 1000,
    desc: "Worth 1000 coins. Cash or sell. 1hr buy cooldown." },

  spiked_wallet: { id: "spiked_wallet", code: "EFOGGT", name: "Spiked Wallet", emoji: "\uD83C\uDF35", price: 1500, sell: 600,
    type: "boost", durationMs: 2 * 24 * 60 * 60 * 1000, stack: true,
    desc: "Each use = +2 days. Stack for more. Damages robbers." },

  iron_shovel: { id: "iron_shovel", code: "LMJFMF", name: "Iron Shovel", emoji: "\u26CF\uFE0F", price: 1500, sell: 600,
    type: "tool", slot: "pickaxe", tier: 2, uses: 35, cdMs: 3 * 60 * 1000,
    rarity: "rare", desc: "Better finds. 3min CD. Rare finds boosted." },

  lucky_rod: { id: "lucky_rod", code: "9SM3RS", name: "Lucky Fishing Rod", emoji: "\uD83C\uDFA3", price: 1500, sell: 600,
    type: "tool", slot: "rod", tier: 2, uses: 35, cdMs: 3 * 60 * 1000,
    rarity: "uncommon", desc: "+15% luck. 3min CD. Uncommon/rare fish boosted." },

  money_boost_1d: { id: "money_boost_1d", code: "LCMGZ8", name: "2x Money Boost (1d)", emoji: "\uD83D\uDCB0", price: 1500, sell: 500,
    type: "boost", durationMs: 24 * 60 * 60 * 1000,
    desc: "2x chat/daily for 24hrs." },

  rob_booster: { id: "rob_booster", code: "EXZ38K", name: "Rob Booster", emoji: "\u26A1", price: 1500, sell: 500,
    type: "consumable", stack: true, maxStack: 3,
    desc: "Stacks to 3x. Use with ,rob @user 2x." },

  wallet_lock: { id: "wallet_lock", code: "Q03FZ3", name: "Wallet Lock", emoji: "\uD83D\uDD12", price: 2000, sell: 700,
    type: "boost", durationMs: 2 * 24 * 60 * 60 * 1000, stack: true,
    desc: "Stack multiple. First = 2 days, each extra = +1 day." },

  heist_booster: { id: "heist_booster", code: "RTLZSN", name: "Heist Booster", emoji: "\uD83C\uDF11", price: 2000, sell: 700,
    type: "consumable", stack: true, maxStack: 3,
    desc: "Stacks to 3x. Use with ,heist @user 2x." },

  fighting_chicken: { id: "fighting_chicken", code: "ZU9VAK", name: "Fighting Chicken", emoji: "\uD83D\uDC14", price: 2000, sell: 700,
    type: "consumable",
    desc: "Enter ,cockfight. Consumed on loss." },

  luck_boost_1d: { id: "luck_boost_1d", code: "SKR9L0", name: "Luck Boost (1d)", emoji: "\uD83C\uDFB2", price: 2500, sell: 800,
    type: "boost", durationMs: 24 * 60 * 60 * 1000,
    desc: "Better odds for 24hrs." },

  mystery_box: { id: "mystery_box", code: "Q7XFGY", name: "Mystery Box", emoji: "\uD83D\uDCE6", price: 2500, sell: 1000,
    type: "box", boxRarity: "common",
    desc: "Common items \u2014 shovels, rods, pet supplies, boosts. Open with ,open. Coins are rare." },

  inv_robber_luck: { id: "inv_robber_luck", code: "BNA2C6", name: "Inv Robber Luck", emoji: "\uD83C\uDFAD", price: 2500, sell: 800,
    type: "boost", durationMs: 12 * 60 * 60 * 1000,
    desc: "Better luck stealing valuable items with ,rob inv." },

  vault_drill: { id: "vault_drill", code: "IT37RE", name: "Vault Drill", emoji: "\uD83D\uDD27", price: 2500, sell: 800,
    type: "consumable",
    desc: "Required for ,heist. One-time use." },

  diamond_rod: { id: "diamond_rod", code: "F45VRJ", name: "Diamond Fishing Rod", emoji: "\uD83D\uDC9A", price: 2800, sell: 1100,
    type: "tool", slot: "rod", tier: 4, uses: 100, cdMs: 0,
    rarity: "legendary", desc: "Best rod. No cooldown! Legendary fish." },

  guard: { id: "guard", code: "H7RIQJ", name: "Guard", emoji: "\uD83D\uDEE1\uFE0F", price: 3000, sell: 1000,
    type: "boost", durationMs: 2 * 24 * 60 * 60 * 1000, stack: true,
    desc: "Protects bank from heists. Stack for more days." },

  dig_luck_charm: { id: "dig_luck_charm", code: "3TLVX1", name: "Dig Luck Charm", emoji: "\uD83C\uDF40", price: 3000, sell: 1000,
    type: "boost", durationMs: 7 * 24 * 60 * 60 * 1000,
    desc: "Boosts rare dig finds for 7 days." },

  gold_pickaxe: { id: "gold_pickaxe", code: "58DE02", name: "Gold Pickaxe", emoji: "\uD83C\uDFCC\uFE0F", price: 3000, sell: 1100,
    type: "tool", slot: "pickaxe", tier: 3, uses: 60, cdMs: 2 * 60 * 1000,
    rarity: "epic", desc: "Rare/epic finds. 2min CD. Epic finds common." },

  diamond_pickaxe: { id: "diamond_pickaxe", code: "C2TKW5", name: "Diamond Pickaxe", emoji: "\uD83D\uDC8E", price: 3200, sell: 1200,
    type: "tool", slot: "pickaxe", tier: 4, uses: 100, cdMs: 0,
    rarity: "legendary", desc: "Best shovel. No cooldown! Legendary finds." },

  inv_protection: { id: "inv_protection", code: "W59E5V", name: "Inv Protection", emoji: "\uD83D\uDD12", price: 3500, sell: 1100,
    type: "boost", durationMs: 2 * 24 * 60 * 60 * 1000, stack: true,
    desc: "Protects inventory from ,rob inv. 2 days per use." },

  guard_with_gun: { id: "guard_with_gun", code: "W8168R", name: "Guard with Gun", emoji: "\uD83D\uDD2B", price: 4000, sell: 1300,
    type: "boost", durationMs: 2 * 24 * 60 * 60 * 1000, stack: true,
    desc: "Fires back at robbers. Stack for more days." },

  luck_boost_7d: { id: "luck_boost_7d", code: "8ZI2XQ", name: "Luck Boost 7 day", emoji: "\uD83C\uDF40", price: 5000, sell: 1500,
    type: "boost", durationMs: 7 * 24 * 60 * 60 * 1000,
    desc: "Better gambling/rob odds for 7 days." },

  rare_mystery_box: { id: "rare_mystery_box", code: "VAAKL3", name: "Rare Mystery Box", emoji: "\uD83C\uDF81", price: 6000, sell: 2200,
    type: "box", boxRarity: "rare",
    desc: "Better items \u2014 iron/gold tools, 7d boosts, vault drills. Open with ,open. Coins are rare." },

  money_boost_7d: { id: "money_boost_7d", code: "OUG2Y5", name: "2x Money Boost (7d)", emoji: "\uD83D\uDCB8", price: 6000, sell: 2000,
    type: "boost", durationMs: 7 * 24 * 60 * 60 * 1000,
    desc: "2x chat/daily for 7 days." },

  legendary_box: { id: "legendary_box", code: "T57ZM0", name: "Legendary Box", emoji: "\uD83D\uDFE1", price: 7000, sell: 2800,
    type: "box", boxRarity: "legendary",
    desc: "Best items \u2014 7d boosts, diamond tools, charms. Open with ,open. Coins are rare!" },

  // ===== Dig finds (sellable, not in shop) =====
  dirt: { id: "dirt", code: "DIRT01", name: "Dirt", emoji: "\uD83D\uDFEB", price: 0, sell: 5, type: "find", desc: "Worthless dirt." },
  pebble: { id: "pebble", code: "PEBL02", name: "Pebble", emoji: "\u26AB", price: 0, sell: 25, type: "find", desc: "A small rock." },
  copper_nugget: { id: "copper_nugget", code: "COPP03", name: "Copper Nugget", emoji: "\uD83D\uDFE0", price: 0, sell: 150, type: "find", desc: "Shiny copper." },
  iron_nugget: { id: "iron_nugget", code: "IRON04", name: "Iron Nugget", emoji: "\u26AA", price: 0, sell: 400, type: "find", desc: "Lump of iron." },
  gold_nugget: { id: "gold_nugget", code: "GOLD05", name: "Gold Nugget", emoji: "\uD83D\uDFE1", price: 0, sell: 1500, type: "find", desc: "Pure gold." },
  diamond: { id: "diamond", code: "DIAM06", name: "Diamond", emoji: "\uD83D\uDC8E", price: 0, sell: 8000, type: "find", desc: "Rare gem." },
  cursed_artifact: { id: "cursed_artifact", code: "CURS07", name: "Cursed Artifact", emoji: "\uD83D\uDC80", price: 0, sell: 0, type: "find", desc: "-40% luck, -30% earnings 24hrs. Pay the Wizard!" },

  // ===== Fish finds =====
  minnow: { id: "minnow", code: "MINN08", name: "Minnow", emoji: "\uD83D\uDC1F", price: 0, sell: 30, type: "find", desc: "Tiny fish." },
  bass: { id: "bass", code: "BASS09", name: "Bass", emoji: "\uD83D\uDC1F", price: 0, sell: 250, type: "find", desc: "A solid catch." },
  tuna: { id: "tuna", code: "TUNA10", name: "Tuna", emoji: "\uD83D\uDC1F", price: 0, sell: 800, type: "find", desc: "Big bluefin." },
  shark: { id: "shark", code: "SHRK11", name: "Shark", emoji: "\uD83E\uDD88", price: 0, sell: 3500, type: "find", desc: "Whoa!" },
  golden_fish: { id: "golden_fish", code: "GOLF12", name: "Golden Fish", emoji: "\uD83C\uDF1F", price: 0, sell: 12000, type: "find", desc: "Legendary catch." },
  old_boot: { id: "old_boot", code: "BOOT13", name: "Old Boot", emoji: "\uD83D\uDC62", price: 0, sell: 5, type: "find", desc: "Why is this here?" },
};

// ===== PET TYPES (adoption — rolled rarity, can starve/dehydrate) =====
// All pet entries: rarity rolled on buy (common 70% / rare 25% / legendary 5%).
// Earnings from ,pet @<name> interaction. Keep fed & watered or hunger/thirst -> 0 = pet dies.
const PET_TYPES = {
  pet_rock: { id: "pet_rock", code: "8HEK0V", name: "Pet Rock", emoji: "\uD83E\uDEA8", price: 1500, type: "pet",
    earn: [50, 100], cdMs: 2 * 60 * 60 * 1000,
    desc: "Rarity rolled on buy! Earns 50-100/interaction. 2hr CD. Keep fed & watered or it dies!" },

  pet_hamster: { id: "pet_hamster", code: "H1LUVG", name: "Pet Hamster", emoji: "\uD83D\uDC39", price: 3500, type: "pet",
    earn: [80, 160], cdMs: 60 * 60 * 1000, autoIncome: true, autoHourly: [100, 250],
    desc: "Rarity rolled on buy! Auto earns 100-250/hr! Also ,pet for XP. Keep fed & watered or it dies!" },

  pet_cat: { id: "pet_cat", code: "B1B966", name: "Pet Cat", emoji: "\uD83D\uDC31", price: 6000, type: "pet",
    earn: [150, 300], cdMs: 60 * 60 * 1000,
    desc: "Rarity rolled on buy! Earns 150-300/interaction. 1hr CD. Keep fed & watered or it dies!" },

  pet_dog: { id: "pet_dog", code: "36MIZ7", name: "Pet Dog", emoji: "\uD83D\uDC36", price: 6000, type: "pet",
    earn: [150, 300], cdMs: 60 * 60 * 1000,
    desc: "Rarity rolled on buy! Earns 150-300/interaction. 1hr CD. Keep fed & watered or it dies!" },

  pet_parrot: { id: "pet_parrot", code: "6WMIWM", name: "Pet Parrot", emoji: "\uD83E\uDD9C", price: 10000, type: "pet",
    earn: [250, 500], cdMs: 90 * 60 * 1000,
    desc: "Rarity rolled on buy! Earns 250-500/interaction. 1.5hr CD. Keep fed & watered or it dies!" },

  pet_lucky_rabbit: { id: "pet_lucky_rabbit", code: "31ZC7A", name: "Pet Lucky Rabbit", emoji: "\uD83D\uDC07", price: 16000, type: "pet",
    earn: [200, 400], cdMs: 60 * 60 * 1000, digLuckBoost: true,
    desc: "Rarity rolled on buy! Earns 200-400/interaction + dig luck! 1hr CD. Keep fed & watered or it dies!" },

  pet_dragon: { id: "pet_dragon", code: "31EK50", name: "Pet Dragon", emoji: "\uD83D\uDC09", price: 35000, type: "pet",
    earn: [700, 1400], cdMs: 3 * 60 * 60 * 1000,
    desc: "Rarity rolled on buy! Earns 700-1400/interaction. 3hr CD. Keep fed & watered or it dies!" },
};

// ===== PET SUPPLIES (sold in pet shop, sorted by price) =====
// Includes: consumables (food/water/treats), 7-day boosts, and PERMANENT upgrades that
// modify the user's pet stats (saved in user_pet_perks JSON column).
const PET_SUPPLIES = {
  // ---- Consumables ----
  water_bowl: { id: "water_bowl", code: "JWW4N1", name: "Water Bowl", emoji: "\uD83D\uDCA7", price: 200, sell: 50,
    type: "water", restore: 50,
    desc: "Restores 50 thirst. A thirsty pet earns 50% less \u2014 keep this stocked!" },

  basic_pet_food: { id: "basic_pet_food", code: "9B03XN", name: "Basic pet food", emoji: "\uD83C\uDF56", price: 300, sell: 80,
    type: "food", restore: 50,
    desc: "Restores 50 hunger. 300 coins \u2014 your pet earns this back in one interaction!" },

  premium_water: { id: "premium_water", code: "RW36CF", name: "Premium Water", emoji: "\uD83E\uDDCA", price: 500, sell: 150,
    type: "water", restore: 100,
    desc: "Fully restores thirst." },

  pet_treat: { id: "pet_treat", code: "2CMBJZ", name: "Pet treat", emoji: "\uD83E\uDDB4", price: 500, sell: 150,
    // type is "treat" (NOT "food") so `,feed` won't auto-pick it as the
    // best food option \u2014 that would let one treat give hunger restore +50 XP
    // simultaneously, making `,treat` strictly worse. Use `,treat` for these.
    type: "treat", xpBonus: 50,
    desc: "+50 XP instantly to your chosen pet. Use `,treat <pet#>`." },

  premium_pet_food: { id: "premium_pet_food", code: "HWK1Y5", name: "Premium Pet Food", emoji: "\uD83E\uDD69", price: 750, sell: 250,
    type: "food", restore: 100, xpBonus: 10,
    desc: "Fully restores hunger + 10 XP bonus." },

  // ---- Boosts (7d) ----
  pet_xp_boost: { id: "pet_xp_boost", code: "EMES8R", name: "Pet XP Boost", emoji: "\u2B50", price: 2000, sell: 600,
    type: "boost", durationMs: 7 * 24 * 60 * 60 * 1000,
    desc: "2x XP from pet interactions for 7 days." },

  pet_luck_charm: { id: "pet_luck_charm", code: "BI2TI0", name: "Pet Luck Charm", emoji: "\u2728", price: 10000, sell: 3000,
    type: "boost", durationMs: 7 * 24 * 60 * 60 * 1000, exclusive: true,
    desc: "1.5x pet payouts for 7 days. Only 1 active at a time." },

  // ---- Permanent upgrades (one-time, saved on user) ----
  feed_timer_upgrade: { id: "feed_timer_upgrade", code: "GVV0LG", name: "Feed Timer Upgrade", emoji: "\u23F2\uFE0F", price: 2500, sell: 0,
    type: "perk", perk: "feedTimer", once: true,
    desc: "Pet stays full 12hrs longer. Permanent \u2014 buy once, saves money long-term." },

  water_timer_upgrade: { id: "water_timer_upgrade", code: "QUEXU4", name: "Water Timer Upgrade", emoji: "\u23F0", price: 2500, sell: 0,
    type: "perk", perk: "waterTimer", once: true,
    desc: "Pet stays hydrated 12hrs longer. Permanent." },

  pet_luck_upgrade: { id: "pet_luck_upgrade", code: "5GN5N6", name: "Pet Luck Upgrade", emoji: "\uD83C\uDF40", price: 3500, sell: 0,
    type: "perk", perk: "petLuck", once: true,
    desc: "+10% bonus payout chance per interaction. Permanent." },

  strength_upgrade: { id: "strength_upgrade", code: "M82CQX", name: "Strength Upgrade", emoji: "\uD83D\uDCAA", price: 5000, sell: 0,
    type: "perk", perk: "strength", once: true,
    desc: "+20% coins per interaction. Permanent \u2014 pays itself off within days." },
};

// ===== Shop categories — used by the UI =====
const SHOP_CATEGORIES = {
  items: {
    label: "Items",
    title: "Items Shop",
    emoji: "\uD83D\uDED2",
    description: "Tools, boosters & more",
    color: 0xF7C04A,
  },
  roles: {
    label: "Roles",
    title: "Roles Shop",
    emoji: "\uD83C\uDFAD",
    description: "Server roles",
    color: 0x9B59B6,
  },
  colors: {
    label: "Colors",
    title: "Colors Shop",
    emoji: "\uD83C\uDFA8",
    description: "Color roles",
    color: 0xE91E63,
  },
  pets: {
    label: "Pet Shop",
    title: "Pets Shop",
    emoji: "\uD83D\uDC3E",
    description: "Pet shop",
    color: 0x2ECC71,
  },
};

// ===== Helpers =====

function getItem(id) {
  return ITEMS[id] || PET_TYPES[id] || PET_SUPPLIES[id] || null;
}

function getItemByCode(code) {
  if (!code) return null;
  const c = code.toUpperCase();
  for (const reg of [ITEMS, PET_TYPES, PET_SUPPLIES]) {
    for (const id of Object.keys(reg)) {
      if (reg[id].code === c) return reg[id];
    }
  }
  return null;
}

function findItemByName(query) {
  if (!query) return null;
  const q = query.toLowerCase().replace(/[_\s-]+/g, "");
  // First: code match
  const byCode = getItemByCode(query);
  if (byCode) return byCode;
  // Then: id/name exact
  for (const reg of [ITEMS, PET_TYPES, PET_SUPPLIES]) {
    for (const id of Object.keys(reg)) {
      if (id.replace(/_/g, "") === q) return reg[id];
      if (reg[id].name.toLowerCase().replace(/[_\s-]+/g, "") === q) return reg[id];
    }
  }
  // Then: partial
  for (const reg of [ITEMS, PET_TYPES, PET_SUPPLIES]) {
    for (const id of Object.keys(reg)) {
      if (id.includes(q) || reg[id].name.toLowerCase().includes(query.toLowerCase())) return reg[id];
    }
  }
  return null;
}

// Returns the static shop entries for a given category (items, pets only).
// Roles and colors are guild-specific, pulled from DB.
function getStaticShopEntries(category) {
  const entries = [];
  if (category === "items") {
    for (const it of Object.values(ITEMS)) {
      if (it.type === "find") continue; // not buyable
      if (it.price <= 0) continue;
      entries.push({
        code: it.code,
        category: "items",
        item_id: it.id,
        name: it.name,
        emoji: it.emoji,
        price: it.price,
        description: it.desc,
        rarity: it.rarity || null,
        stock: -1,
      });
    }
  } else if (category === "pets") {
    for (const p of Object.values(PET_TYPES)) {
      entries.push({
        code: p.code,
        category: "pets",
        pet_id: p.id,
        name: p.name,
        emoji: p.emoji,
        price: p.price,
        description: p.desc,
        rarity: null,
        stock: -1,
      });
    }
    for (const s of Object.values(PET_SUPPLIES)) {
      entries.push({
        code: s.code,
        category: "pets",
        item_id: s.id,
        name: s.name,
        emoji: s.emoji,
        price: s.price,
        description: s.desc,
        rarity: null,
        stock: -1,
      });
    }
  }
  // Sort by price ascending
  entries.sort((a, b) => a.price - b.price);
  return entries;
}

const PET_RARITY_MULT = { common: 1.0, rare: 1.15, legendary: 1.30 };

module.exports = {
  ITEMS,
  PET_TYPES,
  PET_SUPPLIES,
  PET_RARITY_MULT,
  RARITY_DOT,
  SHOP_CATEGORIES,
  getItem,
  getItemByCode,
  findItemByName,
  getStaticShopEntries,
};
