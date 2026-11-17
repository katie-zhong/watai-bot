import { daysUntil, localDate } from './dates.ts';

/** Days before the deadline on which owners are pinged. */
export const REMIND_BEFORE = [3, 1, 0];
/** Daily overdue pings stop after this many days; the weekly digest takes over. */
export const OVERDUE_CAP_DAYS = 3;

export type ReminderKind = 'upcoming' | 'overdue' | 'snooze';

export interface Remindable {
  status: string;
  dueAt: Date;
  lastRemindedOn: string | null;
  snoozedUntil: string | null;
}

/** Decides whether a task should ping now. At most one ping per task per local day. */
export function reminderDue(
  task: Remindable,
  now: Date,
  zone: string,
  reminderHour: number,
): ReminderKind | null {
  if (task.status === 'done') return null;
  const today = localDate(now, zone);
  if (task.lastRemindedOn === today) return null;
  if (hourIn(now, zone) < reminderHour) return null;
  if (task.snoozedUntil) return today >= task.snoozedUntil ? 'snooze' : null;
  const days = daysUntil(task.dueAt, now, zone);
  if (REMIND_BEFORE.includes(days)) return 'upcoming';
  if (days < 0 && days >= -OVERDUE_CAP_DAYS) return 'overdue';
  return null;
}

export function hourIn(now: Date, zone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(
      now,
    ),
  );
}
