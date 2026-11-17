import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.ts';
import { startCheckin } from '../src/jobs/checkin.ts';
import { runDigests } from '../src/jobs/digest.ts';
import { runReminders } from '../src/jobs/reminders.ts';
import { updateConfig } from '../src/services/config.ts';
import { createProject } from '../src/services/projects.ts';
import { createTask, getTask, setStatus, updateTask } from '../src/services/tasks.ts';
import { at, fakeMessenger, GUILD, taskInput, testDb } from './helpers.ts';

let db: Db;
beforeEach(async () => {
  db = await testDb();
  await updateConfig(db, GUILD, { reminderChannelIds: ['c-default'], digestChannelId: 'c-digest' });
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

describe('digest', () => {
  it('posts once on Sunday morning, grouped by team', async () => {
    await createTask(db, taskInput({ title: 'Venue', teams: ['events'] }));
    await createTask(db, taskInput({ title: 'Old', dueAt: at('2026-11-10T12:00:00-05:00') }));
    const m = fakeMessenger();
    expect(await runDigests(db, m, at('2026-11-14T09:05:00-05:00'))).toBe(0); // Saturday
    expect(await runDigests(db, m, at('2026-11-15T08:00:00-05:00'))).toBe(0); // Sunday, too early
    expect(await runDigests(db, m, at('2026-11-15T09:05:00-05:00'))).toBe(1);
    expect(await runDigests(db, m, at('2026-11-15T10:05:00-05:00'))).toBe(0);
    expect(m.sent[0]?.channelId).toBe('c-digest');
    const fields = m.sent[0]?.msg.embeds?.[0]?.toJSON().fields?.map((f) => f.name);
    expect(fields).toEqual(['🔴 Overdue', 'Events — due this week']);
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

  it('pings every team role, or @everyone when none are mapped', async () => {
    const m = fakeMessenger();
    await startCheckin(db, m, { guildId: GUILD, channelId: 'c1' }, now);
    expect(m.sent[0]?.msg.content).toContain('@everyone');
    await updateConfig(db, GUILD, { teamRoles: { events: 'r-events', finance: 'r-fin' } });
    await startCheckin(db, m, { guildId: GUILD, channelId: 'c1' }, now);
    expect(m.sent[1]?.msg.allowedMentions).toEqual({ roles: ['r-events', 'r-fin'] });
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
