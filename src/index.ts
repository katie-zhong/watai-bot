import { Client, Events, GatewayIntentBits } from 'discord.js';
import { connect } from './db/client.ts';
import { commands } from './discord/commands/index.ts';
import { handleComponent } from './discord/components.ts';
import { registerCommands } from './discord/register.ts';
import { type Ctx, fail } from './discord/util.ts';
import { loadEnv } from './env.ts';
import { discordMessenger } from './jobs/messenger.ts';
import { startScheduler } from './jobs/scheduler.ts';
import { createSheetSync, type NameOf } from './sheets/sync.ts';

const env = loadEnv();
const db = await connect(env.DATABASE_URL);

// Slash commands and components need only the Guilds intent (no privileged intents).
// Mentions are opt-in per message so user-written text can never ping.
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  allowedMentions: { parse: [] },
});

async function resolveNames(guildId: string, ids: string[]): Promise<NameOf> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const names = new Map<string, string>();
  for (const id of ids) {
    const member = await guild?.members.fetch(id).catch(() => null);
    names.set(id, member?.displayName ?? id);
  }
  return (id) => names.get(id) ?? id;
}

const sheets =
  env.GOOGLE_SHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? createSheetSync(db, env.GOOGLE_SHEET_ID, env.GOOGLE_SERVICE_ACCOUNT_JSON, resolveNames)
    : undefined;
if (!sheets) console.log('Google Sheets mirror disabled (no sheet id / service account).');

const ctx: Ctx = { db, client, sync: () => sheets?.schedule() };
const byName = new Map(commands.map((c) => [c.data.name, c]));

client.on(Events.InteractionCreate, async (i) => {
  if (!i.inCachedGuild()) return;
  try {
    if (i.isChatInputCommand()) await byName.get(i.commandName)?.execute(i, ctx);
    else if (i.isAutocomplete()) await byName.get(i.commandName)?.autocomplete?.(i, ctx);
    else if (i.isMessageComponent()) await handleComponent(i, ctx);
  } catch (e) {
    console.error('interaction failed:', e);
    if (i.isRepliable()) await fail(i, 'Something went wrong.').catch(() => {});
  }
});

client.once(Events.ClientReady, (c) => {
  console.log(`ready as ${c.user.tag}`);
  // The hourly tick also refreshes the sheet so derived columns (overdue) stay current.
  const stop = startScheduler(db, discordMessenger(client), ctx.sync);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      stop();
      void client.destroy().then(() => process.exit(0));
    });
});

await registerCommands(env.DISCORD_TOKEN, env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID);
await client.login(env.DISCORD_TOKEN);
