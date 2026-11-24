/** Channel facts the blast logic needs, gathered from Discord by the command. */
export interface BlastChannel {
  id: string;
  name: string;
  category: string | null;
  categoryPosition: number;
  position: number;
  botCanSend: boolean;
  userCanSend: boolean;
}

export interface BlastPlan {
  targets: BlastChannel[];
  /** Matching channels that will be skipped, with why. */
  skipped: { channel: BlastChannel; reason: string }[];
}

/** "admin, #Announcements" → ["admin", "announcements"]. */
export function parseChannelNames(input: string): string[] {
  const names = input
    .split(/[,\s]+/)
    .map((n) => n.replace(/^#/, '').trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(names)];
}

/** Exact-name matches, ordered as Discord shows them (category, then channel). */
export function planBlast(channels: BlastChannel[], names: string[]): BlastPlan {
  const matches = channels
    .filter((c) => names.includes(c.name.toLowerCase()))
    .sort(
      (a, b) =>
        a.categoryPosition - b.categoryPosition ||
        (a.category ?? '').localeCompare(b.category ?? '') ||
        a.position - b.position,
    );
  const plan: BlastPlan = { targets: [], skipped: [] };
  for (const channel of matches) {
    if (!channel.userCanSend) plan.skipped.push({ channel, reason: 'you can’t post there' });
    else if (!channel.botCanSend) plan.skipped.push({ channel, reason: 'bot lacks access' });
    else plan.targets.push(channel);
  }
  return plan;
}

/** "Category › #channel" lines grouped under each category. */
export function describeTargets(channels: BlastChannel[]): string {
  const groups = new Map<string, string[]>();
  for (const c of channels) {
    const key = c.category ?? 'No category';
    groups.set(key, [...(groups.get(key) ?? []), `<#${c.id}>`]);
  }
  return [...groups].map(([category, list]) => `**${category}** › ${list.join(' ')}`).join('\n');
}
