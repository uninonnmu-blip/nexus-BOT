# Currency Bot

A full-featured Discord economy / leveling / gambling / pets / digging / custom-roles bot. Replicates the command surface from the reference bot screenshots (7-page help menu, `,` prefix, ~70 commands).

## Features

- Earning: chat XP+coins, `,daily`, `,work`, `,crime`, `,slut`, `,quests`, `,guide`
- Balance & bank: `,bal`, `,wallet`, `,deposit`, `,withdraw`, `,vault`, `,profile`, `,leaderboard`, `,lbhide`, `,lbshow`, `,lbhidden`
- Giving & trading: `,give`, `,trade`, `,bet`
- Shop: `,shop`, `,buy`, `,open` (mystery boxes), `,sell`, `,shopsell`, `,reset`
- Inventory: `,inv`, `,use`
- Digging / fishing / grab: `,dig`, `,fish`, `,grab`, `,payoff` / `,uncurse`
- Pets: `,pet`, `,pets`, food/water care, hourly hamster income, level 10 auto-income
- Custom roles: full `,rrole` subcommand suite + `,rclaim`, `,rroles`
- Gambling: `,coinflip`, `,slots`, `,blackjack`, `,cockfight`, `,lottery`
- Robbing: `,rob`, `,heist`, `,hibernate` (+ inventory items: Robber Luck, Protection, Spike Trap, Vault Drill)
- Admin: `,adminbal`, `,adminitem`, `,admingive`, `,adminrole`, `,endlottery`, `,adminhibernate`, `,diagnose`
- Misc: `,currency` (paginated help), `,notifications`, `,guide`

## Setup

### 1. Create a Discord application

1. Go to <https://discord.com/developers/applications>
2. Click **New Application**, name it, then go to the **Bot** tab
3. Click **Reset Token** and copy the token
4. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (required for prefix commands)
   - **Server Members Intent** (required for member lookups)

### 2. Invite the bot

Use the OAuth2 → URL Generator with scopes `bot` and the following permissions (or just `Administrator` for testing):

- Read Messages / View Channels
- Send Messages
- Embed Links
- Attach Files
- Read Message History
- Add Reactions
- Manage Roles (required for `,rrole` features)
- Manage Messages (optional, for cleanup)

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```
DISCORD_TOKEN=your_bot_token_here
PREFIX=,
OWNER_IDS=
```

`OWNER_IDS` is **optional**. Admin commands (`,adminbal`, `,adminitem`, `,admingive`, `,adminrole`, `,endlottery`, `,diagnose`, `,shop edit`, etc.) are usable by anyone who has the **Administrator** permission in their Discord server. Only set `OWNER_IDS` (comma-separated) if you want certain users to have admin access **without** giving them the Discord Administrator role — useful if you (the bot developer) want to debug remotely.

### 4. Install & run

```bash
npm install
npm start
```

Database (`data.db`, SQLite) is created automatically on first run.

## Hosting

Works on any Node 18+ host. Common options:

- **Railway / Render**: just point at the repo, set env vars, start command `npm start`
- **VPS / PM2**: `pm2 start index.js --name currency-bot`
- **Locally**: `npm start`

## Project structure

```
index.js                # Bot entrypoint (login, message router, chat earning, hourly tickers)
src/
  config.js             # All tunable values (prefix, cooldowns, payouts, etc.)
  db.js                 # better-sqlite3 schema + helpers (users, items, pets, roles, lottery, ...)
  items.js              # Item catalog (shop items, pets, food, boosts, mystery boxes)
  utils.js              # Embeds, formatting, parsing, RNG helpers
  handler.js            # Command loader / dispatcher
  commands/
    balance.js          # bal, deposit, withdraw, vault, profile, leaderboard, lb*
    earning.js          # daily, work, crime, slut, quests, guide
    giving.js           # give, trade, bet
    shop.js             # shop, buy, open, sell, shopsell, reset
    inventory.js        # inv, use
    digging.js          # dig, fish, grab, payoff
    pets.js             # pet, pets
    gambling.js         # coinflip, slots, blackjack, cockfight, lottery
    robbing.js          # rob, heist, hibernate
    rroles.js           # rrole + subcommands, rclaim, rroles
    admin.js            # admin* commands, diagnose
    misc.js             # currency (alias of help), notifications
    help.js             # 7-page paginated help menu (mirrors reference screenshots)
```

## Notes

- All values (cooldowns, payouts, win rates, boost multipliers, role costs, pet decay, etc.) live in `src/config.js` so you can tune them without touching command code.
- The bot uses `better-sqlite3` (synchronous, fast, single-file). For multi-server hosted setups consider switching to Postgres in `src/db.js`.
- Custom roles call Discord's role API. The bot's role must be **above** any role it manages, and it needs `Manage Roles`.
- Lottery draws automatically every 24h from boot. Admins can force a draw with `,endlottery`.
- Pets decay every hour; warning DMs go out at 36h, death at 48h without food/water.
