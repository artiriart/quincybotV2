# QuincybotV2

Discord utility bot with multi-bot parsing, reminders, and synced data indexes.

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

On startup the bot initializes and syncs SQLite schema in `database.sqlite`.

## Project Layout

- `index.js`: client bootstrap and global setup.
- `database.js`: SQLite schema + query helpers.
- `functions/`: handlers and startup sync logic.
- `events/`: Discord event entrypoints.
- `commands/`: slash/prefix command modules.
- `utils/`: shared helper utilities.

## External Resources

- Feather icons: https://feathericons.com/
- Google AI Studio (Gemma API keys): https://aistudio.google.com/api-keys
