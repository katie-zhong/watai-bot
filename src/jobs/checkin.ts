import { EmbedBuilder } from 'discord.js';
import { DateTime } from 'luxon';
import type { Db } from '../db/client.ts';
import type { GuildConfig } from '../db/schema.ts';
import { taskLine } from '../discord/embeds.ts';
import { COLORS, title } from '../domain/constants.ts';
import { localDate } from '../domain/dates.ts';
import { hourIn } from '../domain/reminders.ts';
import { allConfigs, getConfig, updateConfig } from '../services/config.ts';
import { getProject } from '../services/projects.ts';
import { listTasks } from '../services/tasks.ts';
import type { Messenger, Outgoing } from './messenger.ts';

export interface CheckinTarget {
  guildId: string;
  channelId: string;
  team?: string;
  projectId?: number;
}

/**
 * Async stand-up: pings the audience, opens a thread for updates and seeds it with
 * everyone's open tasks so updates are anchored to real work.
 */
export async function startCheckin(
  db: Db,
  messenger: Messenger,
  target: CheckinTarget,
  now: Date,
): Promise<boolean> {
  const config = await getConfig(db, target.guildId);
  const project = target.projectId
    ? await getProject(db, target.guildId, target.projectId)
    : undefined;
  const tasks = await listTasks(db, target.guildId, {
    team: target.team,
    projectId: project?.id,
  });

  const { mention, allowedMentions, scope } = audience(config, target.team, project);
  const day = DateTime.fromJSDate(now, { zone: config.timezone }).toFormat('LLL d');
  const msg: Outgoing = {
    content: `📋 **Check-in${scope ? ` · ${scope}` : ''}** ${mention}\nReply in the thread: what you shipped, what's next, and anything blocking you.`,
    allowedMentions,
  };

  const byOwner = new Map<string, string[]>();
  for (const t of tasks)
    for (const owner of t.ownerIds)
      byOwner.set(owner, [
        ...(byOwner.get(owner) ?? []),
        taskLine({ ...t, ownerIds: [] }, undefined),
      ]);
  const blocks = [...byOwner].map(([owner, lines]) => `<@${owner}>\n${lines.join('\n')}`);
  const followUps = pack(blocks).map((description, i) => ({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.blue)
        .setTitle(i ? 'Open tasks (cont.)' : 'Open tasks')
        .setDescription(description),
    ],
  }));

  return messenger.sendThread(
    target.channelId,
    msg,
    `Check-in · ${scope ? `${scope} · ` : ''}${day}`,
    followUps,
  );
}

function audience(
  config: GuildConfig,
  team: string | undefined,
  project: { name: string; memberIds: string[]; leadId: string } | undefined,
) {
  if (project) {
    const users = [...new Set([project.leadId, ...project.memberIds])];
    return {
      mention: users.map((u) => `<@${u}>`).join(' '),
      allowedMentions: { users },
      scope: project.name,
    };
  }
  const scope = team ? title(team) : '';
  const ping = config.defaultPingRoleId;
  if (!team && ping === config.guildId)
    return { mention: '@everyone', allowedMentions: { parse: ['everyone' as const] }, scope };
  // Org-wide: the configured default ping, else every mapped team role. Never an implicit @everyone.
  const roles = team ? [config.teamRoles[team]] : ping ? [ping] : Object.values(config.teamRoles);
  const unique = [...new Set(roles.filter((r): r is string => !!r))];
  return {
    mention: unique.map((r) => `<@&${r}>`).join(' '),
    allowedMentions: { roles: unique },
    scope,
  };
}

/** Packs text blocks into embed descriptions (4096-char limit). */
function pack(blocks: string[], limit = 3800): string[] {
  const out: string[] = [];
  let cur = '';
  for (const raw of blocks) {
    const block = raw.slice(0, limit);
    if (cur && cur.length + block.length + 2 > limit) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n\n${block}` : block;
  }
  if (cur) out.push(cur);
  return out;
}

/** Runs each server's scheduled weekly check-in once on its configured weekday. */
export async function runCheckins(db: Db, messenger: Messenger, now: Date): Promise<number> {
  let sent = 0;
  for (const config of await allConfigs(db)) {
    const zone = config.timezone;
    const today = localDate(now, zone);
    if (
      !config.checkinChannelId ||
      config.checkinWeekday == null ||
      config.lastCheckinOn === today ||
      DateTime.fromJSDate(now, { zone }).weekday !== config.checkinWeekday ||
      hourIn(now, zone) < config.reminderHour
    )
      continue;
    const target = { guildId: config.guildId, channelId: config.checkinChannelId };
    if (await startCheckin(db, messenger, target, now)) {
      await updateConfig(db, config.guildId, { lastCheckinOn: today });
      sent++;
    }
  }
  return sent;
}
