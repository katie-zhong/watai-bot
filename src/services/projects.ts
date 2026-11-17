import { and, asc, eq, ilike } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import {
  type Artifact,
  artifacts,
  type Milestone,
  milestones,
  type NewProject,
  type Project,
  projects,
} from '../db/schema.ts';

export class DuplicateProjectError extends Error {}

export async function createProject(db: Db, input: NewProject): Promise<Project> {
  const [row] = await db.insert(projects).values(input).onConflictDoNothing().returning();
  if (!row) throw new DuplicateProjectError(input.name);
  return row;
}

export async function getProject(
  db: Db,
  guildId: string,
  id: number,
): Promise<Project | undefined> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.guildId, guildId), eq(projects.id, id)));
  return row;
}

export async function updateProject(
  db: Db,
  guildId: string,
  id: number,
  patch: Partial<NewProject>,
): Promise<Project | undefined> {
  const [row] = await db
    .update(projects)
    .set(patch)
    .where(and(eq(projects.guildId, guildId), eq(projects.id, id)))
    .returning();
  return row;
}

export async function listProjects(
  db: Db,
  guildId: string,
  opts: { includeArchived?: boolean; query?: string } = {},
): Promise<Project[]> {
  const where = [eq(projects.guildId, guildId)];
  if (!opts.includeArchived) where.push(eq(projects.archived, false));
  if (opts.query) where.push(ilike(projects.name, `%${opts.query}%`));
  return db
    .select()
    .from(projects)
    .where(and(...where))
    .orderBy(asc(projects.name));
}

export async function addArtifact(
  db: Db,
  projectId: number,
  label: string,
  url: string,
  addedBy: string,
): Promise<Artifact> {
  const [row] = await db.insert(artifacts).values({ projectId, label, url, addedBy }).returning();
  if (!row) throw new Error('artifact insert returned nothing');
  return row;
}

export function listArtifacts(db: Db, projectId: number): Promise<Artifact[]> {
  return db
    .select()
    .from(artifacts)
    .where(eq(artifacts.projectId, projectId))
    .orderBy(asc(artifacts.id));
}

export async function removeArtifact(db: Db, projectId: number, id: number): Promise<boolean> {
  const rows = await db
    .delete(artifacts)
    .where(and(eq(artifacts.projectId, projectId), eq(artifacts.id, id)))
    .returning();
  return rows.length > 0;
}

export async function addMilestone(
  db: Db,
  projectId: number,
  name: string,
  dueAt: Date | null,
): Promise<Milestone> {
  const [row] = await db.insert(milestones).values({ projectId, name, dueAt }).returning();
  if (!row) throw new Error('milestone insert returned nothing');
  return row;
}

export function listMilestones(db: Db, projectId: number): Promise<Milestone[]> {
  return db
    .select()
    .from(milestones)
    .where(eq(milestones.projectId, projectId))
    .orderBy(asc(milestones.dueAt), asc(milestones.id));
}

export async function removeMilestone(db: Db, projectId: number, id: number): Promise<boolean> {
  const rows = await db
    .delete(milestones)
    .where(and(eq(milestones.projectId, projectId), eq(milestones.id, id)))
    .returning();
  return rows.length > 0;
}

export function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
