import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { NewProject, Project } from '../../db/schema.ts';
import { COLOR_NAMES, COLORS, title } from '../../domain/constants.ts';
import { parseDue } from '../../domain/dates.ts';
import { normalizeTerm } from '../../domain/term.ts';
import { getConfig } from '../../services/config.ts';
import {
  addArtifact,
  addMilestone,
  createProject,
  DuplicateProjectError,
  getProject,
  isHttpUrl,
  listArtifacts,
  listMilestones,
  listProjects,
  removeArtifact,
  removeMilestone,
  updateProject,
} from '../../services/projects.ts';
import { listTasks } from '../../services/tasks.ts';
import { projectEmbed } from '../embeds.ts';
import { projectPanel } from '../panels.ts';
import { autocomplete, type Command, type Ctx, canManageProject, fail, isAdmin } from '../util.ts';

type I = ChatInputCommandInteraction<'cached'>;
const colorChoices = COLOR_NAMES.map((c) => ({ name: title(c), value: c }));

export async function renderProject(ctx: Ctx, project: Project): Promise<EmbedBuilder> {
  const [config, artifacts, milestones, tasks] = await Promise.all([
    getConfig(ctx.db, project.guildId),
    listArtifacts(ctx.db, project.id),
    listMilestones(ctx.db, project.id),
    listTasks(ctx.db, project.guildId, { projectId: project.id, includeDone: true }),
  ]);
  return projectEmbed(project, artifacts, milestones, tasks, config.timezone);
}

/** Loads the `project` option; replies and returns null when missing or not permitted. */
async function load(i: I, ctx: Ctx, mustManage: boolean): Promise<Project | null> {
  const project = await getProject(ctx.db, i.guildId, i.options.getInteger('project', true));
  if (!project) {
    await fail(i, 'Pick a project from the list.');
    return null;
  }
  if (mustManage && !canManageProject(project, i.user.id, isAdmin(i))) {
    await fail(i, 'Only the lead, members, creator or an admin can change this project.');
    return null;
  }
  return project;
}

const projectOption = (
  o: import('discord.js').SlashCommandIntegerOption,
): import('discord.js').SlashCommandIntegerOption =>
  o.setName('project').setDescription('Project').setRequired(true).setAutocomplete(true);

export const project: Command = {
  data: new SlashCommandBuilder()
    .setName('project')
    .setDescription('Create and manage projects')
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Create a project')
        .addStringOption((o) =>
          o.setName('name').setDescription('Project name').setRequired(true).setMaxLength(80),
        )
        .addStringOption((o) =>
          o.setName('description').setDescription('What it is').setMaxLength(1500),
        )
        .addUserOption((o) => o.setName('lead').setDescription('Lead (default: you)'))
        .addStringOption((o) => o.setName('term').setDescription('Term, e.g. F26'))
        .addStringOption((o) =>
          o
            .setName('color')
            .setDescription('Colour, inherited by its tasks')
            .addChoices(...colorChoices),
        )
        .addStringOption((o) =>
          o.setName('artifact_url').setDescription('Pin a key artifact now (spec, repo, drive…)'),
        )
        .addStringOption((o) =>
          o.setName('artifact_label').setDescription('Name for that artifact').setMaxLength(60),
        ),
    )
    .addSubcommand((s) =>
      s.setName('view').setDescription('Project overview').addIntegerOption(projectOption),
    )
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('All projects')
        .addBooleanOption((o) => o.setName('archived').setDescription('Include archived')),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Edit a project; also reopens the teams/members/channels picker')
        .addIntegerOption(projectOption)
        .addStringOption((o) => o.setName('name').setDescription('New name').setMaxLength(80))
        .addStringOption((o) =>
          o.setName('description').setDescription('New description').setMaxLength(1500),
        )
        .addUserOption((o) => o.setName('lead').setDescription('New lead'))
        .addStringOption((o) => o.setName('term').setDescription('Term, e.g. F26'))
        .addStringOption((o) =>
          o
            .setName('color')
            .setDescription('Colour')
            .addChoices(...colorChoices),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('archive')
        .setDescription('Archive or restore a project')
        .addIntegerOption(projectOption)
        .addBooleanOption((o) => o.setName('restore').setDescription('Un-archive instead')),
    ),
  autocomplete,
  async execute(i, ctx) {
    const sub = i.options.getSubcommand();
    if (sub === 'create') return create(i, ctx);
    if (sub === 'list') {
      const rows = await listProjects(ctx.db, i.guildId, {
        includeArchived: i.options.getBoolean('archived') ?? false,
      });
      const lines = rows.map(
        (p) =>
          `${p.archived ? '📦 ' : ''}**${p.name}** · <@${p.leadId}>${p.term ? ` · ${p.term}` : ''}`,
      );
      const embed = new EmbedBuilder()
        .setColor(COLORS.blue)
        .setTitle('Projects')
        .setDescription(lines.join('\n').slice(0, 4000) || 'No projects yet — `/project create`.');
      return void (await i.reply({ embeds: [embed] }));
    }
    const found = await load(i, ctx, sub !== 'view');
    if (!found) return;
    if (sub === 'view') return void (await i.reply({ embeds: [await renderProject(ctx, found)] }));
    if (sub === 'archive') {
      const archived = !(i.options.getBoolean('restore') ?? false);
      await updateProject(ctx.db, i.guildId, found.id, { archived });
      ctx.sync();
      return void (await i.reply(`${archived ? '📦 Archived' : '♻️ Restored'} **${found.name}**.`));
    }
    return edit(i, ctx, found);
  },
};

async function create(i: I, ctx: Ctx) {
  const termOpt = i.options.getString('term');
  const term = termOpt ? normalizeTerm(termOpt) : null;
  if (termOpt && !term) return fail(i, 'Term looks like `W27`, `S26` or `F26`.');
  const url = i.options.getString('artifact_url');
  if (url && !isHttpUrl(url)) return fail(i, 'Artifact must be an http(s) URL.');
  const lead = i.options.getUser('lead') ?? i.user;
  let created: Project;
  try {
    created = await createProject(ctx.db, {
      guildId: i.guildId,
      name: i.options.getString('name', true).trim(),
      description: i.options.getString('description'),
      leadId: lead.id,
      memberIds: [lead.id],
      term,
      color: i.options.getString('color') ?? undefined,
      createdBy: i.user.id,
    });
  } catch (e) {
    if (e instanceof DuplicateProjectError) return fail(i, 'A project with that name exists.');
    throw e;
  }
  if (url)
    await addArtifact(
      ctx.db,
      created.id,
      i.options.getString('artifact_label') ?? 'Link',
      url,
      i.user.id,
    );
  ctx.sync();
  await i.reply({
    content: 'Project created — set teams, members and ping channels below.',
    embeds: [await renderProject(ctx, created)],
    components: projectPanel(created),
  });
}

async function edit(i: I, ctx: Ctx, current: Project) {
  const patch: Partial<NewProject> = {};
  const name = i.options.getString('name');
  if (name) patch.name = name.trim();
  const description = i.options.getString('description');
  if (description) patch.description = description;
  const lead = i.options.getUser('lead');
  if (lead) patch.leadId = lead.id;
  const color = i.options.getString('color');
  if (color) patch.color = color;
  const termOpt = i.options.getString('term');
  if (termOpt) {
    const term = normalizeTerm(termOpt);
    if (!term) return fail(i, 'Term looks like `W27`, `S26` or `F26`.');
    patch.term = term;
  }
  let updated = current;
  if (Object.keys(patch).length) {
    try {
      updated = (await updateProject(ctx.db, i.guildId, current.id, patch)) ?? current;
    } catch {
      return fail(i, 'A project with that name exists.');
    }
    ctx.sync();
  }
  await i.reply({
    embeds: [await renderProject(ctx, updated)],
    components: projectPanel(updated),
    flags: MessageFlags.Ephemeral,
  });
}

export const artifact: Command = {
  data: new SlashCommandBuilder()
    .setName('artifact')
    .setDescription('Pin key artifacts (spec, repo, designs…) to a project')
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Pin an artifact')
        .addIntegerOption(projectOption)
        .addStringOption((o) =>
          o.setName('label').setDescription('Name').setRequired(true).setMaxLength(60),
        )
        .addStringOption((o) => o.setName('url').setDescription('Link').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Unpin an artifact')
        .addIntegerOption(projectOption)
        .addIntegerOption((o) =>
          o.setName('id').setDescription('Artifact id shown in /project view').setRequired(true),
        ),
    ),
  autocomplete,
  async execute(i, ctx) {
    const found = await load(i, ctx, true);
    if (!found) return;
    if (i.options.getSubcommand() === 'add') {
      const url = i.options.getString('url', true);
      if (!isHttpUrl(url)) return fail(i, 'Artifact must be an http(s) URL.');
      await addArtifact(ctx.db, found.id, i.options.getString('label', true), url, i.user.id);
    } else if (!(await removeArtifact(ctx.db, found.id, i.options.getInteger('id', true)))) {
      return fail(i, 'No artifact with that id on this project.');
    }
    ctx.sync();
    await i.reply({ embeds: [await renderProject(ctx, found)] });
  },
};

export const milestone: Command = {
  data: new SlashCommandBuilder()
    .setName('milestone')
    .setDescription('Group a project’s tasks under milestones')
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a milestone')
        .addIntegerOption(projectOption)
        .addStringOption((o) =>
          o.setName('name').setDescription('Name').setRequired(true).setMaxLength(80),
        )
        .addStringOption((o) => o.setName('due').setDescription('Target date')),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a milestone (its tasks stay)')
        .addIntegerOption(projectOption)
        .addIntegerOption((o) =>
          o
            .setName('milestone')
            .setDescription('Milestone')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),
  autocomplete,
  async execute(i, ctx) {
    const found = await load(i, ctx, true);
    if (!found) return;
    if (i.options.getSubcommand() === 'add') {
      const dueOpt = i.options.getString('due');
      const config = await getConfig(ctx.db, i.guildId);
      const due = dueOpt ? parseDue(dueOpt, new Date(), config.timezone) : null;
      if (dueOpt && !due) return fail(i, "Couldn't read that date — e.g. `2026-12-01`, `friday`.");
      await addMilestone(ctx.db, found.id, i.options.getString('name', true), due?.dueAt ?? null);
    } else if (
      !(await removeMilestone(ctx.db, found.id, i.options.getInteger('milestone', true)))
    ) {
      return fail(i, 'No such milestone on this project.');
    }
    await i.reply({ embeds: [await renderProject(ctx, found)] });
  },
};
