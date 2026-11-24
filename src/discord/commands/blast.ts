import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  LabelBuilder,
  type MessageActionRowComponentBuilder,
  type MessageComponentInteraction,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  type BlastChannel,
  describeTargets,
  parseChannelNames,
  planBlast,
} from '../../domain/blast.ts';
import { COLORS } from '../../domain/constants.ts';
import { rolesMention } from '../../domain/digest.ts';
import { discordMessenger } from '../../jobs/messenger.ts';
import { type Command, type Ctx, canEditAll, fail } from '../util.ts';

/** Discord's message limit, minus room for the role mention and sender line. */
export const MAX_BLAST_LENGTH = 1800;
const DRAFT_TTL_MS = 15 * 60_000; // Discord interaction tokens expire after 15 minutes.
const MAX_SELECT = 25;

interface Draft {
  id: number;
  guildId: string;
  userId: string;
  names: string[];
  roleId: string | null;
  message: string;
  targetIds: string[];
  selectedIds: string[];
  createdAt: number;
}

/** Drafts live in memory: a blast is composed and sent within one 15-minute interaction. */
const drafts = new Map<number, Draft>();
let nextId = 1;

function takeDraft(id: number, userId: string): Draft | undefined {
  const now = Date.now();
  for (const [key, d] of drafts) if (now - d.createdAt > DRAFT_TTL_MS) drafts.delete(key);
  const draft = drafts.get(id);
  return draft?.userId === userId ? draft : undefined;
}

const SEND = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages;

export function blastChannels(guild: Guild, member: GuildMember): BlastChannel[] {
  const me = guild.members.me;
  return guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
    .map((c) => ({
      id: c.id,
      name: c.name,
      category: c.parent?.name ?? null,
      categoryPosition: c.parent?.position ?? -1,
      position: 'position' in c ? c.position : 0,
      botCanSend: !!me && !!c.permissionsFor(me)?.has(SEND),
      userCanSend: !!c.permissionsFor(member)?.has(SEND),
    }));
}

export const blast: Command = {
  data: new SlashCommandBuilder()
    .setName('blast')
    .setDescription('Post one message to every channel with a given name, across categories')
    .addStringOption((o) =>
      o
        .setName('channels')
        .setDescription('Channel name(s), comma-separated, e.g. "admin, announcements"')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addRoleOption((o) =>
      o.setName('ping').setDescription('Role to ping (or @everyone); default none'),
    ),
  async autocomplete(i) {
    const typed = String(i.options.getFocused()).split(',');
    const current = (typed.pop() ?? '').trim().replace(/^#/, '').toLowerCase();
    const prefix = typed.map((t) => t.trim()).filter(Boolean);
    const counts = new Map<string, number>();
    for (const c of blastChannels(i.guild, i.member))
      if (c.userCanSend) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    const options = [...counts]
      .filter(([name]) => name.includes(current) && !prefix.includes(name))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 25)
      .map(([name, n]) => {
        const value = [...prefix, name].join(', ');
        return {
          name: `${value} (${n} channel${n === 1 ? '' : 's'})`.slice(0, 100),
          value: value.slice(0, 100),
        };
      });
    await i.respond(options);
  },
  async execute(i, ctx) {
    if (!(await canEditAll(i, ctx)))
      return fail(i, 'Only bot managers and admins can send blasts (see /config access).');
    const names = parseChannelNames(i.options.getString('channels', true));
    if (!names.length) return fail(i, 'Name at least one channel.');
    const plan = planBlast(blastChannels(i.guild, i.member), names);
    if (!plan.targets.length && !plan.skipped.length)
      return fail(i, `No channels named ${names.map((n) => `\`${n}\``).join(', ')}.`);

    const id = nextId++;
    drafts.set(id, {
      id,
      guildId: i.guildId,
      userId: i.user.id,
      names,
      roleId: i.options.getRole('ping')?.id ?? null,
      message: '',
      targetIds: [],
      selectedIds: [],
      createdAt: Date.now(),
    });
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`b:modal:${id}`)
        .setTitle(`Blast to #${names.join(', #')}`.slice(0, 45))
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Message')
            .setDescription('Markdown works. You’ll see where it goes before it sends.')
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('message')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(MAX_BLAST_LENGTH)
                .setRequired(true),
            ),
        ),
    );
  },
};

function preview(draft: Draft, guild: Guild, member: GuildMember) {
  const plan = planBlast(blastChannels(guild, member), draft.names);
  draft.targetIds = plan.targets.map((c) => c.id);
  draft.selectedIds = draft.selectedIds.filter((id) => draft.targetIds.includes(id));
  const selected = plan.targets.filter((c) => draft.selectedIds.includes(c.id));
  const ping = draft.roleId ? rolesMention([draft.roleId], draft.guildId).text : 'nobody';

  const embed = new EmbedBuilder()
    .setColor(COLORS.orange)
    .setTitle(`Send to ${selected.length} channel${selected.length === 1 ? '' : 's'}?`)
    .setDescription(draft.message.slice(0, 4000))
    .addFields(
      { name: 'Channels', value: describeTargets(selected).slice(0, 1024) || '— none selected —' },
      { name: 'Pings', value: ping, inline: true },
    );
  if (plan.skipped.length)
    embed.addFields({
      name: 'Skipped',
      value: plan.skipped
        .map((s) => `${s.channel.category ?? 'No category'} › <#${s.channel.id}> — ${s.reason}`)
        .join('\n')
        .slice(0, 1024),
    });

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  const row = () => new ActionRowBuilder<MessageActionRowComponentBuilder>();
  if (plan.targets.length > 1 && plan.targets.length <= MAX_SELECT)
    rows.push(
      row().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`b:pick:${draft.id}`)
          .setPlaceholder('Untick channels to skip')
          .setMinValues(0)
          .setMaxValues(plan.targets.length)
          .addOptions(
            plan.targets.map((c) => ({
              label: `${c.category ?? 'No category'} › #${c.name}`.slice(0, 100),
              value: c.id,
              default: draft.selectedIds.includes(c.id),
            })),
          ),
      ),
    );
  rows.push(
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(`b:send:${draft.id}`)
        .setLabel(`Send to ${selected.length}`)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!selected.length),
      new ButtonBuilder()
        .setCustomId(`b:cancel:${draft.id}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return { embeds: [embed], components: rows };
}

/** Modal submitted: store the message and show the confirmation preview. */
export async function onBlastModal(i: ModalSubmitInteraction<'cached'>, id: number): Promise<void> {
  const draft = takeDraft(id, i.user.id);
  if (!draft) return fail(i, 'This blast expired — run /blast again.');
  draft.message = i.fields.getTextInputValue('message').trim();
  draft.selectedIds = planBlast(blastChannels(i.guild, i.member), draft.names).targets.map(
    (c) => c.id,
  );
  await i.reply({ ...preview(draft, i.guild, i.member), flags: MessageFlags.Ephemeral });
}

export async function onBlastComponent(
  i: MessageComponentInteraction<'cached'>,
  ctx: Ctx,
  action: string,
  id: number,
): Promise<void> {
  const draft = takeDraft(id, i.user.id);
  if (!draft)
    return void (await i.update({
      content: 'This blast expired — run /blast again.',
      embeds: [],
      components: [],
    }));
  if (action === 'cancel') {
    drafts.delete(id);
    return void (await i.update({ content: 'Blast cancelled.', embeds: [], components: [] }));
  }
  if (action === 'pick' && i.isStringSelectMenu()) {
    draft.selectedIds = i.values;
    return void (await i.update(preview(draft, i.guild, i.member)));
  }
  if (action !== 'send') return;
  // Re-check access and channels at send time; either may have changed since the preview.
  if (!(await canEditAll(i, ctx))) return fail(i, 'You no longer have access to send blasts.');
  const live = new Set(
    planBlast(blastChannels(i.guild, i.member), draft.names).targets.map((c) => c.id),
  );
  const targets = draft.selectedIds.filter((c) => live.has(c));
  drafts.delete(id);
  await i.update({ content: `Sending to ${targets.length} channels…`, embeds: [], components: [] });

  const mention = draft.roleId ? rolesMention([draft.roleId], draft.guildId) : undefined;
  const content = [mention?.text, draft.message, `-# Sent by <@${draft.userId}> via /blast`]
    .filter(Boolean)
    .join('\n');
  const messenger = discordMessenger(ctx.client);
  const results = await Promise.all(
    targets.map(async (channelId) => ({
      channelId,
      ok: await messenger.send(channelId, {
        content,
        allowedMentions: mention?.allowedMentions ?? {},
      }),
    })),
  );
  const failed = results.filter((r) => !r.ok).map((r) => `<#${r.channelId}>`);
  await i.editReply(
    `📣 Sent to ${results.length - failed.length}/${results.length} channels.` +
      (failed.length ? `\n⚠️ Failed: ${failed.join(' ')}` : ''),
  );
}
