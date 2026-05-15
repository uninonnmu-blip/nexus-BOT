"use strict";

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const { COLORS } = require("../config");

const cat = "misc";

const PAGES = [
  {
    title: "Help — Earning & Balance (1/7)",
    sections: [
      {
        heading: "Balance & Bank",
        lines: [
          "`,bal [@user]` / `,wallet` — Check balance",
          "`,deposit/withdraw <amt|all>` — Move money freely (no daily cap!)",
          "`,vault` — View your vault",
          "`,profile [@user]` — Full stats",
          "`,leaderboard` / `,lb` / `,top` — Richest members",
          "`,lbhide [days]` — Hide from leaderboard (2,000/day, max 5 days)",
          "`,lbshow` — Unhide early (free) | `,lbhidden` — Check status",
        ],
      },
      {
        heading: "Earning Coins",
        lines: [
          "Chat to earn 30–50 coins per message",
          "`,daily` — 1,500 every 24hrs (Boosters get 1.5x)",
          "`,work` — 50–1,500 coins (1hr CD) | `,crime` — 500–15,000, risk (4hr CD)",
          "`,slut` — Quick money (1hr CD)",
          "`,quests` — Daily bonus quests | `,guide` — Full money guide (DM)",
        ],
      },
      {
        heading: "Giving & Trading",
        lines: [
          "`,give @user <amount>` — Give coins (5% tax)",
          "`,give @user [qty] <item>` — Give item(s)",
          "`,trade @user <offer> for <offer>` — Trade items, coins, and/or roles",
          "→ Roles use `@RoleName` or `@roleId` prefix in offer",
          "→ Up to 5 items/roles + coins per side, joined by `+`",
          "→ Example: `Iron Shovel + @SexyRole + 500 for @CoolRole`",
          "`,bet @user <offer> for <offer>` — PvP wager (10% fee)",
        ],
      },
    ],
    footer: "Page 1/7 • Use ◀ ▶ to navigate",
  },
  {
    title: "Help — Shop, Inventory & Selling (2/7)",
    sections: [
      {
        heading: "Shop & Buying",
        lines: [
          "`,shop` — Public browse or DM (My Eyes Only)",
          "`,buy <name or ID> [qty]` — Buy directly",
          "`,open [qty]` — Open mystery boxes (Common, Rare, Legendary)",
          "Prices rise with demand (roles/colors capped at 25%)",
          "Buying a role grants **permanent ownership** + auto-equips it",
          "Re-buying an owned role is blocked — toggle it instead",
        ],
      },
      {
        heading: "Owned Roles (equip / unequip)",
        lines: [
          "`,myroles` (alias `,roles`) — List every shop role you own and which are equipped",
          "`,equip <code>` — Wear an owned role (works with code or name)",
          "`,unequip <code>` — Take it off without losing ownership",
          "Colors auto-swap: equipping one unequips any other owned color",
          "Ownership is permanent — toggle as often as you want, no extra cost",
        ],
      },
      {
        heading: "Selling",
        lines: [
          "`,sell all` — Sell all dig/fish finds",
          "`,sell <item> [qty]` — Sell specific item",
          "`,shopsell` — View find sell prices",
          "`,reset` — Sell EVERYTHING at 85% of buy price",
          "Admin shop editing: `,shop <type> edit <ID>` (includes sell price)",
        ],
      },
      {
        heading: "Inventory & Items",
        lines: [
          "`,inv [@user]` — View inventory (4 tabs)",
          "`,use <item>` — Activate an item",
          "Shovels/rods auto-activate via `,dig` / `,fish`",
          "Pets: 1 per type. Cannot be traded.",
        ],
      },
    ],
    footer: "Page 2/7 • Use ◀ ▶ to navigate",
  },
  {
    title: "Help — Digging, Fishing & Grab (3/7)",
    sections: [
      {
        heading: "Digging",
        lines: [
          "`,dig` — Dig for treasure",
          "Wooden 5min → Iron 3min → Gold 2min → Diamond no CD",
          "Diamond Pickaxe: multi-dig (up to 3×) — shows grouped summary",
          "Traps fine you. Cursed Artifact = -40% luck, -30% earnings 24hrs",
        ],
      },
      {
        heading: "Fishing",
        lines: [
          "`,fish` — Go fishing",
          "Basic 5min → Lucky 3min → Diamond no CD",
          "Diamond Rod: multi-cast (up to 3×) — shows grouped summary",
        ],
      },
      {
        heading: "Grab Drops",
        lines: [
          "`,grab` — Grab active drops in grab channels",
          "Always includes coins",
          "Lottery Ticket (1%) | Wooden Shovel/Basic Rod (3%)",
          "Iron Shovel (2.3%) | Lucky Rod (1.5%)",
          "Gold Pickaxe (1%) | Diamond Pickaxe (0.5%) | Diamond Rod (0.2%)",
        ],
      },
      {
        heading: "Curses & Payoff",
        lines: ["`,payoff` / `,uncurse` — Pay the Wizard to lift curse early"],
      },
    ],
    footer: "Page 3/7 • Use ◀ ▶ to navigate",
  },
  {
    title: "Help — Pets (4/7)",
    sections: [
      {
        heading: "Pet Commands",
        lines: [
          "`,pet <n>` — Interact (earn coins + XP)",
          "`,pets` — View all pets with status bars",
          "`,shop pets` — Buy pets, food, water, upgrades",
          "`,feed <n>` — Feed pet #N with the best food in your inventory",
          "`,water <n>` — Water pet #N with the best water item",
          "`,treat <n>` — Give a Pet Treat to pet #N (+50 XP, no hunger)",
          "Or `,use <food/water>` to feed/water your first pet automatically",
          "Pets die after 2 days without care!",
          "Hamster earns automatically every hour",
          "Level 10 = auto-income unlocked for all pets",
          "Common | Rare +15% income | Legendary +30% income",
        ],
      },
    ],
    footer: "Page 4/7 • Use ◀ ▶ to navigate",
  },
  {
    title: "Help — Custom Roles (5/7)",
    sections: [
      {
        heading: "Creating & Managing",
        lines: [
          "`,rrole create` — Create a custom role (wizard)",
          "`,rrole @user` — Invite someone to wear your role (any channel)",
          "`,rrole remove @user` — Remove a member from your role (any channel)",
          "`,rrole ping <msg>` — Ping role (2hr CD) (any channel)",
          "`,rrole renew` — Extend 7 days (30–65% of creation cost)",
          "`,rrole update` — Change name or color",
          "`,rrole duration` — Check time left",
          "`,rrole ownership @user` — Transfer ownership",
        ],
      },
      {
        heading: "Removing & Claiming",
        lines: [
          "`,rrole delete` — Delete your role entirely (vote if others have it)",
          "`,rrole remove <@role or roleID>` — Remove shop role → item returned to inventory",
          "`,rrole item @RoleName` — Convert a worn role back into an inventory item",
          "`,rrole unregister` — Remove role from custom role system (keeps Discord role)",
          "→ Choose: make claimable via `,rclaim` or just untrack it",
          "`,rrole leave` — Leave a role given to you (no refund)",
          "`,rclaim <name>` — Claim an ownerless role",
          "`,rroles` / `,rcustomroles` — List all custom roles & owners",
        ],
      },
      {
        heading: "Trading Roles",
        lines: [
          "Use `@RoleName` or `@roleId` in trade offers (must be a shop role)",
          "`,trade @user @SexyRole for 5000` — sell role for coins",
          "`,trade @user @SexyRole for @CoolRole` — swap roles",
          "`,trade @user Iron Shovel + @MyRole for 2000` — mix items and roles",
          "→ Role removed from sender, shop item given to receiver",
          "→ Color roles: receiver's old colors removed + returned to their inventory",
        ],
      },
      {
        heading: "Admin Role Commands",
        lines: [
          "`,rrole setowner <roleId> @user` — Set role owner",
          "`,rrole addexisting <roleId> [@user]` — Register existing Discord role",
          "`,rrole giveextra @user <roleId>` — Give user a 2nd custom role",
          "`,rrole permanent [@user]` — Make role permanent",
          "`,rrole extend @role <days|infinite>` — Extend role",
          "`,rrole unregister [@user]` — Untrack role (admin can target any user)",
          "`,admingive @user <item> [qty]` — Give items directly",
        ],
      },
    ],
    footer: "Page 5/7 • Use ◀ ▶ to navigate",
  },
  {
    title: "Help — Robbing & Gambling (6/7)",
    sections: [
      {
        heading: "Robbing",
        lines: [
          "`,rob @user` — Steal 5–25% of wallet",
          "`,heist @user` — Rob bank (needs Vault Drill)",
          "`,rob inv @user` — Steal items from inventory",
          "→ Inv Robber Luck boosts success | Inv Protection blocks 85% of attempts",
          "→ Inv Spike Trap counter-steals from robber",
          "`,hibernate` — Pay to be untouchable (max 5 days)",
        ],
      },
      {
        heading: "Gambling",
        lines: [
          "`,coinflip` — 2x on win. max 5,500, 0.16666666666666666min CD",
          "`,slots` — 1.2x–2.5x jackpot (symbol rarity). 2-of-a-kind = 1.1–1.3x. max 15,000, 8min CD",
          "`,blackjack` — 1.5x–2x on win. Double once → max 16,000. Natural BJ = 2x. 4min CD",
          "`,cockfight` (needs chicken) — 1.5x–2x on win; lose = bet + chicken gone",
          "Luck Boost — raises win chance only, not payout",
          "Money Boost — raises earnings on work/crime/chat only, not gambling",
          "Buy Lottery Ticket → auto-entered! Use `,lottery` to check jackpot",
        ],
      },
    ],
    footer: "Page 6/7 • Use ◀ ▶ to navigate",
  },
  {
    title: "Help — Admin & Misc (7/7)",
    sections: [
      {
        heading: "Admin",
        lines: [
          "`,adminbal set/add/remove @user <amt>`",
          "`,adminitem add/remove @user <item>`",
          "`,admingive @user <item> [qty]` — Give items directly",
          "`,adminrole permanent/extend/delete @user`",
          "`,giverole @user <roleId>` — Manually assign a role (tracks shop ownership)",
          "`,endlottery` — Force end the lottery draw",
          "`,adminhibernate @user <days|remove>` — Force-set or clear hibernation",
          "`,robber` — Spawn a robber drop in this channel (testing)",
          "`,diagnose` — Check all bot systems",
          "`,payoff` / `,uncurse` — Lift a dig curse",
          "Shop editing: `,shop <type> edit <ID>` (name, price, sell price, stock, etc.)",
          "Remove shop item: `,shop items/roles/colors remove <ID>`",
          "`,shop seed [colors|roles|all]` — Pre-fill shop with default colors/roles",
          "`,shop clear <colors|roles>` — Wipe a shop section before re-seeding",
        ],
      },
      {
        heading: "Channel Lock",
        lines: [
          "`,setchannel add #channel` — Lock the bot to a channel (allow-list)",
          "`,setchannel remove #channel` — Remove a channel from the allow-list",
          "`,setchannel list` — Show currently allowed channels",
          "`,setchannel clear` — Remove all restrictions (bot replies everywhere)",
          "Aliases: `,botchannel`, `,channellock`, `,channel`",
          "Note: `,setchannel` itself still works in any channel so you can never lock yourself out.",
        ],
      },
      {
        heading: "Leaderboard Privacy",
        lines: [
          "`,lbhide [days]` — Hide from leaderboard for 1–5 days (2,000 coins/day)",
          "`,lbshow` — Unhide early at any time (free)",
          "`,lbhidden` — Check your current hide status",
        ],
      },
      {
        heading: "Misc",
        lines: [
          "`,notifications off/on` — Toggle DM alerts (server or DMs)",
          "`,economy` (alias `,inflation`) — View current server inflation and total wealth",
          "`,currency` — This help menu",
          "`,guide` — Detailed money guide (sent to DMs)",
        ],
      },
    ],
    footer: "Page 7/7",
  },
];

function buildEmbed(i) {
  const p = PAGES[i];
  const eb = new EmbedBuilder().setColor(COLORS.info).setTitle(p.title).setFooter({ text: p.footer });
  const desc = p.sections
    .map((s) => `**${s.heading}**\n${s.lines.join("\n")}`)
    .join("\n\n");
  eb.setDescription(desc);
  return eb;
}

function buildRow(i, userId) {
  const prev = new ButtonBuilder()
    .setCustomId(`help:prev:${userId}`)
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("◀")
    .setDisabled(i === 0);
  const next = new ButtonBuilder()
    .setCustomId(`help:next:${userId}`)
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("▶")
    .setDisabled(i === PAGES.length - 1);
  const close = new ButtonBuilder()
    .setCustomId(`help:close:${userId}`)
    .setStyle(ButtonStyle.Danger)
    .setLabel("Close");
  return new ActionRowBuilder().addComponents(prev, next, close);
}

const help = {
  name: "currency",
  aliases: ["help", "commands", "cmds"],
  category: cat,
  description: "Show the help menu.",
  usage: ",currency",
  async run({ message }) {
    let i = 0;
    const userId = message.author.id;
    const msg = await message.reply({ embeds: [buildEmbed(i)], components: [buildRow(i, userId)] });
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 5 * 60 * 1000,
    });
    collector.on("collect", async (interaction) => {
      const [, action, ownerId] = interaction.customId.split(":");
      if (interaction.user.id !== ownerId) {
        return interaction.reply({ content: "This help menu isn't yours. Run `,currency` yourself.", ephemeral: true });
      }
      if (action === "prev") i = Math.max(0, i - 1);
      else if (action === "next") i = Math.min(PAGES.length - 1, i + 1);
      else if (action === "close") {
        collector.stop("closed");
        return interaction.update({ components: [] });
      }
      await interaction.update({ embeds: [buildEmbed(i)], components: [buildRow(i, userId)] });
    });
    collector.on("end", async () => {
      try {
        await msg.edit({ components: [] });
      } catch {}
    });
  },
};

module.exports = help;
