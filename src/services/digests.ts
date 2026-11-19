import { and, asc, eq, ilike, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { type Digest, digests, type NewDigest } from '../db/schema.ts';

export class DuplicateDigestError extends Error {}

export async function createDigest(db: Db, input: NewDigest): Promise<Digest> {
  const [row] = await db.insert(digests).values(input).onConflictDoNothing().returning();
  if (!row) throw new DuplicateDigestError(input.name);
  return row;
}

export async function getDigest(db: Db, guildId: string, id: number): Promise<Digest | undefined> {
  const [row] = await db
    .select()
    .from(digests)
    .where(and(eq(digests.guildId, guildId), eq(digests.id, id)));
  return row;
}

export async function updateDigest(
  db: Db,
  guildId: string,
  id: number,
  patch: Partial<NewDigest>,
): Promise<Digest | undefined> {
  try {
    const [row] = await db
      .update(digests)
      .set(patch)
      .where(and(eq(digests.guildId, guildId), eq(digests.id, id)))
      .returning();
    return row;
  } catch (e) {
    if (patch.name) throw new DuplicateDigestError(patch.name);
    throw e;
  }
}

export async function deleteDigest(db: Db, guildId: string, id: number): Promise<boolean> {
  const rows = await db
    .delete(digests)
    .where(and(eq(digests.guildId, guildId), eq(digests.id, id)))
    .returning();
  return rows.length > 0;
}

export function listDigests(db: Db, guildId: string, query = ''): Promise<Digest[]> {
  const where = [eq(digests.guildId, guildId)];
  if (query) where.push(ilike(digests.name, `%${query}%`));
  return db
    .select()
    .from(digests)
    .where(and(...where))
    .orderBy(asc(digests.name));
}

export function digestsForGuilds(db: Db, guildIds: string[]): Promise<Digest[]> {
  if (!guildIds.length) return Promise.resolve([]);
  return db.select().from(digests).where(inArray(digests.guildId, guildIds));
}
