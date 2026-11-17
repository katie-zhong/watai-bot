import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { DateTime } from 'luxon';
import type { GuildConfig } from '../../db/schema.ts';
import { COLORS, TEAMS, title } from '../../domain/constants.ts';
import { startCheckin } from '../../jobs/checkin.ts';
import { discordMessenger } from '../../jobs/messenger.ts';
import { getConfig, updateConfig } from '../../services/config.ts';
import { autocomplete, type Command, fail } from '../util.ts';

const teamChoices = TEAMS.map((t) => ({ name: title(t), value: t }));
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const checkin: Command = {
  data: new SlashCommandBuilder()
    .setName('checkin')
    .setDescription('Async team check-in: pings people and opens a thread for updates')
    .addStringOption((o) =>
      o
        .setName('team')
        .setDescription('Only this team (default: everyone)')
        .addChoices(...teamChoices),
    )
    .addIntegerOption((o) =>
      o.setName('project').setDescription('Only this project’s members').setAutocomplete(true),
    ),
  autocomplete,
  async execute(i, ctx) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const ok = await startCheckin(
      ctx.db,
      discordMessenger(ctx.client),
      {
        guildId: i.guildId,
        channelId: i.channelId,
        team: i.options.getString('team') ?? undefined,
        projectId: i.options.getInteger('project') ?? undefined,
      },
      new Date(),
    );
    await i.editReply(
      ok
        ? 'Check-in started.'
        : '⚠️ Could not post here — I need Send Messages, Create Public Threads and Mention Everyone in this channel.',
    );
  },
};

export function configEmbed(c: GuildConfig): EmbedBuilder {
  const ch = (id: string | null | undefined) => (id ? `<#${id}>` : '—');
  const teams = TEAMS.map(
    (t) =>
      `**${title(t)}** · role ${c.teamRoles[t] ? `<@&${c.teamRoles[t]}>` : '—'} · channel ${ch(c.teamChannels[t])}`,
  );
  return new EmbedBuilder()
    .setColor(COLORS.grey)
    .setTitle('Settings')
    .addFields(
      { name: 'Timezone', value: c.timezone, inline: true },
      { name: 'Morning hour', value: `${c.reminderHour}:00`, inline: true },
      { name: 'Sunday digest', value: ch(c.digestChannelId), inline: true },
      {
        name: 'Default ping channels',
        value: c.reminderChannelIds.map((id) => `<#${id}>`).join(' ') || '—',
      },
      {
        name: 'Scheduled check-in',
        value:
          c.checkinWeekday && c.checkinChannelId
            ? `${WEEKDAYS[c.checkinWeekday - 1]}s in ${ch(c.checkinChannelId)}`
            : 'off',
      },
      { name: 'Teams', value: teams.join('\n') },
    );
}

export const configPanel = (c: GuildConfig) => {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId('c:reminders')
    .setPlaceholder('Default ping channels')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(5);
  if (c.reminderChannelIds.length) menu.setDefaultChannels(c.reminderChannelIds.slice(0, 5));
  return [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(menu)];
};

export const config: Command = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Server settings (admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('show').setDescription('Show settings; pick default ping channels'),
    )
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Change settings')
        .addStringOption((o) =>
          o.setName('timezone').setDescription('IANA zone, e.g. America/Toronto'),
        )
        .addIntegerOption((o) =>
          o
            .setName('morning_hour')
            .setDescription('Hour (0–23) reminders, digest and check-in post')
            .setMinValue(0)
            .setMaxValue(23),
        )
        .addChannelOption((o) =>
          o
            .setName('digest_channel')
            .setDescription('Where the Sunday digest posts')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addChannelOption((o) =>
          o
            .setName('checkin_channel')
            .setDescription('Where the scheduled check-in posts')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addIntegerOption((o) =>
          o
            .setName('checkin_day')
            .setDescription('Weekday of the scheduled check-in')
            .addChoices(
              { name: 'Off', value: 0 },
              ...WEEKDAYS.map((d, n) => ({ name: d, value: n + 1 })),
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('team')
        .setDescription('Map a team to its Discord role and ping channel')
        .addStringOption((o) =>
          o
            .setName('team')
            .setDescription('Team')
            .setRequired(true)
            .addChoices(...teamChoices),
        )
        .addRoleOption((o) => o.setName('role').setDescription('Role pinged for check-ins'))
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Where this team’s task reminders post')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    ),
  async execute(i, ctx) {
    const sub = i.options.getSubcommand();
    let current = await getConfig(ctx.db, i.guildId);
    if (sub === 'set') {
      const patch: Partial<GuildConfig> = {};
      const tz = i.options.getString('timezone');
      if (tz) {
        if (!DateTime.local().setZone(tz).isValid)
          return fail(i, 'Unknown timezone — use an IANA name like `America/Toronto`.');
        patch.timezone = tz;
      }
      const hour = i.options.getInteger('morning_hour');
      if (hour != null) patch.reminderHour = hour;
      const digest = i.options.getChannel('digest_channel');
      if (digest) patch.digestChannelId = digest.id;
      const checkinChannel = i.options.getChannel('checkin_channel');
      if (checkinChannel) patch.checkinChannelId = checkinChannel.id;
      const day = i.options.getInteger('checkin_day');
      if (day != null) patch.checkinWeekday = day || null;
      current = await updateConfig(ctx.db, i.guildId, patch);
    } else if (sub === 'team') {
      const team = i.options.getString('team', true);
      const role = i.options.getRole('role');
      const channel = i.options.getChannel('channel');
      current = await updateConfig(ctx.db, i.guildId, {
        teamRoles: role ? { ...current.teamRoles, [team]: role.id } : current.teamRoles,
        teamChannels: channel
          ? { ...current.teamChannels, [team]: channel.id }
          : current.teamChannels,
      });
    }
    await i.reply({
      embeds: [configEmbed(current)],
      components: configPanel(current),
      flags: MessageFlags.Ephemeral,
    });
  },
};

const HELP: [string, string][] = [
  ['/task add', 'Create a task, then pick teams, extra owners and ping channels'],
  ['/task edit · view · done · delete', 'Manage a task'],
  ['/task status', 'Open / in progress / blocked (with a blocker note) / done'],
  ['/deadlines', 'Upcoming deadlines — filter by project, term, team, owner, status'],
  ['/mine', 'Your open tasks'],
  ['/project create · view · list · edit · archive', 'Projects with lead, members, colour'],
  ['/artifact add · remove', 'Pin key links (spec, repo, designs) to a project'],
  ['/milestone add · remove', 'Group a project’s tasks'],
  ['/checkin', 'Ping the team and open a thread for async updates'],
  ['/config show · set · team', 'Admins: channels, timezone, team roles, schedules'],
];

export const help: Command = {
  data: new SlashCommandBuilder().setName('help').setDescription('What this bot can do'),
  async execute(i) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.blue)
      .setTitle('WAT.ai task bot')
      .setDescription(
        [
          ...HELP.map(([c, d]) => `**${c}** — ${d}`),
          '',
          'Owners are pinged 3 days before, 1 day before and on the due date, then daily for 3 days once overdue. Reminders carry **Done** and **Snooze** buttons. A digest posts every Sunday morning.',
          'Dates accept `2026-12-01`, `friday`, `dec 3 5pm`, `in 2 weeks`. Terms: `W27` Jan–Apr, `S26` May–Aug, `F26` Sep–Dec.',
        ].join('\n'),
      );
    await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
