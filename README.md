# watai-bot

Discord bot for WAT.ai tasks, deadlines and projects, with automatic reminders. Features and decisions: [`docs/SPEC.md`](docs/SPEC.md).

## Setup

1. **Discord app:** create one at <https://discord.com/developers/applications>, add a bot, copy the token and application ID. Invite it with scopes `bot` + `applications.commands` and permissions: View Channels, Send Messages, Embed Links, Create Public Threads, Send Messages in Threads, Mention Everyone.
2. **Env:** `cp .env.example .env` and fill it in. Set `DISCORD_GUILD_ID` so commands appear instantly.
3. **Google Sheet (optional):** see [Google Sheets mirror](#google-sheets-mirror).
4. **Run:** `docker compose up -d --build` (bot + Postgres). Migrations and command registration run on start.
5. **In Discord** (as someone with Manage Server):
   - `/config set digest_channel:#… default_ping:@Members`
   - `/config show`, then pick default reminder channels from the menu
   - `/config team` for each team: its role and reminder channel
   - `/config access role:@Execs level:Manager` (and `Admin` for whoever else runs `/config`)

## Google Sheets mirror

The bot rewrites `Tasks` and `Projects` tabs in the sheet ~10 s after each change and hourly. Edits made in the sheet are overwritten.

1. Go to <https://console.cloud.google.com> with a **personal Google account**. University and other Workspace orgs often block service-account keys (policy `iam.disableServiceAccountKeyCreation`).
2. Top bar → project picker → **New project** (e.g. `watai-bot`) → **Create**, then select it.
3. **APIs & Services → Library** → search **Google Sheets API** → **Enable**.
4. **IAM & Admin → Service accounts → Create service account**. Name it `watai-sheets` → **Create and continue** → skip both optional steps (no project roles needed) → **Done**.
5. Open the account → **Keys → Add key → Create new key → JSON → Create**. A `.json` file downloads. Keep it outside this repo; it is a password.
6. Copy the account's email (`watai-sheets@<project>.iam.gserviceaccount.com`, also `client_email` in the file).
7. Open the sheet → **Share** → paste that email → **Editor** → untick **Notify people** → **Share**. If sharing outside your org is blocked, the sheet's owner or Workspace admin must allow it, or move the sheet to a personal account.
8. Encode the key onto one line and put it in `.env`:
   ```bash
   base64 -w0 path/to/key.json   # macOS: base64 -i path/to/key.json
   ```
   ```
   GOOGLE_SHEET_ID=<id between /d/ and /edit in the sheet URL>
   GOOGLE_SERVICE_ACCOUNT_JSON=<base64 output>
   ```
9. Restart the bot. The log should say `Google Sheets mirror on`, and the two tabs appear within about a minute.

| Log error | Fix |
| --- | --- |
| `403 … caller does not have permission` | Step 7: sheet not shared with the service account |
| `403 … API has not been used in project` | Step 3: enable the Sheets API, wait a minute |
| `404 … Requested entity was not found` | Wrong `GOOGLE_SHEET_ID` |
| `Invalid environment` / JSON parse error | Re-run step 8; paste the whole base64 line with no quotes |

To revoke: delete the key under **Keys**, or remove the email from the sheet's sharing.

## Develop

Needs Node ≥22.18, pnpm, and a Postgres at `DATABASE_URL`.

```bash
pnpm install
pnpm dev
pnpm typecheck && pnpm lint && pnpm test
```

Tests use an in-process Postgres (PGlite); no database needed.
