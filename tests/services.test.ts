import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.ts';
import { getConfig, updateConfig } from '../src/services/config.ts';
import {
  addArtifact,
  addMilestone,
  createProject,
  DuplicateProjectError,
  isHttpUrl,
  listArtifacts,
  listProjects,
} from '../src/services/projects.ts';
import {
  canModify,
  createTask,
  getTask,
  listTasks,
  searchTasks,
  setStatus,
} from '../src/services/tasks.ts';
import { at, GUILD, taskInput, testDb } from './helpers.ts';

let db: Db;
beforeEach(async () => {
  db = await testDb();
});

const project = (name = 'Hackathon') =>
  createProject(db, { guildId: GUILD, name, leadId: 'lead', createdBy: 'u1' });

describe('tasks', () => {
  it('filters by project, term, team, owner and status', async () => {
    const p = await project();
    await createTask(db, taskInput({ title: 'a', teams: ['events'], projectId: p.id }));
    await createTask(db, taskInput({ title: 'b', teams: ['finance', 'events'], ownerIds: ['u2'] }));
    await createTask(db, taskInput({ title: 'c', term: 'W27', ownerIds: ['u1', 'u2'] }));
    await createTask(db, taskInput({ title: 'other server', guildId: 'g2' }));
    const titles = async (f: Parameters<typeof listTasks>[2]) =>
      (await listTasks(db, GUILD, f)).map((t) => t.title);

    expect(await titles({})).toEqual(['a', 'b', 'c']);
    expect(await titles({ projectId: p.id })).toEqual(['a']);
    expect(await titles({ team: 'events' })).toEqual(['a', 'b']);
    expect(await titles({ ownerId: 'u2' })).toEqual(['b', 'c']);
    expect(await titles({ term: 'W27' })).toEqual(['c']);
    expect(await titles({ team: 'events', ownerId: 'u2' })).toEqual(['b']);
  });

  it('orders by deadline and hides done unless asked', async () => {
    const late = await createTask(db, taskInput({ title: 'late', dueAt: at('2026-12-10T12:00Z') }));
    await createTask(db, taskInput({ title: 'soon', dueAt: at('2026-11-18T12:00Z') }));
    await setStatus(db, GUILD, late.id, 'done');
    expect((await listTasks(db, GUILD)).map((t) => t.title)).toEqual(['soon']);
    expect((await listTasks(db, GUILD, { includeDone: true })).map((t) => t.title)).toEqual([
      'soon',
      'late',
    ]);
    expect((await listTasks(db, GUILD, { status: 'done' })).map((t) => t.title)).toEqual(['late']);
  });

  it('keeps a blocker note only while blocked', async () => {
    const t = await createTask(db, taskInput());
    const blocked = await setStatus(db, GUILD, t.id, 'blocked', 'waiting on budget');
    expect(blocked?.blockerNote).toBe('waiting on budget');
    const resumed = await setStatus(db, GUILD, t.id, 'in_progress');
    expect(resumed?.blockerNote).toBeNull();
    const done = await setStatus(db, GUILD, t.id, 'done');
    expect(done?.completedAt).toBeInstanceOf(Date);
  });

  it('scopes lookups to the server', async () => {
    const t = await createTask(db, taskInput());
    expect(await getTask(db, 'g2', t.id)).toBeUndefined();
  });

  it('autocompletes by title or #id', async () => {
    const t = await createTask(db, taskInput({ title: 'Sponsor outreach' }));
    await createTask(db, taskInput({ title: 'Book venue' }));
    expect((await searchTasks(db, GUILD, 'spons')).map((x) => x.id)).toEqual([t.id]);
    expect((await searchTasks(db, GUILD, `#${t.id}`)).map((x) => x.id)).toEqual([t.id]);
    expect(await searchTasks(db, GUILD, '')).toHaveLength(2);
  });

  it('lets anyone attached to a task change it', () => {
    const t = { ownerIds: ['owner'], createdBy: 'creator' };
    expect(canModify(t, undefined, 'owner', false)).toBe(true);
    expect(canModify(t, undefined, 'creator', false)).toBe(true);
    expect(canModify(t, { leadId: 'lead' }, 'lead', false)).toBe(true);
    expect(canModify(t, undefined, 'stranger', true)).toBe(true);
    expect(canModify(t, { leadId: 'lead' }, 'stranger', false)).toBe(false);
  });
});

describe('projects', () => {
  it('rejects duplicate names per server', async () => {
    await project();
    await expect(project()).rejects.toBeInstanceOf(DuplicateProjectError);
    await expect(
      createProject(db, { guildId: 'g2', name: 'Hackathon', leadId: 'x', createdBy: 'x' }),
    ).resolves.toBeDefined();
  });

  it('pins artifacts and unlinks tasks when a milestone or project goes', async () => {
    const p = await project();
    await addArtifact(db, p.id, 'Spec', 'https://example.com/spec', 'u1');
    expect((await listArtifacts(db, p.id)).map((a) => a.label)).toEqual(['Spec']);
    const m = await addMilestone(db, p.id, 'Beta', null);
    const t = await createTask(db, taskInput({ projectId: p.id, milestoneId: m.id }));
    expect((await getTask(db, GUILD, t.id))?.milestoneId).toBe(m.id);
  });

  it('hides archived projects by default', async () => {
    const p = await project();
    const { updateProject } = await import('../src/services/projects.ts');
    await updateProject(db, GUILD, p.id, { archived: true });
    expect(await listProjects(db, GUILD)).toHaveLength(0);
    expect(await listProjects(db, GUILD, { includeArchived: true })).toHaveLength(1);
  });

  it('accepts only http(s) links', () => {
    expect(isHttpUrl('https://github.com/x/y')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });
});

describe('config', () => {
  it('creates defaults on first read and merges updates', async () => {
    const c = await getConfig(db, GUILD);
    expect([c.timezone, c.reminderHour]).toEqual(['America/Toronto', 9]);
    const u = await updateConfig(db, GUILD, { teamRoles: { events: 'r1' }, digestChannelId: 'd' });
    expect(u.teamRoles).toEqual({ events: 'r1' });
    expect((await getConfig(db, GUILD)).digestChannelId).toBe('d');
  });
});
