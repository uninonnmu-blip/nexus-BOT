"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const db = require("../db");
const { embed, errEmbed, okEmbed, moneyEmbed, notEnoughEmbed, coin, fmt, parseAmount, resolveMember, fmtDuration } = require("../utils");
const { COLORS, EMOJI, LBHIDE_PRICE_PER_DAY, LBHIDE_MAX_DAYS } = require("../config");

const cat = "balance";

const bal = {
  name: "bal",
  aliases: ["balance", "wallet", "money"],
  category: cat,
  description: "Check your or another user's balance.",
  usage: ",bal [@user]",
  async run({ message, args }) {
    const target = args[0] ? await resolveMember(args[0], message) : message.member;
    const user = (target?.user) || message.author;
    const u = db.getUser(user.id);
    // Per client request: ,bal only shows wallet, bank, and total.
    // Vault is intentionally excluded here. Use ,vault or ,profile to see it.
    const e = embed({
      color: COLORS.money,
      author: { name: `${user.username}'s Balance`, iconURL: user.displayAvatarURL() },
      fields: [
        { name: `Wallet`, value: coin(u.wallet),                   inline: true },
        { name: `Bank`,   value: coin(u.bank),                     inline: true },
        { name: `Total`,  value: coin(u.wallet + u.bank + u.vault), inline: true },
      ],
    });
    return message.reply({ embeds: [e] });
  },
};

const deposit = {
  name: "deposit",
  aliases: ["dep"],
  category: cat,
  description: "Move money from wallet to bank.",
  usage: ",deposit <amount|all>",
  async run({ message, args }) {
    const u = db.getUser(message.author.id);
    if (u.wallet <= 0) return message.reply({ embeds: [errEmbed("Your wallet is empty.")] });
    const amt = parseAmount(args[0] || "all", u.wallet);
    if (!amt || amt <= 0) return message.reply({ embeds: [errEmbed("Invalid amount.")] });
    if (amt > u.wallet) return message.reply({ embeds: [errEmbed(`You only have ${coin(u.wallet)} in your wallet.`)] });
    db.addWallet(message.author.id, -amt);
    db.addBank(message.author.id, amt);
    return message.reply({ embeds: [okEmbed(`Deposited ${coin(amt)} into your bank.`, "Deposit")] });
  },
};

const withdraw = {
  name: "withdraw",
  aliases: ["with"],
  category: cat,
  description: "Move money from bank to wallet.",
  usage: ",withdraw <amount|all>",
  async run({ message, args }) {
    const u = db.getUser(message.author.id);
    if (u.bank <= 0) return message.reply({ embeds: [errEmbed("Your bank is empty.")] });
    const amt = parseAmount(args[0] || "all", u.bank);
    if (!amt || amt <= 0) return message.reply({ embeds: [errEmbed("Invalid amount.")] });
    if (amt > u.bank) return message.reply({ embeds: [errEmbed(`You only have ${coin(u.bank)} in your bank.`)] });
    db.addBank(message.author.id, -amt);
    db.addWallet(message.author.id, amt);
    return message.reply({ embeds: [okEmbed(`Withdrew ${coin(amt)} to your wallet.`, "Withdraw")] });
  },
};

const vault = {
  name: "vault",
  category: cat,
  description: "View your vault. The vault is rob-resistant unless someone uses a Vault Drill.",
  usage: ",vault",
  async run({ message }) {
    const u = db.getUser(message.author.id);
    return message.reply({ embeds: [embed({
      color: COLORS.info,
      title: `${EMOJI.vault} Vault`,
      description: `Your vault holds **${coin(u.vault)}**.\nUse \`,deposit\` to bank money, then visit your vault to keep it secure.`,
    })] });
  },
};

// ---- Profile (compact + paginated buttons) ----
function buildProfileBase(user, u) {
  return embed({
    color: COLORS.primary,
    author: {
      name: `\uD83D\uDCCA ${user.username}'s Profile`,
      iconURL: user.displayAvatarURL(),
    },
    thumbnail: user.displayAvatarURL({ size: 256 }),
    fields: [
      { name: `\u2764\uFE0F Wallet`,   value: coin(u.wallet),                  inline: true },
      { name: `\uD83C\uDFE6 Bank`,     value: coin(u.bank),                    inline: true },
      { name: `\uD83D\uDCB0 Total`,    value: coin(u.wallet + u.bank + u.vault), inline: true },
    ],
    footer: `Click "More Details" for cooldowns & pets \u2022 "My Eyes Only" for private info`,
  });
}

function buildProfileDetails(user, u, inv, pets) {
  const need = u.level * 250;
  const cds = [];
  const now = Date.now();
  const cdRows = db.db.prepare("SELECT key, expires_at FROM cooldowns WHERE user_id = ? AND expires_at > ?").all(user.id, now);
  for (const r of cdRows.slice(0, 6)) {
    cds.push(`\`${r.key}\` \u2014 <t:${Math.floor(r.expires_at / 1000)}:R>`);
  }
  const petLines = pets.slice(0, 5).map((p) => {
    const dead = !p.alive;
    return `\`#${p.idx ?? "?"}\` ${p.name || p.pet_type} \u2014 Lv ${p.level}${dead ? " (dead)" : ` (\u2764${p.hunger}/100 \uD83D\uDCA7${p.thirst}/100)`}`;
  });

  return embed({
    color: COLORS.primary,
    author: {
      name: `\uD83D\uDCCA ${user.username}'s Profile \u2014 Details`,
      iconURL: user.displayAvatarURL(),
    },
    thumbnail: user.displayAvatarURL({ size: 256 }),
    fields: [
      { name: `\u2764\uFE0F Wallet`,   value: coin(u.wallet),                  inline: true },
      { name: `\uD83C\uDFE6 Bank`,     value: coin(u.bank),                    inline: true },
      { name: `\uD83D\uDCB0 Total`,    value: coin(u.wallet + u.bank + u.vault), inline: true },
      { name: `\u2B50 Level`,          value: `**${u.level}** (${fmt(u.xp)}/${fmt(need)} XP)`, inline: true },
      { name: `\uD83C\uDF92 Inventory`, value: `${inv.length} unique items`, inline: true },
      { name: `\uD83D\uDC3E Pets`,     value: pets.length ? `${pets.length} alive` : "none", inline: true },
      { name: `\u23F1\uFE0F Cooldowns`, value: cds.length ? cds.join("\n") : "_none active_", inline: false },
      ...(petLines.length ? [{ name: `\uD83D\uDC36 Pet Status`, value: petLines.join("\n"), inline: false }] : []),
    ],
    footer: `"My Eyes Only" for private info (active boosts, vault, hibernate)`,
  });
}

function buildProfilePrivate(user, u) {
  const now = Date.now();
  // Boosts live in the `active_items` table (there is no `active_boosts` table).
  // Filter to entries with an expires_at in the future so consumable items
  // without an expiry don't show up as fake "boosts".
  const boostRows = db.db.prepare(
    "SELECT item_id, expires_at FROM active_items WHERE user_id = ? AND expires_at IS NOT NULL AND expires_at > ?"
  ).all(user.id, now);
  const boosts = boostRows.length
    ? boostRows.map((b) => `\u2728 \`${b.item_id}\` \u2014 <t:${Math.floor(b.expires_at / 1000)}:R>`).join("\n")
    : "_no active boosts_";
  const hibernate = u.hibernate_until > now ? `\uD83D\uDCA4 Hibernating until <t:${Math.floor(u.hibernate_until / 1000)}:R>` : "\uD83D\uDCA4 Hibernate: off";
  const curse = u.curse_until > now ? `\uD83D\uDC80 Cursed until <t:${Math.floor(u.curse_until / 1000)}:R> (use \`,payoff\`)` : "\uD83D\uDC80 Curse: none";
  const lbhidden = u.lbhide_until > now ? `\uD83D\uDC65 Hidden from leaderboard until <t:${Math.floor(u.lbhide_until / 1000)}:R>` : "\uD83D\uDC65 Visible on leaderboard";
  return embed({
    color: COLORS.info,
    author: {
      name: `\uD83D\uDD12 ${user.username}'s Private Stats`,
      iconURL: user.displayAvatarURL(),
    },
    fields: [
      { name: `\uD83D\uDD10 Vault`, value: coin(u.vault), inline: true },
      { name: `\uD83D\uDC8E Net Worth`, value: coin(u.wallet + u.bank + u.vault), inline: true },
      { name: `\uD83D\uDD14 Notifications`, value: u.notifications ? "on" : "off", inline: true },
      { name: `Active Boosts`, value: boosts, inline: false },
      { name: `Status`, value: [hibernate, curse, lbhidden].join("\n"), inline: false },
    ],
    footer: `Only visible to you`,
  });
}

function buildProfileRow(userId, mode) {
  const details = new ButtonBuilder()
    .setCustomId(`profile:details:${userId}`)
    .setLabel("More Details")
    .setStyle(mode === "details" ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setEmoji("\uD83D\uDCDD");
  const eyes = new ButtonBuilder()
    .setCustomId(`profile:eyes:${userId}`)
    .setLabel("My Eyes Only")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("\uD83D\uDD12");
  const back = new ButtonBuilder()
    .setCustomId(`profile:back:${userId}`)
    .setLabel("Back")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("\u25C0\uFE0F")
    .setDisabled(mode !== "details");
  return new ActionRowBuilder().addComponents(back, details, eyes);
}

const profile = {
  name: "profile",
  category: cat,
  description: "View your or another member's profile.",
  usage: ",profile [@user]",
  async run({ message, args }) {
    const target = args[0] ? await resolveMember(args[0], message) : message.member;
    const user = (target?.user) || message.author;
    const u = db.getUser(user.id);
    const ownerId = message.author.id;

    const msg = await message.reply({
      embeds: [buildProfileBase(user, u)],
      components: [buildProfileRow(ownerId, "base")],
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 5 * 60 * 1000,
    });

    collector.on("collect", async (interaction) => {
      const [, action, oid] = interaction.customId.split(":");
      if (interaction.user.id !== oid) {
        return interaction.reply({
          content: "This profile view isn't yours. Run `,profile` yourself.",
          ephemeral: true,
        });
      }
      // Re-fetch fresh data on every click.
      const fresh = db.getUser(user.id);
      if (action === "details") {
        const inv = db.listInventory(user.id);
        const pets = db.listPets(user.id);
        return interaction.update({
          embeds: [buildProfileDetails(user, fresh, inv, pets)],
          components: [buildProfileRow(oid, "details")],
        });
      }
      if (action === "back") {
        return interaction.update({
          embeds: [buildProfileBase(user, fresh)],
          components: [buildProfileRow(oid, "base")],
        });
      }
      if (action === "eyes") {
        // Only the original author can see their own private info; viewing
        // another user's profile still only reveals THEIR private info to them.
        return interaction.reply({
          embeds: [buildProfilePrivate(user, fresh)],
          ephemeral: true,
        });
      }
    });

    collector.on("end", async () => {
      try { await msg.edit({ components: [] }); } catch {}
    });
  },
};

const leaderboard = {
  name: "leaderboard",
  aliases: ["lb", "top"],
  category: cat,
  description: "Top richest members in the server.",
  usage: ",leaderboard",
  async run({ message, client }) {
    const rows = db.topUsers(15);
    const lines = [];
    let rank = 1;
    for (const r of rows) {
      const u = await client.users.fetch(r.id).catch(() => null);
      const name = u ? u.username : `User ${r.id}`;
      const medal = rank === 1 ? "\uD83E\uDD47" : rank === 2 ? "\uD83E\uDD48" : rank === 3 ? "\uD83E\uDD49" : `**${rank}.**`;
      lines.push(`${medal} ${name} — ${coin(r.net)}`);
      rank++;
    }
    return message.reply({ embeds: [embed({
      color: COLORS.money,
      title: `${EMOJI.coin} Richest Members`,
      description: lines.join("\n") || "_no entries yet_",
    })] });
  },
};

const lbhide = {
  name: "lbhide",
  category: cat,
  description: "Hide from the leaderboard for up to 5 days.",
  usage: ",lbhide [days]",
  async run({ message, args }) {
    // Parse with NaN guard. Without this, `,lbhide abc` would propagate
    // NaN through cost/until math and corrupt the wallet (NaN gets stored
    // as NULL in SQLite, breaking subsequent arithmetic).
    const parsedDays = parseInt(args[0] || "1", 10);
    if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
      return message.reply({ embeds: [errEmbed(`Usage: \`,lbhide <1-${LBHIDE_MAX_DAYS}>\``)] });
    }
    const days = Math.max(1, Math.min(LBHIDE_MAX_DAYS, parsedDays));
    const cost = days * LBHIDE_PRICE_PER_DAY;
    const u = db.getUser(message.author.id);
    if (u.wallet < cost) return message.reply({ embeds: [notEnoughEmbed(cost, u.wallet, `(${coin(LBHIDE_PRICE_PER_DAY)}/day for ${days} day${days > 1 ? "s" : ""}.)`)] });
    db.addWallet(message.author.id, -cost);
    const until = Date.now() + days * 24 * 60 * 60 * 1000;
    db.setUserField(message.author.id, "lbhide_until", until);
    return message.reply({ embeds: [okEmbed(`Hidden from leaderboard for **${days}** day(s). Cost: ${coin(cost)}.`)] });
  },
};

const lbshow = {
  name: "lbshow",
  category: cat,
  description: "Unhide yourself from the leaderboard (free).",
  usage: ",lbshow",
  async run({ message }) {
    db.setUserField(message.author.id, "lbhide_until", 0);
    return message.reply({ embeds: [okEmbed("You are now visible on the leaderboard.")] });
  },
};

const lbhidden = {
  name: "lbhidden",
  category: cat,
  description: "Check leaderboard hide status.",
  usage: ",lbhidden",
  async run({ message }) {
    const u = db.getUser(message.author.id);
    if (u.lbhide_until > Date.now()) {
      return message.reply({ embeds: [embed({ color: COLORS.info, description: `You are hidden for **${fmtDuration(u.lbhide_until - Date.now())}**.` })] });
    }
    return message.reply({ embeds: [embed({ color: COLORS.info, description: `You are **visible** on the leaderboard.` })] });
  },
};

module.exports = { commands: [bal, deposit, withdraw, vault, profile, leaderboard, lbhide, lbshow, lbhidden] };
