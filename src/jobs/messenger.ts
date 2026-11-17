import type {
  ActionRowBuilder,
  Client,
  EmbedBuilder,
  MessageActionRowComponentBuilder,
  MessageMentionOptions,
} from 'discord.js';
import { ThreadAutoArchiveDuration } from 'discord.js';

export interface Outgoing {
  content?: string;
  embeds?: EmbedBuilder[];
  components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  allowedMentions?: MessageMentionOptions;
}

/** The only path jobs use to reach Discord, so they can be tested with a fake. */
export interface Messenger {
  send(channelId: string, msg: Outgoing): Promise<boolean>;
  /** Posts `msg`, opens a thread on it and posts `followUps` inside. */
  sendThread(
    channelId: string,
    msg: Outgoing,
    threadName: string,
    followUps: Outgoing[],
  ): Promise<boolean>;
}

export function discordMessenger(client: Client): Messenger {
  async function post(channelId: string, msg: Outgoing) {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isSendable()) throw new Error(`channel ${channelId} is not sendable`);
    return channel.send(msg);
  }
  return {
    async send(channelId, msg) {
      try {
        await post(channelId, msg);
        return true;
      } catch (e) {
        console.warn(`send to ${channelId} failed:`, e);
        return false;
      }
    },
    async sendThread(channelId, msg, threadName, followUps) {
      try {
        const message = await post(channelId, msg);
        const thread = await message.startThread({
          name: threadName.slice(0, 100),
          autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        });
        for (const f of followUps) await thread.send(f);
        return true;
      } catch (e) {
        console.warn(`thread in ${channelId} failed:`, e);
        return false;
      }
    },
  };
}
