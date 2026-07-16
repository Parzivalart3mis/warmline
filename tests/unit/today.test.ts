import { describe, it, expect } from 'vitest';
import { formatToday, tenseRule } from '@/lib/ai/today';

describe('formatToday', () => {
  it('formats a date as a long en-US string in UTC', () => {
    expect(formatToday(new Date('2026-07-16T03:00:00Z'))).toBe('July 16, 2026');
    // Uses UTC so it does not drift across the local midnight boundary.
    expect(formatToday(new Date('2026-01-01T00:30:00Z'))).toBe('January 1, 2026');
  });
});

describe('tenseRule', () => {
  it("states today and forbids asserting ongoing status without 'Present'", () => {
    const rule = tenseRule('July 16, 2026');
    expect(rule).toContain('July 16, 2026');
    expect(rule).toMatch(/COMPLETED/);
    expect(rule).toMatch(/Present/);
    expect(rule).toMatch(/finished, not ongoing/);
  });
});
