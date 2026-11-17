import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.ts';

/** Driver-agnostic handle so services run on postgres.js (prod) and PGlite (tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function connect(url: string): Promise<Db> {
  const db = drizzle(postgres(url, { max: 5, onnotice: () => {} }), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}
