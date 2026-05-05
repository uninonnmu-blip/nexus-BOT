"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const db = require("../db");
const { embed, errEmbed, okEmbed, notEnoughEmbed, coin, fmt, weightedPick, rand } = require("../utils");
const { COLORS } = require("../config");
const { ITEMS, PET_TYPES, PET_SUPPLIES, SHOP_CATEGORIES, RARITY_DOT, getItem, getItemByCode, findItemByName, getStaticShopEntries } = require("../items");

const cat = "shop";

// ===== Pre-baked seed data =====
// Colors: matches the screenshots EXACTLY (20 colors, sorted by price).
// Admins can add more later with `,shop add color <name> <#hex> <price>`.
const COLOR_SEED = [
  { name: "Purple pink",       hex: "#C77DFF", price: 1600 },
  { name: "Very light yellow", hex: "#FFFACD", price: 1800 },
  { name: "Whitish pink",      hex: "#FFE4E1", price: 1800 },
  { name: "Pink green",        hex: "#B5EAD7", price: 2000 },
  { name: "Orange dark",       hex: "#D2691E", price: 2000 },
  { name: "Red light",         hex: "#FF6B6B", price: 2365 },
  { name: "White gray",        hex: "#D3D3D3", price: 2400 },
  { name: "Red white",         hex: "#FFB6B6", price: 2433 },
  { name: "Yellow light",      hex: "#FFFF99", price: 2465 },
  { name: "Green neon",        hex: "#39FF14", price: 2500 },
  { name: "Pinkish red",       hex: "#FF477E", price: 2555 },
  { name: "Orange white",      hex: "#FFDAB9", price: 2600 },
  { name: "Purple light",      hex: "#B19CD9", price: 2999 },
  { name: "White black",       hex: "#4A4A4A", price: 3211 },
  { name: "Gray",              hex: "#808080", price: 3333 },
  { name: "Blue light",        hex: "#ADD8E6", price: 3500 },
  { name: "White gray bright", hex: "#C0C0C0", price: 4199 },
  { name: "Green dark",        hex: "#006400", price: 4400 },
  { name: "Orange neon",       hex: "#FF6700", price: 4500 },
  { name: "Dark purple",       hex: "#4B0082", price: 4567 },
];

// Roles: generic, server-friendly placeholders. The client should rename these
// to match their server's culture using `,shop edit <code> name <new name>` or
// by renaming the Discord role directly (the shop entry will follow).
const ROLE_SEED = [
  { name: "Active Member", price: 2000 },
  { name: "Supporter",     price: 3000 },
  { name: "Member Plus",   price: 3500 },
  { name: "Veteran",       price: 4000 },
  { name: "Regular",       price: 4500 },
  { name: "Trusted",       price: 5000 },
  { name: "Loyal",         price: 6000 },
  { name: "Pro",           price: 7500 },
  { name: "Elite",         price: 9000 },
  { name: "Premium",       price: 10000 },
  { name: "VIP",           price: 12500 },
  { name: "Star",          price: 15000 },
  { name: "Legend",        price: 20000 },
  { name: "Champion",      price: 30000 },
];

function isAdmin(member) {
  if (!member) return false;
  return member.permissions?.has?.("Administrator") || false;
}

function parsePrice(str) {
  if (!str) return NaN;
  const n = parseInt(String(str).replace(/[, _]/g, ""), 10);
  return Number.isFinite(n) ? n : NaN;
}

function parseHex(str) {
  if (!str) return null;
  const s = str.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return "#" + s.toUpperCase();
}

// ===== Shop command: main entry point + admin subcommands =====
const shop = {
  name: "shop",
  category: cat,
  description: "Browse the economy shop. Admins: `,shop add|remove|edit|seed|clear`.",
  usage: ",shop [items|roles|colors|pets] OR ,shop add|remove|edit|seed",
  async run({ message, args }) {
    const sub = (args[0] || "").toLowerCase();

    if (["items", "roles", "colors", "pets"].includes(sub)) {
      return sendShopPage(message, sub, 0);
    }

    // ----- Admin subcommands -----
    if (["add", "remove", "edit", "seed", "clear"].includes(sub)) {
      if (!isAdmin(message.member)) {
        return message.reply({ embeds: [errEmbed("Admin only.")] });
      }
      if (!message.guild) {
        return message.reply({ embeds: [errEmbed("Run this in a server.")] });
      }
      try {
        if (sub === "seed")   return shopSeed(message, args.slice(1));
        if (sub === "clear")  return shopClear(message, args.slice(1));
        if (sub === "remove") return shopRemove(message, args.slice(1));
        if (sub === "edit")   return shopEdit(message, args.slice(1));
        if (sub === "add")    return shopAdd(message, args.slice(1));
      } catch (e) {
        console.error("[shop admin]", e);
        return message.reply({ embeds: [errEmbed(`Error: \`${e.message}\``)] });
      }
    }

    // Default (no sub-arg): show the public/private chooser and let the user
    // pick. The chooser buttons are owner-locked to message.author.id so
    // randos can't decide for them.
    return message.reply(buildShopChooser(message.author.id));
  },
};

// ===== Admin: ,shop seed [colors|roles|all] =====
async function shopSeed(message, args) {
  const what = (args[0] || "all").toLowerCase();
  const guild = message.guild;
  const me = guild.members.me;
  if (!me?.permissions.has("ManageRoles")) {
    return message.reply({ embeds: [errEmbed("I need the **Manage Roles** permission to create shop roles.")] });
  }

  await message.reply({
    embeds: [embed({
      color: COLORS.info,
      title: "Seeding shop...",
      description: "Creating Discord roles and shop entries. This may take ~10s.",
    })],
  });

  let createdColors = 0;
  let createdRoles = 0;
  const errors = [];

  if (what === "colors" || what === "all") {
    // Skip ones that are already seeded (by name match in shop_entries).
    const existing = db.listShopEntries(guild.id, "colors");
    const existingNames = new Set(existing.map((e) => e.name.toLowerCase()));
    for (const c of COLOR_SEED) {
      if (existingNames.has(c.name.toLowerCase())) continue;
      try {
        const role = await guild.roles.create({
          name: c.name,
          color: c.hex,
          reason: "Shop seed: color role",
          permissions: [],
          mentionable: false,
        });
        db.addShopEntry({
          guild_id: guild.id,
          category: "colors",
          name: c.name,
          emoji: "\uD83C\uDFA8",
          price: c.price,
          description: `${c.hex} \u2022 .`,
          rarity: null,
          color_hex: c.hex,
          role_id: role.id,
          stock: -1,
        });
        createdColors++;
      } catch (e) {
        errors.push(`color ${c.name}: ${e.message}`);
      }
    }
  }

  if (what === "roles" || what === "all") {
    const existing = db.listShopEntries(guild.id, "roles");
    const existingNames = new Set(existing.map((e) => e.name.toLowerCase()));
    for (const r of ROLE_SEED) {
      if (existingNames.has(r.name.toLowerCase())) continue;
      try {
        const role = await guild.roles.create({
          name: r.name,
          color: 0,
          reason: "Shop seed: placeholder role",
          permissions: [],
          mentionable: false,
        });
        db.addShopEntry({
          guild_id: guild.id,
          category: "roles",
          name: r.name,
          emoji: "\uD83C\uDFAD",
          price: r.price,
          description: "Placeholder role \u2014 admins can rename via `,shop edit`.",
          rarity: null,
          color_hex: null,
          role_id: role.id,
          stock: -1,
        });
        createdRoles++;
      } catch (e) {
        errors.push(`role ${r.name}: ${e.message}`);
      }
    }
  }

  const lines = [];
  if (createdColors) lines.push(`Created **${createdColors}** color roles.`);
  if (createdRoles)  lines.push(`Created **${createdRoles}** placeholder roles.`);
  if (!createdColors && !createdRoles) lines.push("Nothing to seed (entries already exist). Use `,shop clear <colors|roles>` first to start fresh.");
  if (errors.length) lines.push(`\n**Errors (${errors.length}):**\n` + errors.slice(0, 5).join("\n"));

  return message.channel.send({
    embeds: [okEmbed(lines.join("\n"), "Shop Seeded")],
  });
}

// ===== Admin: ,shop clear <colors|roles> =====
async function shopClear(message, args) {
  const what = (args[0] || "").toLowerCase();
  if (!["colors", "roles"].includes(what)) {
    return message.reply({ embeds: [errEmbed("Usage: `,shop clear colors` or `,shop clear roles`. This deletes shop entries (Discord roles are kept).")] });
  }
  const entries = db.listShopEntries(message.guild.id, what);
  for (const e of entries) db.removeShopEntry(e.code);
  return message.reply({ embeds: [okEmbed(`Removed **${entries.length}** ${what} shop entries. Discord roles were kept \u2014 delete them manually if you want.`, "Shop Cleared")] });
}

// ===== Admin: ,shop remove <code> =====
async function shopRemove(message, args) {
  const code = (args[0] || "").toUpperCase();
  if (!code) return message.reply({ embeds: [errEmbed("Usage: `,shop remove <CODE>`")] });
  const entry = db.getShopEntryByCode(code);
  if (!entry || entry.guild_id !== message.guild.id) {
    return message.reply({ embeds: [errEmbed("No shop entry with that code in this server.")] });
  }
  db.removeShopEntry(code);
  return message.reply({ embeds: [okEmbed(`Removed **${entry.name}** (\`${code}\`) from the shop.`, "Removed")] });
}

// ===== Admin: ,shop edit <code> <field> <value...> =====
async function shopEdit(message, args) {
  const code = (args[0] || "").toUpperCase();
  const field = (args[1] || "").toLowerCase();
  const value = args.slice(2).join(" ");
  if (!code || !field || !value) {
    return message.reply({ embeds: [errEmbed("Usage: `,shop edit <CODE> price|name|description|stock <value>`")] });
  }
  const entry = db.getShopEntryByCode(code);
  if (!entry || entry.guild_id !== message.guild.id) {
    return message.reply({ embeds: [errEmbed("No shop entry with that code in this server.")] });
  }
  const updates = {};
  if (field === "price") {
    const n = parsePrice(value);
    if (!Number.isFinite(n) || n < 0) return message.reply({ embeds: [errEmbed("Price must be a positive number.")] });
    updates.price = n;
  } else if (field === "name") {
    updates.name = value.slice(0, 100);
    // Also rename the Discord role
    if (entry.role_id) {
      const role = await message.guild.roles.fetch(entry.role_id).catch(() => null);
      if (role) await role.setName(updates.name).catch(() => {});
    }
  } else if (field === "description" || field === "desc") {
    updates.description = value.slice(0, 200);
  } else if (field === "stock") {
    if (value === "unlimited" || value === "-1") updates.stock = -1;
    else {
      const n = parsePrice(value);
      if (!Number.isFinite(n) || n < 0) return message.reply({ embeds: [errEmbed("Stock must be `-1` (unlimited) or a positive number.")] });
      updates.stock = n;
    }
  } else {
    return message.reply({ embeds: [errEmbed("Field must be one of: `price`, `name`, `description`, `stock`.")] });
  }
  db.updateShopEntry(code, updates);
  return message.reply({ embeds: [okEmbed(`Updated **${entry.name}** (\`${code}\`).`, "Edited")] });
}

// ===== Admin: ,shop add color|role <args...> =====
async function shopAdd(message, args) {
  const kind = (args[0] || "").toLowerCase();
  if (kind === "color") {
    // ,shop add color <name> <#hex> <price>
    const hexIdx = args.findIndex((a) => /^#?[0-9a-fA-F]{6}$/.test(a));
    if (hexIdx < 1) {
      return message.reply({ embeds: [errEmbed("Usage: `,shop add color <name...> <#hex> <price>`")] });
    }
    const name = args.slice(1, hexIdx).join(" ").slice(0, 100);
    const hex = parseHex(args[hexIdx]);
    const price = parsePrice(args[hexIdx + 1]);
    if (!name || !hex || !Number.isFinite(price) || price < 0) {
      return message.reply({ embeds: [errEmbed("Usage: `,shop add color <name...> <#hex> <price>`")] });
    }
    const role = await message.guild.roles.create({
      name, color: hex, reason: `Shop add color (by ${message.author.tag})`, permissions: [],
    });
    const code = db.addShopEntry({
      guild_id: message.guild.id, category: "colors",
      name, emoji: "\uD83C\uDFA8", price, description: `${hex} \u2022 .`,
      color_hex: hex, role_id: role.id, stock: -1,
    });
    return message.reply({ embeds: [okEmbed(`Added **${name}** color to the shop.\nCode: \`${code}\`\nPrice: ${coin(price)}`, "Added")] });
  }

  if (kind === "role") {
    // ,shop add role <@role|id> <price>
    const roleArg = args[1];
    const price = parsePrice(args[2]);
    if (!roleArg || !Number.isFinite(price) || price < 0) {
      return message.reply({ embeds: [errEmbed("Usage: `,shop add role <@role|id> <price>` (role must already exist)")] });
    }
    const roleId = roleArg.replace(/[<@&>]/g, "");
    const role = await message.guild.roles.fetch(roleId).catch(() => null);
    if (!role) return message.reply({ embeds: [errEmbed("Role not found.")] });
    const code = db.addShopEntry({
      guild_id: message.guild.id, category: "roles",
      name: role.name, emoji: "\uD83C\uDFAD", price,
      description: `Server role \u2022 ${role.name}`,
      role_id: role.id, stock: -1,
    });
    return message.reply({ embeds: [okEmbed(`Added **${role.name}** to the role shop.\nCode: \`${code}\`\nPrice: ${coin(price)}`, "Added")] });
  }

  return message.reply({ embeds: [errEmbed("Usage: `,shop add color <name> <#hex> <price>` or `,shop add role <@role> <price>`")] });
}

// Build the landing payload (used by both message and interaction).
// Layout matches the competitor bot exactly: title "Economy Shop", a one-line
// inflation indicator under "Choose a category.", then 4 inline category
// fields (Roles/Items/Colors on row 1, Pets on row 2).
function buildShopLanding() {
  const inflation = db.getInflationPct();

  const e = embed({
    color: COLORS.money,
    title: "Economy Shop",
    description: [
      "Choose a category.",
      `\uD83C\uDF0D **Economy:** ${inflation > 0 ? `+${inflation}% inflation active` : "no inflation"}`,
    ].join("\n"),
    fields: [
      { name: "\uD83C\uDFAD Roles",  value: "Server roles", inline: true },
      { name: "\uD83C\uDF92 Items",  value: "Tools, boosters & more", inline: true },
      { name: "\uD83C\uDFA8 Colors", value: "Color roles", inline: true },
      { name: "\uD83D\uDC3E Pets",   value: "Pet shop", inline: true },
    ],
    footer: "My Eyes Only \u2014 15 min timeout",
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("shop:roles:0").setLabel("Roles").setStyle(ButtonStyle.Primary).setEmoji("\uD83C\uDFAD"),
    new ButtonBuilder().setCustomId("shop:items:0").setLabel("Items").setStyle(ButtonStyle.Success).setEmoji("\uD83D\uDED2"),
    new ButtonBuilder().setCustomId("shop:colors:0").setLabel("Colors").setStyle(ButtonStyle.Danger).setEmoji("\uD83C\uDFA8"),
    new ButtonBuilder().setCustomId("shop:pets:0").setLabel("Pet Shop").setStyle(ButtonStyle.Secondary).setEmoji("\uD83D\uDC3E"),
  );

  return { embeds: [e], components: [row] };
}

async function sendShopLanding(message) {
  return message.reply({ ...buildShopLanding(), flags: [4096] });
}

// ===== Open-mode chooser =====
// Asks the user whether they want the shop posted publicly (Server View) or
// privately to themselves (My Eyes Only / ephemeral). The runner's userId is
// embedded in each customId so other members can't click and hijack the
// chooser. Mirrors the competitor bot's "How do you want to open the shop?"
// prompt from the screenshot.
function buildShopChooser(userId) {
  const e = embed({
    color: COLORS.info,
    title: "How do you want to open the shop?",
    description: [
      "\uD83C\uDF10 **Server View** \u2014 posted publicly, anyone can browse & buy.",
      "\uD83D\uDC41\uFE0F **My Eyes Only** \u2014 only you can see it (15 min timeout).",
    ].join("\n"),
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`shopopen:public:${userId}`)
      .setLabel("Server View")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("\uD83C\uDF10"),
    new ButtonBuilder()
      .setCustomId(`shopopen:private:${userId}`)
      .setLabel("My Eyes Only")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("\uD83D\uDC41\uFE0F"),
  );
  return { embeds: [e], components: [row] };
}

// Build the category page payload. Returns { embeds, components } or { error: '...' }.
function buildShopPage(guildId, category, page = 0) {
  let entries = [];

  if (category === "items" || category === "pets") {
    entries = getStaticShopEntries(category);
  } else if (category === "roles" || category === "colors") {
    if (!guildId) return { error: "Roles/Colors shop is guild-only." };
    entries = db.listShopEntries(guildId, category);
  }

  // Display BASE prices in the shop. The inflation mark-up is shown to the
  // user only inside the buy-confirmation embed, so the shop catalog stays
  // readable and matches the competitor bot's look.
  if (!entries.length) {
    const note = category === "roles" || category === "colors"
      ? " Admins can add items with `,shop add`."
      : "";
    return { error: `The ${category} shop is empty.${note}` };
  }

  const perPage = 4;
  const maxPage = Math.max(0, Math.ceil(entries.length / perPage) - 1);
  if (page < 0) page = 0;
  if (page > maxPage) page = maxPage;

  const startIdx = page * perPage;
  const pageEntries = entries.slice(startIdx, startIdx + perPage);
  const catInfo = SHOP_CATEGORIES[category];

  const lines = pageEntries.map((it) => {
    let stockStr = "";
    if (it.stock >= 0) {
      if (it.stock === 0) stockStr = " • **OUT OF STOCK**";
      else if (it.stock <= 5) stockStr = ` • **${it.stock} left**`;
    }
    const rarityDot = it.rarity ? ` ${RARITY_DOT[it.rarity] || ""}` : "";
    const colorPreview = it.color_hex ? ` \u2022 ${it.color_hex}` : "";
    return [
      `${it.emoji || "\uD83D\uDED2"} **${it.name}** — ${coin(it.price)}${stockStr}`,
      `\`${it.code}\` \u2022 ${it.description || "No description"}${rarityDot}${colorPreview}`,
    ].join("\n");
  });

  const inflation = db.getInflationPct();
  const inflationNote = inflation > 0 ? ` \u00B7 +${inflation}% applied at checkout` : "";

  const emb = embed({
    color: catInfo.color,
    title: `${catInfo.emoji} ${catInfo.title}`,
    description: lines.join("\n\n").slice(0, 4000),
    footer: `Page ${page + 1}/${maxPage + 1} \u00B7 ${entries.length} items${inflationNote} \u00B7 My Eyes Only`,
  });

  // Quick-buy row
  const buyRow = new ActionRowBuilder();
  for (const it of pageEntries) {
    if (it.stock === 0) continue;
    buyRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`buy:${it.code}`)
        .setLabel(it.name.slice(0, 70))
        .setStyle(ButtonStyle.Success)
        .setEmoji(it.emoji || "\uD83D\uDED2")
    );
  }

  // Nav row
  const navRow = new ActionRowBuilder();
  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId(page > 0 ? `shop:${category}:${page - 1}` : "shop:noop")
      .setEmoji("\u25C0\uFE0F")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0)
  );
  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId("shop:landing")
      .setLabel("All Shops")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("\uD83D\uDCC5")
  );
  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId(page < maxPage ? `shop:${category}:${page + 1}` : "shop:noop")
      .setEmoji("\u25B6\uFE0F")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= maxPage)
  );

  const rows = [];
  if (buyRow.components.length) rows.push(buyRow);
  rows.push(navRow);
  return { embeds: [emb], components: rows };
}

async function sendShopPage(message, category, page = 0) {
  const guildId = message.guild?.id;
  const result = buildShopPage(guildId, category, page);
  if (result.error) {
    return message.reply({ embeds: [errEmbed(result.error)], flags: [4096] });
  }
  return message.reply({ ...result, flags: [4096] });
}

// ===== Buy command =====
const buy = {
  name: "buy",
  category: cat,
  aliases: ["purchase"],
  description: "Buy an item by code or name.",
  usage: ",buy <code|name> [qty]",
  async run({ message, args }) {
    if (!args[0]) return message.reply({ embeds: [errEmbed("Usage: `,buy <code|name> [qty]`")] });
    let qty = 1;
    let query = args.join(" ");
    const trailing = args[args.length - 1];
    if (/^\d+$/.test(trailing) && args.length > 1) {
      qty = parseInt(trailing, 10);
      query = args.slice(0, -1).join(" ");
    }
    // Reject qty <= 0 so no-op confirms can't be spammed.
    if (qty <= 0) return message.reply({ embeds: [errEmbed("Quantity must be at least 1.")] });

    // Try code first (6-char)
    let item = null;
    let shopEntry = null;
    if (/^[A-Z0-9]{6}$/i.test(query)) {
      const code = query.toUpperCase();
      // Check shop_entries first
      shopEntry = db.getShopEntryByCode(code);
      if (!shopEntry) item = getItemByCode(code);
    }
    if (!item && !shopEntry) {
      item = findItemByName(query);
    }

    if (!item && !shopEntry) {
      return message.reply({ embeds: [errEmbed(`Item not found: \`${query}\``)] });
    }

    // Show confirmation embed instead of buying immediately. The actual
    // purchase runs only when the user clicks the green Confirm button.
    const code = (shopEntry?.code || item?.code || "").toUpperCase();
    const confirmPayload = buildBuyConfirm(message.author.id, code, qty);
    if (confirmPayload.error) {
      return message.reply({ embeds: [errEmbed(confirmPayload.error)] });
    }
    return message.reply(confirmPayload);
  },
};

// ===== Buy confirmation =====
// Builds the "Confirm" embed shown before any purchase. Matches the
// competitor bot's design: title "Confirm", body shows item + inflated price,
// inflation hint line, and a "Remaining" field with what the wallet will look
// like after the purchase. Two buttons below: green Confirm, red Cancel.
function buildBuyConfirm(userId, code, qty = 1) {
  if (!code) return { error: "Missing item code." };
  const upperCode = code.toUpperCase();
  // SHOP-LISTED-ONLY GUARD. `getItemByCode` and `findItemByName` look up in
  // the entire ITEMS registry, which includes `type: "find"` items (dirt,
  // diamond, gold_nugget, all dig/fish drops) with `price: 0`. The shop UI
  // hides these via `getStaticShopEntries`, but without this guard a user
  // could run `,buy DIAM06 100` to receive 100 diamonds for 0 coins and
  // then `,sell diamond 100` for 800,000 coins of created-from-nothing
  // money. Same trick works with every other find item (cursed_artifact,
  // golden_fish, etc.). Reject any non-shop-entry that is either a find
  // type or priced at 0 BEFORE generating the confirm prompt — both the
  // text `,buy` path and the button-click path flow through here.
  // Pre-resolve so the rejection happens before any user-facing prompt.
  {
    const _shopEntry = db.getShopEntryByCode(upperCode);
    const _item = _shopEntry ? null : getItemByCode(upperCode);
    if (_item && (_item.type === "find" || (_item.price || 0) <= 0)) {
      return { error: "That item isn't sold in the shop." };
    }
  }
  const shopEntry = db.getShopEntryByCode(upperCode);
  const item = shopEntry ? null : getItemByCode(upperCode);
  if (!shopEntry && !item) return { error: "Item not found." };

  const name = shopEntry ? shopEntry.name : item.name;
  const emoji = shopEntry ? (shopEntry.emoji || "\uD83C\uDFAD") : (item.emoji || "\uD83C\uDF92");
  const basePrice = shopEntry ? shopEntry.price : (item.price || 0);
  const each = db.inflatedPrice(basePrice);
  const total = each * qty;
  const u = db.getUser(userId);
  const remaining = u.wallet - total;
  const inflation = db.getInflationPct();

  const qtyPrefix = qty > 1 ? `${qty}\u00D7 ` : "";
  const lines = [
    `Buy ${emoji} **${name}** for ${coin(total)}?`,
  ];
  if (inflation > 0) {
    lines.push(`\uD83C\uDF0D **Economy:** +${inflation}% active`);
  }

  const e = embed({
    color: COLORS.info,
    title: "\uD83D\uDED2 Confirm",
    description: lines.join("\n"),
    fields: [
      {
        name: "Remaining",
        value: remaining >= 0 ? coin(remaining) : `**Not enough!** ${coin(u.wallet)} \u2014 ${coin(total)}`,
        inline: false,
      },
    ],
  });

  // Embed the buyer's userId in the customId so OTHER members can't press
  // Confirm or Cancel on this user's purchase prompt. The interaction
  // handler in index.js verifies interaction.user.id === userId from the
  // customId before doing anything.
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`buyconfirm:${userId}:${upperCode}:${qty}`)
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Success)
      .setEmoji("\u2705")
      .setDisabled(remaining < 0),
    new ButtonBuilder()
      .setCustomId(`buycancel:${userId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("\u274C"),
  );

  // Title prefix matches competitor: "qty× ItemName" when qty > 1
  if (qty > 1) {
    e.data.description = `Buy ${emoji} **${qtyPrefix}${name}** for ${coin(total)}?` +
      (inflation > 0 ? `\n\uD83C\uDF0D **Economy:** +${inflation}% active` : "");
  }

  return { embeds: [e], components: [row] };
}

async function buyStaticItem(message, item, qty) {
  const isPet = !!PET_TYPES[item.id];
  const each = db.inflatedPrice(item.price || 0);
  const total = each * qty;

  const u = db.getUser(message.author.id);
  if (u.wallet < total) {
    return message.reply({ embeds: [notEnoughEmbed(total, u.wallet)] });
  }

  db.addWallet(message.author.id, -total);

  if (isPet) {
    // Can only own 1 of each pet type
    const pets = db.listPets(message.author.id);
    if (pets.find((p) => p.pet_type === item.id)) {
      db.addWallet(message.author.id, total); // refund
      return message.reply({ embeds: [errEmbed(`You already own a ${item.name}. (1 per type)`)] });
    }
    const rarity = weightedPick([
      { item: "common", weight: 70 },
      { item: "rare", weight: 25 },
      { item: "legendary", weight: 5 },
    ]);
    db.addPet(message.author.id, item.id, rarity);
    return message.reply({ embeds: [okEmbed(`You adopted a **${rarity}** ${item.name} ${item.emoji || ""}!`, "New Pet")] });
  }

  // Auto-apply boosts
  if (item.type === "boost") {
    db.addItem(message.author.id, item.id, qty);
    const durationMs = item.durationMs || 60 * 60 * 1000;
    db.setActive(message.author.id, item.id, Date.now() + durationMs, null);
    db.removeItem(message.author.id, item.id, 1);
    return message.reply({ embeds: [okEmbed(`Bought & activated **${qty}× ${item.name}** for ${coin(total)}.`)] });
  }

  // Lottery ticket auto-enters
  if (item.id === "lottery_ticket" && message.guild) {
    const lot = db.getLottery(message.guild.id);
    const entries = JSON.parse(lot.entries || "[]");
    for (let i = 0; i < qty; i++) entries.push(message.author.id);
    db.updateLottery(message.guild.id, { entries: JSON.stringify(entries), jackpot: lot.jackpot + Math.floor(total * 0.5) });
    return message.reply({ embeds: [okEmbed(`Bought **${qty}× Lottery Ticket** and auto-entered. Use \`,lottery\` to view jackpot.`)] });
  }

  db.addItem(message.author.id, item.id, qty);
  return message.reply({ embeds: [okEmbed(`Bought **${qty}× ${item.name}** for ${coin(total)}.`)] });
}

async function buyShopEntry(message, entry, qty = 1) {
  // Reject re-purchase of an already-owned role/color. Roles are now
  // permanent ownership records — buying once gives the user the role
  // forever, and they can ,equip / ,unequip it as they wish. Re-buying
  // would double-charge them for nothing, so we hard-block it here.
  if (entry.role_id && message.guild) {
    const owned = db.getOwnedShopRole(message.author.id, message.guild.id, entry.code);
    if (owned) {
      const verb = owned.equipped ? "already wearing" : "already own (unequipped)";
      return message.reply({ embeds: [errEmbed(
        `You're ${verb} **${entry.name}**. Use \`,equip ${entry.code}\` / \`,unequip ${entry.code}\` to toggle it, or \`,myroles\` to see all owned roles.`
      )] });
    }
    // Roles always purchase at qty 1 — multiple copies makes no sense once
    // ownership is persistent.
    qty = 1;
  }

  if (entry.stock >= 0) {
    if (entry.stock < qty) {
      return message.reply({ embeds: [errEmbed(`Only ${entry.stock} left in stock.`)] });
    }
  }

  const each = entry.price;
  const total = each * qty;
  const u = db.getUser(message.author.id);
  if (u.wallet < total) {
    return message.reply({ embeds: [notEnoughEmbed(total, u.wallet)] });
  }

  db.addWallet(message.author.id, -total);

  if (entry.stock >= 0) {
    for (let i = 0; i < qty; i++) {
      const ok = db.decrementShopStock(entry.code);
      if (!ok) {
        // OOS mid-purchase
        const refund = each * (qty - i);
        db.addWallet(message.author.id, refund);
        return message.reply({ embeds: [errEmbed(`Bought ${i} before stock ran out. Refunded ${coin(refund)}.`)] });
      }
    }
  }

  // If it's a role, assign it
  if (entry.role_id && message.guild) {
    // Helper to also restore stock on the failure paths below. Without this,
    // a user buying a limited-stock role whose Discord role was deleted would
    // get a coin refund but the stock counter would have been silently
    // decremented — leaking stock and eventually selling out a role nobody
    // ever received.
    const refundAll = (reason) => {
      db.addWallet(message.author.id, total);
      if (entry.stock >= 0) {
        const cur = db.getShopEntryByCode(entry.code);
        if (cur) db.updateShopEntry(entry.code, { stock: (cur.stock ?? 0) + qty });
      }
      return message.reply({ embeds: [errEmbed(reason)] });
    };
    const role = await message.guild.roles.fetch(entry.role_id).catch(() => null);
    if (!role) {
      return refundAll("Role no longer exists.");
    }
    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) {
      return refundAll("You're not in this server.");
    }

    // Colors are mutually exclusive: equipping one auto-unequips any others
    // the user currently owns. We reflect that in BOTH Discord (remove other
    // color roles from the member) AND ownership (mark them equipped=0 in
    // the DB) so `,myroles` accurately shows what's worn.
    if (entry.category === "colors") {
      const colorRoles = db.listShopEntries(message.guild.id, "colors").map((e) => e.role_id).filter(Boolean);
      const toRemove = member.roles.cache.filter((r) => colorRoles.includes(r.id));
      for (const r of toRemove.values()) {
        await member.roles.remove(r).catch(() => {});
      }
      db.unequipAllColorsForUser(message.author.id, message.guild.id);
    }

    await member.roles.add(role).catch(() => {});
    // Persist ownership + equipped state. The ON CONFLICT clause re-equips
    // if a stale row somehow existed for this code.
    db.addOwnedShopRole(message.author.id, message.guild.id, entry.code, entry.role_id, entry.category);
    return message.reply({ embeds: [okEmbed(
      `You purchased **${entry.name}** for ${coin(total)}!\nUse \`,unequip ${entry.code}\` to take it off — you'll keep ownership.`,
      "Role Added"
    )] });
  }

  return message.reply({ embeds: [okEmbed(`Bought **${qty}× ${entry.name}** for ${coin(total)}.`)] });
}

// ===== Open boxes =====
const open = {
  name: "open",
  category: cat,
  description: "Open mystery boxes from your inventory.",
  usage: ",open [qty] [common|rare|legendary]",
  async run({ message, args }) {
    let qty = 1;
    let rarity = "common";
    for (const a of args) {
      if (/^\d+$/.test(a)) qty = parseInt(a, 10);
      else if (/^(common|rare|legendary)$/i.test(a)) rarity = a.toLowerCase();
    }

    const boxId = `${rarity === "common" ? "mystery" : rarity === "rare" ? "rare_mystery" : "legendary"}_box`;
    const have = db.getItem(message.author.id, boxId);
    if (have < qty) return message.reply({ embeds: [errEmbed(`You only have ${have}× ${ITEMS[boxId].name}.`)] });
    db.removeItem(message.author.id, boxId, qty);

    const lines = [];
    let totalCoins = 0;
    let ticketsAutoEntered = 0; // tally for the result line
    const lootTable = LOOT[rarity];
    for (let i = 0; i < qty; i++) {
      const drop = weightedPick(lootTable);
      if (drop.kind === "coins") {
        const amt = rand(drop.min, drop.max);
        totalCoins += amt;
        lines.push(`\uD83D\uDCB5 ${coin(amt)}`);
      } else {
        const dropQty = drop.qty || 1;
        // Lottery tickets are useless as inventory items (no `,use` handler,
        // no redemption path) — they only have value when entered into the
        // lottery. Auto-enter on drop so users actually get value, instead
        // of accumulating dead-weight tickets.
        if (drop.id === "lottery_ticket" && message.guild) {
          const lot = db.getLottery(message.guild.id);
          const entries = JSON.parse(lot.entries || "[]");
          for (let k = 0; k < dropQty; k++) entries.push(message.author.id);
          db.updateLottery(message.guild.id, { entries: JSON.stringify(entries) });
          ticketsAutoEntered += dropQty;
          const def = getItem(drop.id);
          const qtyPrefix = dropQty > 1 ? `${dropQty}\u00D7 ` : "";
          lines.push(`\uD83C\uDFAB ${qtyPrefix}**${def?.name || "Lottery Ticket"}** \u2014 auto-entered`);
          continue;
        }
        db.addItem(message.author.id, drop.id, dropQty);
        const def = getItem(drop.id);
        const emoji = def?.emoji || "\uD83C\uDF81";
        const qtyPrefix = dropQty > 1 ? `${dropQty}\u00D7 ` : "";
        lines.push(`${emoji} ${qtyPrefix}**${def?.name || drop.id}**`);
      }
    }
    if (totalCoins) db.addWallet(message.author.id, totalCoins);

    // Match competitor design: title "Opened 1× Legendary Box!", item list,
    // and a Balance field at the bottom.
    const after = db.getUser(message.author.id);
    const rarityName = rarity[0].toUpperCase() + rarity.slice(1);
    const titleEmoji = rarity === "legendary" ? "\uD83D\uDFE1" : rarity === "rare" ? "\uD83C\uDF81" : "\uD83D\uDCE6";
    return message.reply({
      embeds: [
        embed({
          color: rarity === "legendary" ? 0xF1C40F : rarity === "rare" ? 0x9B59B6 : COLORS.success,
          title: `${titleEmoji} Opened ${qty}\u00D7 ${rarityName} Box!`,
          description: lines.join("\n").slice(0, 3500),
          fields: [{ name: "Balance", value: coin(after.wallet), inline: false }],
        }),
      ],
    });
  },
};

// ===== Box loot tables =====
// COINS are the PRIMARY reward (~75% of pulls), in small-to-mid amounts so
// you don't always profit. ITEMS are the occasional reward (~25%) and add
// variety. All boxes are tuned for a NET LOSS on average so opening boxes
// can never be an infinite money source.
//
// EV vs box price (verified by math in code review):
//   Mystery Box  cost 2,500 -> EV ~1,800 (~28% house edge)
//   Rare Box     cost 6,000 -> EV ~4,500 (~25% house edge)
//   Legendary    cost 7,000 -> EV ~5,500 (~21% house edge)
//
// The 5 coin tiers each box uses follow this pattern:
//   Tier 1 (low):    very small consolation drop, like the "200 coins" drop
//   Tier 2 (common): typical drop, ~40% of box price
//   Tier 3 (mid):    average drop, ~75% of box price
//   Tier 4 (good):   above-cost drop, ~140% of box price
//   Tier 5 (jackpot): rare big win, ~250% of box price (still capped)
const LOOT = {
  // ---------- Mystery Box (cost 2,500, EV ~1,800) ----------
  common: [
    // Coins ~75% (5 tiers of varying generosity, weights total 75)
    { item: { kind: "coins", min: 100,  max: 600  }, weight: 13 }, // tier 1: tiny "200" drop
    { item: { kind: "coins", min: 600,  max: 1500 }, weight: 22 }, // tier 2: typical
    { item: { kind: "coins", min: 1500, max: 2700 }, weight: 22 }, // tier 3: average
    { item: { kind: "coins", min: 2700, max: 4500 }, weight: 13 }, // tier 4: good
    { item: { kind: "coins", min: 4500, max: 6500 }, weight: 5 },  // tier 5: jackpot
    // Items ~25% (mostly mid-value boosts/tools, no top-tier yet)
    { item: { kind: "item", id: "lottery_ticket",   qty: 1 }, weight: 3 }, // 1,000
    { item: { kind: "item", id: "pet_treat",        qty: 2 }, weight: 2 }, // 1,000
    { item: { kind: "item", id: "premium_pet_food", qty: 1 }, weight: 2 }, // 750
    { item: { kind: "item", id: "premium_water",    qty: 1 }, weight: 2 }, // 500
    { item: { kind: "item", id: "wooden_shovel",    qty: 1 }, weight: 2 }, // 500
    { item: { kind: "item", id: "basic_rod",        qty: 1 }, weight: 2 }, // 500
    { item: { kind: "item", id: "bank_note",        qty: 1 }, weight: 2 }, // 1,000
    { item: { kind: "item", id: "iron_shovel",      qty: 1 }, weight: 2 }, // 1,500
    { item: { kind: "item", id: "lucky_rod",        qty: 1 }, weight: 2 }, // 1,500
    { item: { kind: "item", id: "money_boost_1d",   qty: 1 }, weight: 2 }, // 1,500
    { item: { kind: "item", id: "spiked_wallet",    qty: 1 }, weight: 1 }, // 1,500
    { item: { kind: "item", id: "luck_boost_1d",    qty: 1 }, weight: 1 }, // 2,500
    { item: { kind: "item", id: "vault_drill",      qty: 1 }, weight: 1 }, // 2,500
    { item: { kind: "item", id: "mystery_box",      qty: 1 }, weight: 1 }, // 2,500 (chain!)
  ],
  // ---------- Rare Box (cost 6,000, EV ~4,500) ----------
  rare: [
    // Coins ~75%
    { item: { kind: "coins", min: 300,   max: 1800  }, weight: 12 }, // tier 1
    { item: { kind: "coins", min: 1800,  max: 3500  }, weight: 22 }, // tier 2
    { item: { kind: "coins", min: 3500,  max: 6000  }, weight: 22 }, // tier 3
    { item: { kind: "coins", min: 6000,  max: 9500  }, weight: 13 }, // tier 4
    { item: { kind: "coins", min: 9500,  max: 14000 }, weight: 6 },  // tier 5: jackpot
    // Items ~25% (mid-to-high tier)
    { item: { kind: "item", id: "iron_shovel",      qty: 2 }, weight: 3 }, // 3,000
    { item: { kind: "item", id: "lucky_rod",        qty: 2 }, weight: 3 }, // 3,000
    { item: { kind: "item", id: "spiked_wallet",    qty: 2 }, weight: 2 }, // 3,000
    { item: { kind: "item", id: "money_boost_1d",   qty: 2 }, weight: 2 }, // 3,000
    { item: { kind: "item", id: "vault_drill",      qty: 1 }, weight: 2 }, // 2,500
    { item: { kind: "item", id: "luck_boost_1d",    qty: 1 }, weight: 2 }, // 2,500
    { item: { kind: "item", id: "heist_booster",    qty: 1 }, weight: 2 }, // 2,000
    { item: { kind: "item", id: "wallet_lock",      qty: 1 }, weight: 2 }, // 2,000
    { item: { kind: "item", id: "gold_pickaxe",     qty: 1 }, weight: 2 }, // 3,000
    { item: { kind: "item", id: "guard",            qty: 1 }, weight: 1 }, // 3,000
    { item: { kind: "item", id: "dig_luck_charm",   qty: 1 }, weight: 1 }, // 3,000
    { item: { kind: "item", id: "inv_protection",   qty: 1 }, weight: 1 }, // 3,500
    { item: { kind: "item", id: "guard_with_gun",   qty: 1 }, weight: 1 }, // 4,000
    { item: { kind: "item", id: "mystery_box",      qty: 1 }, weight: 1 }, // 2,500
  ],
  // ---------- Legendary Box (cost 7,000, EV ~5,500) ----------
  legendary: [
    // Coins ~75%
    { item: { kind: "coins", min: 400,   max: 2200  }, weight: 12 }, // tier 1
    { item: { kind: "coins", min: 2200,  max: 4500  }, weight: 22 }, // tier 2
    { item: { kind: "coins", min: 4500,  max: 7500  }, weight: 22 }, // tier 3
    { item: { kind: "coins", min: 7500,  max: 12000 }, weight: 13 }, // tier 4
    { item: { kind: "coins", min: 12000, max: 18000 }, weight: 6 },  // tier 5: jackpot
    // Items ~25% (high-tier, occasional top-tier)
    { item: { kind: "item", id: "diamond_pickaxe",  qty: 1 }, weight: 3 }, // 3,200
    { item: { kind: "item", id: "diamond_rod",      qty: 1 }, weight: 3 }, // 2,800
    { item: { kind: "item", id: "money_boost_1d",   qty: 2 }, weight: 2 }, // 3,000
    { item: { kind: "item", id: "luck_boost_1d",    qty: 2 }, weight: 2 }, // 5,000
    { item: { kind: "item", id: "heist_booster",    qty: 2 }, weight: 2 }, // 4,000
    { item: { kind: "item", id: "inv_protection",   qty: 1 }, weight: 2 }, // 3,500
    { item: { kind: "item", id: "guard_with_gun",   qty: 1 }, weight: 2 }, // 4,000
    { item: { kind: "item", id: "dig_luck_charm",   qty: 1 }, weight: 2 }, // 3,000
    { item: { kind: "item", id: "vault_drill",      qty: 2 }, weight: 1 }, // 5,000
    { item: { kind: "item", id: "money_boost_7d",   qty: 1 }, weight: 1 }, // 6,000
    { item: { kind: "item", id: "luck_boost_7d",    qty: 1 }, weight: 1 }, // 5,000
    { item: { kind: "item", id: "pet_xp_boost",     qty: 1 }, weight: 1 }, // 2,000
    { item: { kind: "item", id: "pet_luck_charm",   qty: 1 }, weight: 1 }, // 10,000 (rare jackpot item)
    { item: { kind: "item", id: "rare_mystery_box", qty: 1 }, weight: 1 }, // 6,000 (chain!)
    { item: { kind: "item", id: "mystery_box",      qty: 2 }, weight: 1 }, // 5,000
  ],
};

// ===== Sell & shopsell =====
const sell = {
  name: "sell",
  category: cat,
  description: "Sell items from inventory. ,sell all = sell all dig/fish finds.",
  usage: ",sell <item|all> [qty]",
  async run({ message, args }) {
    if (!args[0]) return message.reply({ embeds: [errEmbed("Usage: `,sell <item|all> [qty]`")] });
    if (args[0].toLowerCase() === "all") {
      const inv = db.listInventory(message.author.id);
      let total = 0;
      const sold = [];
      for (const row of inv) {
        const def = ITEMS[row.item_id];
        if (!def || def.type !== "find") continue;
        const each = def.sell || 0;
        if (each <= 0) continue;
        const got = each * row.qty;
        total += got;
        sold.push(`${row.qty}× ${def.name} → ${coin(got)}`);
        db.removeItem(message.author.id, row.item_id, row.qty);
      }
      if (!total) return message.reply({ embeds: [errEmbed("Nothing to sell.")] });
      db.addWallet(message.author.id, total);
      return message.reply({ embeds: [okEmbed(`Sold all finds for **${coin(total)}**.\n\n${sold.join("\n")}`, "Sell All")] });
    }
    const trailing = args[args.length - 1];
    let qty = null;
    let q = args.join(" ");
    if (/^\d+$/.test(trailing) && args.length > 1) {
      qty = parseInt(trailing, 10);
      q = args.slice(0, -1).join(" ");
    }
    const item = findItemByName(q);
    if (!item) return message.reply({ embeds: [errEmbed("Item not found.")] });
    // Block qty <= 0 (would otherwise be a free no-op message).
    if (qty != null && qty <= 0) return message.reply({ embeds: [errEmbed("Quantity must be at least 1.")] });
    const have = db.getItem(message.author.id, item.id);
    if (have <= 0) return message.reply({ embeds: [errEmbed(`You don't have any **${item.name}**.`)] });
    if (qty == null) qty = have;
    if (qty > have) qty = have;
    const each = item.sell || 0;
    if (each <= 0) return message.reply({ embeds: [errEmbed(`**${item.name}** can't be sold here.`)] });
    db.removeItem(message.author.id, item.id, qty);
    const total = each * qty;
    db.addWallet(message.author.id, total);
    return message.reply({ embeds: [okEmbed(`Sold ${qty}× **${item.name}** for ${coin(total)}.`)] });
  },
};

const shopsell = {
  name: "shopsell",
  category: cat,
  description: "View dig/fish find sell prices.",
  usage: ",shopsell",
  async run({ message }) {
    const finds = Object.values(ITEMS).filter((i) => i.type === "find" && i.sell);
    const lines = finds.map((i) => `${i.emoji || ""} **${i.name}** — ${coin(i.sell)} each`);
    return message.reply({
      embeds: [
        embed({
          color: COLORS.info,
          title: "Find Sell Prices",
          description: lines.join("\n"),
        }),
      ],
    });
  },
};

const reset = {
  name: "reset",
  category: cat,
  description: "Sell EVERYTHING in your inventory at 85% of buy price.",
  usage: ",reset",
  async run({ message }) {
    const preview = db.listInventory(message.author.id);
    if (!preview.length) return message.reply({ embeds: [errEmbed("Inventory is empty.")] });
    await message.reply({ content: "Type `confirm` within 15s to sell **everything** at 85%." });
    try {
      await message.channel.awaitMessages({
        filter: (m) => m.author.id === message.author.id && m.content.toLowerCase() === "confirm",
        max: 1,
        time: 15_000,
        errors: ["time"],
      });
    } catch {
      return message.channel.send({ embeds: [errEmbed("Reset cancelled.")] });
    }
    // CRITICAL: Re-read inventory AFTER confirm and credit ONLY for the
    // amount db.removeItem actually removed. The previous version
    // snapshotted `inv` BEFORE the 15s prompt and credited based on that
    // snapshot — letting a user trade or give items away during the
    // window and still get paid for items they no longer owned
    // (db.removeItem silently no-ops on items the user doesn't have).
    const inv = db.listInventory(message.author.id);
    if (!inv.length) return message.channel.send({ embeds: [errEmbed("Reset cancelled — inventory is now empty.")] });
    let total = 0;
    for (const row of inv) {
      const def = ITEMS[row.item_id];
      if (!def) continue;
      const price = Math.floor((def.price || def.sell || 0) * 0.85);
      // Use the actual amount removed (clamped to current ownership) so a
      // mid-flow give/trade can never produce phantom payouts.
      const actuallyRemoved = db.removeItem(message.author.id, row.item_id, row.qty);
      total += price * actuallyRemoved;
    }
    db.addWallet(message.author.id, total);
    return message.channel.send({ embeds: [okEmbed(`Sold everything for **${coin(total)}**.`, "Inventory Reset")] });
  },
};

// ===== Owned-role management: equip / unequip / list =====
//
// Once a player buys a shop role or color, the ownership is permanent — they
// can take it off and put it back on as many times as they like without
// paying again. These three commands drive that:
//
//   ,equip <code>     Wear an owned role.
//   ,unequip <code>   Take off an owned role (keep ownership).
//   ,myroles          List all owned shop roles + which are equipped.
//
// The CODE is the same shop entry code shown on `,shop` (e.g. RBLU01). We
// resolve by code first, then fall back to a case-insensitive name match
// against owned roles so the player doesn't have to memorize codes.

function resolveOwnedRole(message, query) {
  if (!message.guild || !query) return null;
  const owned = db.listOwnedShopRoles(message.author.id, message.guild.id);
  if (!owned.length) return null;
  const upper = query.toUpperCase();
  // Try exact code match first (deterministic).
  const byCode = owned.find((o) => o.code.toUpperCase() === upper);
  if (byCode) return byCode;
  // Then case-insensitive name match against the live shop entry.
  const lower = query.toLowerCase();
  for (const o of owned) {
    const entry = db.getShopEntryByCode(o.code);
    if (entry && entry.name.toLowerCase() === lower) return o;
  }
  return null;
}

const equip = {
  name: "equip",
  category: cat,
  description: "Wear an owned shop role or color.",
  usage: ",equip <code|name>",
  async run({ message, args }) {
    if (!message.guild) return message.reply({ embeds: [errEmbed("Use this in a server.")] });
    const query = args.join(" ").trim();
    if (!query) return message.reply({ embeds: [errEmbed("Usage: `,equip <code>` (see `,myroles`).")] });
    const owned = resolveOwnedRole(message, query);
    if (!owned) return message.reply({ embeds: [errEmbed("You don't own that role. Buy it first or check `,myroles`.")] });
    const entry = db.getShopEntryByCode(owned.code);
    const role = await message.guild.roles.fetch(owned.role_id).catch(() => null);
    if (!role) return message.reply({ embeds: [errEmbed("That role no longer exists on the server.")] });
    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return message.reply({ embeds: [errEmbed("Could not find you in this server.")] });

    // Colors are mutually exclusive: unequip every other owned color (and
    // strip the Discord roles) before adding this one.
    if (owned.category === "colors") {
      const otherOwned = db.listOwnedShopRoles(message.author.id, message.guild.id)
        .filter((o) => o.category === "colors" && o.code !== owned.code && o.equipped);
      for (const o of otherOwned) {
        await member.roles.remove(o.role_id).catch(() => {});
      }
      db.unequipAllColorsForUser(message.author.id, message.guild.id);
    }

    await member.roles.add(role).catch(() => {});
    db.setOwnedShopRoleEquipped(message.author.id, message.guild.id, owned.code, true);
    const name = entry?.name || role.name;
    return message.reply({ embeds: [okEmbed(`Equipped **${name}**.`)] });
  },
};

const unequip = {
  name: "unequip",
  category: cat,
  description: "Remove an owned shop role (keep ownership so you can re-equip later).",
  usage: ",unequip <code|name>",
  async run({ message, args }) {
    if (!message.guild) return message.reply({ embeds: [errEmbed("Use this in a server.")] });
    const query = args.join(" ").trim();
    if (!query) return message.reply({ embeds: [errEmbed("Usage: `,unequip <code>` (see `,myroles`).")] });
    const owned = resolveOwnedRole(message, query);
    if (!owned) return message.reply({ embeds: [errEmbed("You don't own that role.")] });
    const entry = db.getShopEntryByCode(owned.code);
    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return message.reply({ embeds: [errEmbed("Could not find you in this server.")] });
    await member.roles.remove(owned.role_id).catch(() => {});
    db.setOwnedShopRoleEquipped(message.author.id, message.guild.id, owned.code, false);
    const name = entry?.name || "role";
    return message.reply({ embeds: [okEmbed(`Unequipped **${name}**. Use \`,equip ${owned.code}\` to wear it again.`)] });
  },
};

const myroles = {
  name: "myroles",
  aliases: ["roles"],
  category: cat,
  description: "List shop roles and colors you own (and which are equipped).",
  usage: ",myroles",
  async run({ message }) {
    if (!message.guild) return message.reply({ embeds: [errEmbed("Use this in a server.")] });
    const owned = db.listOwnedShopRoles(message.author.id, message.guild.id);
    if (!owned.length) {
      return message.reply({ embeds: [embed({
        color: COLORS.info,
        title: "Your Roles",
        description: "You don't own any shop roles yet. Browse with `,shop` and buy one to get started.",
      })] });
    }
    const lines = owned.map((o) => {
      const entry = db.getShopEntryByCode(o.code);
      const label = entry ? entry.name : `Role ${o.code}`;
      const status = o.equipped ? "**[equipped]**" : "*(unequipped)*";
      const cmd = o.equipped ? `\`,unequip ${o.code}\`` : `\`,equip ${o.code}\``;
      return `\u2022 ${label} ${status} \u2014 ${cmd}`;
    });
    return message.reply({ embeds: [embed({
      color: COLORS.info,
      title: `Your Roles (${owned.length})`,
      description: lines.join("\n"),
      footer: { text: "Ownership is permanent — toggle freely, no extra cost." },
    })] });
  },
};

module.exports = {
  commands: [shop, buy, open, sell, shopsell, reset, equip, unequip, myroles],
  sendShopLanding,
  sendShopPage,
  buildShopChooser,
  buildShopLanding,
  buildShopPage,
  buildBuyConfirm,
  buyStaticItem,
  buyShopEntry,
};
