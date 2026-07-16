/** Human-readable current date for AI context, e.g. "July 16, 2026". Kept in
 *  one place so the draft generator and the faithfulness gate reason about
 *  "now" identically. */
export function formatToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(now);
}

/** The shared temporal rule: date ranges are historical unless marked ongoing. */
export function tenseRule(today: string): string {
  return `Today's date is ${today}. Treat any education or employment END-DATE on or before today as COMPLETED — refer to it in the past tense. Do NOT describe the sender as currently enrolled, currently studying, or currently employed unless the resume explicitly marks that item as "Present" or "Current". A degree or role shown as a finished date range (e.g. "2024 - 2026") is finished, not ongoing.`;
}
