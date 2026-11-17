import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';

export interface ParsedDue {
  dueAt: Date;
  hasTime: boolean;
}

/**
 * Parses "2026-12-01", "friday", "dec 3 5pm", "in 2 weeks" as wall-clock time in `zone`.
 * Date-only input is due at 23:59 that day.
 */
export function parseDue(text: string, now: Date, zone: string): ParsedDue | null {
  // chrono reads the reference via system-local getters, so hand it the zone's wall clock.
  const wall = DateTime.fromJSDate(now, { zone });
  const ref = new Date(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const result = chrono.parse(text, ref, { forwardDate: true })[0];
  if (!result) return null;
  const c = result.start;
  const hasTime = c.isCertain('hour');
  const year = c.get('year');
  const month = c.get('month');
  const day = c.get('day');
  if (year == null || month == null || day == null) return null;
  const dt = DateTime.fromObject(
    {
      year,
      month,
      day,
      hour: hasTime ? (c.get('hour') ?? 23) : 23,
      minute: hasTime ? (c.get('minute') ?? 0) : 59,
    },
    { zone },
  );
  return dt.isValid ? { dueAt: dt.toJSDate(), hasTime } : null;
}

/** Calendar date (YYYY-MM-DD) of `date` in `zone`. */
export function localDate(date: Date, zone: string): string {
  return DateTime.fromJSDate(date, { zone }).toISODate() ?? '';
}

/** Whole calendar days from `now` to `due` in `zone` (negative when overdue). */
export function daysUntil(due: Date, now: Date, zone: string): number {
  const a = DateTime.fromJSDate(now, { zone }).startOf('day');
  const b = DateTime.fromJSDate(due, { zone }).startOf('day');
  return Math.round(b.diff(a, 'days').days);
}

export function addDays(isoDate: string, days: number): string {
  return DateTime.fromISO(isoDate).plus({ days }).toISODate() ?? isoDate;
}

/** Discord renders this in each viewer's own timezone. */
export function discordTime(date: Date, hasTime: boolean): string {
  const unix = Math.floor(date.getTime() / 1000);
  return `<t:${unix}:${hasTime ? 'f' : 'D'}>`;
}

export function relativeDue(days: number): string {
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days > 1) return `due in ${days} days`;
  return `overdue by ${-days} day${days === -1 ? '' : 's'}`;
}
