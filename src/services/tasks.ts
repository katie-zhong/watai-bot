import { and, arrayContains, asc, eq, ilike, inArray, lte, ne, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { type NewTask, type Project, type Task, tasks } from '../db/schema.ts';
import type { Status } from '../domain/constants.ts';

export interface TaskFilter {
  projectId?: number;
  milestoneId?: number;
  term?: string;
  team?: string;
  ownerId?: string;
  status?: Status;
  includeDone?: boolean;
  dueBefore?: Date;
}

export async function createTask(db: Db, input: NewTask): Promise<Task> {
  const [row] = await db.insert(tasks).values(input).returning();
  if (!row) throw new Error('task insert returned nothing');
  return row;
}

export async function getTask(db: Db, guildId: string, id: number): Promise<Task | undefined> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.guildId, guildId), eq(tasks.id, id)));
  return row;
}

export async function updateTask(
  db: Db,
  guildId: string,
  id: number,
  patch: Partial<NewTask>,
): Promise<Task | undefined> {
  const [row] = await db
    .update(tasks)
    .set(patch)
    .where(and(eq(tasks.guildId, guildId), eq(tasks.id, id)))
    .returning();
  return row;
}

export async function deleteTask(db: Db, guildId: string, id: number): Promise<void> {
  await db.delete(tasks).where(and(eq(tasks.guildId, guildId), eq(tasks.id, id)));
}

/** A blocker note only lives while the task is blocked. */
export function setStatus(db: Db, guildId: string, id: number, status: Status, note?: string) {
  return updateTask(db, guildId, id, {
    status,
    blockerNote: status === 'blocked' ? (note ?? null) : null,
    completedAt: status === 'done' ? new Date() : null,
    snoozedUntil: status === 'done' ? null : undefined,
  });
}

export async function listTasks(db: Db, guildId: string, f: TaskFilter = {}): Promise<Task[]> {
  const where: (SQL | undefined)[] = [eq(tasks.guildId, guildId)];
  if (f.status) where.push(eq(tasks.status, f.status));
  else if (!f.includeDone) where.push(ne(tasks.status, 'done'));
  if (f.projectId != null) where.push(eq(tasks.projectId, f.projectId));
  if (f.milestoneId != null) where.push(eq(tasks.milestoneId, f.milestoneId));
  if (f.term) where.push(eq(tasks.term, f.term));
  if (f.team) where.push(arrayContains(tasks.teams, [f.team]));
  if (f.ownerId) where.push(arrayContains(tasks.ownerIds, [f.ownerId]));
  if (f.dueBefore) where.push(lte(tasks.dueAt, f.dueBefore));
  return db
    .select()
    .from(tasks)
    .where(and(...where))
    .orderBy(asc(tasks.dueAt));
}

export async function searchTasks(db: Db, guildId: string, query: string): Promise<Task[]> {
  const id = Number(query.replace('#', ''));
  const where = [eq(tasks.guildId, guildId)];
  if (Number.isInteger(id) && id > 0) where.push(eq(tasks.id, id));
  else {
    where.push(ne(tasks.status, 'done'));
    if (query) where.push(ilike(tasks.title, `%${query}%`));
  }
  return db
    .select()
    .from(tasks)
    .where(and(...where))
    .orderBy(asc(tasks.dueAt))
    .limit(25);
}

/** Every unfinished task across guilds, for the hourly reminder pass. */
export async function openTasksForGuilds(db: Db, guildIds: string[]): Promise<Task[]> {
  if (guildIds.length === 0) return [];
  return db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.guildId, guildIds), ne(tasks.status, 'done')));
}

/**
 * Anyone can create and assign; changing a task is limited to people attached to it,
 * or managers/admins (`canEditAll`).
 */
export function canModify(
  task: Pick<Task, 'ownerIds' | 'createdBy'>,
  project: Pick<Project, 'leadId'> | undefined,
  userId: string,
  canEditAll: boolean,
): boolean {
  return (
    canEditAll ||
    task.createdBy === userId ||
    task.ownerIds.includes(userId) ||
    project?.leadId === userId
  );
}
