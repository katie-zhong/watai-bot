import { describe, expect, it } from 'vitest';
import {
  type BlastChannel,
  describeTargets,
  parseChannelNames,
  planBlast,
} from '../src/domain/blast.ts';

const ch = (
  id: string,
  name: string,
  category: string | null,
  categoryPosition: number,
  over: Partial<BlastChannel> = {},
): BlastChannel => ({
  id,
  name,
  category,
  categoryPosition,
  position: 0,
  botCanSend: true,
  userCanSend: true,
  ...over,
});

const server = [
  ch('3', 'announcements', 'Events', 1),
  ch('1', 'admin', 'Events', 1),
  ch('2', 'admin', 'Finance', 2),
  ch('4', 'Admin', null, -1),
  ch('5', 'general', 'Events', 1),
  ch('6', 'admin', 'Execs', 3, { userCanSend: false }),
  ch('7', 'admin', 'Projects', 4, { botCanSend: false }),
];

describe('blast', () => {
  it('parses names loosely', () => {
    expect(parseChannelNames(' #Admin, announcements,admin ')).toEqual(['admin', 'announcements']);
    expect(parseChannelNames(' , ')).toEqual([]);
  });

  it('matches exact names case-insensitively, in Discord order', () => {
    const plan = planBlast(server, ['admin', 'announcements']);
    expect(plan.targets.map((c) => c.id)).toEqual(['4', '3', '1', '2']);
    expect(plan.skipped.map((s) => [s.channel.id, s.reason])).toEqual([
      ['6', 'you can’t post there'],
      ['7', 'bot lacks access'],
    ]);
  });

  it('never matches partial names', () => {
    expect(planBlast(server, ['admi']).targets).toEqual([]);
  });

  it('groups the preview by category', () => {
    const plan = planBlast(server, ['admin', 'announcements']);
    expect(describeTargets(plan.targets)).toBe(
      ['**No category** › <#4>', '**Events** › <#3> <#1>', '**Finance** › <#2>'].join('\n'),
    );
  });
});
