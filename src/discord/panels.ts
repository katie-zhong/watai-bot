import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type MessageActionRowComponentBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import type { Project, Task } from '../db/schema.ts';
import { TEAMS, title } from '../domain/constants.ts';

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
const row = (c: MessageActionRowComponentBuilder): Row =>
  new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(c);

const teamSelect = (id: string, selected: string[]) =>
  new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder('Teams')
    .setMinValues(0)
    .setMaxValues(TEAMS.length)
    .addOptions(TEAMS.map((t) => ({ label: title(t), value: t, default: selected.includes(t) })));

const channelSelect = (id: string, selected: string[]) => {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder('Ping channels (empty = inherit default)')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(5);
  if (selected.length) menu.setDefaultChannels(selected.slice(0, 5));
  return menu;
};

const userSelect = (id: string, placeholder: string, selected: string[], min: number) => {
  const menu = new UserSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(placeholder)
    .setMinValues(min)
    .setMaxValues(10);
  if (selected.length) menu.setDefaultUsers(selected.slice(0, 10));
  return menu;
};

/** Multi-select fields slash-command options can't express: teams, owners, ping channels. */
export function taskPanel(task: Task): Row[] {
  return [
    row(teamSelect(`t:teams:${task.id}`, task.teams)),
    row(userSelect(`t:owners:${task.id}`, 'Owners', task.ownerIds, 1)),
    row(channelSelect(`t:channels:${task.id}`, task.channelIds)),
    row(
      new ButtonBuilder()
        .setCustomId(`t:save:${task.id}`)
        .setLabel('Finish')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

export function projectPanel(project: Project): Row[] {
  return [
    row(teamSelect(`p:teams:${project.id}`, project.teams)),
    row(userSelect(`p:members:${project.id}`, 'Members', project.memberIds, 0)),
    row(channelSelect(`p:channels:${project.id}`, project.channelIds)),
    row(
      new ButtonBuilder()
        .setCustomId(`p:save:${project.id}`)
        .setLabel('Finish')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

export const SNOOZE_OPTIONS = [2, 3, 7, 14];

export function reminderActions(taskId: number): Row[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`t:done:${taskId}`)
        .setLabel('Done')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`t:snooze:${taskId}:1`)
        .setLabel('Snooze 1 day')
        .setStyle(ButtonStyle.Secondary),
    ),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(`t:snoozesel:${taskId}`)
        .setPlaceholder('Snooze longer…')
        .addOptions(
          SNOOZE_OPTIONS.map((d) => ({
            label: d % 7 === 0 ? `${d / 7} week${d > 7 ? 's' : ''}` : `${d} days`,
            value: String(d),
          })),
        ),
    ),
  ];
}
