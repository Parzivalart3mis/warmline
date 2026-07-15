/** Small, dependency-free formatters for the data-as-data typography. */

export function timeOfDay(date: Date | string | null | undefined, tz?: string): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(tz ? { timeZone: tz } : {}),
  }).format(d);
}

export function relativeTime(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
  const mins = Math.round(diff / 60_000);
  if (abs < 60_000) return 'just now';
  if (abs < 3_600_000) return rtf.format(mins, 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}

export function initials(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase() || '?';
}
