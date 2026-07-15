import { CalendarDateTime, fromDate, getDayOfWeek, toZoned } from '@internationalized/date';

/**
 * All local-time math goes through the IANA zone via @internationalized/date —
 * never naive offset arithmetic. Vercel Cron fires at a fixed UTC hour; these
 * functions are what make "09:00 America/Chicago" true in CST and CDT both.
 */

/** The instant of `hhmm` local time in `tz`, on the tz-local date of `nowUtc` (+ dayOffset). */
export function localInstant(nowUtc: Date, tz: string, hhmm: string, dayOffset = 0): Date {
  const [hh, mm] = hhmm.split(':').map(Number);
  if (hh === undefined || mm === undefined || Number.isNaN(hh) || Number.isNaN(mm)) {
    throw new Error(`Bad HH:MM time: ${hhmm}`);
  }
  const zonedNow = fromDate(nowUtc, tz);
  let local = new CalendarDateTime(zonedNow.year, zonedNow.month, zonedNow.day, hh, mm);
  if (dayOffset !== 0) local = local.add({ days: dayOffset });
  // 'compatible' disambiguation: times inside the spring-forward gap move
  // forward; ambiguous fall-back times take the earlier offset.
  return toZoned(local, tz).toDate();
}

/** Milliseconds from `nowUtc` until `hhmm` local today; 0 if already past. */
export function msUntilLocalTime(nowUtc: Date, tz: string, hhmm: string): number {
  return Math.max(0, localInstant(nowUtc, tz, hhmm).getTime() - nowUtc.getTime());
}

/** Is `nowUtc` a Saturday or Sunday in `tz`? */
export function isWeekendIn(nowUtc: Date, tz: string): boolean {
  const dow = getDayOfWeek(fromDate(nowUtc, tz), 'en-US'); // 0 = Sunday
  return dow === 0 || dow === 6;
}

/** How many sends fit from `start` to `windowEnd` inclusive at `intervalSeconds` pacing. */
export function capacityInWindow(start: Date, windowEnd: Date, intervalSeconds: number): number {
  const span = windowEnd.getTime() - start.getTime();
  if (span < 0) return 0;
  return Math.floor(span / (intervalSeconds * 1000)) + 1;
}
