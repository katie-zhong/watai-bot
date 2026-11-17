import { DateTime } from 'luxon';
import type { Db } from '../db/client.ts';
import type { GuildConfig, Task } from '../db/schema.ts';
import { type Bucket, listEmbed } from '../discord/embeds.ts';
import { TEAMS, title } from '../domain/constants.ts';
import { daysUntil, localDate } from '../domain/dates.ts';
import { hourIn } from '../domain/reminders.ts';
import { allConfigs, updateConfig } from '../services/config.ts';
import { listProjects } from '../services/projects.ts';
import { listTasks } from '../services/tasks.ts';
import type { Messenger } from './messenger.ts';

export const DIGEST_WEEKDAY = 7; // Sunday

export function digestBuckets(tasks: Task[], now: Date, zone: string): Bucket[] {
  const days = (t: Task) => daysUntil(t.dueAt, now, zone);
  const week = tasks.filter((t) => days(t) >= 0 && days(t) <= 7);
  return [
    { label: '🔴 Overdue', tasks: tasks.filter((t) => days(t) < 0) },
    { label: '⛔ Blocked', tasks: tasks.filter((t) => t.status === 'blocked') },
    ...TEAMS.map((team) => ({
      label: `${title(team)} — due this week`,
      tasks: week.filter((t) => t.teams.includes(team)),
    })),
    { label: 'No team — due this week', tasks: week.filter((t) => !t.teams.length) },
  ].filter((b) => b.tasks.length);
}

export async function sendDigest(
  db: Db,
  messenger: Messenger,
  config: GuildConfig,
  now: Date,
): Promise<boolean> {
  if (!config.digestChannelId) return false;
  const [tasks, projects] = await Promise.all([
    listTasks(db, config.guildId),
    listProjects(db, config.guildId, { includeArchived: true }),
  ]);
  const week = DateTime.fromJSDate(now, { zone: config.timezone }).toFormat('LLL d');
  const embed = listEmbed(
    `Weekly digest — week of ${week}`,
    digestBuckets(tasks, now, config.timezone),
    new Map(projects.map((p) => [p.id, p.name])),
    '/deadlines for the full list · /mine for yours',
  );
  return messenger.send(config.digestChannelId, { embeds: [embed] });
}

/** Posts each server's digest once, Sunday morning in its timezone. */
export async function runDigests(db: Db, messenger: Messenger, now: Date): Promise<number> {
  let sent = 0;
  for (const config of await allConfigs(db)) {
    const zone = config.timezone;
    const today = localDate(now, zone);
    if (
      !config.digestChannelId ||
      config.lastDigestOn === today ||
      DateTime.fromJSDate(now, { zone }).weekday !== DIGEST_WEEKDAY ||
      hourIn(now, zone) < config.reminderHour
    )
      continue;
    if (await sendDigest(db, messenger, config, now)) {
      await updateConfig(db, config.guildId, { lastDigestOn: today });
      sent++;
    }
  }
  return sent;
}
