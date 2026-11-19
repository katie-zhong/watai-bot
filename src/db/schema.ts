import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const ids = (name: string) => text(name).array().notNull().default([]);

export const guildConfig = pgTable('guild_config', {
  guildId: text('guild_id').primaryKey(),
  timezone: text('timezone').notNull().default('America/Toronto'),
  reminderHour: integer('reminder_hour').notNull().default(9),
  reminderChannelIds: ids('reminder_channel_ids'),
  digestChannelId: text('digest_channel_id'),
  lastDigestOn: date('last_digest_on', { mode: 'string' }),
  checkinChannelId: text('checkin_channel_id'),
  /** ISO weekday 1 (Mon) – 7 (Sun); null disables the scheduled check-in. */
  checkinWeekday: integer('checkin_weekday'),
  lastCheckinOn: date('last_checkin_on', { mode: 'string' }),
  teamRoles: jsonb('team_roles').$type<Record<string, string>>().notNull().default({}),
  teamChannels: jsonb('team_channels').$type<Record<string, string>>().notNull().default({}),
  /** Role pinged by org-wide check-ins. Equal to guildId means @everyone. */
  defaultPingRoleId: text('default_ping_role_id'),
  /** Discord roles granted bot access levels (see src/domain/access.ts). */
  adminRoleIds: ids('admin_role_ids'),
  managerRoleIds: ids('manager_role_ids'),
});

export const projects = pgTable(
  'projects',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    leadId: text('lead_id').notNull(),
    memberIds: ids('member_ids'),
    teams: ids('teams'),
    term: text('term'),
    color: text('color').notNull().default('blue'),
    channelIds: ids('channel_ids'),
    archived: boolean('archived').notNull().default(false),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('projects_guild_name').on(t.guildId, t.name)],
);

export const artifacts = pgTable('artifacts', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  url: text('url').notNull(),
  addedBy: text('added_by').notNull(),
});

export const milestones = pgTable('milestones', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
});

export const tasks = pgTable(
  'tasks',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    link: text('link'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    dueHasTime: boolean('due_has_time').notNull().default(false),
    ownerIds: ids('owner_ids'),
    teams: ids('teams'),
    term: text('term').notNull(),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    milestoneId: integer('milestone_id').references(() => milestones.id, {
      onDelete: 'set null',
    }),
    /** null inherits the project colour. */
    color: text('color'),
    status: text('status').notNull().default('open'),
    blockerNote: text('blocker_note'),
    /** Empty inherits project → team → server default channels. */
    channelIds: ids('channel_ids'),
    snoozedUntil: date('snoozed_until', { mode: 'string' }),
    lastRemindedOn: date('last_reminded_on', { mode: 'string' }),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('tasks_guild_status_due').on(t.guildId, t.status, t.dueAt)],
);

export type GuildConfig = typeof guildConfig.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type NewProject = typeof projects.$inferInsert;
