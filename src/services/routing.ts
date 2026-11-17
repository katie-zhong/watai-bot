import type { GuildConfig, Project, Task } from '../db/schema.ts';

/** Where a task's pings go: task → project → its teams' channels → server default → digest. */
export function resolveChannels(
  task: Pick<Task, 'channelIds' | 'teams'>,
  project: Pick<Project, 'channelIds'> | undefined,
  config: Pick<GuildConfig, 'teamChannels' | 'reminderChannelIds' | 'digestChannelId'>,
): string[] {
  if (task.channelIds.length) return task.channelIds;
  if (project?.channelIds.length) return project.channelIds;
  const team = task.teams.map((t) => config.teamChannels[t]).filter((c): c is string => !!c);
  if (team.length) return [...new Set(team)];
  if (config.reminderChannelIds.length) return config.reminderChannelIds;
  return config.digestChannelId ? [config.digestChannelId] : [];
}
