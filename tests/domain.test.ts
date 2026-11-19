import { describe, expect, it } from 'vitest';
import { accessLevel, roleMention, setRoleLevel } from '../src/domain/access.ts';
import { daysUntil, parseDue } from '../src/domain/dates.ts';
import { digestMention } from '../src/domain/digest.ts';
import { reminderDue } from '../src/domain/reminders.ts';
import { normalizeTerm, termFor } from '../src/domain/term.ts';
import { resolveChannels } from '../src/services/routing.ts';
import { at, ZONE } from './helpers.ts';

describe('term', () => {
  it('maps months to W/S/F terms', () => {
    expect(termFor(at('2026-05-01T12:00:00-04:00'), ZONE)).toBe('S26');
    expect(termFor(at('2026-08-31T12:00:00-04:00'), ZONE)).toBe('S26');
    expect(termFor(at('2026-09-01T12:00:00-04:00'), ZONE)).toBe('F26');
    expect(termFor(at('2027-01-15T12:00:00-05:00'), ZONE)).toBe('W27');
    expect(termFor(at('2027-04-30T12:00:00-04:00'), ZONE)).toBe('W27');
  });
  it('uses the local date at year boundaries', () => {
    // 03:00 UTC on Jan 1 is still Dec 31 in Toronto.
    expect(termFor(at('2027-01-01T03:00:00Z'), ZONE)).toBe('F26');
  });
  it('validates input', () => {
    expect(normalizeTerm(' s26 ')).toBe('S26');
    expect(normalizeTerm('spring')).toBeNull();
  });
});

describe('parseDue', () => {
  const now = at('2026-11-17T15:00:00-05:00'); // Tuesday
  it('treats a bare date as end of that local day', () => {
    const r = parseDue('2026-12-01', now, ZONE);
    expect(r?.hasTime).toBe(false);
    expect(r?.dueAt.toISOString()).toBe('2026-12-02T04:59:00.000Z');
  });
  it('reads natural language in the server timezone', () => {
    expect(parseDue('friday', now, ZONE)?.dueAt.toISOString()).toBe('2026-11-21T04:59:00.000Z');
    const timed = parseDue('dec 3 5pm', now, ZONE);
    expect(timed?.hasTime).toBe(true);
    expect(timed?.dueAt.toISOString()).toBe('2026-12-03T22:00:00.000Z');
  });
  it('rolls forward rather than into the past', () => {
    expect(daysUntil(parseDue('monday', now, ZONE)?.dueAt ?? now, now, ZONE)).toBe(6);
  });
  it('rejects nonsense', () => {
    expect(parseDue('whenever', now, ZONE)).toBeNull();
  });
});

describe('reminderDue', () => {
  const base = { status: 'open', lastRemindedOn: null, snoozedUntil: null };
  const due = at('2026-11-20T23:59:00-05:00');
  const morning = (day: string) => at(`2026-11-${day}T09:30:00-05:00`);

  it('fires 3 days before, 1 day before and on the day', () => {
    const kinds = ['16', '17', '18', '19', '20'].map((d) =>
      reminderDue({ ...base, dueAt: due }, morning(d), ZONE, 9),
    );
    expect(kinds).toEqual([null, 'upcoming', null, 'upcoming', 'upcoming']);
  });
  it('pings overdue tasks daily for 3 days, then stops', () => {
    const kinds = ['21', '22', '23', '24'].map((d) =>
      reminderDue({ ...base, dueAt: due }, morning(d), ZONE, 9),
    );
    expect(kinds).toEqual(['overdue', 'overdue', 'overdue', null]);
  });
  it('waits for the morning hour and pings once a day', () => {
    const t = { ...base, dueAt: due };
    expect(reminderDue(t, at('2026-11-20T08:59:00-05:00'), ZONE, 9)).toBeNull();
    expect(reminderDue({ ...t, lastRemindedOn: '2026-11-20' }, morning('20'), ZONE, 9)).toBeNull();
  });
  it('holds a snoozed task until its date, then pings regardless of schedule', () => {
    const t = { ...base, dueAt: due, snoozedUntil: '2026-11-26' };
    expect(reminderDue(t, morning('20'), ZONE, 9)).toBeNull();
    expect(reminderDue(t, morning('26'), ZONE, 9)).toBe('snooze');
  });
  it('never pings done tasks', () => {
    expect(reminderDue({ ...base, status: 'done', dueAt: due }, morning('20'), ZONE, 9)).toBeNull();
  });
});

describe('resolveChannels', () => {
  const config = {
    teamChannels: { events: 'c-events', finance: 'c-fin' },
    reminderChannelIds: ['c-default'],
  };
  it('prefers task, then project, then team, then server default', () => {
    const project = { channelIds: ['c-proj'] };
    expect(resolveChannels({ channelIds: ['a', 'b'], teams: ['events'] }, project, config)).toEqual(
      ['a', 'b'],
    );
    expect(resolveChannels({ channelIds: [], teams: ['events'] }, project, config)).toEqual([
      'c-proj',
    ]);
    expect(
      resolveChannels({ channelIds: [], teams: ['events', 'finance'] }, undefined, config),
    ).toEqual(['c-events', 'c-fin']);
    expect(resolveChannels({ channelIds: [], teams: ['community'] }, undefined, config)).toEqual([
      'c-default',
    ]);
    expect(
      resolveChannels({ channelIds: [], teams: [] }, undefined, {
        ...config,
        reminderChannelIds: [],
      }),
    ).toEqual([]);
  });
});

describe('access', () => {
  const config = { adminRoleIds: ['r-admin'], managerRoleIds: ['r-exec', 'r-tpm'] };
  it('maps roles to the highest level held', () => {
    expect(accessLevel(['r-tpm'], false, config)).toBe('manager');
    expect(accessLevel(['r-tpm', 'r-admin'], false, config)).toBe('admin');
    expect(accessLevel(['r-other'], false, config)).toBe('member');
  });
  it('always treats Manage Server as admin', () => {
    expect(accessLevel([], true, { adminRoleIds: [], managerRoleIds: [] })).toBe('admin');
  });
  it('keeps each role at one level', () => {
    const promoted = setRoleLevel(config, 'r-exec', 'admin');
    expect(promoted).toEqual({ adminRoleIds: ['r-admin', 'r-exec'], managerRoleIds: ['r-tpm'] });
    expect(setRoleLevel(promoted, 'r-exec', 'member').adminRoleIds).toEqual(['r-admin']);
  });
  it('mentions the @everyone role correctly', () => {
    expect(roleMention('g1', 'g1')).toBe('@everyone');
    expect(roleMention('r1', 'g1')).toBe('<@&r1>');
  });
});

describe('digestMention', () => {
  const config = { defaultPingRoleId: 'r-all', teamRoles: { events: 'r-ev' } };
  const d = (over = {}) => ({
    pingMode: 'auto',
    pingRoleId: null,
    teams: [],
    guildId: 'g1',
    ...over,
  });
  it('auto: team roles, else project members, else the server default', () => {
    expect(digestMention(d({ teams: ['events'] }), config).text).toBe('<@&r-ev>');
    expect(digestMention(d({ teams: ['finance'] }), config).text).toBe('<@&r-all>');
    expect(digestMention(d(), config).text).toBe('<@&r-all>');
    expect(digestMention(d(), config, { leadId: 'l', memberIds: ['l', 'm'] }).text).toBe(
      '<@l> <@m>',
    );
    expect(digestMention(d(), { ...config, defaultPingRoleId: null }).text).toBe('');
  });
  it('role and none override auto', () => {
    expect(
      digestMention(d({ pingMode: 'role', pingRoleId: 'r-x', teams: ['events'] }), config).text,
    ).toBe('<@&r-x>');
    expect(
      digestMention(d({ pingMode: 'role', pingRoleId: 'g1' }), config).allowedMentions,
    ).toEqual({ parse: ['everyone'] });
    expect(digestMention(d({ pingMode: 'none' }), config)).toEqual({
      text: '',
      allowedMentions: {},
    });
  });
});
