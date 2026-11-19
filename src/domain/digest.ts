import { DateTime } from 'luxon';
import { roleMention } from './access.ts';
import { localDate } from './dates.ts';
import { hourIn } from './reminders.ts';

/**
 * Who a digest pings:
 * - auto: project digest → its lead and members; team digest → those teams' mapped roles;
 *   otherwise (or if no team role is mapped) → the server's default ping.
 * - role: one chosen role (or @everyone).
 * - none: posts silently.
 */
export const PING_MODES = ['auto', 'role', 'none'] as const;
export type PingMode = (typeof PING_MODES)[number];

export interface Mention {
  text: string;
  allowedMentions: { users?: string[]; roles?: string[]; parse?: 'everyone'[] };
}

const NONE: Mention = { text: '', allowedMentions: {} };

export function rolesMention(roleIds: string[], guildId: string): Mention {
  if (roleIds.includes(guildId))
    return { text: '@everyone', allowedMentions: { parse: ['everyone'] } };
  const roles = [...new Set(roleIds)];
  return { text: roles.map((r) => roleMention(r, guildId)).join(' '), allowedMentions: { roles } };
}

export function digestMention(
  digest: { pingMode: string; pingRoleId: string | null; teams: string[]; guildId: string },
  config: { defaultPingRoleId: string | null; teamRoles: Record<string, string> },
  project?: { leadId: string; memberIds: string[] },
): Mention {
  if (digest.pingMode === 'none') return NONE;
  if (digest.pingMode === 'role')
    return digest.pingRoleId ? rolesMention([digest.pingRoleId], digest.guildId) : NONE;
  if (project) {
    const users = [...new Set([project.leadId, ...project.memberIds])];
    return { text: users.map((u) => `<@${u}>`).join(' '), allowedMentions: { users } };
  }
  const teamRoles = digest.teams.map((t) => config.teamRoles[t]).filter((r): r is string => !!r);
  if (teamRoles.length) return rolesMention(teamRoles, digest.guildId);
  return config.defaultPingRoleId ? rolesMention([config.defaultPingRoleId], digest.guildId) : NONE;
}

/** True once per scheduled day, at or after the digest's hour. */
export function digestDue(
  digest: { weekday: number; hour: number | null; lastSentOn: string | null },
  now: Date,
  zone: string,
  defaultHour: number,
): boolean {
  return (
    digest.lastSentOn !== localDate(now, zone) &&
    DateTime.fromJSDate(now, { zone }).weekday === digest.weekday &&
    hourIn(now, zone) >= (digest.hour ?? defaultHour)
  );
}
