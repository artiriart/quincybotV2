# QuincybotV2

Discord utility bot focused on multi-bot parsing, reminders, calculators, and data indexing.

## What The Bot Does

- Tracks/aggregates data from multiple bots (`Dank`, `Anigame`, `Karuta`, `Izzi`, `7w7`).
- Runs startup sync for external datasets and emoji indexing (Dank items, Feather icons, Deco emojis, Izzi, Anigame).
- Provides configurable user/guild settings via `/settings`.
- Supports reminder workflows:
  - bot-driven reminders from parsed messages
  - custom reminders via `/reminder`
  - reminder poller with snooze/delete actions
- Provides utility commands:
  - `/help` (curated + filter dropdown)
  - `/repo` (quick GitHub section + button)
  - `/calculator`, `/dice`, `/ping`, `/invite`
- Provides Dank utilities:
  - `/dank stats`, `/dank itemcalc`, `/dank nuke`
  - multiplier editors/calculators and omega/prestige calculator
- Provides card/reminder utilities for Anigame and Karuta, plus Izzi shard lobby parsing.

## Requirements

- Node.js 20+
- npm

## Install

```bash
npm install
```

## Environment

Create `.env` in project root:

```env
BOT_TOKEN=your_discord_bot_token
OWNERS=OWNER_ID_1|OWNER_ID_2
KARUTA_RECOG=gemma
```

`KARUTA_RECOG` options:
- `gemma`
- `tesseract`
- `off`

## Run

```bash
node index.js
```

## Project Layout

- `index.js`: client bootstrap, startup sync, status/pollers.
- `database.js`: SQLite schema + query helpers.
- `events/`: Discord event entrypoints.
- `functions/`: routing, bot message handlers, interaction handlers, startup sync.
- `commands/`: slash/prefix command modules.
- `utils/`: shared helpers.

## Contributing

If you want to add more features or support more bots, PRs are welcome.

I review and accept practical, clean additions that fit the existing command/handler structure.

## External Resources

- Feather icons: https://feathericons.com/
- Google AI Studio (Gemma API keys): https://aistudio.google.com/api-keys
