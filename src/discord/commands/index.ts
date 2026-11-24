import type { Command } from '../util.ts';
import { blast } from './blast.ts';
import { deadlines, mine } from './deadlines.ts';
import { digest } from './digest.ts';
import { checkin, config, help } from './misc.ts';
import { artifact, milestone, project } from './project.ts';
import { task } from './task.ts';

export const commands: Command[] = [
  task,
  deadlines,
  mine,
  project,
  artifact,
  milestone,
  checkin,
  digest,
  blast,
  config,
  help,
];
