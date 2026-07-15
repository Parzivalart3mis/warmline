import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb, mkUser, mkContact, mkRun, mkMessage } from '../helpers/test-db';
import type { Db } from '@/lib/db';
import { contacts, messages, suppressions } from '@/db/schema';
import { planRun, GRACE_MS } from '@/lib/engine/plan';

let db: Db;

beforeEach(async () => {
  db = await makeTestDb();
});

// Tue 2026-03-10, 06:05Z = 01:05 CDT — a normal cron morning.
const TUESDAY_CRON = new Date('2026-03-10T06:05:00Z');
// Sat 2026-03-14, 06:05Z.
const SATURDAY_CRON = new Date('2026-03-14T06:05:00Z');

const CHI = 'America/Chicago';
const midRng = () => 0.5; // jitter term 0 → exact interval delays

describe('planRun', () => {
  it('respects daily_cap', async () => {
    const user = await mkUser(db, { timezone: CHI, dailyCap: 5 });
    for (let i = 0; i < 12; i++) await mkContact(db, user.clerkUserId);
    const run = await mkRun(db, user.clerkUserId, { kind: 'daily' });

    const plan = await planRun(db, run.id, { now: TUESDAY_CRON, rng: midRng });
    expect(plan.plannedCount).toBe(5);
    expect(plan.delays).toHaveLength(4);
    // 06:05Z → 09:00 CDT is 14:00Z.
    expect(plan.msUntilSendTime).toBe(
      new Date('2026-03-10T14:00:00Z').getTime() - TUESDAY_CRON.getTime(),
    );
  });

  it('skips weekends entirely when weekdays_only', async () => {
    const user = await mkUser(db, { timezone: CHI, weekdaysOnly: true });
    await mkContact(db, user.clerkUserId);
    const run = await mkRun(db, user.clerkUserId, { kind: 'daily' });

    const plan = await planRun(db, run.id, { now: SATURDAY_CRON });
    expect(plan.plannedCount).toBe(0);
  });

  it('sends on weekends when weekdays_only is off', async () => {
    const user = await mkUser(db, { timezone: CHI, weekdaysOnly: false });
    await mkContact(db, user.clerkUserId);
    const run = await mkRun(db, user.clerkUserId, { kind: 'daily' });
    const plan = await planRun(db, run.id, { now: SATURDAY_CRON });
    expect(plan.plannedCount).toBe(1);
  });

  it('rolls the surplus when the drip would run past the window', async () => {
    // Window closes at 09:30; drip starts 09:10 (send time + 10min grace).
    // 20 min of window at 120s pacing → 11 sends fit.
    const user = await mkUser(db, {
      timezone: CHI,
      dailyCap: 30,
      windowEnd: '09:30',
      jitterSeconds: 0,
    });
    for (let i = 0; i < 20; i++) await mkContact(db, user.clerkUserId);
    const run = await mkRun(db, user.clerkUserId, { kind: 'daily' });

    const plan = await planRun(db, run.id, { now: TUESDAY_CRON, rng: midRng });
    expect(plan.plannedCount).toBe(11);

    const leftover = await db.select().from(contacts).where(eq(contacts.status, 'not_sent'));
    expect(leftover).toHaveLength(9); // rolls to the next eligible day
  });

  it('plans nothing when the window already closed', async () => {
    const user = await mkUser(db, {
      timezone: CHI,
      windowEnd: '07:00',
      sendTime: '06:00',
      windowStart: '06:00',
    });
    await mkContact(db, user.clerkUserId);
    const run = await mkRun(db, user.clerkUserId, { kind: 'daily' });
    // 20:00Z = 15:00 CDT, hours past the 07:00 window end.
    const plan = await planRun(db, run.id, { now: new Date('2026-03-10T20:00:00Z') });
    expect(plan.plannedCount).toBe(0);
  });

  it('filters suppressed contacts at the planner (checkpoint 2)', async () => {
    const user = await mkUser(db);
    await mkContact(db, user.clerkUserId, { suppressed: true, status: 'not_sent' });
    const listed = await mkContact(db, user.clerkUserId, { email: 'listed@example.com' });
    await db.insert(suppressions).values({ userId: user.clerkUserId, email: 'LISTED@example.com' });
    await mkContact(db, user.clerkUserId); // the only sendable one
    const run = await mkRun(db, user.clerkUserId, { kind: 'manual' });

    const plan = await planRun(db, run.id, { now: TUESDAY_CRON, rng: midRng });
    expect(plan.plannedCount).toBe(1);
    void listed;
  });

  it('selects due follow-ups with threading fields and skips maxed-out threads', async () => {
    const user = await mkUser(db, { followupDays: 5, maxFollowups: 2 });
    const eightDaysAgo = new Date(TUESDAY_CRON.getTime() - 8 * 24 * 3_600_000);

    const due = await mkContact(db, user.clerkUserId, { status: 'sent' });
    await mkMessage(db, user.clerkUserId, due.id, {
      status: 'sent',
      step: 1,
      subject: 'Original subject',
      sentAt: eightDaysAgo,
      rfcMessageId: '<orig@warmline.app>',
    });

    const tooRecent = await mkContact(db, user.clerkUserId, { status: 'sent' });
    await mkMessage(db, user.clerkUserId, tooRecent.id, {
      status: 'sent',
      step: 1,
      sentAt: new Date(TUESDAY_CRON.getTime() - 24 * 3_600_000),
    });

    const maxedOut = await mkContact(db, user.clerkUserId, { status: 'sent' });
    await mkMessage(db, user.clerkUserId, maxedOut.id, {
      status: 'sent',
      step: 3, // initial + 2 follow-ups already
      sentAt: eightDaysAgo,
    });

    const replied = await mkContact(db, user.clerkUserId, {
      status: 'sent',
      repliedAt: new Date(),
    });
    await mkMessage(db, user.clerkUserId, replied.id, {
      status: 'sent',
      step: 1,
      sentAt: eightDaysAgo,
    });

    const run = await mkRun(db, user.clerkUserId, { kind: 'manual' });
    const plan = await planRun(db, run.id, { now: TUESDAY_CRON, rng: midRng });

    expect(plan.plannedCount).toBe(1);
    const [followup] = await db
      .select()
      .from(messages)
      .where(eq(messages.contactId, due.id))
      .then((rows) => rows.filter((r) => r.step === 2));
    expect(followup?.subject).toBe('Re: Original subject');
    expect(followup?.inReplyTo).toBe('<orig@warmline.app>');
    expect(followup?.references).toContain('<orig@warmline.app>');
  });

  it('never double-plans a contact that already has a pending message', async () => {
    const user = await mkUser(db);
    const contact = await mkContact(db, user.clerkUserId, { status: 'not_sent' });
    await mkMessage(db, user.clerkUserId, contact.id, { status: 'queued' });
    const run = await mkRun(db, user.clerkUserId, { kind: 'manual' });

    const plan = await planRun(db, run.id, { now: TUESDAY_CRON, rng: midRng });
    // The orphaned queued message is adopted; no NEW row is created.
    const all = await db.select().from(messages).where(eq(messages.contactId, contact.id));
    expect(all).toHaveLength(1);
    expect(all[0]?.runId).toBe(run.id);
    expect(plan.messageIds).toContain(all[0]?.id);
  });

  it('restricts manual runs to the requested contacts', async () => {
    const user = await mkUser(db);
    const wanted = await mkContact(db, user.clerkUserId);
    await mkContact(db, user.clerkUserId);
    await mkContact(db, user.clerkUserId);
    const run = await mkRun(db, user.clerkUserId, { kind: 'manual' });

    const plan = await planRun(db, run.id, {
      now: TUESDAY_CRON,
      rng: midRng,
      contactIds: [wanted.id],
    });
    expect(plan.plannedCount).toBe(1);
    const [m] = await db.select().from(messages).where(eq(messages.contactId, wanted.id));
    expect(m).toBeDefined();
  });

  it('spaces scheduled_for by the rolled delays starting after the grace period', async () => {
    const user = await mkUser(db, { jitterSeconds: 0, intervalSeconds: 120 });
    for (let i = 0; i < 3; i++) await mkContact(db, user.clerkUserId);
    const run = await mkRun(db, user.clerkUserId, { kind: 'manual' });

    const plan = await planRun(db, run.id, { now: TUESDAY_CRON, rng: midRng });
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.runId, run.id))
      .then((r) =>
        r.sort((a, b) => (a.scheduledFor?.getTime() ?? 0) - (b.scheduledFor?.getTime() ?? 0)),
      );

    const start = TUESDAY_CRON.getTime() + GRACE_MS;
    expect(rows[0]?.scheduledFor?.getTime()).toBe(start);
    expect(rows[1]?.scheduledFor?.getTime()).toBe(start + 120_000);
    expect(rows[2]?.scheduledFor?.getTime()).toBe(start + 240_000);
    expect(plan.plannedCount).toBe(3);
  });

  it('returns an empty plan for a cancelled run', async () => {
    const user = await mkUser(db);
    await mkContact(db, user.clerkUserId);
    const run = await mkRun(db, user.clerkUserId, { kind: 'manual', cancelled: true });
    const plan = await planRun(db, run.id, { now: TUESDAY_CRON });
    expect(plan.plannedCount).toBe(0);
  });
});
