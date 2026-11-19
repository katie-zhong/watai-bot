import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  type RESTPostAPIApplicationCommandsJSONBody,
  type RepliableInteraction,
} from 'discord.js';
import type { Db } from '../db/client.ts';
import type { Project } from '../db/schema.ts';
import { type AccessLevel, accessLevel } from '../domain/access.ts';
import { getConfig } from '../services/config.ts';
import { listDigests } from '../services/digests.ts';
import { listMilestones, listProjects } from '../services/projects.ts';
import { searchTasks } from '../services/tasks.ts';

export interface Ctx {
  db: Db;
  client: Client;
  /** Queues a debounced Google Sheets mirror refresh. */
  sync: () => void;
}

export interface Command {
  data: { name: string; toJSON(): RESTPostAPIApplicationCommandsJSONBody };
  execute(i: ChatInputCommandInteraction<'cached'>, ctx: Ctx): Promise<void>;
  autocomplete?(i: AutocompleteInteraction<'cached'>, ctx: Ctx): Promise<void>;
}

interface Member {
  guildId: string;
  member: GuildMember;
  memberPermissions: { has(p: bigint): boolean };
}

/** The caller's bot access level, from Manage Server and their roles (see /config access). */
export async function access(i: Member, ctx: Pick<Ctx, 'db'>): Promise<AccessLevel> {
  const config = await getConfig(ctx.db, i.guildId);
  return accessLevel(
    [...i.member.roles.cache.keys()],
    i.memberPermissions.has(PermissionFlagsBits.ManageGuild),
    config,
  );
}

/** Managers and admins can change any task or project. */
export const canEditAll = async (i: Member, ctx: Pick<Ctx, 'db'>) =>
  (await access(i, ctx)) !== 'member';

type Failable = Pick<RepliableInteraction, 'replied' | 'deferred' | 'reply' | 'followUp'>;

export async function fail(i: Failable, message: string): Promise<void> {
  const payload = { content: `⚠️ ${message}`, flags: MessageFlags.Ephemeral } as const;
  if (i.replied || i.deferred) await i.followUp(payload);
  else await i.reply(payload);
}

export const canManageProject = (p: Project, userId: string, editAll: boolean) =>
  editAll || p.leadId === userId || p.createdBy === userId || p.memberIds.includes(userId);

const clip = (s: string) => (s.length > 100 ? `${s.slice(0, 99)}…` : s);

/** Shared autocomplete for `task`, `project`, `milestone` and `artifact` options. */
export async function autocomplete(i: AutocompleteInteraction<'cached'>, ctx: Ctx): Promise<void> {
  const focused = i.options.getFocused(true);
  const query = String(focused.value);
  if (focused.name === 'task') {
    const rows = await searchTasks(ctx.db, i.guildId, query);
    return i.respond(rows.map((t) => ({ name: clip(`#${t.id} ${t.title}`), value: t.id })));
  }
  if (focused.name === 'project') {
    const rows = await listProjects(ctx.db, i.guildId, { query });
    return i.respond(rows.slice(0, 25).map((p) => ({ name: clip(p.name), value: p.id })));
  }
  if (focused.name === 'digest') {
    const rows = await listDigests(ctx.db, i.guildId, query);
    return i.respond(rows.slice(0, 25).map((d) => ({ name: clip(d.name), value: d.id })));
  }
  if (focused.name === 'milestone') {
    const projectId = i.options.getInteger('project');
    const rows = projectId ? await listMilestones(ctx.db, projectId) : [];
    const hits = rows.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));
    return i.respond(hits.slice(0, 25).map((m) => ({ name: clip(m.name), value: m.id })));
  }
  return i.respond([]);
}
