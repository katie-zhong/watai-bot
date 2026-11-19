import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.ts';
import type { NewDigest } from '../src/db/schema.ts';
import { startCheckin } from '../src/jobs/checkin.ts';
import { runDigests } from '../src/jobs/digest.ts';
import { runReminders } from '../src/jobs/reminders.ts';
import { updateConfig } from '../src/services/config.ts';
import { createDigest } from '../src/services/digests.ts';
import { createProject } from '../src/services/projects.ts';
import { createTask, getTask, setStatus, updateTask } from '../src/services/tasks.ts';
import { at, fakeMessenger, GUILD, taskInput, testDb } from './helpers.ts';

let db: Db;
beforeEach(async () => {
  db = await testDb();
  await updateConfig(db, GUILD, { reminderChannelIds: ['c-default'] });
});

const dueDay = at('2026-11-20T09:05:00-05:00'); // Friday, the task's due date

describe('reminders', () => {
  it('pings owners once per day in every resolved channel', async () => {
    const t = await createTask(db, taskInput({ ownerIds: ['u1', 'u2'], channelIds: ['a', 'b'] }));
    const m = fakeMessenger();
    expect(await runReminders(db, m, dueDay)).toBe(2);
    expect(m.sent.map((s) => s.channelId)).toEqual(['a', 'b']);
    expect(m.sent[0]?.msg.content).toContain('<@u1> <@u2>');
    expect(m.sent[0]?.msg.content).toContain('due today');
    expect(m.sent[0]?.msg.allowedMentions).toEqual({ users: ['u1', 'u2'] });
    expect((await getTask(db, GUILD, t.id))?.lastRemindedOn).toBe('2026-11-20');
    // A second tick the same day (or a restart) must not ping again.
    expect(await runReminders(db, m, at('2026-11-20T10:00:00-05:00'))).toBe(0);
  });

  it('falls back to the server default channel and skips done tasks', async () => {
    const done = await createTask(db, taskInput({ title: 'done one' }));
    await setStatus(db, GUILD, done.id, 'done');
    await createTask(db, taskInput());
    const m = fakeMessenger();
    await runReminders(db, m, dueDay);
    expect(m.sent.map((s) => s.channelId)).toEqual(['c-default']);
  });

  it('retries next hour when Discord rejects the send', async () => {
    const t = await createTask(db, taskInput());
    expect(await runReminders(db, fakeMessenger(false), dueDay)).toBe(0);
    expect((await getTask(db, GUILD, t.id))?.lastRemindedOn).toBeNull();
    expect(await runReminders(db, fakeMessenger(), at('2026-11-20T10:00:00-05:00'))).toBe(1);
  });

  it('stays quiet while snoozed, then pings and clears the snooze', async () => {
    const t = await createTask(db, taskInput());
    await updateTask(db, GUILD, t.id, { snoozedUntil: '2026-11-27' });
    const m = fakeMessenger();
    expect(await runReminders(db, m, dueDay)).toBe(0);
    expect(await runReminders(db, m, at('2026-11-27T09:05:00-05:00'))).toBe(1);
    expect((await getTask(db, GUILD, t.id))?.snoozedUntil).toBeNull();
  });
});

describe('digests', () => {
  const sunday = at('2026-11-15T09:05:00-05:00');
  const digest = (over: Partial<NewDigest> = {}) =>
    createDigest(db, {
      guildId: GUILD,
      name: 'All',
      channelId: 'c-digest',
      createdBy: 'u1',
      ...over,
    });

  it('posts once on its day after its hour, grouped by team', async () => {
    await digest();
    await createTask(db, taskInput({ title: 'Venue', teams: ['events'] }));
    await createTask(db, taskInput({ title: 'Old', dueAt: at('2026-11-10T12:00:00-05:00') }));
    const m = fakeMessenger();
    expect(await runDigests(db, m, at('2026-11-14T09:05:00-05:00'))).toBe(0); // Saturday
    expect(await runDigests(db, m, at('2026-11-15T08:00:00-05:00'))).toBe(0); // too early
    expect(await runDigests(db, m, sunday)).toBe(1);
    expect(await runDigests(db, m, at('2026-11-15T10:05:00-05:00'))).toBe(0);
    expect(m.sent[0]?.channelId).toBe('c-digest');
    const fields = m.sent[0]?.msg.embeds?.[0]?.toJSON().fields?.map((f) => f.name);
    expect(fields).toEqual(['🔴 Overdue', 'Events — due this week']);
  });

  it('runs several digests, each scoped to its teams and pinging their roles', async () => {
    await updateConfig(db, GUILD, {
      teamRoles: { events: 'r-events', finance: 'r-fin' },
      defaultPingRoleId: 'r-all',
    });
    await digest({ name: 'Events', channelId: 'c-ev', teams: ['events'] });
    await digest({ name: 'Finance', channelId: 'c-fin', teams: ['finance'], weekday: 1, hour: 8 });
    await digest({ name: 'Org', channelId: 'c-org' });
    await createTask(db, taskInput({ title: 'Venue', teams: ['events'] }));
    await createTask(db, taskInput({ title: 'Budget', teams: ['finance'] }));
    const m = fakeMessenger();
    expect(await runDigests(db, m, sunday)).toBe(2);
    const ev = m.sent.find((s) => s.channelId === 'c-ev');
    expect(ev?.msg.allowedMentions).toEqual({ roles: ['r-events'] });
    expect(JSON.stringify(ev?.msg.embeds)).toContain('Venue');
    expect(JSON.stringify(ev?.msg.embeds)).not.toContain('Budget');
    expect(m.sent.find((s) => s.channelId === 'c-org')?.msg.content).toBe('<@&r-all>');
    expect(await runDigests(db, m, at('2026-11-16T08:05:00-05:00'))).toBe(1); // Finance, Monday 8:00
  });

  it('scopes a project digest to that project', async () => {
    const p = await createProject(db, {
      guildId: GUILD,
      name: 'Hack',
      leadId: 'lead',
      memberIds: ['m1'],
      createdBy: 'lead',
    });
    await digest({ name: 'Hack', projectId: p.id });
    await createTask(db, taskInput({ title: 'In', projectId: p.id }));
    await createTask(db, taskInput({ title: 'Out' }));
    const m = fakeMessenger();
    await runDigests(db, m, sunday);
    expect(m.sent[0]?.msg.allowedMentions).toEqual({ users: ['lead', 'm1'] });
    const body = JSON.stringify(m.sent[0]?.msg.embeds);
    expect(body).toContain('In');
    expect(body).not.toContain('Out');
  });

  it('retries next hour when the post fails', async () => {
    await digest();
    expect(await runDigests(db, fakeMessenger(false), sunday)).toBe(0);
    expect(await runDigests(db, fakeMessenger(), at('2026-11-15T10:05:00-05:00'))).toBe(1);
  });
});

describe('check-in', () => {
  const now = at('2026-11-17T12:00:00-05:00');

  it('pings the team role and seeds the thread with each owner’s open tasks', async () => {
    await updateConfig(db, GUILD, { teamRoles: { events: 'r-events', finance: 'r-fin' } });
    await createTask(db, taskInput({ title: 'Venue', teams: ['events'], ownerIds: ['u1'] }));
    await createTask(db, taskInput({ title: 'Budget', teams: ['finance'], ownerIds: ['u2'] }));
    const m = fakeMessenger();
    await startCheckin(db, m, { guildId: GUILD, channelId: 'c1', team: 'events' }, now);
    const [sent] = m.sent;
    expect(sent?.msg.content).toContain('<@&r-events>');
    expect(sent?.msg.allowedMentions).toEqual({ roles: ['r-events'] });
    expect(sent?.thread?.name).toBe('Check-in · Events · Nov 17');
    const body = sent?.thread?.followUps[0]?.embeds?.[0]?.toJSON().description;
    expect(body).toContain('<@u1>');
    expect(body).toContain('Venue');
    expect(body).not.toContain('Budget');
  });

  it('org-wide: pings the default role, else every team role, never an implicit @everyone', async () => {
    const m = fakeMessenger();
    const run = () => startCheckin(db, m, { guildId: GUILD, channelId: 'c1' }, now);
    await run();
    expect(m.sent[0]?.msg.content).not.toContain('@everyone');
    expect(m.sent[0]?.msg.allowedMentions).toEqual({ roles: [] });

    await updateConfig(db, GUILD, { teamRoles: { events: 'r-events', finance: 'r-fin' } });
    await run();
    expect(m.sent[1]?.msg.allowedMentions).toEqual({ roles: ['r-events', 'r-fin'] });

    await updateConfig(db, GUILD, { defaultPingRoleId: 'r-members' });
    await run();
    expect(m.sent[2]?.msg.content).toContain('<@&r-members>');
    expect(m.sent[2]?.msg.allowedMentions).toEqual({ roles: ['r-members'] });

    await updateConfig(db, GUILD, { defaultPingRoleId: GUILD }); // the @everyone role
    await run();
    expect(m.sent[3]?.msg.content).toContain('@everyone');
    expect(m.sent[3]?.msg.allowedMentions).toEqual({ parse: ['everyone'] });
  });

  it('team check-ins ignore the default ping', async () => {
    await updateConfig(db, GUILD, { defaultPingRoleId: 'r-members', teamRoles: { events: 'r-e' } });
    const m = fakeMessenger();
    await startCheckin(db, m, { guildId: GUILD, channelId: 'c1', team: 'events' }, now);
    expect(m.sent[0]?.msg.allowedMentions).toEqual({ roles: ['r-e'] });
  });

  it('pings project members for a project check-in', async () => {
    const p = await createProject(db, {
      guildId: GUILD,
      name: 'Hackathon',
      leadId: 'lead',
      memberIds: ['lead', 'm1'],
      createdBy: 'lead',
    });
    const m = fakeMessenger();
    await startCheckin(db, m, { guildId: GUILD, channelId: 'c1', projectId: p.id }, now);
    expect(m.sent[0]?.msg.allowedMentions).toEqual({ users: ['lead', 'm1'] });
  });
});
