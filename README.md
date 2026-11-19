# watai-bot

Discord bot for WAT.ai tasks, deadlines and projects, with automatic reminders. Features and decisions: [`docs/SPEC.md`](docs/SPEC.md).

## Deploy (Railway)

No local clone needed: Railway builds straight from GitHub. On Railway there is no `.env` file; the variables below go in its dashboard.

1. **Discord app:** <https://discord.com/developers/applications> → **New Application** → **Bot** → **Reset Token**, copy it. Copy the **Application ID** from **General Information**. Invite the bot: **OAuth2 → URL Generator**, scopes `bot` + `applications.commands`, permissions View Channels, Send Messages, Embed Links, Create Public Threads, Send Messages in Threads, Mention Everyone. Open the URL and pick the server.
2. **Merge to `main`**, or note the branch name: Railway deploys from one branch.
3. <https://railway.com> → sign in with GitHub → **New Project → Deploy from GitHub repo** → `watai-bot`. It finds `Dockerfile` and `railway.json`.
4. In the project: **Create → Database → PostgreSQL**.
5. Bot service → **Variables** → add:

   | Name | Value |
   | --- | --- |
   | `DISCORD_TOKEN` | Bot token (step 1) |
   | `DISCORD_CLIENT_ID` | Application ID (step 1) |
   | `DISCORD_GUILD_ID` | Server ID (Discord: enable Developer Mode, right-click the server → Copy Server ID) |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` | Optional, see [Google Sheets mirror](#google-sheets-mirror) |

6. Bot service → **Settings**: if deploying a branch other than `main`, set it under **Source**. Keep **1 replica**: two would double-post.
7. **Deploy**. Logs should end with `ready as <bot name>`. Every push to the branch redeploys; migrations and slash-command registration run on start.
8. **Hand-over:** add teammates under project **Settings → Members**.

## First-time Discord setup

As someone with Manage Server:

- `/config set default_ping:@Members` — who org-wide check-ins and digests ping
- `/config show`, then pick default reminder channels from the menu
- `/config team` for each team: its role and reminder channel
- `/config access role:@Execs level:Manager` (and `Admin` for others who run `/config`)
- `/digest create` per team (e.g. `name:Events channel:#events`, then pick Events), and one org-wide digest with no teams. `/digest send` previews one now.

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

## Develop locally

Only needed to change code. Needs Node ≥22.18, pnpm and Docker.

```bash
git clone https://github.com/katie-zhong/watai-bot && cd watai-bot
cp .env.example .env   # fill in; lives in the repo root, git-ignored
docker compose up -d db
pnpm install
```

```bash
pnpm dev
pnpm typecheck && pnpm lint && pnpm test
```

Tests use an in-process Postgres (PGlite); no database needed.
