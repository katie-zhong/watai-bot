import { EmbedBuilder } from 'discord.js';
import type { Artifact, Milestone, Project, Task } from '../db/schema.ts';
import {
  COLORS,
  DEFAULT_COLOR,
  isColor,
  isStatus,
  STATUS_LABEL,
  title,
} from '../domain/constants.ts';
import { daysUntil, discordTime, relativeDue } from '../domain/dates.ts';

const mentions = (ids: string[]) => (ids.length ? ids.map((i) => `<@${i}>`).join(' ') : '—');
const channels = (ids: string[]) => ids.map((i) => `<#${i}>`).join(' ');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function colorOf(task: Pick<Task, 'color'>, project?: Pick<Project, 'color'>): number {
  const name = task.color ?? project?.color ?? DEFAULT_COLOR;
  return COLORS[isColor(name) ? name : DEFAULT_COLOR];
}

export const statusLabel = (s: string) => (isStatus(s) ? STATUS_LABEL[s] : s);

export function taskEmbed(
  task: Task,
  project: Project | undefined,
  zone: string,
  now = new Date(),
): EmbedBuilder {
  const days = daysUntil(task.dueAt, now, zone);
  const due =
    task.status === 'done'
      ? discordTime(task.dueAt, task.dueHasTime)
      : `${discordTime(task.dueAt, task.dueHasTime)} · ${relativeDue(days)}`;
  const embed = new EmbedBuilder()
    .setColor(colorOf(task, project))
    .setTitle(clip(`#${task.id} · ${task.title}`, 256))
    .addFields(
      { name: 'Due', value: due, inline: true },
      { name: 'Status', value: statusLabel(task.status), inline: true },
      { name: 'Term', value: task.term, inline: true },
      { name: 'Owners', value: mentions(task.ownerIds), inline: true },
      { name: 'Teams', value: task.teams.map(title).join(', ') || '—', inline: true },
      { name: 'Project', value: project?.name ?? '—', inline: true },
    );
  if (task.notes) embed.setDescription(clip(task.notes, 2000));
  if (task.blockerNote) embed.addFields({ name: 'Blocker', value: clip(task.blockerNote, 1024) });
  if (task.link) embed.addFields({ name: 'Link', value: clip(task.link, 1024) });
  if (task.channelIds.length)
    embed.addFields({ name: 'Pings in', value: channels(task.channelIds) });
  return embed;
}

/** One compact line per task, used by lists, digests and check-ins. */
export function taskLine(task: Task, projectName: string | undefined): string {
  const flag = task.status === 'blocked' ? ' ⛔' : task.status === 'in_progress' ? ' 🔵' : '';
  const owners = task.ownerIds.map((i) => `<@${i}>`).join(' ');
  const project = projectName ? ` · ${projectName}` : '';
  return `\`#${task.id}\` **${clip(task.title, 70)}**${flag} — ${discordTime(task.dueAt, task.dueHasTime)} ${owners}${project}`;
}

export interface Bucket {
  label: string;
  tasks: Task[];
}

export function bucketByDue(tasks: Task[], now: Date, zone: string): Bucket[] {
  const open = tasks.filter((t) => t.status !== 'done');
  const of = (pred: (d: number) => boolean) =>
    open.filter((t) => pred(daysUntil(t.dueAt, now, zone)));
  return [
    { label: '🔴 Overdue', tasks: of((d) => d < 0) },
    { label: '🟡 Next 7 days', tasks: of((d) => d >= 0 && d <= 7) },
    { label: '🟢 Later', tasks: of((d) => d > 7) },
    { label: '✅ Done', tasks: tasks.filter((t) => t.status === 'done') },
  ].filter((b) => b.tasks.length);
}

const MAX_LINES = 15;

export function listEmbed(
  heading: string,
  buckets: Bucket[],
  projectNames: Map<number, string>,
  footer?: string,
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLORS.blue).setTitle(heading);
  if (!buckets.length) embed.setDescription('Nothing here. 🎉');
  for (const b of buckets) {
    const lines = b.tasks
      .slice(0, MAX_LINES)
      .map((t) => taskLine(t, t.projectId ? projectNames.get(t.projectId) : undefined));
    if (b.tasks.length > MAX_LINES) lines.push(`…and ${b.tasks.length - MAX_LINES} more`);
    embed.addFields(...chunk(lines).map((value, i) => ({ name: i ? '​' : b.label, value })));
  }
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

/** Splits lines into ≤1024-char embed field values. */
function chunk(lines: string[]): string[] {
  const out: string[] = [];
  let cur = '';
  for (const line of lines) {
    if (cur && cur.length + line.length + 1 > 1024) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n${line}` : clip(line, 1024);
  }
  if (cur) out.push(cur);
  return out;
}

export function projectEmbed(
  project: Project,
  artifacts: Artifact[],
  milestones: Milestone[],
  tasks: Task[],
  zone: string,
  now = new Date(),
): EmbedBuilder {
  const open = tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => daysUntil(t.dueAt, now, zone) < 0).length;
  const blocked = open.filter((t) => t.status === 'blocked');
  const embed = new EmbedBuilder()
    .setColor(COLORS[isColor(project.color) ? project.color : DEFAULT_COLOR])
    .setTitle(clip(`${project.archived ? '📦 ' : ''}${project.name}`, 256))
    .addFields(
      { name: 'Lead', value: `<@${project.leadId}>`, inline: true },
      { name: 'Term', value: project.term ?? '—', inline: true },
      { name: 'Teams', value: project.teams.map(title).join(', ') || '—', inline: true },
      { name: 'Members', value: mentions(project.memberIds) },
      {
        name: 'Progress',
        value: `${open.length} open · ${blocked.length} blocked · ${overdue} overdue · ${tasks.length - open.length} done`,
      },
    );
  if (project.description) embed.setDescription(clip(project.description, 2000));
  if (artifacts.length)
    embed.addFields({
      name: '📌 Key artifacts',
      value: clip(artifacts.map((a) => `[${a.label}](${a.url}) \`${a.id}\``).join('\n'), 1024),
    });
  if (milestones.length)
    embed.addFields({
      name: 'Milestones',
      value: clip(
        milestones
          .map((m) => {
            const mine = tasks.filter((t) => t.milestoneId === m.id);
            const done = mine.filter((t) => t.status === 'done').length;
            const due = m.dueAt ? ` — ${discordTime(m.dueAt, false)}` : '';
            return `**${m.name}**${due} · ${done}/${mine.length} done \`${m.id}\``;
          })
          .join('\n'),
        1024,
      ),
    });
  if (blocked.length)
    embed.addFields({
      name: '⛔ Blockers',
      value: clip(
        blocked.map((t) => `\`#${t.id}\` ${t.title}: ${t.blockerNote ?? 'no note'}`).join('\n'),
        1024,
      ),
    });
  if (open.length)
    embed.addFields({
      name: 'Next deadlines',
      value: clip(
        open
          .slice(0, 5)
          .map((t) => taskLine(t, undefined))
          .join('\n'),
        1024,
      ),
    });
  if (project.channelIds.length)
    embed.addFields({ name: 'Pings in', value: channels(project.channelIds) });
  return embed;
}
