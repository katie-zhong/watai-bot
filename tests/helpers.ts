import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { type Db, MIGRATIONS_DIR } from '../src/db/client.ts';
import type { NewTask } from '../src/db/schema.ts';
import * as schema from '../src/db/schema.ts';
import type { Messenger, Outgoing } from '../src/jobs/messenger.ts';

export const GUILD = 'g1';
export const ZONE = 'America/Toronto';

/** In-process Postgres running the real migrations. */
export async function testDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as Db;
}

export const at = (iso: string) => new Date(iso);

export function taskInput(over: Partial<NewTask> = {}): NewTask {
  return {
    guildId: GUILD,
    title: 'Book venue',
    dueAt: at('2026-11-20T23:59:00-05:00'),
    ownerIds: ['u1'],
    term: 'F26',
    createdBy: 'u1',
    ...over,
  };
}

export interface Sent {
  channelId: string;
  msg: Outgoing;
  thread?: { name: string; followUps: Outgoing[] };
}

export function fakeMessenger(ok = true): Messenger & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    async send(channelId, msg) {
      if (ok) sent.push({ channelId, msg });
      return ok;
    },
    async sendThread(channelId, msg, name, followUps) {
      if (ok) sent.push({ channelId, msg, thread: { name, followUps } });
      return ok;
    },
  };
}
