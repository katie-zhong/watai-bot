import { JWT } from 'google-auth-library';
import { DateTime } from 'luxon';
import type { Db } from '../db/client.ts';
import type { Artifact, Project, Task } from '../db/schema.ts';
import { daysUntil } from '../domain/dates.ts';
import { allConfigs } from '../services/config.ts';
import { listArtifacts, listProjects } from '../services/projects.ts';
import { listTasks } from '../services/tasks.ts';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TABS = ['Tasks', 'Projects'] as const;

export type NameOf = (userId: string) => string;
type Row = (string | number)[];

const stamp = (d: Date | null, zone: string, withTime = false) =>
  d ? DateTime.fromJSDate(d, { zone }).toFormat(withTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd') : '';

export function taskRows(
  tasks: Task[],
  projects: Map<number, Project>,
  name: NameOf,
  zone: string,
): Row[] {
  const header = [
    'ID',
    'Title',
    'Status',
    'Due',
    'Owners',
    'Teams',
    'Term',
    'Project',
    'Blocker',
    'Link',
    'Notes',
    'Created',
    'Completed',
  ];
  return [
    header,
    ...tasks.map((t) => [
      t.id,
      t.title,
      t.status,
      stamp(t.dueAt, zone, t.dueHasTime),
      t.ownerIds.map(name).join(', '),
      t.teams.join(', '),
      t.term,
      (t.projectId && projects.get(t.projectId)?.name) || '',
      t.blockerNote ?? '',
      t.link ?? '',
      t.notes ?? '',
      stamp(t.createdAt, zone),
      stamp(t.completedAt, zone),
    ]),
  ];
}

export function projectRows(
  projects: Project[],
  tasks: Task[],
  artifacts: Map<number, Artifact[]>,
  name: NameOf,
  zone: string,
  now: Date,
): Row[] {
  const header = [
    'ID',
    'Name',
    'Lead',
    'Members',
    'Teams',
    'Term',
    'Open',
    'Blocked',
    'Overdue',
    'Done',
    'Artifacts',
    'Archived',
  ];
  return [
    header,
    ...projects.map((p) => {
      const mine = tasks.filter((t) => t.projectId === p.id);
      const open = mine.filter((t) => t.status !== 'done');
      return [
        p.id,
        p.name,
        name(p.leadId),
        p.memberIds.map(name).join(', '),
        p.teams.join(', '),
        p.term ?? '',
        open.length,
        open.filter((t) => t.status === 'blocked').length,
        open.filter((t) => daysUntil(t.dueAt, now, zone) < 0).length,
        mine.length - open.length,
        (artifacts.get(p.id) ?? []).map((a) => `${a.label}: ${a.url}`).join('\n'),
        p.archived ? 'yes' : '',
      ];
    }),
  ];
}

/** Accepts the service-account key as raw JSON or base64. */
export function parseServiceAccount(value: string): { client_email: string; private_key: string } {
  const text = value.trim().startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8');
  const key = JSON.parse(text);
  if (!key.client_email || !key.private_key) throw new Error('service account key is incomplete');
  return key;
}

/**
 * One-way mirror: Postgres is the source of truth and each sync rewrites the Tasks and
 * Projects tabs. Edits made in the sheet are overwritten.
 */
export function createSheetSync(
  db: Db,
  sheetId: string,
  serviceAccountJson: string,
  resolveNames: (guildId: string, ids: string[]) => Promise<NameOf>,
) {
  const key = parseServiceAccount(serviceAccountJson);
  const auth = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const call = <T>(path: string, method: 'GET' | 'POST', data?: unknown) =>
    auth.request<T>({ url: `${API}/${sheetId}${path}`, method, data }).then((r) => r.data);

  async function syncNow(now = new Date()) {
    const meta = await call<{ sheets: { properties: { title: string } }[] }>(
      '?fields=sheets.properties.title',
      'GET',
    );
    const existing = new Set(meta.sheets.map((s) => s.properties.title));
    const missing = TABS.filter((t) => !existing.has(t));
    if (missing.length)
      await call(':batchUpdate', 'POST', {
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      });

    const tasks: Row[] = [];
    const projects: Row[] = [];
    for (const config of await allConfigs(db)) {
      const zone = config.timezone;
      const [t, p] = await Promise.all([
        listTasks(db, config.guildId, { includeDone: true }),
        listProjects(db, config.guildId, { includeArchived: true }),
      ]);
      const artifacts = new Map(
        await Promise.all(p.map(async (x) => [x.id, await listArtifacts(db, x.id)] as const)),
      );
      const ids = [
        ...t.flatMap((x) => x.ownerIds),
        ...p.flatMap((x) => [x.leadId, ...x.memberIds]),
      ];
      const name = await resolveNames(config.guildId, [...new Set(ids)]);
      const tr = taskRows(t, new Map(p.map((x) => [x.id, x])), name, zone);
      const pr = projectRows(p, t, artifacts, name, zone, now);
      tasks.push(...(tasks.length ? tr.slice(1) : tr));
      projects.push(...(projects.length ? pr.slice(1) : pr));
    }
    if (!tasks.length) return;

    // RAW so user-entered text is never evaluated as a formula.
    await call('/values:batchUpdate', 'POST', {
      valueInputOption: 'RAW',
      data: [
        { range: 'Tasks!A1', values: tasks },
        { range: 'Projects!A1', values: projects },
      ],
    });
    // Drop rows left over from a longer previous sync.
    await call('/values:batchClear', 'POST', {
      ranges: [`Tasks!A${tasks.length + 1}:Z`, `Projects!A${projects.length + 1}:Z`],
    });
  }

  let timer: NodeJS.Timeout | undefined;
  return {
    syncNow,
    /** Coalesces bursts of edits into one write, well inside the Sheets API quota. */
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        syncNow().catch((e) => console.warn('sheet sync failed:', e.message ?? e));
      }, 10_000);
    },
  };
}
