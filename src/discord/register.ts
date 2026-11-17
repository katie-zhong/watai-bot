import { REST, Routes } from 'discord.js';
import { loadEnv } from '../env.ts';
import { commands } from './commands/index.ts';

/** Guild-scoped registration is instant; global takes up to an hour to propagate. */
export async function registerCommands(token: string, clientId: string, guildId?: string) {
  const body = commands.map((c) => c.data.toJSON());
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);
  await new REST().setToken(token).put(route, { body });
  console.log(`registered ${body.length} commands ${guildId ? `to guild ${guildId}` : 'globally'}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  await registerCommands(env.DISCORD_TOKEN, env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID);
}
