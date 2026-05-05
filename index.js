"use strict";

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
} = require("discord.js");
const { TOKEN, PREFIX, CHAT_EARN_MIN, CHAT_EARN_MAX, CHAT_COOLDOWN_MS } = require("./src/config");
const handler = require("./src/handler");
const db = require("./src/db");
const { rand, errEmbed, okEmbed, coin, moneyEmbed } = require("./src/utils");
const { ITEMS, PET_TYPES, PET_SUPPLIES, PET_RARITY_MULT } = require("./src/items");
const shopCmd = require("./src/commands/shop");

if (!TOKEN) {
  console.error("[bot] DISCORD_TOKEN is missing. Set it in .env (copy .env.example to .env).");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember],
});

handler.loadAll();
console.log(`[bot] Loaded ${handler.commands.size} command names across ${handler.listByCategory().size} categories.`);

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] Logged in as ${c.user.tag}. Prefix: ${PREFIX}`);
  c.user.setActivity(`${PREFIX}currency for help`, { type: 3 });

  // One-time backfill: scan every guild member for shop roles they're already
  // wearing (from before the persistent-ownership system existed) and insert
  // an `owned_shop_roles` row with equipped=1. Without this, members who
  // bought roles on the old codebase can't `,unequip` / `,equip` / see their
  // roles in `,myroles` — and worse, they could be charged again if they hit
  // `,buy <code>` since the duplicate-block only triggers when an ownership
  // row exists. Idempotent: ON CONFLICT updates equipped=1, so re-running
  // does not corrupt anything.
  backfillOwnedShopRoles(c).catch((e) => console.error("[migrate] failed:", e));

  // Auto pet income job
  setInterval(() => runPetIncome(), 60 * 1000);
  // Robber-spawn loop: every 5 minutes check each guild
  setInterval(() => tickRobbers(c), 5 * 60 * 1000);
  // First check 2 minutes after boot so the bot has time to settle
  setTimeout(() => tickRobbers(c), 2 * 60 * 1000);
  // Bill collector: passive money sink, runs every 10 minutes
  setInterval(() => runBillCollector(c), 10 * 60 * 1000);
  setTimeout(() => runBillCollector(c), 5 * 60 * 1000);
});

// ----- One-time migration: backfill ownership rows for already-worn roles -----
// Runs every boot but is fully idempotent. We only INSERT for members who are
// currently wearing a shop role and DON'T already have an ownership row,
// so an admin won't accidentally regrant ownership to someone who already
// unequipped post-migration. Total work is O(members × shop_roles_per_guild)
// which is fine for the realistic server sizes this bot targets.
async function backfillOwnedShopRoles(c) {
  let inserted = 0;
  for (const [guildId, guild] of c.guilds.cache) {
    // Build a set of all (role_id -> {code, category}) for this guild's shop
    // entries that have a Discord role attached. Both "roles" and "colors"
    // categories use role_id; everything else (items, pets, find-items) does
    // not have a role and is irrelevant here.
    const shopRoleMap = new Map();
    for (const cat of ["roles", "colors"]) {
      const entries = db.listShopEntries(guildId, cat);
      for (const e of entries) {
        if (e.role_id) shopRoleMap.set(e.role_id, { code: e.code, category: cat });
      }
    }
    if (shopRoleMap.size === 0) continue;

    // Force-fetch members so role caches are populated. fetch() can throw on
    // huge guilds without the GuildMembers intent — wrap defensively so a
    // single bad guild can't block migration for the rest.
    let members;
    try {
      members = await guild.members.fetch();
    } catch (e) {
      console.warn(`[migrate] could not fetch members for ${guild.name} (${guildId}): ${e.message}`);
      continue;
    }

    for (const [, member] of members) {
      if (member.user.bot) continue;
      for (const [roleId, info] of shopRoleMap) {
        if (!member.roles.cache.has(roleId)) continue;
        const existing = db.getOwnedShopRole(member.id, guildId, info.code);
        if (existing) continue; // already tracked, leave alone
        db.addOwnedShopRole(member.id, guildId, info.code, roleId, info.category);
        inserted++;
      }
    }
  }
  if (inserted > 0) {
    console.log(`[migrate] Backfilled ${inserted} owned-shop-role row(s) from existing members.`);
  }
}

const chatCooldowns = new Map();

// ===== Robber event state =====
// lastActiveChannel: guildId -> { channelId, ts } updated on every non-bot guild message
// activeRobbers: messageId -> { guildId, channelId, perClaim, totalClaims, claimsLeft, claimedBy:Set, results:[{userId,amount}], expiresAt, timeout }
// nextRobberAt: guildId -> timestamp at which a new spawn becomes eligible
const lastActiveChannel = new Map();
const activeRobbers = new Map();
const nextRobberAt = new Map();
const ROBBER_MIN_INTERVAL_MS = 30 * 60 * 1000;  // earliest re-spawn 30 min
const ROBBER_MAX_INTERVAL_MS = 90 * 60 * 1000;  // latest re-spawn 90 min
const ROBBER_DURATION_MS = 5 * 60 * 1000;       // 5 min window to claim
const ROBBER_ACTIVITY_WINDOW_MS = 60 * 60 * 1000; // channel must've been active in past hour

// ===== Bill collector state =====
// lastActiveUsers: userId -> { ts, channelId, guildId } updated on every non-bot message.
// Only users active in the last 24h are eligible for bills (so inactive accounts don't drain).
// nextBillAt: userId -> timestamp; per-user cooldown so nobody gets billed twice in quick succession.
const lastActiveUsers = new Map();
const nextBillAt = new Map();
const BILL_USER_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4h between bills per user
const BILL_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000; // user must've messaged in last 24h
const BILL_AMOUNT = 25; // flat fee — always exactly 25 coins, matches competitor bot
const BILL_MIN_WALLET = 25; // skip if user can't afford the flat fee
const BILL_TICK_CHANCE = 0.18; // ~18% chance per eligible user per 10-min tick

client.on(Events.MessageCreate, async (message) => {
  try {
    if (!message || message.author?.bot) return;

    // Per-guild bot-channel lock. If admins have configured an allow-list,
    // every bot interaction (chat-to-earn AND commands) is gated to those
    // channels. Admins always bypass the lock so they can never get stuck
    // unable to run `,setchannel` from a non-allowed channel.
    let channelAllowed = true;
    if (message.guild) {
      channelAllowed = db.isCommandChannelAllowed(message.guild.id, message.channel.id);
    }

    // Track last active channel per guild for robber spawns (only inside
    // allowed channels — otherwise robbers would spawn in random rooms).
    if (message.guild && channelAllowed) {
      lastActiveChannel.set(message.guild.id, {
        channelId: message.channel.id,
        ts: Date.now(),
      });
      // Track active user for bill collector eligibility
      lastActiveUsers.set(message.author.id, {
        ts: Date.now(),
        channelId: message.channel.id,
        guildId: message.guild.id,
      });
    }

    // Chat-to-earn AND messages-quest tracking (guild messages only, not
    // commands, only in allowed channels). The "Send 25 messages" quest is
    // counted on EVERY non-command message (independent of the 60s coin
    // cooldown) so a normal conversation reaches 25 in reasonable time.
    if (channelAllowed && message.guild && !message.content.startsWith(PREFIX)) {
      const completedQuests = db.incQuestProgress(message.author.id, "messages", 1);
      if (completedQuests.length) {
        for (const q of completedQuests) {
          message.channel.send({ embeds: [moneyEmbed(
            `Quest Complete: **${q.name}** \u2014 +${coin(q.reward)} credited to wallet!`,
            "Daily Quest",
          )] }).catch(() => {});
        }
      }
      const last = chatCooldowns.get(message.author.id) || 0;
      if (Date.now() - last >= CHAT_COOLDOWN_MS) {
        chatCooldowns.set(message.author.id, Date.now());
        let earn = rand(CHAT_EARN_MIN, CHAT_EARN_MAX);
        // money boost
        if (db.hasActiveBoost(message.author.id, "money_boost")) earn = Math.floor(earn * 2.0);
        const u = db.getUser(message.author.id);
        if (u.booster) earn = Math.floor(earn * 1.5);
        db.addWallet(message.author.id, earn);
        // XP
        const xpGain = rand(8, 15);
        const newXp = u.xp + xpGain;
        const need = u.level * 250;
        if (newXp >= need) {
          db.setUserField(message.author.id, "xp", newXp - need);
          db.setUserField(message.author.id, "level", u.level + 1);
          if (u.notifications) {
            message.channel.send({ content: `<@${message.author.id}> leveled up to **${u.level + 1}**!` }).catch(() => {});
          }
        } else {
          db.setUserField(message.author.id, "xp", newXp);
        }
      }
    }

    if (!message.content.startsWith(PREFIX)) return;
    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const name = args.shift()?.toLowerCase();
    if (!name) return;
    const cmd = handler.get(name);
    if (!cmd) return;

    // Channel-lock enforcement: silently ignore commands in non-allowed
    // channels. The lock applies to EVERYONE including admins/staff so the
    // server stays clean — only the `,setchannel` management commands
    // themselves bypass, so an admin can always fix a bad config (or run
    // `,setchannel clear`) from any channel without being locked out.
    const channelLockBypass =
      name === "setchannel" ||
      name === "botchannel" ||
      name === "channellock" ||
      name === "channel";
    if (!channelAllowed && !channelLockBypass) return;

    // Hibernate doesn't block self-commands; nothing else to enforce here.
    await cmd.run({ message, args, client, db, prefix: PREFIX });
  } catch (e) {
    console.error("[cmd error]", e);
    message.reply({ embeds: [errEmbed(`Something went wrong: \`${e.message}\``)] }).catch(() => {});
  }
});

// MessageFlags.Ephemeral is the bit-flag (1 << 6 = 64) that makes an
// interaction reply visible only to the user who triggered it. NOTE:
// 4096 is SuppressNotifications, NOT ephemeral — earlier code in this
// file accidentally used 4096 thinking it was ephemeral, which made
// "private" confirm prompts actually public. Use this constant going
// forward for any interaction.reply that should be private.
const EPHEMERAL = 64;

// ===== Button interactions (shop) =====
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isButton()) return;
    const id = interaction.customId || "";

    // Shop open-mode chooser: shopopen:<public|private>:<userId>
    // Owner-locked so randoms can't pick for the runner. "Server View" replaces
    // the chooser with a public landing in the same message; "My Eyes Only"
    // replaces the chooser with a confirmation note and sends the landing as
    // a true ephemeral follow-up visible only to the runner.
    if (id.startsWith("shopopen:")) {
      const [, mode, ownerId] = id.split(":");
      if (interaction.user.id !== ownerId) {
        return interaction.reply({
          embeds: [errEmbed("This shop prompt isn't yours. Run `,shop` yourself.")],
          flags: [EPHEMERAL],
        }).catch(() => {});
      }
      if (mode === "public") {
        return interaction.update(shopCmd.buildShopLanding()).catch(() => {});
      }
      if (mode === "private") {
        // Replace the chooser with a tiny "opened privately" note so the
        // public message doesn't keep dangling buttons, then ephemerally
        // follow up with the actual shop landing for ONLY the runner.
        await interaction.update({
          embeds: [{ description: "Opened the shop privately. Check the ephemeral message below.", color: 0x5865F2 }],
          components: [],
        }).catch(() => {});
        return interaction.followUp({
          ...shopCmd.buildShopLanding(),
          flags: [EPHEMERAL],
        }).catch(() => {});
      }
      return;
    }

    // Shop navigation: shop:landing | shop:<cat>:<page> | shop:noop
    if (id.startsWith("shop:")) {
      if (id === "shop:noop") {
        return interaction.deferUpdate().catch(() => {});
      }
      if (id === "shop:landing") {
        return interaction.update(shopCmd.buildShopLanding()).catch(() => {});
      }
      const [, category, pageStr] = id.split(":");
      const page = parseInt(pageStr, 10) || 0;
      const result = shopCmd.buildShopPage(interaction.guildId, category, page);
      if (result.error) {
        return interaction.reply({ embeds: [errEmbed(result.error)], flags: [EPHEMERAL] }).catch(() => {});
      }
      return interaction.update(result).catch(() => {});
    }

    // Robber claim: robber:claim:<messageId>
    if (id.startsWith("robber:claim:")) {
      return handleRobberClaim(interaction, id.slice("robber:claim:".length));
    }

    // Quick-buy: buy:<code> -> show confirm dialog (does NOT purchase yet)
    if (id.startsWith("buy:")) {
      const code = id.slice(4).toUpperCase();
      const payload = shopCmd.buildBuyConfirm(interaction.user.id, code, 1);
      if (payload.error) {
        return interaction.reply({ embeds: [errEmbed(payload.error)], flags: [EPHEMERAL] }).catch(() => {});
      }
      // Ephemeral so the confirm prompt is private to the user who pressed it.
      return interaction.reply({ ...payload, flags: [EPHEMERAL] }).catch(() => {});
    }

    // Confirm purchase: buyconfirm:<userId>:<code>:<qty>
    // The userId is embedded so only the original buyer can confirm; anyone
    // else gets an ephemeral "not yours" message and the purchase is blocked.
    if (id.startsWith("buyconfirm:")) {
      const [, ownerId, code, qtyStr] = id.split(":");
      if (interaction.user.id !== ownerId) {
        return interaction.reply({
          embeds: [errEmbed("This purchase isn't yours. Run `,buy` yourself.")],
          flags: [EPHEMERAL],
        }).catch(() => {});
      }
      const qty = Math.max(1, parseInt(qtyStr, 10) || 1);
      const upperCode = code.toUpperCase();
      const shopEntry = db.getShopEntryByCode(upperCode);
      const { getItemByCode } = require("./src/items");
      const staticItem = shopEntry ? null : getItemByCode(upperCode);
      if (!shopEntry && !staticItem) {
        return interaction.reply({ embeds: [errEmbed("Item not found.")], flags: [EPHEMERAL] }).catch(() => {});
      }
      await interaction.deferUpdate().catch(() => {});
      const result = await runBuy(interaction, shopEntry, staticItem, qty);
      // Edit the confirm message with the result and remove the buttons
      return interaction.editReply({ ...result, components: [] }).catch(() => {});
    }

    // Cancel purchase: buycancel:<userId> — same ownership rule.
    if (id.startsWith("buycancel:")) {
      const [, ownerId] = id.split(":");
      if (interaction.user.id !== ownerId) {
        return interaction.reply({
          embeds: [errEmbed("This purchase isn't yours.")],
          flags: [EPHEMERAL],
        }).catch(() => {});
      }
      await interaction.deferUpdate().catch(() => {});
      return interaction.editReply({
        embeds: [errEmbed("Purchase cancelled.")],
        components: [],
      }).catch(() => {});
    }
  } catch (e) {
    console.error("[interaction]", e);
    if (!interaction.replied && !interaction.deferred) {
      interaction.reply({ embeds: [errEmbed(`Error: \`${e.message}\``)], flags: [EPHEMERAL] }).catch(() => {});
    }
  }
});

// Inline buy helper for button interactions. Returns { embeds: [...] }.
async function runBuy(interaction, shopEntry, staticItem, qty = 1) {
  const userId = interaction.user.id;
  const item = staticItem;
  const entry = shopEntry;

  // Defense-in-depth: reject any static item that isn't shop-listed.
  // The buildBuyConfirm gate already rejects find/price=0 items, but this
  // is the function that actually credits the inventory, so it MUST also
  // refuse to mint find-type items (dirt, diamond, gold_nugget, etc.) or
  // any zero-priced item. Without this check, a user who somehow got past
  // buildBuyConfirm (custom button, race) could run runBuy on `diamond`
  // with price=0 and walk away with free diamonds to sell for 8000 each.
  if (item && (item.type === "find" || (item.price || 0) <= 0)) {
    return { embeds: [errEmbed("That item isn't sold in the shop.")] };
  }

  if (entry) {
    const each = db.inflatedPrice(entry.price);
    const total = each * qty;
    if (entry.stock >= 0 && entry.stock < qty) {
      return { embeds: [errEmbed(`Only ${entry.stock} left in stock.`)] };
    }
    const u = db.getUser(userId);
    if (u.wallet < total) return { embeds: [errEmbed(`You need ${coin(total)} but only have ${coin(u.wallet)}.`)] };
    db.addWallet(userId, -total);

    if (entry.stock >= 0) {
      for (let i = 0; i < qty; i++) {
        const ok = db.decrementShopStock(entry.code);
        if (!ok) {
          const refund = each * (qty - i);
          db.addWallet(userId, refund);
          return { embeds: [errEmbed(`Stock ran out. Refunded ${coin(refund)}.`)] };
        }
      }
    }

    if (entry.role_id && interaction.guild) {
      // Helper to also restore stock when role/member fetch fails. Without
      // this, a limited-stock role whose Discord role got deleted would
      // refund coins but leave the stock counter decremented — a silent
      // stock leak that eventually sells out a role nobody ever received.
      const refundAll = (reason) => {
        db.addWallet(userId, total);
        if (entry.stock >= 0) {
          const cur = db.getShopEntryByCode(entry.code);
          if (cur) db.updateShopEntry(entry.code, { stock: (cur.stock ?? 0) + qty });
        }
        return { embeds: [errEmbed(reason)] };
      };
      const role = await interaction.guild.roles.fetch(entry.role_id).catch(() => null);
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!role || !member) {
        return refundAll("Could not assign role (it may have been deleted).");
      }
      if (entry.category === "colors") {
        const colorRoles = db.listShopEntries(interaction.guild.id, "colors").map((e) => e.role_id).filter(Boolean);
        const toRemove = member.roles.cache.filter((r) => colorRoles.includes(r.id));
        for (const r of toRemove.values()) {
          await member.roles.remove(r).catch(() => {});
        }
      }
      await member.roles.add(role).catch(() => {});
      return { embeds: [okEmbed(`You purchased **${entry.name}** for ${coin(total)}!`, "Role Added")] };
    }
    return { embeds: [okEmbed(`Bought **${qty}× ${entry.name}** for ${coin(total)}.`)] };
  }

  // static item path
  const each = db.inflatedPrice(item.price || 0);
  const total = each * qty;
  const u = db.getUser(userId);
  if (u.wallet < total) return { embeds: [errEmbed(`You need ${coin(total)} but only have ${coin(u.wallet)}.`)] };

  const isPet = !!PET_TYPES[item.id];
  db.addWallet(userId, -total);

  if (isPet) {
    const pets = db.listPets(userId);
    if (pets.find((p) => p.pet_type === item.id)) {
      db.addWallet(userId, total);
      return { embeds: [errEmbed(`You already own a ${item.name}. (1 per type)`)] };
    }
    const rarities = ["common", "common", "common", "common", "common", "common", "common", "rare", "rare", "rare", "legendary"];
    const rarity = rarities[Math.floor(Math.random() * rarities.length)];
    db.addPet(userId, item.id, rarity);
    return { embeds: [okEmbed(`You adopted a **${rarity}** ${item.name} ${item.emoji || ""}!`, "New Pet")] };
  }

  if (item.type === "perk" && item.once) {
    if (db.hasPerk(userId, item.perk)) {
      db.addWallet(userId, total);
      return { embeds: [errEmbed(`You already own **${item.name}** \u2014 it's permanent.`)] };
    }
    db.setPerk(userId, item.perk, true);
    return { embeds: [okEmbed(`Permanent upgrade unlocked: **${item.name}** ${item.emoji || ""}`, "Pet Upgrade")] };
  }

  if (item.type === "boost") {
    const durationMs = item.durationMs || 60 * 60 * 1000;
    // Exclusive boosts (e.g. pet_luck_charm) overwrite any existing entry of the same id.
    db.setActive(userId, item.id, Date.now() + durationMs, null);
    return { embeds: [okEmbed(`Bought & activated **${qty}\u00D7 ${item.name}** for ${coin(total)}.`)] };
  }

  // Pet food/water/treats \u2014 plain inventory items used via ,feed / ,water / ,treat.
  if (item.type === "food" || item.type === "water") {
    db.addItem(userId, item.id, qty);
    return { embeds: [okEmbed(`Bought **${qty}\u00D7 ${item.name}** ${item.emoji || ""} for ${coin(total)}. Use with \`,feed <pet#>\` or \`,water <pet#>\`.`)] };
  }

  if (item.id === "lottery_ticket" && interaction.guild) {
    const lot = db.getLottery(interaction.guild.id);
    const entries = JSON.parse(lot.entries || "[]");
    for (let i = 0; i < qty; i++) entries.push(userId);
    db.updateLottery(interaction.guild.id, { entries: JSON.stringify(entries), jackpot: lot.jackpot + Math.floor(total * 0.5) });
    return { embeds: [okEmbed(`Bought **${qty}× Lottery Ticket** and auto-entered.`)] };
  }

  db.addItem(userId, item.id, qty);
  return { embeds: [okEmbed(`Bought **${qty}× ${item.name}** for ${coin(total)}.`)] };
}

// ===== Robber event =====
//
// Periodic loop: every 5 min, for each guild whose nextRobberAt has passed,
// try to spawn a robber drop in that guild's most-recently-active text channel.
// The bot needs Send Messages + Embed Links permission in that channel.
async function tickRobbers(client) {
  try {
    for (const [guildId, info] of lastActiveChannel.entries()) {
      const next = nextRobberAt.get(guildId) || 0;
      if (Date.now() < next) continue;
      // Channel must've been active recently
      if (Date.now() - info.ts > ROBBER_ACTIVITY_WINDOW_MS) {
        // Try again in 30 minutes
        nextRobberAt.set(guildId, Date.now() + ROBBER_MIN_INTERVAL_MS);
        continue;
      }
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      const channel = guild.channels.cache.get(info.channelId);
      if (!channel || !channel.isTextBased()) continue;
      const me = guild.members.me;
      if (!me) continue;
      const perms = channel.permissionsFor(me);
      if (!perms?.has(PermissionsBitField.Flags.SendMessages) || !perms?.has(PermissionsBitField.Flags.EmbedLinks)) continue;
      await spawnRobber(channel).catch((e) => console.error("[robber spawn]", e));
      // Schedule next attempt 30-90 min away
      const delta = ROBBER_MIN_INTERVAL_MS + Math.floor(Math.random() * (ROBBER_MAX_INTERVAL_MS - ROBBER_MIN_INTERVAL_MS));
      nextRobberAt.set(guildId, Date.now() + delta);
    }
  } catch (e) {
    console.error("[robber tick]", e);
  }
}

async function spawnRobber(channel) {
  // Single-winner event: the FIRST person to press the button gets the
  // entire pot. No splitting, no second-place. Pot is bigger than the old
  // multi-claim version since only one person wins.
  const pot = rand(3500, 15000);
  const expiresAt = Date.now() + ROBBER_DURATION_MS;

  const embed = new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle("\uD83E\uDD79 A robber broke out!")
    .setDescription([
      `Quick \u2014 the **first** person to press **Stop Them!** grabs the loot!`,
      `Reward: ${coin(pot)}`,
      ``,
      `_Expires <t:${Math.floor(expiresAt / 1000)}:R>_`,
    ].join("\n"));

  const button = new ButtonBuilder()
    .setCustomId(`robber:claim:pending`) // will be updated after we know msg.id
    .setLabel("Stop Them!")
    .setStyle(ButtonStyle.Danger)
    .setEmoji("\uD83D\uDE93");
  const row = new ActionRowBuilder().addComponents(button);

  const msg = await channel.send({ embeds: [embed], components: [row] });

  // Update the button with the actual message id so the handler can look up state
  const finalButton = ButtonBuilder.from(button).setCustomId(`robber:claim:${msg.id}`);
  await msg.edit({ components: [new ActionRowBuilder().addComponents(finalButton)] }).catch(() => {});

  const state = {
    guildId: channel.guild.id,
    channelId: channel.id,
    pot,
    winner: null, // userId of the first claimer; locks the event when set
    expiresAt,
  };
  state.timeout = setTimeout(() => finalizeRobber(msg.id, "expired").catch(() => {}), ROBBER_DURATION_MS + 1000);
  activeRobbers.set(msg.id, state);
}

async function handleRobberClaim(interaction, messageId) {
  const state = activeRobbers.get(messageId);
  if (!state) {
    return interaction.reply({
      embeds: [errEmbed("This robber already got away or was already stopped.")],
      flags: [EPHEMERAL],
    }).catch(() => {});
  }
  // Already won — anyone clicking after the first winner gets a polite reject.
  if (state.winner) {
    return interaction.reply({
      embeds: [errEmbed(`Too slow \u2014 <@${state.winner}> already stopped them!`)],
      flags: [EPHEMERAL],
    }).catch(() => {});
  }
  if (Date.now() >= state.expiresAt) {
    return interaction.reply({
      embeds: [errEmbed("Too late \u2014 the robber escaped.")],
      flags: [EPHEMERAL],
    }).catch(() => {});
  }

  // First click wins everything. Lock the state immediately so concurrent
  // clicks during the same tick can't double-claim.
  state.winner = interaction.user.id;
  if (state.timeout) clearTimeout(state.timeout);
  db.addWallet(interaction.user.id, state.pot);

  return finalizeRobber(messageId, "won", interaction);
}

async function finalizeRobber(messageId, reason, interaction = null) {
  const state = activeRobbers.get(messageId);
  if (!state) return;
  activeRobbers.delete(messageId);

  const guild = client.guilds.cache.get(state.guildId);
  const channel = guild?.channels.cache.get(state.channelId);
  if (!channel) return;
  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (!msg) return;

  let title;
  let desc;
  let color = 0x2ECC71;
  if (state.winner) {
    title = "\uD83D\uDCB0 Robber Stopped!";
    desc = `<@${state.winner}> grabbed the full ${coin(state.pot)}! \uD83C\uDF89`;
  } else {
    title = "\uD83C\uDFC3\u200D\u2642\uFE0F Robber escaped!";
    desc = `Nobody stopped them in time. They got away with ${coin(state.pot)}.`;
    color = 0xE74C3C;
  }
  const final = new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc);

  if (interaction) {
    await interaction.update({ embeds: [final], components: [] }).catch(() => {});
  } else {
    await msg.edit({ embeds: [final], components: [] }).catch(() => {});
  }
}

// Allow other modules (admin commands) to force-spawn a robber for testing.
module.exports.spawnRobber = spawnRobber;

function runPetIncome() {
  try {
    const rows = db.db.prepare("SELECT * FROM pets WHERE alive = 1").all();
    const now = Date.now();
    for (const p of rows) {
      const def = PET_TYPES[p.pet_type];
      if (!def) continue;

      // Permanent perks: Feed/Water Timer Upgrade => +12hr survival (48 -> 60).
      const perks = db.getUserPerks(p.user_id);
      const feedMaxHrs = perks.feedTimer ? 60 : 48;
      const waterMaxHrs = perks.waterTimer ? 60 : 48;

      const hoursSinceFed = (now - p.last_fed) / (3600 * 1000);
      const hoursSinceWatered = (now - p.last_watered) / (3600 * 1000);
      const hunger = Math.max(0, 100 - Math.floor(hoursSinceFed * 100 / feedMaxHrs));
      const thirst = Math.max(0, 100 - Math.floor(hoursSinceWatered * 100 / waterMaxHrs));
      if (hoursSinceFed > feedMaxHrs || hoursSinceWatered > waterMaxHrs) {
        db.killPet(p.id);
        continue;
      }
      db.updatePet(p.id, { hunger, thirst });

      // Auto income: Hamster (autoHourly), or any pet at level 10+ (fallback).
      const eligible = def.autoIncome || p.level >= 10;
      if (!eligible) continue;
      if (now - p.last_income < 60 * 60 * 1000) continue; // 1 hour
      let base;
      if (def.autoHourly) {
        const [lo, hi] = def.autoHourly;
        base = lo + Math.floor(Math.random() * (hi - lo + 1));
      } else {
        base = def.baseIncome || 80;
      }
      const mult = (PET_RARITY_MULT[p.rarity] || 1) * (perks.strength ? 1.20 : 1);
      const charmBoost = db.hasActiveBoost(p.user_id, "pet_luck_charm") ? 1.5 : 1;
      const amt = Math.floor(base * mult * charmBoost * (1 + p.level * 0.05));
      db.addWallet(p.user_id, amt);
      db.updatePet(p.id, { last_income: now });
    }
  } catch (e) {
    console.error("[pet income]", e);
  }
}

// ===== Bill Collector =====
// Passive money sink. Flat 25 coin fee deducted from random active users every
// ~10 minutes. Matches the competitor bot exactly: same flat amount, same
// "Digital loitering fine" wording, same DM format.
async function runBillCollector(client) {
  try {
    const now = Date.now();
    for (const [userId, info] of lastActiveUsers.entries()) {
      // Skip users not active in the past 24h (and clean up the map)
      if (now - info.ts > BILL_ACTIVITY_WINDOW_MS) {
        lastActiveUsers.delete(userId);
        continue;
      }
      // Per-user cooldown
      const next = nextBillAt.get(userId) || 0;
      if (now < next) continue;
      // Random chance per tick
      if (Math.random() > BILL_TICK_CHANCE) continue;

      const u = db.getUser(userId);
      if (!u || u.wallet < BILL_MIN_WALLET) continue;

      // Always deduct exactly 25 coins.
      db.addWallet(userId, -BILL_AMOUNT);
      nextBillAt.set(userId, now + BILL_USER_COOLDOWN_MS);

      // DM the user (if notifications are on)
      if (u.notifications) {
        try {
          const user = await client.users.fetch(userId).catch(() => null);
          if (user) {
            const dm = new EmbedBuilder()
              .setColor(0xE74C3C)
              .setTitle("\uD83D\uDCB8 Bill Collected!")
              .setDescription(`**Digital loitering fine:** ${coin(BILL_AMOUNT)} deducted from your wallet.`)
              .setFooter({ text: "To disable DM alerts: ,notifications off" });
            await user.send({ embeds: [dm] }).catch(() => {});
          }
        } catch {}
      }
    }
  } catch (e) {
    console.error("[bill collector]", e);
  }
}

client.login(TOKEN);
