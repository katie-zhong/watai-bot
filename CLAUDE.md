# watai-bot

Discord bot for WAT.ai task, deadline and project tracking. `docs/SPEC.md` is the source of truth.

## Working preferences (owner's standing instructions)

- **Docs:** extremely concise, no filler. Only key decisions (with the reason), key features and usage.
- **Chat:** justify technical decisions concisely and directly; surface everything the owner should know; link evidence where it matters.
- **New projects:** start with repo guardrails before app code — `CLAUDE.md`, `.claude/settings.json` (allow safe commands, deny destructive ones and secret reads, format-on-edit hook), `.gitignore`, `docs/SPEC.md`. Choose the stack that best fits the specs and explain why; don't default to a template.

## Stack

Node ≥22.18 (runs TypeScript natively, no build step) · strict TypeScript · discord.js v14 · Postgres via Drizzle ORM · Biome (lint + format) · Vitest with PGlite · pnpm.

## Layout

| Path | Holds | Rule |
| --- | --- | --- |
| `src/domain/` | Terms, date parsing, reminder schedule | Pure: no DB, no Discord |
| `src/services/` | All database queries | Take `db` as first argument; scope every query by `guildId` |
| `src/discord/` | Commands, embeds, select-menu panels, component router | Thin: validate → call a service → render |
| `src/jobs/` | Hourly reminders, digests, check-ins | Reach Discord only through `Messenger`; idempotent per local day |
| `src/sheets/` | One-way Google Sheets mirror | Never read from the sheet |
| `drizzle/` | Generated SQL migrations | Never hand-edit; run `pnpm db:generate` after changing `src/db/schema.ts` |

## Rules

- Read `docs/SPEC.md` before a feature; update it when behaviour changes.
- Before finishing: `pnpm typecheck && pnpm lint && pnpm test`.
- No `any`, `@ts-ignore` or non-null `!`. Use `import type` and `.ts` import extensions; no enums or parameter properties (Node strips types, it does not compile).
- Bot messages never ping unless `allowedMentions` is set on that message.
- New command: add it to `src/discord/commands/index.ts` and the `/help` list.
- Component ids are `<scope>:<action>:<id>[:<arg>]`, routed in `src/discord/components.ts`.
- Secrets live in `.env` only.

## Commands

`pnpm dev` · `pnpm test` · `pnpm typecheck` · `pnpm lint:fix` · `pnpm db:generate` · `docker compose up -d --build`
