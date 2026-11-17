import { DateTime } from 'luxon';

/** W = Jan–Apr, S = May–Aug, F = Sep–Dec, followed by a 2-digit year (e.g. S26). */
export function termFor(date: Date, zone: string): string {
  const d = DateTime.fromJSDate(date, { zone });
  const season = d.month <= 4 ? 'W' : d.month <= 8 ? 'S' : 'F';
  return `${season}${String(d.year % 100).padStart(2, '0')}`;
}

export function normalizeTerm(input: string): string | null {
  const t = input.trim().toUpperCase();
  return /^[WSF]\d{2}$/.test(t) ? t : null;
}
