# Spec

Discord bot that tracks tasks, deadlines and key artifacts for WAT.ai, with automatic pings. One product for two uses: exec operations and technical project management. Same users, same commands.

## Data

- **Task:** title, due date (optional time), owners (1+), teams (multi), term, optional project / milestone / link / notes / colour, status, blocker note, ping channels.
- **Project:** name (unique per server), description, lead, members, teams, term, colour, ping channels, pinned artifacts, milestones. Can be archived.
- **Teams:** events, partnerships, projects, community, finance.
- **Term:** `W` Jan–Apr, `S` May–Aug, `F` Sep–Dec + 2-digit year (`S26`). Derived from the due date; can be overridden.
- **Status:** open, in progress, blocked (requires a note), done.
- **Colour:** per task; unset inherits the project's.

## Commands

| Command | Does |
| --- | --- |
| `/task add` | Create; then pick teams, extra owners and ping channels from menus |
| `/task edit · view · done · status · delete` | Manage a task |
| `/deadlines` | Overdue / next 7 days / later; filter by project, term, team, owner, status |
| `/mine` | Your open tasks |
| `/project create · view · list · edit · archive` | Projects; an artifact can be pinned at creation |
| `/artifact add · remove` | Pin key links to a project |
| `/milestone add · remove` | Group a project's tasks |
| `/checkin [team] [project]` | Ping the audience, open a thread seeded with each person's open tasks |
| `/config show · set · team` | Admin: timezone, morning hour, channels, team roles, scheduled check-in |
| `/help` | Command list |

## Automation

- **Reminders:** owners pinged 3 days before, 1 day before, on the due date, then daily for 3 days overdue. One ping per task per day, at the morning hour (default 9:00 America/Toronto).
- **Reminder buttons:** Done · Snooze 1 day · snooze 2 days / 3 days / 1 week / 2 weeks.
- **Ping channels (multi):** task's own → project's → its teams' channels → server default → digest channel.
- **Weekly digest:** Sunday morning; overdue, blocked, and due this week by team.
- **Scheduled check-in:** optional, weekly on a chosen weekday.
- **Google Sheet:** `Tasks` and `Projects` tabs rewritten ~10 s after any change and hourly.

## Permissions

Anyone can create tasks and projects and assign anyone. Changing a task: its owners, creator, project lead, or Manage Server. Changing a project: lead, members, creator, or Manage Server. `/config`: Manage Server.

## Decisions

| Decision | Why |
| --- | --- |
| TypeScript on Node ≥22.18, no build step | discord.js is the most complete Discord library; Node runs `.ts` directly, so deploy is copy + run |
| Postgres + Drizzle | Chosen DB; Drizzle gives typed queries and plain SQL migrations with no runtime engine |
| Hourly scheduler | Every schedule is day-granular; the hourly check is idempotent per day, so restarts neither drop nor repeat pings |
| Pings in shared channels, not DMs | Visibility creates accountability |
| Sheet is a one-way mirror | Two-way sync needs conflict resolution; edits made in the sheet are overwritten |
| Multi-select via menus after the command | Slash-command options can't multi-select |
| Guilds intent only | No privileged intents, so no Discord approval needed |
| Single package | One deployable; split into workspaces when the web dashboard arrives |

## Later (MVP2)

Recurring tasks · subtasks and dependencies · priorities · Google Calendar sync · web dashboard.
