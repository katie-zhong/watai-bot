import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { STATUSES, type Status, TEAMS, title } from '../../domain/constants.ts';
import { normalizeTerm } from '../../domain/term.ts';
import { getConfig } from '../../services/config.ts';
import { listProjects } from '../../services/projects.ts';
import { listTasks, type TaskFilter } from '../../services/tasks.ts';
import { bucketByDue, listEmbed } from '../embeds.ts';
import { autocomplete, type Command, type Ctx, fail } from '../util.ts';

async function show(
  i: ChatInputCommandInteraction<'cached'>,
  ctx: Ctx,
  heading: string,
  filter: TaskFilter,
  footer?: string,
) {
  const [config, tasks, projects] = await Promise.all([
    getConfig(ctx.db, i.guildId),
    listTasks(ctx.db, i.guildId, filter),
    listProjects(ctx.db, i.guildId, { includeArchived: true }),
  ]);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const buckets = bucketByDue(tasks, new Date(), config.timezone);
  await i.reply({ embeds: [listEmbed(heading, buckets, names, footer)] });
}

export const deadlines: Command = {
  data: new SlashCommandBuilder()
    .setName('deadlines')
    .setDescription('Upcoming deadlines, filterable')
    .addIntegerOption((o) => o.setName('project').setDescription('Project').setAutocomplete(true))
    .addStringOption((o) => o.setName('term').setDescription('Term, e.g. S26'))
    .addStringOption((o) =>
      o
        .setName('team')
        .setDescription('Team')
        .addChoices(...TEAMS.map((t) => ({ name: title(t), value: t }))),
    )
    .addUserOption((o) => o.setName('owner').setDescription('Owner'))
    .addStringOption((o) =>
      o
        .setName('status')
        .setDescription('Status (default: everything not done)')
        .addChoices(...STATUSES.map((v) => ({ name: title(v.replace('_', ' ')), value: v }))),
    ),
  autocomplete,
  async execute(i, ctx) {
    const termOpt = i.options.getString('term');
    const term = termOpt ? normalizeTerm(termOpt) : undefined;
    if (term === null) return fail(i, 'Term looks like `W27`, `S26` or `F26`.');
    const owner = i.options.getUser('owner');
    const team = i.options.getString('team') ?? undefined;
    const status = (i.options.getString('status') as Status | null) ?? undefined;
    const projectId = i.options.getInteger('project') ?? undefined;
    const used = [
      projectId && 'project',
      term,
      team,
      owner && `@${owner.username}`,
      status?.replace('_', ' '),
    ].filter(Boolean);
    await show(
      i,
      ctx,
      'Deadlines',
      { projectId, term, team, ownerId: owner?.id, status },
      used.length ? `Filters: ${used.join(' · ')}` : undefined,
    );
  },
};

export const mine: Command = {
  data: new SlashCommandBuilder().setName('mine').setDescription('Your open tasks'),
  async execute(i, ctx) {
    await show(i, ctx, `${i.member.displayName}'s tasks`, { ownerId: i.user.id });
  },
};
