import { describe, it, expect } from 'vitest';
import { timeOfDay, relativeTime, initials } from '@/lib/format';

describe('timeOfDay', () => {
  it('formats in a given timezone', () => {
    // 14:00Z = 09:00 in America/Chicago (CDT).
    expect(timeOfDay('2026-07-14T14:00:00Z', 'America/Chicago')).toMatch(/9:00/);
  });
  it('returns a dash for empty or invalid input', () => {
    expect(timeOfDay(null)).toBe('—');
    expect(timeOfDay('not a date')).toBe('—');
  });
});

describe('relativeTime', () => {
  it('says "just now" for the present', () => {
    expect(relativeTime(new Date())).toBe('just now');
  });
  it('handles past and future', () => {
    expect(relativeTime(new Date(Date.now() - 2 * 3_600_000))).toMatch(/hour/);
    expect(relativeTime(new Date(Date.now() + 3 * 86_400_000))).toMatch(/day/);
  });
  it('returns empty for nullish', () => {
    expect(relativeTime(null)).toBe('');
  });
});

describe('initials', () => {
  it('takes the first letter of each name, uppercased', () => {
    expect(initials('Ada', 'Lovelace')).toBe('AL');
    expect(initials('cher', '')).toBe('C');
    expect(initials('', '')).toBe('?');
  });
});
