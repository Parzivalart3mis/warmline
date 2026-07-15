import { describe, it, expect } from 'vitest';
import {
  contactCreateSchema,
  contactUpdateSchema,
  settingsUpdateSchema,
  messagePatchSchema,
  importSchema,
  runCreateSchema,
  generateSchema,
} from '@/lib/schemas';

describe('contactCreateSchema', () => {
  it('accepts a minimal valid contact and normalizes email', () => {
    const parsed = contactCreateSchema.parse({ email: '  Ada@Example.COM ', firstName: 'Ada' });
    expect(parsed.email).toBe('ada@example.com');
    expect(parsed.lastName).toBe('');
    expect(parsed.tags).toEqual([]);
    expect(parsed.researchOptIn).toBe(true);
  });

  it('rejects an invalid email', () => {
    expect(contactCreateSchema.safeParse({ email: 'not-an-email', firstName: 'X' }).success).toBe(
      false,
    );
  });

  it('rejects a missing first name', () => {
    expect(contactCreateSchema.safeParse({ email: 'a@b.com' }).success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    const r = contactCreateSchema.safeParse({ email: 'a@b.com', firstName: 'A', wat: 1 });
    expect(r.success).toBe(false);
  });

  it('enforces field caps', () => {
    expect(
      contactCreateSchema.safeParse({ email: 'a@b.com', firstName: 'A'.repeat(101) }).success,
    ).toBe(false);
    expect(
      contactCreateSchema.safeParse({ email: `${'a'.repeat(250)}@b.com`, firstName: 'A' }).success,
    ).toBe(false);
    expect(
      contactCreateSchema.safeParse({
        email: 'a@b.com',
        firstName: 'A',
        tags: Array.from({ length: 11 }, (_, i) => `t${i}`),
      }).success,
    ).toBe(false);
  });

  it('requires https for job and linkedin URLs', () => {
    expect(
      contactCreateSchema.safeParse({ email: 'a@b.com', firstName: 'A', jobUrl: 'http://x.com' })
        .success,
    ).toBe(false);
    const ok = contactCreateSchema.parse({
      email: 'a@b.com',
      firstName: 'A',
      jobUrl: 'https://x.com/job',
      linkedinUrl: '',
    });
    expect(ok.jobUrl).toBe('https://x.com/job');
    expect(ok.linkedinUrl).toBeUndefined();
  });
});

describe('contactUpdateSchema', () => {
  it('rejects an empty patch', () => {
    expect(contactUpdateSchema.safeParse({}).success).toBe(false);
  });
  it('accepts a single field', () => {
    expect(contactUpdateSchema.safeParse({ company: 'Acme' }).success).toBe(true);
  });
});

describe('settingsUpdateSchema', () => {
  it('validates HH:MM times', () => {
    expect(settingsUpdateSchema.safeParse({ sendTime: '09:00' }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ sendTime: '9:00' }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ sendTime: '24:00' }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ sendTime: '23:59' }).success).toBe(true);
  });

  it('rejects a window that ends before it starts', () => {
    expect(
      settingsUpdateSchema.safeParse({ windowStart: '18:00', windowEnd: '09:00' }).success,
    ).toBe(false);
  });

  it('rejects jitter >= interval', () => {
    expect(
      settingsUpdateSchema.safeParse({ intervalSeconds: 120, jitterSeconds: 120 }).success,
    ).toBe(false);
    expect(
      settingsUpdateSchema.safeParse({ intervalSeconds: 120, jitterSeconds: 30 }).success,
    ).toBe(true);
  });

  it('rejects an invalid timezone', () => {
    expect(settingsUpdateSchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ timezone: 'America/Chicago' }).success).toBe(true);
  });

  it('bounds numeric settings', () => {
    expect(settingsUpdateSchema.safeParse({ dailyCap: 0 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ dailyCap: 101 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ maxFollowups: 6 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ intervalSeconds: 10 }).success).toBe(false);
  });
});

describe('messagePatchSchema', () => {
  it('requires at least one field', () => {
    expect(messagePatchSchema.safeParse({}).success).toBe(false);
    expect(messagePatchSchema.safeParse({ subject: 'Hi' }).success).toBe(true);
  });
  it('caps body length', () => {
    expect(messagePatchSchema.safeParse({ body: 'x'.repeat(10_001) }).success).toBe(false);
  });
});

describe('importSchema', () => {
  it('rejects empty and oversized batches', () => {
    expect(importSchema.safeParse({ rows: [] }).success).toBe(false);
    const many = Array.from({ length: 501 }, () => ({ email: 'a@b.com', firstName: 'A' }));
    expect(importSchema.safeParse({ rows: many }).success).toBe(false);
  });
});

describe('runCreateSchema', () => {
  it('accepts manual with optional contactIds', () => {
    expect(runCreateSchema.safeParse({ kind: 'manual' }).success).toBe(true);
    expect(runCreateSchema.safeParse({ kind: 'manual', contactIds: ['a'] }).success).toBe(true);
    expect(runCreateSchema.safeParse({ kind: 'daily' }).success).toBe(false);
  });
});

describe('generateSchema', () => {
  it('requires a contactId and bounds step', () => {
    expect(generateSchema.safeParse({ contactId: 'c1' }).success).toBe(true);
    expect(generateSchema.safeParse({ contactId: 'c1', step: 7 }).success).toBe(false);
    expect(generateSchema.safeParse({ step: 1 }).success).toBe(false);
  });
});
