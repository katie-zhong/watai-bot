import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import type { Digest, NewDigest } from '../../db/schema.ts';
import { COLORS, TEAMS, title } from '../../domain/constants.ts';
import { digestMention, type PingMode } from '../../domain/digest.ts';
import { sendDigest } from '../../jobs/digest.ts';
import { discordMessenger } from '../../jobs/messenger.ts';
import { getConfig } from '../../services/config.ts';
import {
  createDigest,
  DuplicateDigestError,
  deleteDigest,
  getDigest,
  listDigests,
  updateDigest,
} from '../../services/digests.ts';
import { getProject } from '../../services/projects.ts';
import { autocomplete, type Command, type Ctx, canEditAll, fail } from '../util.ts';

type I = ChatInputCommandInteraction<'cached'>;

export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** Options shared by create and edit; `required` marks create's mandatory ones. */
function settings(s: SlashCommandSubcommandBuilder, required: boolean) {
  return s
    .addStringOption((o) =>
      o
        .setName('name')
        .setDescription('e.g. "Events weekly"')
        .setRequired(required)
        .setMaxLength(60),
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Where it posts')
        .setRequired(required)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addIntegerOption((o) =>
      o
        .setName('day')
        .setDescription('Day it posts (default Sunday)')
        .addChoices(...WEEKDAYS.map((d, n) => ({ name: d, value: n + 1 }))),
    )
    .addIntegerOption((o) =>
      o
        .setName('hour')
        .setDescription('Hour 0–23 (default: server morning hour)')
        .setMinValue(0)
        .setMaxValue(23),
    )
    .addIntegerOption((o) =>
      o.setName('project').setDescription('Only this project').setAutocomplete(true),
    )
    .addStringOption((o) =>
      o
        .setName('ping')
        .setDescription('Who it pings (default: auto)')
        .addChoices(
          { name: 'Auto — team roles / project members / server default ping', value: 'auto' },
          { name: 'A specific role (set ping_role)', value: 'role' },
          { name: 'Nobody', value: 'none' },
        ),
    )
    .addRoleOption((o) => o.setName('ping_role').setDescription('Role to ping (or @everyone)'));
}

const digestOption = (s: SlashCommandSubcommandBuilder) =>
  s.addIntegerOption((o) =>
    o.setName('digest').setDescription('Digest').setRequired(true).setAutocomplete(true),
  );

export function digestPanel(d: Digest) {
  const row = (c: MessageActionRowComponentBuilder) =>
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(c);
  return [
    row(
      new StringSelectMenuBuilder()
        .setCustomId(`d:teams:${d.id}`)
        .setPlaceholder('Teams (none selected = all teams)')
        .setMinValues(0)
        .setMaxValues(TEAMS.length)
        .addOptions(
          TEAMS.map((t) => ({ label: title(t), value: t, default: d.teams.includes(t) })),
        ),
    ),
    row(
      new ButtonBuilder()
        .setCustomId(`d:save:${d.id}`)
        .setLabel('Finish')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

export async function digestEmbed(ctx: Pick<Ctx, 'db'>, d: Digest): Promise<EmbedBuilder> {
  const config = await getConfig(ctx.db, d.guildId);
  const project = d.projectId ? await getProject(ctx.db, d.guildId, d.projectId) : undefined;
  const ping = digestMention(d, config, project).text || 'nobody';
  return new EmbedBuilder()
    .setColor(COLORS.blue)
    .setTitle(`📰 ${d.name}`)
    .addFields(
      {
        name: 'Posts',
        value: `${WEEKDAYS[d.weekday - 1]}s ${d.hour ?? config.reminderHour}:00 in <#${d.channelId}>`,
      },
      { name: 'Teams', value: d.teams.map(title).join(', ') || 'All', inline: true },
      { name: 'Project', value: project?.name ?? 'All', inline: true },
      { name: `Pings (${d.pingMode})`, value: ping, inline: true },
    );
}

/** Reads create/edit options into a patch; replies and returns null on invalid input. */
async function readSettings(i: I, ctx: Ctx, current?: Digest): Promise<Partial<NewDigest> | null> {
  const patch: Partial<NewDigest> = {};
  const name = i.options.getString('name');
  if (name) patch.name = name.trim();
  const channel = i.options.getChannel('channel');
  if (channel) patch.channelId = channel.id;
  const day = i.options.getInteger('day');
  if (day != null) patch.weekday = day;
  const hour = i.options.getInteger('hour');
  if (hour != null) patch.hour = hour;
  const projectId = i.options.getInteger('project');
  if (projectId != null) {
    if (!(await getProject(ctx.db, i.guildId, projectId))) {
      await fail(i, 'Pick a project from the list.');
      return null;
    }
    patch.projectId = projectId;
  }
  const role = i.options.getRole('ping_role');
  const mode = (i.options.getString('ping') as PingMode | null) ?? (role ? 'role' : null);
  if (mode) patch.pingMode = mode;
  if (role) patch.pingRoleId = role.id;
  if (mode === 'role' && !role && !current?.pingRoleId) {
    await fail(i, 'Set `ping_role` when ping is a specific role.');
    return null;
  }
  return patch;
}

export const digest: Command = {
  data: new SlashCommandBuilder()
    .setName('digest')
    .setDescription('Weekly deadline digests (e.g. one per team)')
    .addSubcommand((s) => settings(s.setName('create').setDescription('Create a digest'), true))
    .addSubcommand((s) =>
      settings(
        digestOption(s.setName('edit').setDescription('Edit a digest; reopens the teams picker')),
        false,
      )
        .addBooleanOption((o) =>
          o.setName('clear_project').setDescription('Cover all projects again'),
        )
        .addBooleanOption((o) =>
          o.setName('clear_hour').setDescription('Use the server morning hour'),
        ),
    )
    .addSubcommand((s) => digestOption(s.setName('delete').setDescription('Delete a digest')))
    .addSubcommand((s) =>
      digestOption(s.setName('send').setDescription('Post a digest now (preview)')),
    )
    .addSubcommand((s) => s.setName('list').setDescription('All digests')),
  autocomplete,
  async execute(i, ctx) {
    const sub = i.options.getSubcommand();
    if (sub === 'list') {
      const rows = await listDigests(ctx.db, i.guildId);
      const lines = rows.map(
        (d) =>
          `**${d.name}** · ${WEEKDAYS[d.weekday - 1]} · <#${d.channelId}> · ${d.teams.map(title).join(', ') || 'all teams'}`,
      );
      const embed = new EmbedBuilder()
        .setColor(COLORS.blue)
        .setTitle('Digests')
        .setDescription(lines.join('\n').slice(0, 4000) || 'None yet — `/digest create`.');
      return void (await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }));
    }
    if (!(await canEditAll(i, ctx)))
      return fail(i, 'Only bot managers and admins can manage digests (see /config access).');

    if (sub === 'create') {
      const patch = await readSettings(i, ctx);
      if (!patch?.name || !patch.channelId) return;
      try {
        const created = await createDigest(ctx.db, {
          ...patch,
          name: patch.name,
          channelId: patch.channelId,
          guildId: i.guildId,
          createdBy: i.user.id,
        });
        return void (await i.reply({
          content: 'Digest created — pick the teams it covers below.',
          embeds: [await digestEmbed(ctx, created)],
          components: digestPanel(created),
          flags: MessageFlags.Ephemeral,
        }));
      } catch (e) {
        if (e instanceof DuplicateDigestError) return fail(i, 'A digest with that name exists.');
        throw e;
      }
    }

    const found = await getDigest(ctx.db, i.guildId, i.options.getInteger('digest', true));
    if (!found) return fail(i, 'Pick a digest from the list.');

    if (sub === 'delete') {
      await deleteDigest(ctx.db, i.guildId, found.id);
      return void (await i.reply({
        content: `🗑️ Deleted digest **${found.name}**.`,
        flags: MessageFlags.Ephemeral,
      }));
    }
    if (sub === 'send') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const ok = await sendDigest(ctx.db, discordMessenger(ctx.client), found, new Date());
      return void (await i.editReply(
        ok
          ? `Posted in <#${found.channelId}>.`
          : '⚠️ Could not post — check my channel permissions.',
      ));
    }

    const patch = await readSettings(i, ctx, found);
    if (!patch) return;
    if (i.options.getBoolean('clear_project')) patch.projectId = null;
    if (i.options.getBoolean('clear_hour')) patch.hour = null;
    let updated = found;
    if (Object.keys(patch).length) {
      try {
        updated = (await updateDigest(ctx.db, i.guildId, found.id, patch)) ?? found;
      } catch (e) {
        if (e instanceof DuplicateDigestError) return fail(i, 'A digest with that name exists.');
        throw e;
      }
    }
    await i.reply({
      embeds: [await digestEmbed(ctx, updated)],
      components: digestPanel(updated),
      flags: MessageFlags.Ephemeral,
    });
  },
};
