"use strict";

require("dotenv").config();

module.exports = {
  TOKEN: process.env.DISCORD_TOKEN,
  PREFIX: process.env.PREFIX || ",",
  OWNER_IDS: (process.env.OWNER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean),

  // Visual
  COLORS: {
    primary: 0xf2c94c,
    success: 0x3ba55d,
    error: 0xed4245,
    info: 0x5865f2,
    warn: 0xfaa61a,
    money: 0xf1c40f,
  },

  EMOJI: {
    coin: "\uD83D\uDCB5", // 💵
    bank: "\uD83C\uDFE6",
    vault: "\uD83D\uDD12",
    pickaxe: "\u26CF\uFE0F",
    fish: "\uD83D\uDC1F",
    chicken: "\uD83D\uDC14",
    pet: "\uD83D\uDC3E",
    role: "\uD83C\uDFAD",
    diamond: "\uD83D\uDC8E",
  },

  // Chat earnings
  CHAT_EARN_MIN: 30,
  CHAT_EARN_MAX: 50,
  CHAT_COOLDOWN_MS: 60 * 1000, // 1 message earn per minute

  // Command cooldowns (ms)
  CD: {
    daily: 24 * 60 * 60 * 1000,
    work: 60 * 60 * 1000,
    crime: 4 * 60 * 60 * 1000,
    slut: 90 * 60 * 1000, // 1h 30m to match competitor
    coinflip: 10 * 1000, // ~0.166 min
    slots: 8 * 60 * 1000,
    blackjack: 4 * 60 * 1000,
    cockfight: 3 * 60 * 1000,
    rob: 30 * 60 * 1000,
    heist: 6 * 60 * 60 * 1000,
    rrolePing: 2 * 60 * 60 * 1000,
    digWooden: 5 * 60 * 1000,
    digIron: 3 * 60 * 1000,
    digGold: 2 * 60 * 1000,
    digDiamond: 0,
    digFree: 8 * 60 * 1000, // bare-hands dig (no tool) — longer than wooden
    fishBasic: 5 * 60 * 1000,
    fishLucky: 3 * 60 * 1000,
    fishDiamond: 0,
    fishFree: 8 * 60 * 1000, // hand-fishing (no rod) — longer than basic
  },

  // Caps / amounts
  DAILY_AMOUNT: 1500,
  BOOSTER_MULTIPLIER: 1.5,
  GIVE_TAX: 0.05,
  BET_FEE: 0.10,
  HIBERNATE_MAX_DAYS: 5,
  HIBERNATE_PRICE_PER_DAY: 50000,
  LBHIDE_PRICE_PER_DAY: 2000,
  LBHIDE_MAX_DAYS: 5,
};
