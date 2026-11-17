import { type ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { NewTask } from '../../db/schema.ts';
import { COLOR_NAMES, STATUSES, type Status, title } from '../../domain/constants.ts';
import { localDate, parseDue } from '../../domain/dates.ts';
import { normalizeTerm, termFor } from '../../domain/term.ts';
import { getConfig } from '../../services/config.ts';
import { getProject, isHttpUrl, listMilestones } from '../../services/projects.ts';
import {
  canModify,
  createTask,
  deleteTask,
  getTask,
  setStatus,
  updateTask,
} from '../../services/tasks.ts';
import { taskEmbed } from '../embeds.ts';
import { taskPanel } from '../panels.ts';
import { autocomplete, type Command, type Ctx, fail, isAdmin } from '../util.ts';

const colorChoices = COLOR_NAMES.map((c) => ({ name: title(c), value: c }));
const DUE_HELP = 'e.g. `2026-12-01`, `friday`, `dec 3 5pm`, `in 2 weeks`';

const data = new SlashCommandBuilder()
  .setName('task')
  .setDescription('Create and manage tasks')
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Create a task')
      .addStringOption((o) =>
        o.setName('title').setDescription('What needs doing').setRequired(true).setMaxLength(200),
      )
      .addStringOption((o) =>
        o
          .setName('due')
          .setDescription('Deadline: 2026-12-01, friday, dec 3 5pm')
          .setRequired(true),
      )
      .addUserOption((o) => o.setName('owner').setDescription('Owner (default: you)'))
      .addIntegerOption((o) => o.setName('project').setDescription('Project').setAutocomplete(true))
      .addIntegerOption((o) =>
        o.setName('milestone').setDescription('Milestone in that project').setAutocomplete(true),
      )
      .addStringOption((o) =>
        o
          .setName('color')
          .setDescription('Card colour')
          .addChoices(...colorChoices),
      )
      .addStringOption((o) => o.setName('link').setDescription('Key link or artifact URL'))
      .addStringOption((o) => o.setName('notes').setDescription('Details').setMaxLength(1500))
      .addStringOption((o) =>
        o.setName('term').setDescription('Override term (default: from due date), e.g. S26'),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('edit')
      .setDescription('Edit a task; also reopens the teams/owners/channels picker')
      .addIntegerOption((o) =>
        o.setName('task').setDescription('Task').setRequired(true).setAutocomplete(true),
      )
      .addStringOption((o) => o.setName('title').setDescription('New title').setMaxLength(200))
      .addStringOption((o) => o.setName('due').setDescription('New deadline'))
      .addIntegerOption((o) => o.setName('project').setDescription('Project').setAutocomplete(true))
      .addIntegerOption((o) =>
        o.setName('milestone').setDescription('Milestone').setAutocomplete(true),
      )
      .addBooleanOption((o) =>
        o.setName('clear_project').setDescription('Remove from its project and milestone'),
      )
      .addStringOption((o) =>
        o
          .setName('color')
          .setDescription('Card colour')
          .addChoices(...colorChoices),
      )
      .addStringOption((o) => o.setName('link').setDescription('Key link or artifact URL'))
      .addStringOption((o) => o.setName('notes').setDescription('Details').setMaxLength(1500))
      .addStringOption((o) => o.setName('term').setDescription('Term, e.g. S26')),
  )
  .addSubcommand((s) =>
    s
      .setName('view')
      .setDescription('Show a task')
      .addIntegerOption((o) =>
        o.setName('task').setDescription('Task').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('done')
      .setDescription('Mark a task done')
      .addIntegerOption((o) =>
        o.setName('task').setDescription('Task').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('status')
      .setDescription('Set status; blocked needs a note')
      .addIntegerOption((o) =>
        o.setName('task').setDescription('Task').setRequired(true).setAutocomplete(true),
      )
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('New status')
          .setRequired(true)
          .addChoices(...STATUSES.map((v) => ({ name: title(v.replace('_', ' ')), value: v }))),
      )
      .addStringOption((o) =>
        o.setName('note').setDescription('What is blocking this').setMaxLength(500),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('delete')
      .setDescription('Delete a task')
      .addIntegerOption((o) =>
        o.setName('task').setDescription('Task').setRequired(true).setAutocomplete(true),
      ),
  );

type I = ChatInputCommandInteraction<'cached'>;

async function add(i: I, ctx: Ctx) {
  const config = await getConfig(ctx.db, i.guildId);
  const now = new Date();
  const due = parseDue(i.options.getString('due', true), now, config.timezone);
  if (!due) return fail(i, `Couldn't read that deadline — ${DUE_HELP}.`);
  const termInput = i.options.getString('term');
  const term = termInput ? normalizeTerm(termInput) : termFor(due.dueAt, config.timezone);
  if (!term) return fail(i, 'Term looks like `W27`, `S26` or `F26`.');
  const link = i.options.getString('link');
  if (link && !isHttpUrl(link)) return fail(i, 'Link must be an http(s) URL.');

  const projectId = i.options.getInteger('project');
  const project = projectId ? await getProject(ctx.db, i.guildId, projectId) : undefined;
  if (projectId && !project) return fail(i, 'Pick a project from the list.');
  const milestoneId = await resolveMilestone(i, ctx, project?.id);
  if (milestoneId === false) return;

  const owner = i.options.getUser('owner') ?? i.user;
  const task = await createTask(ctx.db, {
    guildId: i.guildId,
    title: i.options.getString('title', true),
    notes: i.options.getString('notes'),
    link,
    dueAt: due.dueAt,
    dueHasTime: due.hasTime,
    ownerIds: [owner.id],
    teams: project?.teams ?? [],
    term,
    projectId: project?.id ?? null,
    milestoneId,
    color: i.options.getString('color'),
    createdBy: i.user.id,
    // The creation message already pings the owner; skip today's scheduled reminder.
    lastRemindedOn: localDate(now, config.timezone),
  });
  ctx.sync();
  await i.reply({
    content: `New task for <@${owner.id}> — set teams, more owners and ping channels below.`,
    embeds: [taskEmbed(task, project, config.timezone)],
    components: taskPanel(task),
    allowedMentions: { users: [owner.id] },
  });
}

/** Returns the milestone id, null when none was given, or false after replying with an error. */
async function resolveMilestone(i: I, ctx: Ctx, projectId: number | undefined) {
  const id = i.options.getInteger('milestone');
  if (id == null) return null;
  const ok = projectId && (await listMilestones(ctx.db, projectId)).some((m) => m.id === id);
  if (ok) return id;
  await fail(i, 'That milestone is not in the selected project.');
  return false as const;
}

async function load(i: I, ctx: Ctx, mustModify: boolean) {
  const task = await getTask(ctx.db, i.guildId, i.options.getInteger('task', true));
  if (!task) {
    await fail(i, 'Task not found.');
    return null;
  }
  const project = task.projectId ? await getProject(ctx.db, i.guildId, task.projectId) : undefined;
  if (mustModify && !canModify(task, project, i.user.id, isAdmin(i))) {
    await fail(i, 'Only the owners, creator, project lead or an admin can change this task.');
    return null;
  }
  const config = await getConfig(ctx.db, i.guildId);
  return { task, project, config };
}

async function edit(i: I, ctx: Ctx) {
  const found = await load(i, ctx, true);
  if (!found) return;
  const { task, config } = found;
  const patch: Partial<NewTask> = {};

  const titleOpt = i.options.getString('title');
  if (titleOpt) patch.title = titleOpt;
  const notes = i.options.getString('notes');
  if (notes) patch.notes = notes;
  const color = i.options.getString('color');
  if (color) patch.color = color;
  const link = i.options.getString('link');
  if (link) {
    if (!isHttpUrl(link)) return fail(i, 'Link must be an http(s) URL.');
    patch.link = link;
  }

  const dueOpt = i.options.getString('due');
  if (dueOpt) {
    const due = parseDue(dueOpt, new Date(), config.timezone);
    if (!due) return fail(i, `Couldn't read that deadline — ${DUE_HELP}.`);
    patch.dueAt = due.dueAt;
    patch.dueHasTime = due.hasTime;
    patch.snoozedUntil = null;
    // Keep the term in step with the date unless it was set by hand.
    if (task.term === termFor(task.dueAt, config.timezone))
      patch.term = termFor(due.dueAt, config.timezone);
  }
  const termOpt = i.options.getString('term');
  if (termOpt) {
    const term = normalizeTerm(termOpt);
    if (!term) return fail(i, 'Term looks like `W27`, `S26` or `F26`.');
    patch.term = term;
  }

  let projectId = task.projectId;
  if (i.options.getBoolean('clear_project')) {
    projectId = null;
    patch.projectId = null;
    patch.milestoneId = null;
  }
  const projectOpt = i.options.getInteger('project');
  if (projectOpt) {
    if (!(await getProject(ctx.db, i.guildId, projectOpt)))
      return fail(i, 'Pick a project from the list.');
    projectId = projectOpt;
    patch.projectId = projectOpt;
    if (projectOpt !== task.projectId) patch.milestoneId = null;
  }
  const milestoneId = await resolveMilestone(i, ctx, projectId ?? undefined);
  if (milestoneId === false) return;
  if (milestoneId) patch.milestoneId = milestoneId;

  const updated = Object.keys(patch).length
    ? await updateTask(ctx.db, i.guildId, task.id, patch)
    : task;
  if (!updated) return fail(i, 'Task not found.');
  ctx.sync();
  const project = updated.projectId
    ? await getProject(ctx.db, i.guildId, updated.projectId)
    : undefined;
  await i.reply({
    embeds: [taskEmbed(updated, project, config.timezone)],
    components: taskPanel(updated),
    flags: MessageFlags.Ephemeral,
  });
}

async function status(i: I, ctx: Ctx, next: Status) {
  const found = await load(i, ctx, true);
  if (!found) return;
  const note = i.options.getString('note') ?? undefined;
  if (next === 'blocked' && !note) return fail(i, 'Add a `note` saying what is blocking this.');
  const updated = await setStatus(ctx.db, i.guildId, found.task.id, next, note);
  if (!updated) return fail(i, 'Task not found.');
  ctx.sync();
  await i.reply({ embeds: [taskEmbed(updated, found.project, found.config.timezone)] });
}

export const task: Command = {
  data,
  autocomplete,
  async execute(i, ctx) {
    switch (i.options.getSubcommand()) {
      case 'add':
        return add(i, ctx);
      case 'edit':
        return edit(i, ctx);
      case 'done':
        return status(i, ctx, 'done');
      case 'status':
        return status(i, ctx, i.options.getString('status', true) as Status);
      case 'view': {
        const found = await load(i, ctx, false);
        if (found)
          await i.reply({ embeds: [taskEmbed(found.task, found.project, found.config.timezone)] });
        return;
      }
      case 'delete': {
        const found = await load(i, ctx, true);
        if (!found) return;
        await deleteTask(ctx.db, i.guildId, found.task.id);
        ctx.sync();
        await i.reply(`🗑️ Deleted \`#${found.task.id}\` **${found.task.title}**.`);
      }
    }
  },
};
