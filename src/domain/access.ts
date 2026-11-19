/**
 * Bot access levels, granted by Discord role via /config access.
 * - admin: /config, plus everything a manager can do.
 * - manager: edit, close or delete any task or project (e.g. execs, TPMs).
 * - member: create and assign anything; edit only what they own, created or lead.
 * Manage Server always counts as admin, so the server owner can't be locked out.
 */
export const ACCESS_LEVELS = ['admin', 'manager', 'member'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export function accessLevel(
  memberRoleIds: readonly string[],
  hasManageServer: boolean,
  config: { adminRoleIds: string[]; managerRoleIds: string[] },
): AccessLevel {
  if (hasManageServer || config.adminRoleIds.some((r) => memberRoleIds.includes(r))) return 'admin';
  if (config.managerRoleIds.some((r) => memberRoleIds.includes(r))) return 'manager';
  return 'member';
}

/** Moves `roleId` to `level` (or removes it), keeping each role at one level. */
export function setRoleLevel(
  config: { adminRoleIds: string[]; managerRoleIds: string[] },
  roleId: string,
  level: AccessLevel,
): { adminRoleIds: string[]; managerRoleIds: string[] } {
  const adminRoleIds = config.adminRoleIds.filter((r) => r !== roleId);
  const managerRoleIds = config.managerRoleIds.filter((r) => r !== roleId);
  if (level === 'admin') adminRoleIds.push(roleId);
  if (level === 'manager') managerRoleIds.push(roleId);
  return { adminRoleIds, managerRoleIds };
}

/** Mention text for a role; Discord's @everyone role shares the server's id. */
export function roleMention(roleId: string, guildId: string): string {
  return roleId === guildId ? '@everyone' : `<@&${roleId}>`;
}
