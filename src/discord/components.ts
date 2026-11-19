import type { MessageComponentInteraction } from 'discord.js';
import { addDays, localDate } from '../domain/dates.ts';
import { getConfig, updateConfig } from '../services/config.ts';
import { getDigest, updateDigest } from '../services/digests.ts';
import { getProject, updateProject } from '../services/projects.ts';
import { canModify, getTask, setStatus, updateTask } from '../services/tasks.ts';
import { digestEmbed, digestPanel } from './commands/digest.ts';
import { configEmbed, configPanel } from './commands/misc.ts';
import { renderProject } from './commands/project.ts';
import { taskEmbed } from './embeds.ts';
import { projectPanel, taskPanel } from './panels.ts';
import { access, type Ctx, canEditAll, canManageProject, fail } from './util.ts';

type I = MessageComponentInteraction<'cached'>;

/** Routes buttons and select menus by custom id: `<scope>:<action>:<id>[:<arg>]`. */
export async function handleComponent(i: I, ctx: Ctx): Promise<void> {
  const [scope, action = '', id, arg] = i.customId.split(':');
  if (scope === 't') return onTask(i, ctx, action, Number(id), arg);
  if (scope === 'p') return onProject(i, ctx, action, Number(id));
  if (scope === 'd') return onDigest(i, ctx, action, Number(id));
  if (scope === 'c' && action === 'reminders' && i.isChannelSelectMenu()) {
    if ((await access(i, ctx)) !== 'admin') return fail(i, 'Bot admins only.');
    const updated = await updateConfig(ctx.db, i.guildId, { reminderChannelIds: i.values });
    await i.update({ embeds: [configEmbed(updated)], components: configPanel(updated) });
  }
}

async function onTask(i: I, ctx: Ctx, action: string, id: number, arg?: string) {
  const task = await getTask(ctx.db, i.guildId, id);
  if (!task) return fail(i, 'That task no longer exists.');
  const project = task.projectId ? await getProject(ctx.db, i.guildId, task.projectId) : undefined;
  if (!canModify(task, project, i.user.id, await canEditAll(i, ctx)))
    return fail(i, 'Only the owners, creator, project lead or an admin can change this task.');
  const { timezone } = await getConfig(ctx.db, i.guildId);

  if (action === 'save') return void (await i.update({ components: [] }));

  if (action === 'done') {
    const done = await setStatus(ctx.db, i.guildId, id, 'done');
    if (!done) return;
    ctx.sync();
    return void (await i.update({
      content: `✅ **${done.title}** marked done by <@${i.user.id}>.`,
      embeds: [taskEmbed(done, project, timezone)],
      components: [],
    }));
  }

  if (action === 'snooze' || action === 'snoozesel') {
    const days = Number(i.isStringSelectMenu() ? i.values[0] : arg);
    if (!Number.isInteger(days) || days < 1) return;
    const until = addDays(localDate(new Date(), timezone), days);
    await updateTask(ctx.db, i.guildId, id, { snoozedUntil: until });
    return void (await i.update({
      content: `😴 **${task.title}** snoozed until ${until} by <@${i.user.id}>.`,
      components: [],
    }));
  }

  if (!i.isAnySelectMenu()) return;
  const field = { teams: 'teams', owners: 'ownerIds', channels: 'channelIds' }[action];
  if (!field) return;
  const updated = await updateTask(ctx.db, i.guildId, id, { [field]: i.values });
  if (!updated) return;
  ctx.sync();
  await i.update({
    embeds: [taskEmbed(updated, project, timezone)],
    components: taskPanel(updated),
  });
  const added = action === 'owners' ? i.values.filter((u) => !task.ownerIds.includes(u)) : [];
  if (added.length)
    await i.followUp({
      content: `${added.map((u) => `<@${u}>`).join(' ')} you now own \`#${id}\` **${task.title}**.`,
      allowedMentions: { users: added },
    });
}

async function onProject(i: I, ctx: Ctx, action: string, id: number) {
  const project = await getProject(ctx.db, i.guildId, id);
  if (!project) return fail(i, 'That project no longer exists.');
  if (!canManageProject(project, i.user.id, await canEditAll(i, ctx)))
    return fail(i, 'Only the lead, members, creator or an admin can change this project.');
  if (action === 'save') return void (await i.update({ components: [] }));
  if (!i.isAnySelectMenu()) return;
  const field = { teams: 'teams', members: 'memberIds', channels: 'channelIds' }[action];
  if (!field) return;
  const updated = await updateProject(ctx.db, i.guildId, id, { [field]: i.values });
  if (!updated) return;
  ctx.sync();
  await i.update({
    embeds: [await renderProject(ctx, updated)],
    components: projectPanel(updated),
  });
}

async function onDigest(i: I, ctx: Ctx, action: string, id: number) {
  if (!(await canEditAll(i, ctx)))
    return fail(i, 'Only bot managers and admins can manage digests.');
  const found = await getDigest(ctx.db, i.guildId, id);
  if (!found) return fail(i, 'That digest no longer exists.');
  if (action === 'save') return void (await i.update({ components: [] }));
  if (action !== 'teams' || !i.isStringSelectMenu()) return;
  const updated = await updateDigest(ctx.db, i.guildId, id, { teams: i.values });
  if (updated)
    await i.update({ embeds: [await digestEmbed(ctx, updated)], components: digestPanel(updated) });
}
