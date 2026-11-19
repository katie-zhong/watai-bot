import { describe, expect, it } from 'vitest';
import type { Project, Task } from '../src/db/schema.ts';
import { commands } from '../src/discord/commands/index.ts';
import { colorOf, taskEmbed } from '../src/discord/embeds.ts';
import { projectPanel, reminderActions, taskPanel } from '../src/discord/panels.ts';
import { COLORS } from '../src/domain/constants.ts';
import { parseServiceAccount, projectRows, taskRows } from '../src/sheets/sync.ts';
import { at, GUILD, ZONE } from './helpers.ts';

const task: Task = {
  id: 12,
  guildId: GUILD,
  title: '=HYPERLINK("x") Book venue',
  notes: null,
  link: null,
  dueAt: at('2026-11-20T23:59:00-05:00'),
  dueHasTime: false,
  ownerIds: ['u1', 'u2'],
  teams: ['events'],
  term: 'F26',
  projectId: 3,
  milestoneId: null,
  color: null,
  status: 'blocked',
  blockerNote: 'waiting on budget',
  channelIds: ['c1'],
  snoozedUntil: null,
  lastRemindedOn: null,
  createdBy: 'u1',
  createdAt: at('2026-11-01T12:00:00-05:00'),
  completedAt: null,
};
const project: Project = {
  id: 3,
  guildId: GUILD,
  name: 'Hackathon',
  description: null,
  leadId: 'u1',
  memberIds: ['u1', 'u2'],
  teams: ['events'],
  term: 'F26',
  color: 'purple',
  channelIds: [],
  archived: false,
  createdBy: 'u1',
  createdAt: at('2026-11-01T12:00:00-05:00'),
};

describe('command definitions', () => {
  it('serialise within Discord’s limits', () => {
    const json = commands.map((c) => c.data.toJSON());
    expect(json.map((c) => c.name)).toEqual([
      'task',
      'deadlines',
      'mine',
      'project',
      'artifact',
      'milestone',
      'checkin',
      'digest',
      'config',
      'help',
    ]);
    expect(json.length).toBeLessThanOrEqual(100);
  });
  it('wire autocomplete wherever an option asks for it', () => {
    for (const c of commands) {
      if (JSON.stringify(c.data.toJSON()).includes('"autocomplete":true'))
        expect(c.autocomplete, c.data.name).toBeTypeOf('function');
    }
  });
});

describe('components', () => {
  it('fit in a message and carry routable ids', () => {
    for (const rows of [taskPanel(task), projectPanel(project), reminderActions(task.id)]) {
      expect(rows.length).toBeLessThanOrEqual(5);
      for (const row of rows)
        for (const c of row.toJSON().components) {
          const id = 'custom_id' in c ? c.custom_id : '';
          expect(id).toMatch(/^[tp]:[a-z]+:\d+(:\d+)?$/);
        }
    }
  });
  it('pre-select current values so a panel never wipes them', () => {
    const [teams, owners, channels] = taskPanel(task).map((r) => r.toJSON().components[0]);
    expect(JSON.stringify(teams)).toContain('"value":"events","default":true');
    expect(JSON.stringify(owners)).toContain('"id":"u2"');
    expect(JSON.stringify(channels)).toContain('"id":"c1"');
  });
});

describe('embeds', () => {
  it('inherit the project colour unless the task sets one', () => {
    expect(colorOf(task, project)).toBe(COLORS.purple);
    expect(colorOf({ color: 'red' }, project)).toBe(COLORS.red);
    expect(colorOf({ color: null })).toBe(COLORS.blue);
  });
  it('surface the blocker note', () => {
    const fields = taskEmbed(task, project, ZONE, at('2026-11-19T12:00:00-05:00')).toJSON().fields;
    expect(fields?.find((f) => f.name === 'Blocker')?.value).toBe('waiting on budget');
    expect(fields?.find((f) => f.name === 'Due')?.value).toContain('due tomorrow');
  });
});

describe('sheet rows', () => {
  const name = (id: string) => ({ u1: 'Ada', u2: 'Lin' })[id] ?? id;
  it('mirror tasks with names, local dates and project', () => {
    const [header, row] = taskRows([task], new Map([[3, project]]), name, ZONE);
    expect(header?.slice(0, 5)).toEqual(['ID', 'Title', 'Status', 'Due', 'Owners']);
    expect(row?.slice(0, 8)).toEqual([
      12,
      task.title,
      'blocked',
      '2026-11-20',
      'Ada, Lin',
      'events',
      'F26',
      'Hackathon',
    ]);
  });
  it('summarise projects', () => {
    const rows = projectRows(
      [project],
      [task, { ...task, id: 13, status: 'done' }],
      new Map([[3, [{ id: 1, projectId: 3, label: 'Spec', url: 'https://x.dev', addedBy: 'u1' }]]]),
      name,
      ZONE,
      at('2026-11-25T12:00:00-05:00'),
    );
    expect(rows[1]).toEqual([
      3,
      'Hackathon',
      'Ada',
      'Ada, Lin',
      'events',
      'F26',
      1,
      1,
      1,
      1,
      'Spec: https://x.dev',
      '',
    ]);
  });
  it('read a service-account key as raw JSON or base64', () => {
    const raw = JSON.stringify({ client_email: 'a@b.iam', private_key: 'k' });
    expect(parseServiceAccount(raw).client_email).toBe('a@b.iam');
    expect(parseServiceAccount(Buffer.from(raw).toString('base64')).private_key).toBe('k');
    expect(() => parseServiceAccount('{}')).toThrow();
  });
});
