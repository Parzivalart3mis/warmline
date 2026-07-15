import { describe, it, expect } from 'vitest';
import {
  localInstant,
  msUntilLocalTime,
  isWeekendIn,
  capacityInWindow,
} from '@/lib/schedule/local-time';
import { computeDelays } from '@/lib/schedule/delays';

const CHI = 'America/Chicago';
// US 2026 transitions: spring forward Sun Mar 8 (CST→CDT), fall back Sun Nov 1 (CDT→CST).

describe('localInstant across DST (America/Chicago)', () => {
  it('day before spring forward: 09:00 CST = 15:00Z', () => {
    const now = new Date('2026-03-07T06:10:00Z');
    expect(localInstant(now, CHI, '09:00').toISOString()).toBe('2026-03-07T15:00:00.000Z');
  });

  it('day of spring forward: 09:00 CDT = 14:00Z', () => {
    const now = new Date('2026-03-08T06:10:00Z');
    expect(localInstant(now, CHI, '09:00').toISOString()).toBe('2026-03-08T14:00:00.000Z');
  });

  it('day after spring forward: 09:00 CDT = 14:00Z', () => {
    const now = new Date('2026-03-09T06:10:00Z');
    expect(localInstant(now, CHI, '09:00').toISOString()).toBe('2026-03-09T14:00:00.000Z');
  });

  it('day before fall back: 09:00 CDT = 14:00Z', () => {
    const now = new Date('2026-10-31T06:10:00Z');
    expect(localInstant(now, CHI, '09:00').toISOString()).toBe('2026-10-31T14:00:00.000Z');
  });

  it('day of fall back: 09:00 CST = 15:00Z', () => {
    const now = new Date('2026-11-01T06:10:00Z');
    expect(localInstant(now, CHI, '09:00').toISOString()).toBe('2026-11-01T15:00:00.000Z');
  });

  it('day after fall back: 09:00 CST = 15:00Z', () => {
    const now = new Date('2026-11-02T06:10:00Z');
    expect(localInstant(now, CHI, '09:00').toISOString()).toBe('2026-11-02T15:00:00.000Z');
  });

  it('a time inside the spring-forward gap resolves forward, not to 3am chaos', () => {
    const now = new Date('2026-03-08T06:10:00Z');
    // 02:30 does not exist on Mar 8 in Chicago; compatible → 03:30 CDT = 08:30Z.
    expect(localInstant(now, CHI, '02:30').toISOString()).toBe('2026-03-08T08:30:00.000Z');
  });

  it('an ambiguous fall-back time takes the earlier offset', () => {
    const now = new Date('2026-11-01T05:10:00Z');
    // 01:30 happens twice on Nov 1; earlier = CDT = 06:30Z.
    expect(localInstant(now, CHI, '01:30').toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });

  it('uses the LOCAL date, not the UTC date, near midnight', () => {
    // 03:00Z on Mar 8 is still Mar 7 in Chicago (21:00 CST), so "today at
    // 09:00" means Mar 7 09:00 CST — not the UTC date's Mar 8.
    const now = new Date('2026-03-08T03:00:00Z');
    expect(localInstant(now, CHI, '09:00').toISOString()).toBe('2026-03-07T15:00:00.000Z');
    // Tomorrow (Mar 8) is the spring-forward day: 09:00 CDT = 14:00Z.
    expect(localInstant(now, CHI, '09:00', 1).toISOString()).toBe('2026-03-08T14:00:00.000Z');
  });

  it('supports explicit day offsets across the transition', () => {
    const now = new Date('2026-03-07T15:30:00Z');
    expect(localInstant(now, CHI, '09:00', 1).toISOString()).toBe('2026-03-08T14:00:00.000Z');
  });
});

describe('msUntilLocalTime', () => {
  it('cron at 06:00Z on the spring-forward day sleeps exactly to 09:00 CDT', () => {
    const cronFire = new Date('2026-03-08T06:00:00Z');
    expect(msUntilLocalTime(cronFire, CHI, '09:00')).toBe(8 * 3_600_000);
  });

  it('cron at 06:00Z the day before sleeps 9 hours (CST)', () => {
    const cronFire = new Date('2026-03-07T06:00:00Z');
    expect(msUntilLocalTime(cronFire, CHI, '09:00')).toBe(9 * 3_600_000);
  });

  it('clamps to zero when the local time already passed', () => {
    const late = new Date('2026-03-08T20:00:00Z');
    expect(msUntilLocalTime(late, CHI, '09:00')).toBe(0);
  });

  it('throws on malformed times', () => {
    expect(() => localInstant(new Date(), CHI, 'nine am')).toThrow();
  });
});

describe('isWeekendIn', () => {
  it('respects the timezone boundary, not UTC', () => {
    // Sat 2026-03-07 23:30 Chicago = Sun 05:30Z — still Saturday locally.
    expect(isWeekendIn(new Date('2026-03-08T05:30:00Z'), CHI)).toBe(true);
    // Mon 2026-03-09 07:00 Chicago.
    expect(isWeekendIn(new Date('2026-03-09T12:00:00Z'), CHI)).toBe(false);
    // Fri 2026-03-06 18:00Z is Friday in Chicago.
    expect(isWeekendIn(new Date('2026-03-06T18:00:00Z'), CHI)).toBe(false);
  });
});

describe('capacityInWindow', () => {
  const at = (iso: string) => new Date(iso);

  it('counts the send at the window edge inclusively', () => {
    expect(capacityInWindow(at('2026-03-09T14:00:00Z'), at('2026-03-09T14:10:00Z'), 120)).toBe(6);
  });

  it('returns 1 when start equals end', () => {
    expect(capacityInWindow(at('2026-03-09T14:00:00Z'), at('2026-03-09T14:00:00Z'), 120)).toBe(1);
  });

  it('returns 0 when the window already closed', () => {
    expect(capacityInWindow(at('2026-03-09T15:00:00Z'), at('2026-03-09T14:00:00Z'), 120)).toBe(0);
  });
});

describe('computeDelays', () => {
  it('stays within interval ± jitter', () => {
    const delays = computeDelays(200, 120, 30);
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(90_000);
      expect(d).toBeLessThanOrEqual(150_000);
    }
    expect(delays).toHaveLength(200);
  });

  it('is never zero or negative even with absurd jitter', () => {
    const delays = computeDelays(50, 10, 3600, () => 0); // rng()=0 → maximum negative jitter
    for (const d of delays) expect(d).toBeGreaterThanOrEqual(1_000);
  });

  it('is deterministic with an injected rng', () => {
    const rng = () => 0.5; // jitter term = 0
    expect(computeDelays(3, 120, 30, rng)).toEqual([120_000, 120_000, 120_000]);
  });

  it('returns an empty list for zero count', () => {
    expect(computeDelays(0, 120, 30)).toEqual([]);
  });
});
