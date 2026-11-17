import type { Db } from '../db/client.ts';
import { taskEmbed } from '../discord/embeds.ts';
import { reminderActions } from '../discord/panels.ts';
import { daysUntil, localDate, relativeDue } from '../domain/dates.ts';
import { reminderDue } from '../domain/reminders.ts';
import { allConfigs } from '../services/config.ts';
import { listProjects } from '../services/projects.ts';
import { resolveChannels } from '../services/routing.ts';
import { openTasksForGuilds, updateTask } from '../services/tasks.ts';
import type { Messenger } from './messenger.ts';

/** Pings owners of tasks that are due soon, overdue, or coming off a snooze. Returns pings sent. */
export async function runReminders(db: Db, messenger: Messenger, now: Date): Promise<number> {
  const configs = await allConfigs(db);
  const tasks = await openTasksForGuilds(
    db,
    configs.map((c) => c.guildId),
  );
  let sent = 0;
  for (const config of configs) {
    const zone = config.timezone;
    const due = tasks.filter(
      (t) => t.guildId === config.guildId && reminderDue(t, now, zone, config.reminderHour),
    );
    if (!due.length) continue;
    const projects = new Map(
      (await listProjects(db, config.guildId, { includeArchived: true })).map((p) => [p.id, p]),
    );
    for (const task of due) {
      const project = task.projectId ? projects.get(task.projectId) : undefined;
      const channels = resolveChannels(task, project, config);
      if (!channels.length)
        console.warn(`task #${task.id}: no ping channel configured (run /config)`);
      const owners = task.ownerIds.map((i) => `<@${i}>`).join(' ');
      const results = await Promise.all(
        channels.map((channelId) =>
          messenger.send(channelId, {
            content: `⏰ ${owners} — **${task.title}** is ${relativeDue(daysUntil(task.dueAt, now, zone))}.`,
            embeds: [taskEmbed(task, project, zone, now)],
            components: reminderActions(task.id),
            allowedMentions: { users: task.ownerIds },
          }),
        ),
      );
      // A failed send is retried next hour; a task with nowhere to go is not.
      if (channels.length && !results.some(Boolean)) continue;
      await updateTask(db, task.guildId, task.id, {
        lastRemindedOn: localDate(now, zone),
        snoozedUntil: null,
      });
      sent += results.filter(Boolean).length;
    }
  }
  return sent;
}
