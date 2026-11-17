# watai-bot

Discord bot for WAT.ai tasks, deadlines and projects, with automatic reminders. Features and decisions: [`docs/SPEC.md`](docs/SPEC.md).

## Setup

1. **Discord app:** create one at <https://discord.com/developers/applications>, add a bot, copy the token and application ID. Invite it with scopes `bot` + `applications.commands` and permissions: View Channels, Send Messages, Embed Links, Create Public Threads, Send Messages in Threads, Mention Everyone.
2. **Env:** `cp .env.example .env` and fill it in. Set `DISCORD_GUILD_ID` so commands appear instantly.
3. **Google Sheet (optional):** create a Google Cloud service account, enable the Sheets API, share the sheet with the account's email as Editor, and put its JSON key in `GOOGLE_SERVICE_ACCOUNT_JSON`.
4. **Run:** `docker compose up -d --build` (bot + Postgres). Migrations and command registration run on start.
5. **In Discord:** `/config set digest_channel:#…`, `/config show` to pick default ping channels, `/config team` to map each team's role and channel.

## Develop

Needs Node ≥22.18, pnpm, and a Postgres at `DATABASE_URL`.

```bash
pnpm install
pnpm dev
pnpm typecheck && pnpm lint && pnpm test
```

Tests use an in-process Postgres (PGlite); no database needed.
