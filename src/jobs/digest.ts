import { DateTime } from 'luxon';
import type { Db } from '../db/client.ts';
import type { Digest, GuildConfig, Task } from '../db/schema.ts';
import { type Bucket, listEmbed } from '../discord/embeds.ts';
import { TEAMS, title } from '../domain/constants.ts';
import { daysUntil, localDate } from '../domain/dates.ts';
import { digestDue, digestMention } from '../domain/digest.ts';
import { allConfigs, getConfig } from '../services/config.ts';
import { digestsForGuilds, updateDigest } from '../services/digests.ts';
import { getProject, listProjects } from '../services/projects.ts';
import { listTasks } from '../services/tasks.ts';
import type { Messenger } from './messenger.ts';

/** Tasks in scope: the digest's project, and any of its teams (no teams = all). */
export function digestTasks(tasks: Task[], digest: Pick<Digest, 'teams' | 'projectId'>): Task[] {
  return tasks.filter(
    (t) =>
      (digest.projectId == null || t.projectId === digest.projectId) &&
      (!digest.teams.length || t.teams.some((team) => digest.teams.includes(team))),
  );
}

export function digestBuckets(
  tasks: Task[],
  now: Date,
  zone: string,
  teams: string[] = [],
): Bucket[] {
  const days = (t: Task) => daysUntil(t.dueAt, now, zone);
  const week = tasks.filter((t) => days(t) >= 0 && days(t) <= 7);
  const shown = teams.length ? teams : [...TEAMS];
  return [
    { label: '🔴 Overdue', tasks: tasks.filter((t) => days(t) < 0) },
    { label: '⛔ Blocked', tasks: tasks.filter((t) => t.status === 'blocked') },
    ...shown.map((team) => ({
      label: `${title(team)} — due this week`,
      tasks: week.filter((t) => t.teams.includes(team)),
    })),
    {
      label: teams.length ? 'Other — due this week' : 'No team — due this week',
      tasks: week.filter((t) => !t.teams.some((team) => shown.includes(team))),
    },
  ].filter((b) => b.tasks.length);
}

export async function sendDigest(
  db: Db,
  messenger: Messenger,
  digest: Digest,
  now: Date,
  config?: GuildConfig,
): Promise<boolean> {
  const cfg = config ?? (await getConfig(db, digest.guildId));
  const [all, projects] = await Promise.all([
    listTasks(db, digest.guildId, { projectId: digest.projectId ?? undefined }),
    listProjects(db, digest.guildId, { includeArchived: true }),
  ]);
  const project = digest.projectId
    ? await getProject(db, digest.guildId, digest.projectId)
    : undefined;
  const week = DateTime.fromJSDate(now, { zone: cfg.timezone }).toFormat('LLL d');
  const embed = listEmbed(
    `${digest.name} — week of ${week}`,
    digestBuckets(digestTasks(all, digest), now, cfg.timezone, digest.teams),
    new Map(projects.map((p) => [p.id, p.name])),
    '/deadlines for the full list · /mine for yours',
  );
  const mention = digestMention(digest, cfg, project);
  return messenger.send(digest.channelId, {
    content: mention.text || undefined,
    embeds: [embed],
    allowedMentions: mention.allowedMentions,
  });
}

/** Posts every digest that is due, once per scheduled day, in its server's timezone. */
export async function runDigests(db: Db, messenger: Messenger, now: Date): Promise<number> {
  const configs = new Map((await allConfigs(db)).map((c) => [c.guildId, c]));
  let sent = 0;
  for (const digest of await digestsForGuilds(db, [...configs.keys()])) {
    const config = configs.get(digest.guildId);
    if (!config || !digestDue(digest, now, config.timezone, config.reminderHour)) continue;
    if (await sendDigest(db, messenger, digest, now, config)) {
      await updateDigest(db, digest.guildId, digest.id, {
        lastSentOn: localDate(now, config.timezone),
      });
      sent++;
    }
  }
  return sent;
}
