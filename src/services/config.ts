import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { type GuildConfig, guildConfig } from '../db/schema.ts';

export async function getConfig(db: Db, guildId: string): Promise<GuildConfig> {
  await db.insert(guildConfig).values({ guildId }).onConflictDoNothing();
  const [row] = await db.select().from(guildConfig).where(eq(guildConfig.guildId, guildId));
  if (!row) throw new Error(`guild_config missing for ${guildId}`);
  return row;
}

export async function updateConfig(
  db: Db,
  guildId: string,
  patch: Partial<Omit<GuildConfig, 'guildId'>>,
): Promise<GuildConfig> {
  await getConfig(db, guildId);
  const [row] = await db
    .update(guildConfig)
    .set(patch)
    .where(eq(guildConfig.guildId, guildId))
    .returning();
  if (!row) throw new Error(`guild_config missing for ${guildId}`);
  return row;
}

export async function allConfigs(db: Db): Promise<GuildConfig[]> {
  return db.select().from(guildConfig);
}
