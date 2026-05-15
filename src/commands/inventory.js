"use strict";

const db = require("../db");
const { embed, errEmbed, okEmbed, coin, resolveMember, fmtDuration } = require("../utils");
const { COLORS } = require("../config");
const { ITEMS, findItemByName } = require("../items");

const cat = "inventory";

const TABS = ["tools", "consumables", "finds", "boxes"];

const inv = {
  name: "inv",
  aliases: ["inventory", "items"],
  category: cat,
  description: "View your inventory (4 tabs).",
  usage: ",inv [@user] [tab]",
  async run({ message, args }) {
    const target = args[0] && /^<@|\d{17,}/.test(args[0]) ? await resolveMember(args[0], message) : null;
    const user = target?.user || message.author;
    const tab = (args.find((a) => TABS.includes(a.toLowerCase())) || "tools").toLowerCase();
    const rows = db.listInventory(user.id);
    if (!rows.length) return message.reply({ embeds: [embed({ color: COLORS.info, title: `${user.username}'s Inventory`, description: "_empty_" })] });

    const groups = { tools: [], consumables: [], finds: [], boxes: [] };
    for (const r of rows) {
      const d = ITEMS[r.item_id];
      if (!d) continue;
      const line = `\`${r.item_id}\` ${d.emoji || ""} **${d.name}** ×${r.qty}`;
      if (d.type === "tool") groups.tools.push(line);
      else if (d.type === "find") groups.finds.push(line);
      else if (d.type === "box") groups.boxes.push(line);
      else groups.consumables.push(line);
    }
    const fields = TABS.map((t) => ({
      name: `${t === tab ? "▶ " : ""}${t[0].toUpperCase()+t.slice(1)} (${groups[t].length})`,
      value: groups[t].length ? groups[t].slice(0, 15).join("\n") : "_empty_",
      inline: false,
    }));
    return message.reply({ embeds: [embed({
      color: COLORS.primary,
      author: { name: `${user.username}'s Inventory`, iconURL: user.displayAvatarURL() },
      fields,
      footer: `Tabs: ${TABS.join(" • ")}  |  ,use <item> to activate`,
    })] });
  },
};

const use = {
  name: "use",
  aliases: ["activate"],
  category: cat,
  description: "Activate an item (boost, food, etc.).",
  usage: ",use <item>",
  async run({ message, args }) {
    if (!args.length) return message.reply({ embeds: [errEmbed("Usage: `,use <item>`")] });
    const item = findItemByName(args.join(" "));
    if (!item) return message.reply({ embeds: [errEmbed("Item not found.")] });
    const have = db.getItem(message.author.id, item.id);
    if (have <= 0) return message.reply({ embeds: [errEmbed(`You don't have **${item.name}**.`)] });

    if (item.type === "boost") {
      db.removeItem(message.author.id, item.id, 1);
      const expires = Date.now() + (item.durationMs || 60 * 60 * 1000);
      db.setActive(message.author.id, item.id, expires, null);
      return message.reply({ embeds: [okEmbed(`Activated **${item.name}** for ${fmtDuration(item.durationMs || 3600000)}.`)] });
    }

    if (item.type === "food" || item.type === "water") {
      const pets = db.listPets(message.author.id);
      if (!pets.length) return message.reply({ embeds: [errEmbed("You have no pets.")] });
      const target = pets[0]; // first pet
      db.removeItem(message.author.id, item.id, 1);
      if (item.type === "food") {
        const restore = item.id === "premium_pet_food" ? 100 : 50;
        const newH = Math.min(100, target.hunger + restore);
        db.updatePet(target.id, { hunger: newH, last_fed: Date.now() });
        return message.reply({ embeds: [okEmbed(`Fed **${target.name}** (${target.hunger} \u2192 ${newH} hunger).`)] });
      } else {
        const newT = Math.min(100, target.thirst + 50);
        db.updatePet(target.id, { thirst: newT, last_watered: Date.now() });
        return message.reply({ embeds: [okEmbed(`Watered **${target.name}** (${target.thirst} \u2192 ${newT} thirst).`)] });
      }
    }

    // Pet treats: XP-only, no hunger restore. Routed via `,use` (and the
    // dedicated `,treat` command) instead of `,feed` to prevent the
    // double-effect (hunger + XP) that would make `,treat` strictly worse.
    if (item.type === "treat") {
      const pets = db.listPets(message.author.id);
      if (!pets.length) return message.reply({ embeds: [errEmbed("You have no pets.")] });
      const target = pets[0];
      db.removeItem(message.author.id, item.id, 1);
      const xp = item.xpBonus || 50;
      let newXp = target.xp + xp;
      let newLevel = target.level;
      if (newXp >= target.level * 100) { newXp -= target.level * 100; newLevel++; }
      db.updatePet(target.id, { xp: newXp, level: newLevel });
      const lvlUp = newLevel > target.level ? ` \u2014 leveled up to **${newLevel}**!` : "";
      return message.reply({ embeds: [okEmbed(`**${target.name}** loved the treat! +${xp} XP${lvlUp}`)] });
    }

    if (item.type === "tool") {
      return message.reply({ embeds: [embed({ color: COLORS.info, description: `Tools auto-activate via \`,dig\` or \`,fish\`.` })] });
    }

    if (item.type === "lottery") {
      return message.reply({ embeds: [embed({ color: COLORS.info, description: `Lottery tickets are auto-entered when bought.` })] });
    }

    if (item.type === "consumable") {
      return message.reply({ embeds: [embed({ color: COLORS.info, description: `**${item.name}** is consumed automatically by the relevant command (e.g. ,heist or ,cockfight).` })] });
    }

    if (item.type === "box") {
      return message.reply({ embeds: [embed({ color: COLORS.info, description: `Use \`,open\` to open boxes.` })] });
    }

    return message.reply({ embeds: [errEmbed("This item doesn't have a use action.")] });
  },
};

module.exports = { commands: [inv, use] };
